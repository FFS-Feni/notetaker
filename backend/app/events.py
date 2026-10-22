"""События для открытых вкладок.

pg_notify внутри транзакции изменения: PostgreSQL отправит его только после COMMIT,
поэтому вкладка никогда не увидит того, чего ещё (или уже) нет в базе.
"""

import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

CHANNEL = "nt_events"


async def emit(db: AsyncSession, user_id: int, event: str, **data) -> None:
    payload = json.dumps({"user_id": user_id, "type": event, **data}, default=str)
    await db.execute(text("SELECT pg_notify(:ch, :p)"), {"ch": CHANNEL, "p": payload})
