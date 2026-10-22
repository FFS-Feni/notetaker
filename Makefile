.PHONY: up down logs test e2e seed demo psql dev-db chaos

up:        ## всё приложение: база, почта, backend, worker, frontend → http://localhost:5173
	docker compose up -d --build --wait
	@echo "Готово: http://localhost:5173 (demo@example.com / demo12345), письма — http://localhost:8025"

down:
	docker compose down

logs:
	docker compose logs -f backend worker

test:      ## автотесты backend (нужна запущенная база: make up или make dev-db)
	cd backend && uv run pytest -q

e2e:       ## тесты в браузере: две вкладки (нужно запущенное приложение)
	cd e2e && npm ci --no-fund --no-audit && npx playwright test

seed:      ## +5000 заметок в демо-аккаунт
	docker compose exec backend python -m scripts.seed_many

demo:      ## напоминание через 30 секунд: уведомление во всех вкладках + одно письмо
	docker compose exec backend python -m scripts.demo_reminder

psql:      ## консоль базы
	docker compose exec db psql -U notetaker

dev-db:    ## только база и почта — для разработки без Docker-сборки
	docker compose up -d --wait db mailpit

chaos:     ## стресс-тест отказоустойчивости: нагрузка + падения backend, базы, worker’ов (≈2,5 мин)
	cd backend && uv run python -m scripts.chaos
