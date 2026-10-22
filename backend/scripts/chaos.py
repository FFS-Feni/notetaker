"""Стресс-тест отказоустойчивости: нагрузка + падения backend, базы и worker’ов. Запуск: make chaos (≈2,5 мин).

Что проверяем:
- сервис сам поднимается после каждого падения, сколько длится недоступность;
- ни одна подтверждённая запись (ответ 201) не теряется;
- напоминания, запланированные на время сбоев, приходят ровно по одному письму — при двух worker’ах и kill -9.
"""

import asyncio
import random
import statistics
import subprocess
import time
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
API, MAILPIT = "http://localhost:8000", "http://localhost:8025"
CLIENTS, DURATION, REMINDERS = 25, 75, 12
EVENTS = [
    (10, "перезапуск backend", ["restart", "backend"]),
    (25, "перезапуск базы данных", ["restart", "db"]),
    (40, "kill -9 обоих worker’ов", ["kill", "-s", "SIGKILL", "worker"]),
    (48, "worker’ы запущены снова", ["up", "-d", "--scale", "worker=2", "worker"]),
]


def compose(*args: str) -> None:
    subprocess.run(["docker", "compose", *args], cwd=ROOT, capture_output=True, check=False)


async def wait_api(c: httpx.AsyncClient) -> None:
    for _ in range(120):
        try:
            if (await c.get("/api/health")).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        await asyncio.sleep(0.5)


async def load(c: httpx.AsyncClient, t0: float, log: list, created: list) -> None:
    ops, weights = ["list", "calendar", "upcoming", "matrix", "create", "edit"], [3, 2, 2, 1, 1, 1]
    while (now := time.monotonic()) - t0 < DURATION:
        op = random.choices(ops, weights)[0]
        start = time.monotonic()
        try:
            if op == "list":
                r = await c.get("/api/notes", params={"q": random.choice(["", "банк", "отчёт"]), "limit": 50})
            elif op == "calendar":
                d = datetime.now(UTC)
                r = await c.get("/api/occurrences", params={"from": d.isoformat(), "to": (d + timedelta(days=31)).isoformat()})
            elif op == "upcoming":
                r = await c.get("/api/upcoming")
            elif op == "matrix":
                r = await c.get("/api/matrix")
            elif op == "create":
                r = await c.post("/api/notes", json={"title": f"Нагрузка {random.random():.6f}", "start_at": (datetime.now(UTC) + timedelta(days=1)).isoformat()})
                if r.status_code == 201:
                    created.append(r.json()["id"])
            else:
                if not created:
                    continue
                n = await c.get(f"/api/notes/{random.choice(created)}")
                r = n if n.status_code != 200 else await c.patch(f"/api/notes/{n.json()['id']}", json={"version": n.json()["version"], "body": "правка под нагрузкой"})
            code = r.status_code
        except httpx.HTTPError:
            code = "нет связи"
        log.append((now - t0, op, code, (time.monotonic() - start) * 1000))
        await asyncio.sleep(0.02)


async def main() -> None:
    compose("up", "-d", "--scale", "worker=2", "worker")
    async with httpx.AsyncClient(base_url=API, timeout=10, limits=httpx.Limits(max_connections=60)) as c:
        await wait_api(c)
        await c.post("/api/auth/register", json={"email": f"chaos-{int(time.time())}@example.com", "password": "secret1"})
        # Напоминания, которые сработают прямо во время сбоев (через 30–75 с).
        run_id = int(time.time())
        titles = [f"Хаос {run_id} №{i}" for i in range(REMINDERS)]
        for i, title in enumerate(titles):
            start = datetime.now(UTC) + timedelta(minutes=10, seconds=30 + i * 4)
            await c.post("/api/notes", json={"title": title, "start_at": start.isoformat(), "reminders": [10]})

        log: list = []
        created: list = []
        t0 = time.monotonic()

        async def chaos():
            for at, name, args in EVENTS:
                await asyncio.sleep(max(0, at - (time.monotonic() - t0)))
                print(f"  {at:>3} с — {name}")
                await asyncio.to_thread(compose, *args)

        print(f"Нагрузка: {CLIENTS} клиентов, {DURATION} с; два worker’а; сбои:")
        await asyncio.gather(chaos(), *(load(c, t0, log, created) for _ in range(CLIENTS)))

        await wait_api(c)
        print("Ждём, пока сработают все напоминания…")
        await asyncio.sleep(40)

        ok = [x for x in log if isinstance(x[2], int) and x[2] < 500]
        bad = [x for x in log if not (isinstance(x[2], int) and x[2] < 500)]
        print(f"\nЗапросов: {len(log)}, успешных: {len(ok)} ({len(ok) / len(log):.1%}), ошибок во время сбоев: {len(bad)}")
        print("Ошибки по видам:", dict(Counter(str(x[2]) for x in bad)))
        lat = sorted(x[3] for x in ok)
        print(f"Время ответа успешных: медиана {statistics.median(lat):.0f} мс, p95 {lat[int(len(lat) * 0.95)]:.0f} мс")
        # Окна недоступности: подряд идущие секунды, где были ошибки.
        secs = sorted({int(x[0]) for x in bad})
        windows, cur = [], []
        for s in secs:
            if cur and s - cur[-1] > 1:
                windows.append(cur)
                cur = []
            cur.append(s)
        if cur:
            windows.append(cur)
        for w in windows:
            print(f"  недоступно с {w[0]} по {w[-1] + 1} с ({w[-1] + 1 - w[0]} с), после — снова отвечает")

        lost = 0
        for note_id in created:
            if (await c.get(f"/api/notes/{note_id}")).status_code != 200:
                lost += 1
        print(f"\nПодтверждённых записей (201): {len(created)}, потеряно: {lost}")

    msgs = httpx.get(f"{MAILPIT}/api/v1/messages", params={"limit": 1000}).json()["messages"]
    per = Counter(t for m in msgs for t in titles if f"{t} —" in m["Subject"])
    missing = [t for t in titles if per[t] == 0]
    dup = {t: n for t, n in per.items() if n > 1}
    print(f"Напоминаний во время сбоев: {REMINDERS}, писем по одному: {sum(1 for t in titles if per[t] == 1)}, "
          f"пропало: {len(missing)}, дублей: {len(dup)}")
    compose("up", "-d", "--scale", "worker=1", "worker")
    ok_all = lost == 0 and not missing and not dup
    print("\nИТОГ:", "всё выдержало ✓" if ok_all else "есть проблемы ✗")
    raise SystemExit(0 if ok_all else 1)


asyncio.run(main())
