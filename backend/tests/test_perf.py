"""Несколько тысяч заметок: поиск, фильтры и листание по курсору остаются быстрыми."""

import time
import uuid

from tests.conftest import T0

N = 5000


async def test_5000_notes_list_and_search_fast(client, sql):
    user_id = await sql.fetchval("SELECT id FROM users")
    await sql.execute(
        """INSERT INTO notes (user_id, title, body, start_at, tz, updated_at)
           SELECT $1, 'Заметка ' || i, CASE WHEN i % 50 = 0 THEN 'позвонить в банк' ELSE 'обычный текст ' || i END,
                  $2::timestamptz + i * interval '1 hour', 'Asia/Bishkek', $2::timestamptz + i * interval '1 minute'
           FROM generate_series(1, $3) i""",
        user_id, T0, N,
    )
    await sql.execute("ANALYZE notes")

    async def timed(params):
        t = time.perf_counter()
        r = await client.get("/api/notes", params=params)
        assert r.status_code == 200
        return r.json(), (time.perf_counter() - t) * 1000

    page, _ = await timed({"limit": 50})  # прогрев
    assert page["total"] == N
    timings = []
    for params in ({"limit": 50}, {"q": "банк"}, {"sort": "updated", "order": "desc"}, {"status": "active", "q": "заметка 4"}):
        _, ms = await timed(params)
        timings.append(ms)
    # Листаем 20 страниц вглубь: курсор, а не OFFSET — дальние страницы не медленнее первых.
    cursor = None
    for _ in range(20):
        page, ms = await timed({"limit": 50, **({"cursor": cursor} if cursor else {})})
        timings.append(ms)
        cursor = page["next_cursor"]
    found, _ = await timed({"q": "банк", "limit": 200})
    assert found["total"] == N // 50  # поиск — по всем заметкам, не по загруженным
    print(f"\nсписок 5000 заметок: среднее {sum(timings) / len(timings):.1f} мс, максимум {max(timings):.1f} мс")
    assert max(timings) < 100
    assert uuid.UUID(page["items"][0]["id"])
