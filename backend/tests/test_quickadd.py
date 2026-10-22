"""Ввод одной строкой, «напомнить позже» и «готово» из уведомления, чек-листы."""

from datetime import timedelta
from zoneinfo import ZoneInfo

import pytest

from app import worker
from app.quickadd import parse
from tests.conftest import T0
from tests.helpers import make_note, patch, pending_fire_times

TZ = "Asia/Bishkek"  # T0 = четверг 22.10.2026, 18:00 по Бишкеку
MIN = timedelta(minutes=1)


def local(p):
    return p.start_at.astimezone(ZoneInfo(TZ)).strftime("%a %d.%m %H:%M") if p.start_at else None


@pytest.mark.parametrize("text, title, when, extra", [
    ("завтра в 9 позвонить маме #дом !важно", "Позвонить маме", "Fri 23.10 09:00", {"tags": ["дом"], "important": True}),
    ("встреча в пятницу в 15:30 каждую неделю напомнить за час", "Встреча", "Fri 23.10 15:30", {"freq": "weekly", "reminders": [60]}),
    ("в 7 вечера тренировка", "Тренировка", "Thu 22.10 19:00", {}),
    ("в 9 утра йога", "Йога", "Fri 23.10 09:00", {}),  # 9 утра сегодня уже прошло — значит, завтра
    ("сдать отчёт 25.10 !срочно *синий", "Сдать отчёт", "Sun 25.10 09:00", {"urgent": True, "color": "blue"}),
    ("1 ноября день рождения", "День рождения", "Sun 01.11 09:00", {}),
    ("планёрка каждый понедельник в 10", "Планёрка", "Mon 26.10 10:00", {"freq": "weekly"}),
    ("послезавтра вечером кино !!", "Кино", "Sat 24.10 19:00", {"important": True, "urgent": True}),
    ("позвонить в банк", "Позвонить в банк", None, {}),  # «в банк» — не время
    ("31.02 странная дата", "Странная дата", None, {}),  # несуществующая дата не роняет разбор
])
def test_parse_phrases(text, title, when, extra):
    p = parse(text, T0, TZ)
    assert (p.title, local(p)) == (title, when)
    for k, v in extra.items():
        assert getattr(p, k) == v, k


def test_parse_relative():
    assert parse("через 2 часа выпить воды", T0, TZ).start_at == T0 + timedelta(hours=2)
    assert parse("через полчаса созвон", T0, TZ).start_at == T0 + timedelta(minutes=30)
    assert local(parse("через неделю отпуск", T0, TZ)) == "Thu 29.10 09:00"


async def test_quick_create_with_new_and_existing_tags(client):
    home = (await client.post("/api/tags", json={"name": "Дом"})).json()
    preview = (await client.post("/api/notes/parse", json={"text": "завтра в 9 полить цветы #дом #сад !важно"})).json()
    assert preview["tag_ids"] == [home["id"]] and preview["new_tags"] == ["сад"] and "важно" in preview["hints"]
    r = await client.post("/api/notes/quick", json={"text": "завтра в 9 полить цветы #дом #сад !важно"})
    assert r.status_code == 201
    note = r.json()
    assert note["title"] == "Полить цветы" and note["important"] and note["triaged"]
    assert sorted(t["name"] for t in note["tags"]) == ["Дом", "сад"]
    assert note["reminders"] == [10]  # по умолчанию из настроек
    assert (await client.post("/api/notes/quick", json={"text": "#дом !важно"})).status_code == 422  # нет заголовка


async def test_snooze_and_done_from_notification(client, sql, clock):
    note = await make_note(client, start=T0 + 30 * MIN, title="Созвон", reminders=[10])
    await worker.dispatch_due(T0 + 20 * MIN)
    nid = (await sql.fetchval("SELECT id FROM notifications"))
    clock.set(T0 + 21 * MIN)
    r = await client.post(f"/api/notifications/{nid}/snooze", json={"minutes": 10})
    assert r.status_code == 200 and r.json()["shown_at"]
    assert T0 + 31 * MIN in await pending_fire_times(sql, note["id"])
    note = await patch(client, note, title="Созвон с клиентом")  # правка не теряет «напомнить позже»
    assert T0 + 31 * MIN in await pending_fire_times(sql, note["id"])
    assert await worker.dispatch_due(T0 + 31 * MIN) == 1
    body = await sql.fetchval("SELECT body FROM notifications ORDER BY id DESC LIMIT 1")
    assert body.startswith("повторное напоминание · время уже наступило")
    second = await sql.fetchval("SELECT id FROM notifications ORDER BY id DESC LIMIT 1")
    assert (await client.post(f"/api/notifications/{second}/done")).status_code == 200
    assert (await client.get(f"/api/notes/{note['id']}")).json()["is_active"] is False


async def test_done_from_notification_on_recurring_marks_only_this_occurrence(client, clock):
    note = await make_note(client, start=T0 + 30 * MIN, title="Планёрка", freq="daily", reminders=[10])
    await worker.dispatch_due(T0 + 20 * MIN)
    nid = (await client.get("/api/notifications")).json()[0]["id"]
    await client.post(f"/api/notifications/{nid}/done")
    occ = (await client.get("/api/occurrences", params={"from": T0.isoformat(), "to": (T0 + timedelta(days=2)).isoformat()})).json()
    assert [o["is_active"] for o in occ] == [False, True]
    assert (await client.get(f"/api/notes/{note['id']}")).json()["is_active"] is True


async def test_deactivation_cancels_snooze(client, sql, clock):
    note = await make_note(client, start=T0 + 30 * MIN, reminders=[10])
    await worker.dispatch_due(T0 + 20 * MIN)
    nid = (await client.get("/api/notifications")).json()[0]["id"]
    await client.post(f"/api/notifications/{nid}/snooze", json={"minutes": 60})
    await patch(client, note, is_active=False)
    assert await pending_fire_times(sql, note["id"]) == []


async def test_checklist(client):
    note = await make_note(client, title="Покупки", checklist=[{"text": "Молоко"}, {"text": " Хлеб "}])
    assert note["checklist"] == [{"text": "Молоко", "done": False}, {"text": "Хлеб", "done": False}]
    note = await patch(client, note, checklist=[{"text": "Молоко", "done": True}, {"text": "Хлеб", "done": False}])
    assert sum(i["done"] for i in note["checklist"]) == 1
    history = (await client.get(f"/api/notes/{note['id']}/history")).json()
    assert "checklist" in history[0]["changes"]
    bad = await client.patch(f"/api/notes/{note['id']}", json={"version": note["version"], "checklist": [{"text": "  "}]})
    assert bad.status_code == 422
    occ = (await client.get("/api/occurrences", params={"from": T0.isoformat(), "to": (T0 + timedelta(days=1)).isoformat()})).json()
    assert occ[0]["checklist"][0]["done"] is True
