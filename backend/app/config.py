from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://notetaker:notetaker@localhost:5433/notetaker"
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    mail_from: str = "Notetaker <noreply@notetaker.local>"
    default_timezone: str = "Asia/Bishkek"
    app_url: str = "http://localhost:5173"


settings = Settings()
