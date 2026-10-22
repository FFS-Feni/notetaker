"""Заметка, напоминание о которой сработает через 30 секунд. Запуск: make demo.

Откройте приложение в двух вкладках (demo@example.com) и Mailpit (localhost:8025) — через 30 секунд
уведомление всплывёт в обеих вкладках, а в Mailpit придёт одно письмо.
"""

import asyncio
from datetime import timedelta

from sqlalchemy import func, select

from app import clock
from app.db import Session
from app.events import emit
from app.models import Note, User
from app.planner import replan
from app.seed import DEMO_EMAIL, ensure_demo


async def main() -> None:
    await ensure_demo()
    async with Session() as db:
        user = await db.scalar(select(User).where(func.lower(User.email) == DEMO_EMAIL))
        now = clock.now()
        start = (now + timedelta(minutes=10, seconds=30)).replace(microsecond=0)
        note = Note(
            user_id=user.id, title="Демо: напоминание через 30 секунд", body="Проверка: письмо одно, уведомление во всех вкладках.",
            start_at=start, tz=user.timezone, is_active=True, freq="none", reminders=[10], version=1,
            created_at=now, updated_at=now, tags=[],
        )
        db.add(note)
        await db.flush()
        await replan(db, note, now)
        await emit(db, user.id, "notes", id=str(note.id))
        await db.commit()
    print("Готово: через 30 секунд — уведомление во вкладках и письмо в http://localhost:8025")


asyncio.run(main())
