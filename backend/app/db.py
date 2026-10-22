from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

# Предсказуемые имена ограничений: миграции не зависят от того, как их назвала база.
NAMING = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


# Пул побольше: при десятках одновременных запросов они не ждут свободного соединения.
engine = create_async_engine(settings.database_url, pool_pre_ping=True, pool_size=20, max_overflow=20)
Session = async_sessionmaker(engine, expire_on_commit=False)
