import uuid
from datetime import datetime, timedelta

from tests.conftest import T0


async def make_note(client, start: datetime | None = None, **kw) -> dict:
    data = {"title": "Встреча", "start_at": (start or T0 + timedelta(hours=1)).isoformat(), **kw}
    r = await client.post("/api/notes", json=data)
    assert r.status_code == 201, r.text
    return r.json()


async def patch(client, note: dict, **kw) -> dict:
    r = await client.patch(f"/api/notes/{note['id']}", json={"version": note["version"], **kw})
    assert r.status_code == 200, r.text
    return r.json()


async def pending_fire_times(sql, note_id) -> list[datetime]:
    rows = await sql.fetch(
        "SELECT fire_at FROM reminder_jobs WHERE note_id = $1 AND status = 'pending' ORDER BY fire_at", uuid.UUID(str(note_id))
    )
    return [r["fire_at"] for r in rows]
