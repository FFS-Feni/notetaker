import logging
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError

from app.api import account, calendar, live, notes, tags
from app.realtime import hub
from app.seed import ensure_demo


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logging.basicConfig(level=logging.INFO)
    hub.start()
    await ensure_demo()
    yield
    await hub.stop()


app = FastAPI(title="Notetaker API", version="0.1.0", lifespan=lifespan)
for module in (account, tags, notes, calendar, live):
    app.include_router(module.router)


# Обрыв связи с базой (перезапуск, остановка) — понятный 503 вместо 500 с трассировкой; фронтенд сам повторит запрос.
# Настоящие ошибки в коде по-прежнему дают 500.
TRANSIENT = (
    OSError,
    asyncpg.PostgresConnectionError,
    asyncpg.CannotConnectNowError,
    asyncpg.AdminShutdownError,
    asyncpg.InterfaceError,  # в том числе ConnectionDoesNotExistError
    asyncpg.exceptions.InternalClientError,
)


def _is_transient(exc: BaseException | None) -> bool:
    seen = 0
    while exc is not None and seen < 5:  # SQLAlchemy заворачивает ошибку драйвера в несколько слоёв
        if isinstance(exc, TRANSIENT) or (isinstance(exc, DBAPIError) and exc.connection_invalidated):
            return True
        exc = getattr(exc, "orig", None) or exc.__cause__
        seen += 1
    return False


@app.exception_handler(DBAPIError)
@app.exception_handler(OSError)
@app.exception_handler(asyncpg.PostgresError)
@app.exception_handler(asyncpg.InterfaceError)
async def db_unavailable(_request: Request, exc: Exception):
    if not _is_transient(exc):
        raise exc
    logging.getLogger("app").warning("база недоступна: %s", exc)
    return JSONResponse({"detail": "База данных временно недоступна, попробуйте через несколько секунд"}, status_code=503)


@app.get("/api/health", tags=["служебное"])
async def health():
    return {"ok": True}
