"""Правила напоминаний из задания. Время подменяется: не ждём 10 минут, а «переводим часы»."""

import asyncio
import uuid
from datetime import date, timedelta

from app import worker
from tests.conftest import T0
from tests.helpers import make_note, patch, pending_fire_times

MIN = timedelta(minutes=1)


async def outbox(sql) -> list[str]:
    return [r["subject"] for r in await sql.fetch("SELECT subject FROM email_outbox ORDER BY id")]


async def test_one_email_exactly_at_fire_time(client, sql, clock, mailpit):
    """В момент «время заметки − интервал» уходит письмо. Ровно одно."""
    await make_note(client, start=T0 + 30 * MIN, title="Созвон", reminders=[10])
    assert await worker.dispatch_due(T0 + 19 * MIN) == 0  # рано
    assert await worker.dispatch_due(T0 + 20 * MIN) == 1  # ровно в срок
    assert await worker.dispatch_due(T0 + 21 * MIN) == 0  # второй раз — нет
    assert await worker.send_mail() == 1
    assert await worker.send_mail() == 0
    msgs = (await mailpit.get("/api/v1/messages")).json()["messages"]
    assert [m["Subject"] for m in msgs] == ["Напоминание: Созвон — 22.10.2026 18:30"]  # время — в поясе пользователя


async def test_two_workers_in_parallel_send_one_email(client, sql, clock):
    await make_note(client, start=T0 + 30 * MIN, title="Первая", reminders=[10])
    await make_note(client, start=T0 + 30 * MIN, title="Вторая", reminders=[10])
    sent = await asyncio.gather(*(worker.dispatch_due(T0 + 20 * MIN) for _ in range(4)))
    assert sum(sent) == 2  # четыре worker’а, два напоминания — каждое ушло один раз
    assert len(await outbox(sql)) == 2


async def test_several_reminders_per_note(client, sql):
    note = await make_note(client, start=T0 + timedelta(days=2), reminders=[10, 60, 1440])
    assert await pending_fire_times(sql, note["id"]) == [
        T0 + timedelta(days=1), T0 + timedelta(days=2) - 60 * MIN, T0 + timedelta(days=2) - 10 * MIN,
    ]


async def test_deactivated_note_does_not_remind(client, sql, clock):
    note = await make_note(client, start=T0 + 30 * MIN, reminders=[10])
    await patch(client, note, is_active=False)
    assert await pending_fire_times(sql, note["id"]) == []
    assert await worker.dispatch_due(T0 + 20 * MIN) == 0


async def test_reactivated_before_deadline_reminders_return(client, sql, clock):
    note = await make_note(client, start=T0 + 30 * MIN, reminders=[10])
    note = await patch(client, note, is_active=False)
    clock.set(T0 + 5 * MIN)
    await patch(client, note, is_active=True)
    assert await pending_fire_times(sql, note["id"]) == [T0 + 20 * MIN]
    assert await worker.dispatch_due(T0 + 20 * MIN) == 1


async def test_reactivated_after_deadline_past_reminders_not_sent(client, sql, clock):
    note = await make_note(client, start=T0 + 120 * MIN, reminders=[10, 60])
    note = await patch(client, note, is_active=False)
    clock.set(T0 + 90 * MIN)  # «за час» (T0+60) уже прошло, «за 10 минут» (T0+110) — впереди
    await patch(client, note, is_active=True)
    assert await pending_fire_times(sql, note["id"]) == [T0 + 110 * MIN]


async def test_race_deactivated_after_pick_is_still_not_sent(client, sql, clock):
    """Даже если задание осталось (гонка), диспетчер перепроверяет активность перед отправкой."""
    note = await make_note(client, start=T0 + 30 * MIN, reminders=[10])
    await sql.execute("UPDATE notes SET is_active = false WHERE id = $1", uuid.UUID(note["id"]))
    assert await worker.dispatch_due(T0 + 20 * MIN) == 0
    assert await sql.fetchval("SELECT status FROM reminder_jobs") == "skipped"


async def test_changing_time_or_offset_moves_reminders(client, sql):
    note = await make_note(client, start=T0 + 60 * MIN, reminders=[10])
    note = await patch(client, note, start_at=(T0 + 120 * MIN).isoformat())
    assert await pending_fire_times(sql, note["id"]) == [T0 + 110 * MIN]
    await patch(client, note, reminders=[60])
    assert await pending_fire_times(sql, note["id"]) == [T0 + 60 * MIN]


async def test_delete_cancels_restore_returns_only_future(client, sql, clock):
    note = await make_note(client, start=T0 + timedelta(days=1), reminders=[60, 1440])
    await client.delete(f"/api/notes/{note['id']}")
    assert await pending_fire_times(sql, note["id"]) == []
    clock.set(T0 + 2 * 60 * MIN)  # «за день» (T0) уже прошло
    await client.post(f"/api/trash/{note['id']}/restore")
    assert await pending_fire_times(sql, note["id"]) == [T0 + timedelta(days=1) - 60 * MIN]


async def test_timezone_change_keeps_reminder_moment(client, sql):
    note = await make_note(client, start=T0 + 60 * MIN, reminders=[10])
    before = await pending_fire_times(sql, note["id"])
    await client.patch("/api/settings", json={"timezone": "America/New_York"})
    assert await pending_fire_times(sql, note["id"]) == before
    shown = (await client.get(f"/api/notes/{note['id']}")).json()["start_at"]
    assert shown.startswith("2026-10-22T13:00")  # момент тот же (UTC); перевод в пояс делает экран


async def test_recurring_reminds_every_occurrence_and_horizon_extends(client, sql, clock):
    note = await make_note(client, start=T0 + 60 * MIN, freq="daily", reminders=[10])
    jobs = await pending_fire_times(sql, note["id"])
    assert len(jobs) == 7 and jobs[1] - jobs[0] == timedelta(days=1)
    for day in range(3):
        assert await worker.dispatch_due(T0 + timedelta(days=day) + 50 * MIN) == 1
    clock.set(T0 + timedelta(days=3))
    await worker.extend_horizon(T0 + timedelta(days=3))
    assert len(await pending_fire_times(sql, note["id"])) == 7  # снова неделя вперёд, отправленное не продублировано
    assert await sql.fetchval("SELECT count(*) FROM reminder_jobs WHERE status = 'sent'") == 3


async def test_edit_one_occurrence_only(client, sql):
    note = await make_note(client, start=T0 + 60 * MIN, freq="daily", reminders=[10])
    second = T0 + timedelta(days=1) + 60 * MIN
    moved = second + 30 * MIN
    r = await client.patch(
        f"/api/notes/{note['id']}/occurrences/{second.isoformat()}",
        params={"scope": "this"}, json={"version": note["version"], "start_at": moved.isoformat(), "title": "Перенесли"},
    )
    assert r.status_code == 200, r.text
    occ = (await client.get("/api/occurrences", params={"from": T0.isoformat(), "to": (T0 + timedelta(days=3)).isoformat()})).json()
    assert [(o["title"], o["start"][:16]) for o in occ] == [
        ("Встреча", "2026-10-22T13:00"), ("Перенесли", "2026-10-23T13:30"), ("Встреча", "2026-10-24T13:00"),
    ]
    assert moved - 10 * MIN in await pending_fire_times(sql, note["id"])
    d = await client.delete(
        f"/api/notes/{note['id']}/occurrences/{(T0 + timedelta(days=2) + 60 * MIN).isoformat()}",
        params={"scope": "this", "version": r.json()["version"]},
    )
    assert d.status_code == 204
    occ = (await client.get("/api/occurrences", params={"from": T0.isoformat(), "to": (T0 + timedelta(days=3)).isoformat()})).json()
    assert len(occ) == 2


async def test_change_from_this_day_keeps_past(client, sql, clock):
    note = await make_note(client, start=T0 - timedelta(days=3) + 60 * MIN, freq="daily", reminders=[10], until="2026-11-30")
    split_at = T0 + timedelta(days=2) + 60 * MIN
    r = await client.patch(
        f"/api/notes/{note['id']}/occurrences/{split_at.isoformat()}",
        params={"scope": "following"}, json={"version": note["version"], "start_at": (split_at + 60 * MIN).isoformat()},
    )
    assert r.status_code == 200, r.text
    assert r.json()["until"] == "2026-10-23"  # старая серия — до дня перед разрезом
    frm, to = T0 - timedelta(days=3), T0 + timedelta(days=5)
    occ = (await client.get("/api/occurrences", params={"from": frm.isoformat(), "to": to.isoformat()})).json()
    hours = [o["start"][11:16] for o in occ]
    assert hours == ["13:00"] * 5 + ["14:00"] * 3  # прошлое — как было, с 24.10 — новое время
    new = await sql.fetchrow("SELECT until, split_from FROM notes WHERE split_from IS NOT NULL")
    assert new["until"] == date(2026, 11, 30) and str(new["split_from"]) == note["id"]


async def test_downtime_policy(client, sql, clock, mailpit):
    """Простой: событие впереди — шлём «с опозданием»; событие прошло — пропускаем и даём одну сводку."""
    await make_note(client, start=T0 + 120 * MIN, title="Впереди", reminders=[60])  # fire T0+60
    await make_note(client, start=T0 + 30 * MIN, title="Прошло", reminders=[10])  # fire T0+20
    restart = T0 + 90 * MIN  # сервер лежал с T0+10 до T0+90
    assert await worker.dispatch_due(restart) == 1
    statuses = dict(await sql.fetch("SELECT n.title, j.status FROM reminder_jobs j JOIN notes n ON n.id = j.note_id"))
    assert statuses == {"Впереди": "sent", "Прошло": "skipped"}
    assert await sql.fetchval("SELECT late FROM reminder_jobs WHERE status = 'sent'") is True
    body = await sql.fetchval("SELECT body FROM notifications WHERE kind = 'reminder'")
    assert body.startswith("осталось 30 мин (с опозданием")  # встреча в T0+120, сейчас T0+90
    kinds = [r["kind"] for r in await sql.fetch("SELECT kind FROM notifications ORDER BY id")]
    assert kinds == ["reminder", "missed"]
    assert len(await outbox(sql)) == 1


async def test_notification_shown_once(client, clock):
    await make_note(client, start=T0 + 30 * MIN, reminders=[10])
    await worker.dispatch_due(T0 + 20 * MIN)
    clock.set(T0 + 21 * MIN)
    unshown = (await client.get("/api/notifications", params={"unshown": "true"})).json()
    assert len(unshown) == 1
    await client.post(f"/api/notifications/{unshown[0]['id']}/shown")
    await client.post(f"/api/notifications/{unshown[0]['id']}/shown")  # повтор ничего не меняет
    assert (await client.get("/api/notifications", params={"unshown": "true"})).json() == []  # после F5 не всплывёт


async def test_trash_purged_after_30_days(client, sql):
    note = await make_note(client)
    await client.delete(f"/api/notes/{note['id']}")
    assert await worker.purge_trash(T0 + timedelta(days=29)) == 0
    assert await worker.purge_trash(T0 + timedelta(days=30, minutes=1)) == 1
    assert await sql.fetchval("SELECT count(*) FROM notes") == 0


async def test_expired_sessions_cleaned(client, sql):
    assert await sql.fetchval("SELECT count(*) FROM sessions") == 1
    await worker.purge_trash(T0 + timedelta(days=29))
    assert await sql.fetchval("SELECT count(*) FROM sessions") == 1  # ещё действует
    await worker.purge_trash(T0 + timedelta(days=31))
    assert await sql.fetchval("SELECT count(*) FROM sessions") == 0


async def test_upcoming_today_week_past(client, clock):
    # T0 = 18:00 по Бишкеку
    await make_note(client, start=T0 + 60 * MIN, title="Сегодня")
    await make_note(client, start=T0 + timedelta(days=2), title="На неделе")
    await make_note(client, start=T0 - 60 * MIN, title="Прошла")
    await make_note(client, start=T0 - 120 * MIN, title="Прошла неактивная", is_active=False)
    u = (await client.get("/api/upcoming")).json()
    assert [o["title"] for o in u["today"]] == ["Сегодня"]
    assert [o["title"] for o in u["week"]] == ["На неделе"]
    assert [o["title"] for o in u["past"]] == ["Прошла"]
    clock.set(T0 + 61 * MIN)  # время «Сегодня» прошло
    u = (await client.get("/api/upcoming")).json()
    assert [o["title"] for o in u["past"]] == ["Сегодня", "Прошла"]
