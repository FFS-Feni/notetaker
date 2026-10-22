"""5000 заметок в демо-аккаунт — проверить поиск и листание на объёме. Запуск: make seed."""

import asyncio

from sqlalchemy import text

from app.db import Session
from app.seed import DEMO_EMAIL, ensure_demo

N = 5000


async def main() -> None:
    await ensure_demo()
    async with Session() as db:
        await db.execute(
            text(
                """INSERT INTO notes (user_id, title, body, start_at, tz, is_active, updated_at)
                   SELECT u.id, 'Заметка №' || i,
                          (ARRAY['позвонить в банк', 'купить продукты', 'прочитать статью', 'написать отчёт', ''])[1 + i % 5],
                          now() + (i - 2500) * interval '3 hours', u.timezone, i % 7 <> 0, now() - i * interval '1 minute'
                   FROM users u, generate_series(1, :n) i WHERE lower(u.email) = :email"""
            ),
            {"n": N, "email": DEMO_EMAIL},
        )
        await db.execute(text("SELECT pg_notify('nt_events', json_build_object('user_id', id, 'type', 'notes')::text) FROM users WHERE lower(email) = :email"), {"email": DEMO_EMAIL})
        await db.commit()
    print(f"Добавлено {N} заметок в {DEMO_EMAIL}")


asyncio.run(main())
