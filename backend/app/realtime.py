"""Живые обновления: PostgreSQL LISTEN → WebSocket всех вкладок пользователя.

События приходят и от API, и от worker’а (сработало напоминание): все пишут pg_notify в канал nt_events.
Если соединение с базой оборвалось — переподключаемся; вкладки после своего переподключения перезапрашивают всё.
"""

import asyncio
import json
import logging
from collections import defaultdict

import asyncpg
from fastapi import WebSocket

from app.config import settings
from app.events import CHANNEL

log = logging.getLogger(__name__)


class Hub:
    def __init__(self) -> None:
        self.sockets: dict[int, set[WebSocket]] = defaultdict(set)
        self._task: asyncio.Task | None = None

    def add(self, user_id: int, ws: WebSocket) -> None:
        self.sockets[user_id].add(ws)

    def remove(self, user_id: int, ws: WebSocket) -> None:
        self.sockets[user_id].discard(ws)

    def start(self) -> None:
        self._task = asyncio.create_task(self._listen_forever())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()

    async def _listen_forever(self) -> None:
        dsn = settings.database_url.replace("+asyncpg", "")
        while True:
            try:
                conn = await asyncpg.connect(dsn)
                closed = asyncio.Event()
                conn.add_termination_listener(lambda _c: closed.set())
                await conn.add_listener(CHANNEL, self._on_event)
                log.info("LISTEN %s", CHANNEL)
                await closed.wait()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("LISTEN оборвался, переподключаюсь")
            await asyncio.sleep(1)

    def _on_event(self, _conn, _pid, _channel, payload: str) -> None:
        user_id = json.loads(payload).get("user_id")
        for ws in list(self.sockets.get(user_id, ())):
            asyncio.create_task(self._send(user_id, ws, payload))

    async def _send(self, user_id: int, ws: WebSocket, payload: str) -> None:
        try:
            await ws.send_text(payload)
        except Exception:
            self.remove(user_id, ws)


hub = Hub()
