.PHONY: up down migrate test psql

up:        ## поднять базу и почтовую заглушку
	docker compose up -d --wait

down:
	docker compose down

migrate:   ## применить миграции к рабочей базе
	cd backend && uv run alembic upgrade head

test:      ## автотесты backend (база notetaker_test, нужен make up)
	cd backend && uv run pytest -q

psql:      ## консоль рабочей базы
	docker compose exec db psql -U notetaker
