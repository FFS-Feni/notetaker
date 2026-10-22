"""Гибкие настройки: значения по умолчанию, частичное обновление, проверка, влияние на сервер."""

from datetime import timedelta

from app import worker
from tests.conftest import T0
from tests.helpers import make_note, patch

MIN = timedelta(minutes=1)


async def test_defaults_and_partial_update(client):
    prefs = (await client.get("/api/me")).json()["prefs"]
    assert prefs["priorities"] is True and prefs["focus_limit"] == 3 and prefs["calendar_view"] == "dayGridTwoWeeks"
    r = await client.patch("/api/settings", json={"prefs": {"theme": "dark", "focus": False}})
    assert r.status_code == 200
    r = await client.patch("/api/settings", json={"prefs": {"week_start": 0}})
    prefs = r.json()["prefs"]
    assert (prefs["theme"], prefs["focus"], prefs["week_start"]) == ("dark", False, 0)  # прошлые изменения сохранились


async def test_invalid_prefs_rejected(client):
    for bad in ({"focus_limit": 9}, {"day_start": 18, "day_end": 9}, {"calendar_view": "year"}, {"default_reminders": [5]}):
        assert (await client.patch("/api/settings", json={"prefs": bad})).status_code == 422, bad
    assert (await client.get("/api/me")).json()["prefs"]["focus_limit"] == 3  # ничего не испортилось


async def test_focus_limit_is_configurable(client):
    await client.patch("/api/settings", json={"prefs": {"focus_limit": 1}})
    a, b = await make_note(client, title="А"), await make_note(client, title="Б")
    await patch(client, a, focus_on="2026-10-22")
    r = await client.patch(f"/api/notes/{b['id']}", json={"version": 1, "focus_on": "2026-10-22"})
    assert r.status_code == 409 and "1 из 1" in r.json()["detail"]


async def test_email_reminders_off_keeps_in_app_notification(client, sql):
    await client.patch("/api/settings", json={"prefs": {"email_reminders": False}})
    await make_note(client, start=T0 + 30 * MIN, reminders=[10])
    assert await worker.dispatch_due(T0 + 20 * MIN) == 1
    assert await sql.fetchval("SELECT count(*) FROM email_outbox") == 0
    assert await sql.fetchval("SELECT count(*) FROM notifications") == 1
