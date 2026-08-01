# Google Sheets synchronization contract

Each data type has one editing source:

- Google Sheets owns reusable course templates.
- Telegram owns actual groups, students, homework assignments, submissions and reviews.
- Supabase is the private operational database between them.

## Google Sheets to TutorOS

`POST /api/sync-course` with header `x-tutoros-sync-secret`.

```json
{
  "templates": [
    {
      "id": "m1234567890abcdef1234",
      "name": "Продвинутая",
      "program": "advanced",
      "sheet_key": "Продвинутая",
      "active": true
    }
  ],
  "lessons": [
    {
      "id": "e1234567890abcdef1234",
      "template_id": "m1234567890abcdef1234",
      "sheet_lesson_key": "lesson-01",
      "course_month": "Сентябрь",
      "course_week": "1",
      "lesson_number": "1",
      "sequence": 1,
      "topic": "Числа и вычисления",
      "block": "Арифметика",
      "event_type": "lesson",
      "active": true
    }
  ]
}
```

Template IDs are short stable hashes so Telegram buttons stay below the
64-byte callback limit. When the owner creates a group, TutorOS makes its own
snapshot of the template lessons. Later template changes therefore cannot
silently rewrite already conducted lessons or issued homework.

## TutorOS to Google Sheets

TutorOS calls `GOOGLE_SHEETS_WEBHOOK_URL` with the same secret in the request
header and JSON body. Apps Script validates the body value because its Web App
handler does not expose arbitrary request headers. Events use this envelope:

```json
{
  "secret": "same-secret-as-vercel",
  "type": "student.created",
  "occurred_at": "2026-07-30T12:00:00.000Z",
  "payload": {}
}
```

The first event types are `student.created`, `homework.created`,
`submission.submitted` and `submission.checked`.

`homework.created` includes the IDs of students who received the assignment.
This lets Sheets calculate an honest completion rate without counting work
that was created before a student joined the group.
