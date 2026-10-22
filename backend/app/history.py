"""История заметки: кто, когда, откуда и что изменил."""

import re

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.models import Note, NoteEvent, User

TRACKED = ("title", "body", "start_at", "is_active", "freq", "until", "reminders", "important", "urgent",
           "focus_on", "color", "triaged", "tags", "checklist")
_BROWSERS = (("Edg/", "Edge"), ("OPR/", "Opera"), ("YaBrowser", "Яндекс Браузер"), ("Firefox/", "Firefox"),
             ("Chrome/", "Chrome"), ("Safari/", "Safari"))
_SYSTEMS = (("Windows", "Windows"), ("Android", "Android"), ("iPhone", "iPhone"), ("iPad", "iPad"),
            ("Mac OS X", "macOS"), ("CrOS", "ChromeOS"), ("Linux", "Linux"))


def device(user_agent: str) -> str:
    """«Chrome · Windows» из строки браузера; для скриптов и тестов — как есть, коротко."""
    browser = next((name for key, name in _BROWSERS if key in user_agent), "")
    system = next((name for key, name in _SYSTEMS if key in user_agent), "")
    if browser or system:
        return " · ".join(x for x in (browser, system) if x)
    return re.split(r"[/ ]", user_agent)[0][:40] if user_agent else ""


def snapshot(note: Note) -> dict:
    def val(field):
        v = [t.name for t in note.tags] if field == "tags" else getattr(note, field)
        return v.isoformat() if hasattr(v, "isoformat") else v
    return {f: val(f) for f in TRACKED}


async def record(
    db: AsyncSession, note: Note, user: User, request: Request | None, action: str,
    before: dict | None = None, changes: dict | None = None,
) -> None:
    if changes is None:
        after = snapshot(note)
        changes = {} if before is None else {k: [before[k], after[k]] for k in TRACKED if before[k] != after[k]}
        if action == "updated" and not changes:
            return
    db.add(NoteEvent(note_id=note.id, user_id=user.id, at=clock.now(), action=action, changes=changes,
                     device=device(request.headers.get("user-agent", "")) if request else ""))
