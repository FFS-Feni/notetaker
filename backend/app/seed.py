"""Демо-аккаунт с примерами — чтобы проверяющий сразу увидел календарь, повторы, теги и корзину."""

import logging
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app import clock
from app.config import settings
from app.db import Session
from app.models import Note, Tag, User
from app.planner import replan
from app.security import hash_password

DEMO_EMAIL = "demo@example.com"
DEMO_PASSWORD = "demo12345"
log = logging.getLogger(__name__)


async def ensure_demo() -> None:
    async with Session() as db:
        if await db.scalar(select(User.id).where(func.lower(User.email) == DEMO_EMAIL)):
            return
        now = clock.now()
        tz = settings.default_timezone
        zone = ZoneInfo(tz)
        today = now.astimezone(zone).date()

        def at(days: int, hh: int, mm: int = 0) -> datetime:
            return datetime.combine(today + timedelta(days=days), time(hh, mm), zone).astimezone(UTC)

        user = User(email=DEMO_EMAIL, password_hash=hash_password(DEMO_PASSWORD), timezone=tz, prefs={}, created_at=now)
        db.add(user)
        try:
            await db.flush()
        except IntegrityError:  # второй экземпляр API успел раньше
            return
        work, home, health, study = (
            Tag(user_id=user.id, name=n, color=c)
            for n, c in (("Работа", "#f0a93e"), ("Дом", "#5cb0ee"), ("Здоровье", "#e7799e"), ("Учёба", "#47c2a2"))
        )
        db.add_all([work, home, health, study])
        soon = (now + timedelta(minutes=75)).replace(second=0, microsecond=0)
        specs = [  # заголовок, текст, начало, повтор, напоминания, теги, активна, удалена, важно, срочно, в фокусе
            ("Планёрка", "Короткий созвон команды.", at(-3, 9), "daily", [10], [work], True, None, False, False, False),
            ("Встреча с подрядчиком", "Обсудить сроки и смету.", soon, "none", [10, 60], [work], True, None, True, True, True),
            ("Тренировка", "", at(1, 19), "weekly", [60], [health], True, None, True, False, False),
            ("Оплатить интернет", "Личный кабинет провайдера.", at(3, 10), "monthly", [1440], [home], True, None, False, True, False),
            ("Сдать отчёт", "Квартальный отчёт.", at(4, 12), "none", [1440, 60], [work, study], True, None, True, False, True),
            ("Купить лекарство", "", at(-1, 18), "none", [], [health], True, None, False, True, False),
            ("Позвонить в банк", "Уточнить про банковскую карту.", at(2, 11), "none", [10], [home], False, None, False, False, False),
            ("Старый список покупок", "Молоко, хлеб.", at(-5, 12), "none", [], [home], True, now - timedelta(days=3), False, False, False),
        ]
        for title, body, start, freq, reminders, tags, active, deleted, important, urgent, focus in specs:
            note = Note(
                user_id=user.id, title=title, body=body, start_at=start, tz=tz, is_active=active, freq=freq,
                reminders=reminders, version=1, created_at=now, updated_at=now, deleted_at=deleted, tags=tags,
                important=important, urgent=urgent, focus_on=today if focus else None,
            )
            db.add(note)
            await db.flush()
            await replan(db, note, now)
        await db.commit()
        log.info("создан демо-аккаунт %s", DEMO_EMAIL)
