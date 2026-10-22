# Требования → как сделано → чем доказано

✅ сделано и доказано тестом или проверкой · ⚠️ сделано с оговоркой (см. README, «Ограничения») · ❌ не делали.
Тесты backend — `backend/tests/` (`make test`), браузерные — `e2e/tests/two-tabs.spec.js` (`make e2e`).

## Общие требования
| # | Требование | Как | Доказательство | |
|---|---|---|---|---|
| 1 | Клиент-сервер, отдельные backend и frontend | FastAPI (:8000) + React (:5173), общаются по HTTP и WebSocket | `docker-compose.yml`: отдельные сервисы | ✅ |
| 2 | Backend Python/Go/Node | Python 3.12 + FastAPI | — | ✅ |
| 3 | Frontend Vue/React | React 19 + TypeScript | — | ✅ |
| 4 | Реляционная СУБД | PostgreSQL 17, схема — миграцией Alembic | `test_schema.py` (13 тестов) | ✅ |
| 5 | Вход | Почта + пароль (argon2), cookie-сессия, демо-аккаунт | `test_auth_flow`, `test_other_user_cannot_see_my_note` | ✅ |
| 6–7 | Промпты / лог решений, работа с агентом | `docs/DECISIONS.md`, `docs/WORKLOG.md`, коммиты с Co-Authored-By | — | ✅ |
| 8–9 | Предварительные требования, быстрый запуск | README; `make up` (≈15 с при собранных образах) | проверено: e2e 5/5 на Docker-версии | ✅ |
| 10 | Заглушки внешних сервисов | Mailpit вместо почты | e2e: письмо проверяется через API Mailpit | ✅ |
| 11 | Две вкладки одновременно | WebSocket + LISTEN/NOTIFY | все 5 e2e — две вкладки | ✅ |
| 12 | Честное описание состояния | README: «Состояние», «Ограничения», «Чего не делали» | — | ✅ |
| 13 | Доказуемость | 48 тестов backend + 5 e2e + `make demo` | — | ✅ |

## Функции
| Функция | Как | Доказательство | |
|---|---|---|---|
| Заметки: поля, создание, правка, удаление, (де)активация | `notes`, `/api/notes` | `test_note_versions_and_conflict`, `test_note_validation` | ✅ |
| Корзина и восстановление | `deleted_at`, `/api/trash` | `test_trash_restore_delete_forever` | ✅ |
| Теги: создание, переименование, удаление, цвет, несколько у заметки | `tags`, `note_tags` | `test_tags_crud_and_unique_name`, `test_tag_*` в схеме | ✅ |
| Повторы: день / неделя / месяц, дата окончания | правило в заметке, развёртка `recurrence.py` | `test_recurrence.py` (5 тестов) | ✅ |
| Изменить / удалить одно вхождение | `occurrence_overrides` | `test_edit_one_occurrence_only` | ✅ |
| Напоминания: несколько (10 мин, час, день) | `notes.reminders` + `reminder_jobs` | `test_several_reminders_per_note` | ✅ |
| Календарь: месяц, неделя, день; клик; перетаскивание | FullCalendar + `/api/occurrences` | e2e «перетаскивание в календаре» | ✅ |
| Список: поиск, фильтры (теги, статус, период), сортировки | серверный поиск, `pg_trgm`, курсор | `test_list_search_filters_sort_and_cursor` | ✅ |
| «Ближайшее»: сегодня, неделя, прошедшие активные | `/api/upcoming` + таймер на клиенте | `test_upcoming_today_week_past`, e2e | ⚠️ прошедшие — за 7 дней |
| Настройки: почта, часовой пояс | `/api/settings` | `test_settings_timezone_validation` | ✅ |

## Ожидаемое поведение
| Поведение | Как | Доказательство | |
|---|---|---|---|
| В момент «время − интервал» у активной заметки — письмо, ровно одно | диспетчер раз в секунду, `SKIP LOCKED`, outbox с уникальным ключом | `test_one_email_exactly_at_fire_time`, `test_two_workers_in_parallel_send_one_email`, e2e (одно письмо в Mailpit) | ⚠️ см. «Ограничения»: падение между SMTP и записью статуса |
| Уведомление в тот же момент во всех вкладках, после F5 не всплывает | текст в событии WebSocket + `shown_at` | e2e «напоминание всплывает во всех вкладках…», `test_notification_shown_once` | ✅ |
| Деактивация, реактивация до срока / после срока | `replan()` + перепроверка в диспетчере | `test_deactivated_note_does_not_remind`, `test_reactivated_before_deadline_reminders_return`, `test_reactivated_after_deadline_past_reminders_not_sent`, `test_race_deactivated_after_pick_is_still_not_sent` | ✅ |
| Перенос времени/интервала; удаление отменяет; восстановление возвращает будущие | `replan()` в транзакции изменения | `test_changing_time_or_offset_moves_reminders`, `test_delete_cancels_restore_returns_only_future` | ✅ |
| Корзина очищается через 30 дней | worker раз в час | `test_trash_purged_after_30_days` | ✅ |
| Повтор напоминает о каждом вхождении; «начиная с этого дня» не трогает прошлое | горизонт 7 дней + продление; разрез серии | `test_recurring_reminds_every_occurrence_and_horizon_extends`, `test_change_from_this_day_keeps_past` | ✅ |
| Две вкладки / устройства видят одно и то же; календарь, список, «Ближайшее» обновляются | `NOTIFY` → LISTEN → WebSocket → перезапрос | e2e «правка в одной вкладке сразу видна в другой»; событие доходит за ~15 мс | ✅ |
| Одновременная правка не теряется молча | версия, 409, баннер в редакторе | `test_simultaneous_edits_one_wins_other_gets_409`, e2e «одновременная правка» | ✅ |
| Время в поясе пользователя; смена пояса не меняет момент напоминания | UTC в базе, пояс — на экране | `test_timezone_change_keeps_reminder_moment` | ✅ |
| Прошедшая заметка уходит в «прошедшие» без обновления | таймер на ближайшее начало + сверка раз в минуту | e2e «Ближайшее: наступило время…», `test_upcoming_today_week_past` | ✅ |
| Поиск и фильтры по всем заметкам; тысячи без задержек | сервер, индексы, курсор, виртуализация | `test_5000_notes_list_and_search_fast` (≈5 мс в среднем) | ✅ |
| После перезапуска всё на месте; политика простоя | Postgres на volume; просрочено > 1 мин: событие впереди — «с опозданием», прошло — пропуск + сводка | `test_downtime_policy`; ручная проверка `docker compose restart` | ✅ |
