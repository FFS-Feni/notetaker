import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

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


@app.get("/api/health", tags=["служебное"])
async def health():
    return {"ok": True}
