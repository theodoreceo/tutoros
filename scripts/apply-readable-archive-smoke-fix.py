from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)


path = Path('tests/smoke.mjs')
text = path.read_text()

if 'const assignmentPatches = [];' not in text:
    text = replace_once(
        text,
        'const studentPatches = [];\nconst groupPatches = [];',
        'const studentPatches = [];\nconst groupPatches = [];\nconst assignmentPatches = [];',
        'assignment patch tracking',
    )

if "target.endsWith('/rest/v1/homework_submissions') && method === 'POST'" not in text:
    text = replace_once(
        text,
        "  if (target.includes('/rest/v1/homework_submissions?')) {",
        "  if (target.endsWith('/rest/v1/homework_submissions') && method === 'POST') {\n"
        "    const row = JSON.parse(options.body);\n"
        "    submissionRows.push(row);\n"
        "    return json([row]);\n"
        "  }\n"
        "  if (target.includes('/rest/v1/homework_submissions?')) {",
        'submission insert mock',
    )

if "assignmentPatches.push(changes);" not in text:
    text = replace_once(
        text,
        "  if (target.includes('/rest/v1/homework_assignments?')) {\n    return json(assignmentRows);\n  }",
        "  if (target.includes('/rest/v1/homework_assignments?') && method === 'PATCH') {\n"
        "    const changes = JSON.parse(options.body);\n"
        "    assignmentPatches.push(changes);\n"
        "    const requestedId = decodeURIComponent(target.match(/id=eq\\.([^&]+)/)?.[1] || '');\n"
        "    const matched = assignmentRows.filter(row => !requestedId || row.id === requestedId);\n"
        "    matched.forEach(row => Object.assign(row, changes));\n"
        "    return json(matched);\n"
        "  }\n"
        "  if (target.includes('/rest/v1/homework_assignments?')) {\n    return json(assignmentRows);\n  }",
        'assignment patch mock',
    )

if "id: 'hw1', group_id: 'g1', topic: 'Архивируемое ДЗ'" not in text:
    text = replace_once(
        text,
        'const archiveResponse = responseRecorder();',
        "assignmentRows = [{\n"
        "  id: 'hw1', group_id: 'g1', topic: 'Архивируемое ДЗ', due_date: '2026-08-10',\n"
        "  hw_type: 'detailed', archived_at: null,\n"
        "}];\n"
        "const archiveResponse = responseRecorder();",
        'manual archive fixture',
    )

text = text.replace(
    "assert.deepEqual(rpcCalls.at(-1), { p_assignment_id: 'hw1', p_archived: true });",
    "assert.ok(assignmentPatches.at(-1).archived_at);\nassert.ok(assignmentRows[0].archived_at);",
    1,
)

if "id: 'a-current', group_id: 'g1', topic: 'Текущее ДЗ'" not in text:
    text = replace_once(
        text,
        'sessionState = {};\nconst registrationResponse = responseRecorder();',
        "assignmentRows = [{\n"
        "  id: 'a-current', group_id: 'g1', topic: 'Текущее ДЗ', due_date: '2026-09-01',\n"
        "  hw_type: 'detailed', archived_at: null,\n"
        "}];\n"
        "submissionRows = [];\n"
        "sessionState = {};\n"
        "const registrationResponse = responseRecorder();",
        'current homework fixture',
    )

registration_marker = """assert.ok(vkCalls.some(call =>
  call.method === 'messages.send' && call.peer_id === '456' && /подключен как Иван Иванов/.test(call.message)
));

sessionState = { step: 'await_files:sub1', data: { files: [] } };"""

if "row.assignment_id === 'a-current'" not in text:
    archive_flow = """assert.ok(vkCalls.some(call =>
  call.method === 'messages.send' && call.peer_id === '456' && /подключен как Иван Иванов/.test(call.message)
));
assert.ok(submissionRows.some(row =>
  row.assignment_id === 'a-current' && row.student_id === 's1' && row.status === 'assigned'
));

assignmentRows = [{
  id: 'a-old', group_id: 'g1', topic: 'Старое ДЗ', due_date: '2026-08-01',
  hw_type: 'brief', archived_at: '2026-08-02T00:05:00.000Z', answers: ['42'],
}];
submissionRows = [];
const studentArchiveResponse = responseRecorder();
await botHandler(messageUpdate(456, '/archive'), studentArchiveResponse);
assert.match(vkCalls.at(-1).message, /архив заданий/);
assert.ok(JSON.parse(vkCalls.at(-1).keyboard).buttons.flat().some(button =>
  button.action.payload.includes('arch_hw:a-old')
));

const archivedHomeworkResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-archived-homework', peer_id: 456, user_id: 456,
  payload: { cmd: 'arch_hw:a-old' },
}), archivedHomeworkResponse);
assert.equal(submissionRows.length, 1);
assert.equal(submissionRows[0].assignment_id, 'a-old');
assert.equal(submissionRows[0].status, 'assigned');
assert.match(sessionState.step, /^brief_answer:/);

assignmentRows = [];
submissionRows = [];
sessionState = { step: 'await_files:sub1', data: { files: [] } };"""
    text = replace_once(text, registration_marker, archive_flow, 'student archive flow')

path.write_text(text)
print('Readable archive smoke patch applied')
