"""Вход, теги, заметки, корзина, список — через HTTP, как это делает браузер."""

import asyncio
from datetime import timedelta

import httpx
import pytest

from tests.conftest import T0
from tests.helpers import make_note, patch


async def test_auth_flow(client):
    assert (await client.get("/api/me")).json()["email"] == "feni@example.com"
    assert (await client.post("/api/auth/logout")).status_code == 204
    assert (await client.get("/api/me")).status_code == 401
    bad = await client.post("/api/auth/login", json={"email": "feni@example.com", "password": "wrong!!"})
    assert bad.status_code == 401
    ok = await client.post("/api/auth/login", json={"email": "FENI@example.com", "password": "secret1"})
    assert ok.status_code == 200
    dup = await client.post("/api/auth/register", json={"email": "Feni@Example.com", "password": "secret1"})
    assert dup.status_code == 409


async def test_other_user_cannot_see_my_note(client):
    from app.main import app

    note = await make_note(client)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as other:
        await other.post("/api/auth/register", json={"email": "other@example.com", "password": "secret1"})
        assert (await other.get(f"/api/notes/{note['id']}")).status_code == 404
        assert (await other.get("/api/notes")).json()["total"] == 0


async def test_tags_crud_and_unique_name(client):
    work = (await client.post("/api/tags", json={"name": "Работа", "color": "#f0a93e"})).json()
    assert (await client.post("/api/tags", json={"name": "работа"})).status_code == 409
    note = await make_note(client, tag_ids=[work["id"]])
    assert [t["name"] for t in note["tags"]] == ["Работа"]
    renamed = await client.patch(f"/api/tags/{work['id']}", json={"name": "Офис", "color": "#000000"})
    assert renamed.json() == {"id": work["id"], "name": "Офис", "color": "#000000"}
    assert (await client.get(f"/api/notes/{note['id']}")).json()["tags"][0]["name"] == "Офис"
    assert (await client.delete(f"/api/tags/{work['id']}")).status_code == 204
    assert (await client.get(f"/api/notes/{note['id']}")).json()["tags"] == []  # заметка осталась, тег снят


async def test_note_versions_and_conflict(client):
    note = await make_note(client, body="текст")
    updated = await patch(client, note, title="Новая встреча", is_active=False)
    assert updated["version"] == 2 and updated["title"] == "Новая встреча" and updated["is_active"] is False
    stale = await client.patch(f"/api/notes/{note['id']}", json={"version": 1, "title": "Моя правка"})
    assert stale.status_code == 409
    detail = stale.json()["detail"]
    assert detail["current"]["title"] == "Новая встреча" and detail["current"]["version"] == 2


async def test_simultaneous_edits_one_wins_other_gets_409(client):
    note = await make_note(client)
    results = await asyncio.gather(
        client.patch(f"/api/notes/{note['id']}", json={"version": 1, "title": "Вкладка 1"}),
        client.patch(f"/api/notes/{note['id']}", json={"version": 1, "title": "Вкладка 2"}),
    )
    assert sorted(r.status_code for r in results) == [200, 409]


async def test_trash_restore_delete_forever(client, clock):
    note = await make_note(client)
    assert (await client.delete(f"/api/notes/{note['id']}")).status_code == 204
    assert (await client.get("/api/notes")).json()["total"] == 0
    trash = (await client.get("/api/trash")).json()
    assert trash[0]["id"] == note["id"] and trash[0]["purge_at"].startswith((T0 + timedelta(days=30)).date().isoformat())
    restored = await client.post(f"/api/trash/{note['id']}/restore")
    assert restored.status_code == 200 and restored.json()["deleted_at"] is None
    await client.delete(f"/api/notes/{note['id']}")
    assert (await client.delete(f"/api/trash/{note['id']}")).status_code == 204
    assert (await client.get(f"/api/notes/{note['id']}")).status_code == 404


async def test_list_search_filters_sort_and_cursor(client, clock):
    home = (await client.post("/api/tags", json={"name": "Дом"})).json()
    for i in range(25):
        clock.set(T0 + timedelta(minutes=i))  # разное время изменения
        await make_note(
            client,
            start=T0 + timedelta(days=25 - i),
            title=f"Заметка {i}",
            body="позвонить в БАНК" if i % 5 == 0 else "",
            is_active=i % 2 == 0,
            tag_ids=[home["id"]] if i < 3 else [],
        )
    found = (await client.get("/api/notes", params={"q": "банк"})).json()
    assert found["total"] == 5
    assert (await client.get("/api/notes", params={"tags": str(home["id"])})).json()["total"] == 3
    assert (await client.get("/api/notes", params={"status": "inactive"})).json()["total"] == 12
    period = {"from": (T0 + timedelta(days=1)).isoformat(), "to": (T0 + timedelta(days=5)).isoformat()}
    assert (await client.get("/api/notes", params=period)).json()["total"] == 4

    by_start = (await client.get("/api/notes", params={"limit": 25})).json()["items"]
    assert [n["title"] for n in by_start][:2] == ["Заметка 24", "Заметка 23"]
    by_updated = (await client.get("/api/notes", params={"sort": "updated", "order": "desc", "limit": 1})).json()
    assert by_updated["items"][0]["title"] == "Заметка 24"

    seen, cursor = [], None
    while True:
        params = {"limit": 7, **({"cursor": cursor} if cursor else {})}
        page = (await client.get("/api/notes", params=params)).json()
        seen += [n["id"] for n in page["items"]]
        if not (cursor := page["next_cursor"]):
            break
    assert len(seen) == len(set(seen)) == 25


async def test_settings_timezone_validation(client):
    assert (await client.patch("/api/settings", json={"timezone": "Mars/Base"})).status_code == 422
    ok = await client.patch("/api/settings", json={"timezone": "Europe/Moscow", "email": "new@example.com"})
    assert ok.json()["timezone"] == "Europe/Moscow" and ok.json()["email"] == "new@example.com"


@pytest.mark.parametrize("payload", [{"title": " "}, {"reminders": [15]}, {"until": "2026-12-01"}])
async def test_note_validation(client, payload):
    data = {"title": "x", "start_at": T0.isoformat(), **payload}
    assert (await client.post("/api/notes", json=data)).status_code == 422
