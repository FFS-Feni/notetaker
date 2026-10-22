"""Цвета, доска задач, история заметки, фильтры корзины, теги со счётчиком, «Завтра»."""

from datetime import timedelta

from tests.conftest import T0
from tests.helpers import make_note, patch

UA_WIN_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"


async def test_colors_and_color_filter(client):
    await make_note(client, title="Красная", color="red")
    await make_note(client, title="Синяя", color="blue")
    await make_note(client, title="Без цвета")
    assert (await client.post("/api/notes", json={"title": "x", "start_at": T0.isoformat(), "color": "pink"})).status_code == 422
    titles = lambda r: sorted(n["title"] for n in r.json()["items"])
    assert titles(await client.get("/api/notes", params={"color": "red,blue"})) == ["Красная", "Синяя"]
    assert titles(await client.get("/api/notes", params={"color": "none"})) == ["Без цвета"]
    occ = (await client.get("/api/occurrences", params={"from": T0.isoformat(), "to": (T0 + timedelta(days=1)).isoformat()})).json()
    assert {o["title"]: o["color"] for o in occ}["Красная"] == "red"


async def test_marking_important_triages_task(client):
    note = await make_note(client, title="Задача")
    assert note["triaged"] is False
    note = await patch(client, note, important=True)
    assert note["triaged"] is True
    note = await patch(client, note, triaged=False, important=False)  # вернули в «Неразобранные»
    assert (note["triaged"], note["important"]) == (False, False)


async def test_history_who_when_where_what(client):
    await client.patch("/api/settings", json={"name": "Феня"})
    note = await make_note(client, title="Отчёт", color="blue")
    r = await client.patch(f"/api/notes/{note['id']}", json={"version": 1, "title": "Отчёт за квартал", "color": "red"},
                           headers={"user-agent": UA_WIN_CHROME})
    assert r.status_code == 200
    await client.patch(f"/api/notes/{note['id']}", json={"version": 2})  # без изменений — в историю не пишется
    await client.delete(f"/api/notes/{note['id']}")
    history = (await client.get(f"/api/notes/{note['id']}/history")).json()
    assert [h["action"] for h in history] == ["trashed", "updated", "created"]
    upd = history[1]
    assert upd["user_name"] == "Феня" and upd["device"] == "Chrome · Windows"
    assert upd["changes"] == {"title": ["Отчёт", "Отчёт за квартал"], "color": ["blue", "red"]}


async def test_trash_filters(client, clock):
    tag = (await client.post("/api/tags", json={"name": "Дом"})).json()
    for title, kw in (("Купить хлеб", {"tag_ids": [tag["id"]]}), ("Отчёт", {"color": "blue"}), ("Позвонить", {})):
        n = await make_note(client, title=title, **kw)
        await client.delete(f"/api/notes/{n['id']}")
        clock.set(clock.now + timedelta(days=1))
    get = lambda **p: client.get("/api/trash", params=p)
    titles = lambda r: [n["title"] for n in r.json()]
    assert titles(await get(q="хлеб")) == ["Купить хлеб"]
    assert titles(await get(tags=str(tag["id"]))) == ["Купить хлеб"]
    assert titles(await get(color="blue")) == ["Отчёт"]
    assert titles(await get(deleted_from=(T0 + timedelta(hours=12)).isoformat())) == ["Позвонить", "Отчёт"]


async def test_tags_have_counts(client):
    a = (await client.post("/api/tags", json={"name": "А"})).json()
    await client.post("/api/tags", json={"name": "Б"})
    await make_note(client, tag_ids=[a["id"]])
    gone = await make_note(client, tag_ids=[a["id"]])
    await client.delete(f"/api/notes/{gone['id']}")  # в корзине — не считается
    assert {t["name"]: t["count"] for t in (await client.get("/api/tags")).json()} == {"А": 1, "Б": 0}


async def test_upcoming_tomorrow_bucket(client):
    # T0 = 18:00 по Бишкеку → завтра — 23.10
    await make_note(client, start=T0 + timedelta(hours=1), title="Сегодня")
    await make_note(client, start=T0 + timedelta(hours=20), title="Завтра")
    await make_note(client, start=T0 + timedelta(days=3), title="Потом")
    u = (await client.get("/api/upcoming")).json()
    assert ([o["title"] for o in u["today"]], [o["title"] for o in u["tomorrow"]], [o["title"] for o in u["week"]]) == (
        ["Сегодня"], ["Завтра"], ["Потом"])


async def test_color_labels_and_sections_prefs(client):
    r = await client.patch("/api/settings", json={"prefs": {"color_labels": {"red": "Клиенты"}, "upcoming_sections": ["today", "tomorrow"]}})
    prefs = r.json()["prefs"]
    assert prefs["color_labels"]["red"] == "Клиенты" and prefs["color_labels"]["blue"] == "Работа"  # остальные — по умолчанию
    assert prefs["upcoming_sections"] == ["today", "tomorrow"]
    assert (await client.patch("/api/settings", json={"prefs": {"upcoming_sections": ["year"]}})).status_code == 422
