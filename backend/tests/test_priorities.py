"""Матрица Эйзенхауэра и «Фокус дня» (три главных дела)."""

from datetime import timedelta

from tests.conftest import T0
from tests.helpers import make_note, patch

TODAY = "2026-10-22"  # T0 = 18:00 по Бишкеку


async def test_matrix_quadrants(client):
    await make_note(client, title="Пожар", important=True, urgent=True)
    await make_note(client, title="Стратегия", important=True)
    await make_note(client, title="Звонок", urgent=True)
    await make_note(client, title="Мелочь")
    await make_note(client, title="Неактивная важная", important=True, urgent=True, is_active=False)
    m = (await client.get("/api/matrix")).json()
    assert {q: [n["title"] for n in m[q]["items"]] for q in m} == {
        "do": ["Пожар"], "plan": ["Стратегия"], "delegate": ["Звонок"], "drop": ["Мелочь"],
    }  # неактивные (сделанные) в матрицу не попадают


async def test_moving_between_quadrants_and_filters(client):
    note = await make_note(client, title="Отчёт")
    note = await patch(client, note, important=True)
    note = await patch(client, note, urgent=True)
    assert (note["important"], note["urgent"]) == (True, True)
    await make_note(client, title="Другое", urgent=True)
    q1 = (await client.get("/api/notes", params={"important": "true", "urgent": "true"})).json()
    assert [n["title"] for n in q1["items"]] == ["Отчёт"]
    urgent_only = (await client.get("/api/notes", params={"important": "false", "urgent": "true"})).json()
    assert [n["title"] for n in urgent_only["items"]] == ["Другое"]
    occ = (await client.get("/api/occurrences", params={"from": T0.isoformat(), "to": (T0 + timedelta(days=1)).isoformat()})).json()
    assert {o["title"]: o["important"] for o in occ} == {"Отчёт": True, "Другое": False}


async def test_focus_of_the_day_max_three(client):
    notes = [await make_note(client, title=f"Дело {i}") for i in range(4)]
    for n in notes[:3]:
        await patch(client, n, focus_on=TODAY)
    fourth = await client.patch(f"/api/notes/{notes[3]['id']}", json={"version": 1, "focus_on": TODAY})
    assert fourth.status_code == 409 and "уже 3" in fourth.json()["detail"]
    created = await client.post("/api/notes", json={"title": "Пятое", "start_at": T0.isoformat(), "focus_on": TODAY})
    assert created.status_code == 409  # лимит действует и при создании
    assert [n["title"] for n in (await client.get("/api/upcoming")).json()["focus"]] == ["Дело 0", "Дело 1", "Дело 2"]

    first = (await client.get(f"/api/notes/{notes[0]['id']}")).json()
    await patch(client, first, focus_on=None)  # убрали из фокуса — место освободилось
    await patch(client, notes[3], focus_on=TODAY)
    assert len((await client.get("/api/upcoming")).json()["focus"]) == 3


async def test_focus_other_day_not_shown_today(client):
    note = await make_note(client, title="Вчерашний фокус")
    await patch(client, note, focus_on="2026-10-21")
    assert (await client.get("/api/upcoming")).json()["focus"] == []
