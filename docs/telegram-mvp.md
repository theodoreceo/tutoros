# Telegram MVP rollout

Telegram is the primary TutorOS interface; VK remains a fallback. Both channels use the same Supabase rows for students, homework and submissions.

## 1. Database

Run `supabase/add_telegram_mvp.sql` once in Supabase SQL Editor. It is idempotent.

It adds:

- `students.telegram_id`;
- `telegram_sessions`;
- portable homework Telegram file metadata;
- `lesson_materials` for notes and recording links.

## 2. Vercel environment

Required in Production and Preview:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `OWNER_TELEGRAM_ID`
- optional `TELEGRAM_BOT_USERNAME` (without it the owner screen shows the registration token instead of a ready-made deep link)

Existing Supabase and VK variables stay unchanged.

Open `/api/telegram-status` to verify configuration. It never exposes secret values.

## 3. Webhook

Set the Telegram webhook to:

`https://<production-domain>/api/telegram`

and pass the same `TELEGRAM_WEBHOOK_SECRET` as Telegram's `secret_token`.

The currently configured bot can be checked through `/api/telegram-status`.

## 4. MVP behavior

### Teacher in Telegram

- view groups and student channel status;
- create a manually checked homework assignment;
- optionally attach a PDF/file;
- upload a lesson note;
- add a recording as a URL;
- see submitted work;
- accept work or return it for revision.

A file uploaded in Telegram is immediately mirrored into VK and both platform references are stored in Supabase.

### Student in Telegram

- connect with the same `reg_token` used by TutorOS;
- view current homework;
- open homework files;
- submit text answers for short-answer homework;
- submit one or more photos/files for manually checked homework;
- view notes and recording links;
- view checked results.

Telegram submissions use the same `homework_submissions` row as VK. Telegram-uploaded files are also mirrored to VK so the existing VK teacher interface can open them.

### Notifications

Content created from the Telegram teacher interface is delivered to every connected channel for each student. The daily deadline reminder also sends to both Telegram and VK when both are connected.

## Known MVP boundary

The legacy VK monolith still sends some event-specific notifications only to VK when an action originates inside VK (for example, a student submitting a file from VK). The submission itself is immediately visible in Telegram because the database row is shared; cross-channel push for those legacy VK-originated events should be the next refactor of `api/bot.js`.
