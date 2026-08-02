# Подключение файла статистики

Apps Script больше не читает методическую карту и не передаёт уроки в бот.
Его единственная задача — обновлять отдельный файл статистики.

## Script Properties

В Apps Script → Project Settings → Script Properties должны быть:

- `TUTOROS_API_URL` — рабочий адрес Vercel без `/` в конце;
- `TUTOROS_SYNC_SECRET` — значение `GOOGLE_SHEETS_WEBHOOK_SECRET` из Vercel;
- `TUTOROS_STATS_SPREADSHEET_ID` — ID отдельного файла статистики.

## Подключение

1. Вставьте `Code.gs` в проект Apps Script.
2. Один раз запустите функцию `installTutorOSStatsTrigger`.
3. Подтвердите доступ к нужному Google-аккаунту.

Первое обновление выполнится сразу. Затем данные будут обновляться каждые
10 минут. Для ручного обновления можно запустить `refreshTutorOSStatsFile`.

Методическая таблица для работы скрипта не требуется.
