# Google Sheets synchronization contract

Each data type has one editing source:

- Google Sheets owns groups and lessons.
- Telegram owns students, homework assignments, submissions and reviews.
- Supabase is the private operational database between them.

## Google Sheets to TutorOS

`POST /api/sync-lessons` with header `x-tutoros-sync-secret`.

```json
{
  "groups": [
    {
      "id": "group-b",
      "name": "Группа Б",
      "program": "advanced",
      "sheet_key": "Группа Б",
      "active": true
    }
  ],
  "lessons": [
    {
      "id": "group-b-lesson-01",
      "group_id": "group-b",
      "sheet_lesson_key": "lesson-01",
      "course_month": "Сентябрь",
      "course_week": "1",
      "lesson_number": "1",
      "sequence": 1,
      "topic": "Числа и вычисления",
      "block": "Арифметика",
      "event_type": "lesson",
      "scheduled_date": "2026-09-03",
      "active": true
    }
  ]
}
```

IDs are technical. Group and lesson IDs are derived from stable Sheet
properties; student IDs remain in hidden row 8.

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
