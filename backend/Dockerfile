FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Миграции — при каждом старте (на свежей базе создают схему, на старой ничего не делают).
# Два процесса uvicorn: каждый слушает LISTEN сам, события доходят до всех вкладок.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2"]
