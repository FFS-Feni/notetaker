import logging
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import InterfaceError, OperationalError

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


# База перезапускается — понятный 503 вместо 500 с трассировкой; фронтенд сам повторит запрос.
@app.exception_handler(OSError)
@app.exception_handler(OperationalError)
@app.exception_handler(InterfaceError)
@app.exception_handler(asyncpg.PostgresConnectionError)
async def db_unavailable(_request: Request, exc: Exception):
    logging.getLogger("app").warning("база недоступна: %s", exc)
    return JSONResponse({"detail": "База данных временно недоступна, попробуйте через несколько секунд"}, status_code=503)


@app.get("/api/health", tags=["служебное"])
async def health():
    return {"ok": True}
