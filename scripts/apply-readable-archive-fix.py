from pathlib import Path
import re


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return updated


bot_path = Path('api/bot.js')
bot = bot_path.read_text()

if 'async function showStudentArchive' in bot:
    print('Readable archive patch already applied')
else:
    bot = replace_once(
        bot,
        "const isSubmittedOnTime = (assignment, submittedAt) =>\n  assignment?.due_date ? moscowDate(submittedAt) <= assignment.due_date : null;",
        "const isSubmittedOnTime = (assignment, submittedAt) =>\n  assignment?.due_date && !assignment?.archived_at\n    ? moscowDate(submittedAt) <= assignment.due_date\n    : null;",
        'archive timing',
    )

    bot = replace_once(
        bot,
        "function buildStudentMetrics(submissions, assignmentMap) {\n  const relevant = submissions.filter(row => row.status !== 'cancelled');\n  const completed = relevant.filter(row => ['submitted', 'checked'].includes(row.status));",
        "function buildStudentMetrics(submissions, assignmentMap) {\n  const relevant = submissions.filter(row => {\n    if (row.status === 'cancelled') return false;\n    if (['submitted', 'checked'].includes(row.status)) return true;\n    return !assignmentMap.get(row.assignment_id)?.archived_at;\n  });\n  const completed = relevant.filter(row => ['submitted', 'checked'].includes(row.status));",
        'student metrics',
    )

    helper_block = r'''async function updateAssignedSubmission\(subId, studentId, changes\) \{.*?\n\}\n\n(?=const studentInviteLink)'''
    helper_replacement = '''async function updateAssignedSubmission(subId, studentId, changes) {
  const updated = await sbPatch(
    'homework_submissions',
    `id=eq.${encodeURIComponent(subId)}` +
      `&student_id=eq.${encodeURIComponent(studentId)}&status=in.(assigned,revision)`,
    changes
  );
  return updated[0] ?? null;
}

async function assignCurrentHomeworkToStudent(student) {
  if (!student?.id || !student?.group_id) return [];
  const assignments = await sbSelect('homework_assignments',
    `group_id=eq.${encodeURIComponent(student.group_id)}&archived_at=is.null&select=id`);
  if (!assignments.length) return [];

  const assignmentIds = assignments.map(assignment => assignment.id);
  const existing = await sbSelect('homework_submissions',
    `student_id=eq.${encodeURIComponent(student.id)}` +
    `&assignment_id=in.(${assignmentIds.join(',')})&select=id,assignment_id,status`);
  const byAssignment = new Map(existing.map(row => [row.assignment_id, row]));
  const result = [];

  for (const assignment of assignments) {
    let submission = byAssignment.get(assignment.id) || null;
    if (!submission) {
      const inserted = await sbInsert('homework_submissions', {
        id: botId(),
        assignment_id: assignment.id,
        student_id: student.id,
        status: 'assigned',
        source: 'vk',
        submitted_at: null,
        score: null,
        comment: '',
      });
      submission = inserted?.[0] ?? null;
    } else if (submission.status === 'cancelled') {
      const restored = await sbPatch('homework_submissions',
        `id=eq.${encodeURIComponent(submission.id)}` +
        `&student_id=eq.${encodeURIComponent(student.id)}&status=eq.cancelled`,
        { status: 'assigned', comment: '' });
      submission = restored?.[0] ?? submission;
    }
    if (submission) result.push(submission);
  }
  return result;
}

async function ensureArchivedSubmission(student, assignmentId) {
  const assignment = await sbOne('homework_assignments',
    `id=eq.${encodeURIComponent(assignmentId)}` +
    `&group_id=eq.${encodeURIComponent(student.group_id)}&archived_at=not.is.null`);
  if (!assignment) return { assignment: null, submission: null };

  let submission = await sbOne('homework_submissions',
    `assignment_id=eq.${encodeURIComponent(assignment.id)}` +
    `&student_id=eq.${encodeURIComponent(student.id)}`);
  if (!submission) {
    const inserted = await sbInsert('homework_submissions', {
      id: botId(),
      assignment_id: assignment.id,
      student_id: student.id,
      status: 'assigned',
      source: 'vk',
      submitted_at: null,
      score: null,
      comment: '',
    });
    submission = inserted?.[0] ?? null;
  } else if (submission.status === 'cancelled') {
    const restored = await sbPatch('homework_submissions',
      `id=eq.${encodeURIComponent(submission.id)}` +
      `&student_id=eq.${encodeURIComponent(student.id)}&status=eq.cancelled`,
      { status: 'assigned', comment: '' });
    submission = restored?.[0] ?? submission;
  }
  return { assignment, submission };
}

async function setHomeworkArchiveState(assignmentId, archived) {
  const updated = await sbPatch('homework_assignments',
    `id=eq.${encodeURIComponent(assignmentId)}`, {
      archived_at: archived ? new Date().toISOString() : null,
    });
  if (!updated.length) throw new Error('ДЗ не найдено.');

  if (!archived) {
    await sbPatch('homework_submissions',
      `assignment_id=eq.${encodeURIComponent(assignmentId)}&status=eq.cancelled`,
      { status: 'assigned' });
  }
  return updated[0];
}

'''
    bot = regex_once(bot, helper_block, helper_replacement, 'homework helpers')

    bot = replace_once(
        bot,
        "    await sbPatch('students', `id=eq.${sm.id}`, { vk_id: tid });\n    await setSession(tid, { step: 'student' });",
        "    await sbPatch('students', `id=eq.${sm.id}`, { vk_id: tid });\n    await assignCurrentHomeworkToStudent({ ...sm, vk_id: tid });\n    await setSession(tid, { step: 'student' });",
        'registration current homework',
    )

    finish_student_pattern = r'''(async function finishStudentCreation\(chatId, tid, rawName, sess\) \{.*?\n  const student = inserted\?\.\[0\];)\n  const token = student\?\.reg_token;'''
    finish_student_replacement = r'''\1
  if (student) await assignCurrentHomeworkToStudent(student);
  const token = student?.reg_token;'''
    bot = regex_once(bot, finish_student_pattern, finish_student_replacement, 'new student current homework')

    student_list_pattern = r'''async function handleStudentListHw\(chatId, student\) \{.*?\n\}\n\n(?=// ── Student: my results)'''
    student_list_replacement = '''async function handleStudentListHw(chatId, student) {
  await assignCurrentHomeworkToStudent(student);
  const subs = await sbSelect('homework_submissions',
    `student_id=eq.${encodeURIComponent(student.id)}&status=in.(assigned,revision)`);

  const aIds = [...new Set(subs.map(sub => sub.assignment_id))];
  const assignments = aIds.length
    ? await sbSelect('homework_assignments',
        `id=in.(${aIds.join(',')})&select=id,topic,due_date,hw_type,archived_at`)
    : [];
  const aMap = Object.fromEntries(assignments.map(assignment => [assignment.id, assignment]));

  const buttons = [];
  const lines = [];
  const pending = subs
    .map(sub => ({ sub, assignment: aMap[sub.assignment_id] }))
    .filter(item => item.assignment && !item.assignment.archived_at)
    .sort((left, right) => {
      const leftDue = left.assignment.due_date || '9999-12-31';
      const rightDue = right.assignment.due_date || '9999-12-31';
      return leftDue.localeCompare(rightDue);
    });
  pending.forEach(({ sub, assignment: a }, index) => {
    const dueLabel = humanDueDate(a.due_date);
    const overdue = a.due_date && a.due_date < todayMoscow();
    const due = ` · ${overdue ? '🔴 ' : ''}${dueLabel}`;
    const type = a.hw_type === 'brief' ? ' [краткий]' : a.hw_type === 'trial' ? ' [пробник]' : '';
    const revision = sub.status === 'revision' ? ' · 🔁 доработка' : '';
    lines.push(`${index + 1}. <b>${a.topic || 'без темы'}</b>${type}${revision}${due}`);
    buttons.push([{
      text: `${overdue ? '🔴' : sub.status === 'revision' ? '🔁' : '📚'} ${(a.topic || 'домашки').slice(0, 28)} · ${dueLabel}`,
      callback_data: `hw:${sub.id}`,
    }]);
  });
  buttons.push([{ text: '📦 архив заданий', callback_data: 'student_arcpg:0' }]);

  if (!lines.length) {
    return send(chatId, 'активных заданий сейчас нет.', kbd(buttons));
  }
  return send(chatId,
    `задания (${lines.length}):\\n\\n${lines.join('\\n')}\\n\\nвыбери для сдачи:`,
    kbd(buttons));
}

async function showStudentArchive(chatId, student, offset = 0) {
  const pageSize = 8;
  const safeOffset = Math.max(0, offset);
  const assignments = await sbSelect('homework_assignments',
    `group_id=eq.${encodeURIComponent(student.group_id)}&archived_at=not.is.null` +
    `&order=assigned_at.desc&limit=${pageSize}&offset=${safeOffset}` +
    `&select=id,topic,due_date,hw_type,assigned_at`);

  if (!assignments.length) {
    return send(chatId,
      safeOffset === 0 ? 'архив заданий пока пуст.' : 'больше архивных заданий нет.',
      kbd([[{ text: '← к текущим заданиям', callback_data: 'student_current' }]]));
  }

  const assignmentIds = assignments.map(assignment => assignment.id);
  const submissions = await sbSelect('homework_submissions',
    `student_id=eq.${encodeURIComponent(student.id)}` +
    `&assignment_id=in.(${assignmentIds.join(',')})` +
    `&select=id,assignment_id,status,score,max_score`);
  const submissionMap = new Map(submissions.map(row => [row.assignment_id, row]));

  const lines = [];
  const buttons = [];
  assignments.forEach((assignment, index) => {
    const submission = submissionMap.get(assignment.id);
    const state = submission?.status === 'checked' ? '✅ выполнено'
      : submission?.status === 'submitted' ? '📤 на проверке'
      : submission?.status === 'revision' ? '🔁 доработка'
      : '📚 можно решить';
    const type = assignment.hw_type === 'brief' ? ' [краткий]'
      : assignment.hw_type === 'trial' ? ' [пробник]' : '';
    lines.push(`${safeOffset + index + 1}. <b>${assignment.topic || 'без темы'}</b>${type} · ${state}`);

    const callback = submission && ['submitted', 'checked'].includes(submission.status)
      ? `my_sub:${submission.id}`
      : submission && ['assigned', 'revision'].includes(submission.status)
        ? `hw:${submission.id}`
        : `arch_hw:${assignment.id}`;
    buttons.push([{
      text: `${state.split(' ')[0]} ${(assignment.topic || 'домашка').slice(0, 34)}`,
      callback_data: callback,
    }]);
  });

  const nav = [];
  if (safeOffset > 0) nav.push({
    text: '←', callback_data: `student_arcpg:${Math.max(0, safeOffset - pageSize)}`,
  });
  if (assignments.length === pageSize) nav.push({
    text: '→', callback_data: `student_arcpg:${safeOffset + pageSize}`,
  });
  if (nav.length) buttons.push(nav);
  buttons.push([{ text: '← к текущим заданиям', callback_data: 'student_current' }]);

  return send(chatId,
    `📦 архив заданий\\n\\n${lines.join('\\n')}\\n\\nстарые задания можно открыть и решить в любое время.`,
    kbd(buttons));
}

'''
    bot = regex_once(bot, student_list_pattern, student_list_replacement, 'student archive list')

    bot = bot.replace(
        "команды:\\n/dz — активные задания\\n/mydz — мои результаты\\n/unlink — отвязать аккаунт",
        "команды:\\n/dz — активные задания\\n/archive — архив заданий\\n/mydz — мои результаты\\n/unlink — отвязать аккаунт",
    )

    bot = replace_once(
        bot,
        "  if (student) {\n    if (text === '/dz')    return handleStudentListHw(chatId, student);\n    if (text === '/mydz')  return showStudentStats(chatId, student);",
        "  if (student) {\n    if (text === '/dz')      return handleStudentListHw(chatId, student);\n    if (text === '/archive') return showStudentArchive(chatId, student, 0);\n    if (text === '/mydz')    return showStudentStats(chatId, student);",
        'student archive command',
    )

    bot = replace_once(bot, '  const data   = cq.data;', '  let data     = cq.data;', 'mutable callback data')

    bot = replace_once(
        bot,
        "    return send(chatId, `убрать ДЗ «<b>${a?.topic || hwId}</b>» в архив?\\n\\nОно исчезнет у учеников, но результаты и файлы сохранятся.`,",
        "    return send(chatId, `убрать ДЗ «<b>${a?.topic || hwId}</b>» в архив?\\n\\nОно исчезнет из текущих заданий, но останется доступно ученикам в архиве. Результаты и файлы сохранятся.`,",
        'archive confirmation',
    )

    bot = replace_once(
        bot,
        "    await sbRpc('set_homework_archived', { p_assignment_id: hwId, p_archived: true });\n    await setSession(tid, { step: 'owner' });\n    return send(chatId, '✅ ДЗ убрано в архив. Результаты и файлы сохранены.', rkbd(OWNER_KBD));",
        "    await setHomeworkArchiveState(hwId, true);\n    await setSession(tid, { step: 'owner' });\n    return send(chatId, '✅ ДЗ убрано в архив. Ученики по-прежнему могут открыть и решить его там.', rkbd(OWNER_KBD));",
        'manual archive',
    )

    bot = replace_once(
        bot,
        "    await sbRpc('set_homework_archived', { p_assignment_id: hwId, p_archived: false });\n    await setSession(tid, { step: 'owner' });\n    return send(chatId, '✅ ДЗ снова активно и вернулось ученикам.', rkbd(OWNER_KBD));",
        "    await setHomeworkArchiveState(hwId, false);\n    await setSession(tid, { step: 'owner' });\n    return send(chatId, '✅ ДЗ снова активно и вернулось ученикам.', rkbd(OWNER_KBD));",
        'manual restore',
    )

    callback_marker = "  // Student taps HW\n  if (data.startsWith('hw:') && student) {"
    callback_replacement = """  if (data === 'student_current' && student) {
    return handleStudentListHw(chatId, student);
  }
  if (data.startsWith('student_arcpg:') && student) {
    return showStudentArchive(chatId, student,
      parseInt(data.slice('student_arcpg:'.length), 10) || 0);
  }
  if (data.startsWith('arch_hw:') && student) {
    const assignmentId = data.slice('arch_hw:'.length);
    const { submission } = await ensureArchivedSubmission(student, assignmentId);
    if (!submission) return send(chatId, 'архивное задание не найдено.');
    if (['submitted', 'checked'].includes(submission.status)) {
      return showStudentSubDetail(chatId, student, submission.id);
    }
    data = `hw:${submission.id}`;
  }

  // Student taps HW
  if (data.startsWith('hw:') && student) {"""
    bot = replace_once(bot, callback_marker, callback_replacement, 'archive callback')

    bot = bot.replace(
        "`id=in.(${aIds.join(',')})&select=id,topic,due_date,hw_type,task_config`",
        "`id=in.(${aIds.join(',')})&select=id,topic,due_date,hw_type,task_config,archived_at`",
        1,
    )
    bot = replace_once(
        bot,
        "`group_id=eq.${encodeURIComponent(student.group_id)}&select=id,topic,due_date,hw_type,task_config`",
        "`group_id=eq.${encodeURIComponent(student.group_id)}&select=id,topic,due_date,hw_type,task_config,archived_at`",
        'owner student archived metrics',
    )

    bot_path.write_text(bot)


smoke_path = Path('tests/smoke.mjs')
smoke = smoke_path.read_text()

if 'const assignmentPatches = [];' not in smoke:
    smoke = replace_once(
        smoke,
        'const studentPatches = [];\nconst groupPatches = [];',
        'const studentPatches = [];\nconst groupPatches = [];\nconst assignmentPatches = [];',
        'smoke assignment patches',
    )

    smoke = replace_once(
        smoke,
        "  if (target.includes('/rest/v1/homework_submissions?')) {",
        "  if (target.endsWith('/rest/v1/homework_submissions') && method === 'POST') {\n    const row = JSON.parse(options.body);\n    submissionRows.push(row);\n    return json([row]);\n  }\n  if (target.includes('/rest/v1/homework_submissions?')) {",
        'smoke submission insert',
    )

    smoke = replace_once(
        smoke,
        "  if (target.includes('/rest/v1/homework_assignments?')) {\n    return json(assignmentRows);\n  }",
        "  if (target.includes('/rest/v1/homework_assignments?') && method === 'PATCH') {\n    const changes = JSON.parse(options.body);\n    assignmentPatches.push(changes);\n    const requestedId = decodeURIComponent(target.match(/id=eq\\.([^&]+)/)?.[1] || '');\n    const matched = assignmentRows.filter(row => !requestedId || row.id === requestedId);\n    matched.forEach(row => Object.assign(row, changes));\n    return json(matched);\n  }\n  if (target.includes('/rest/v1/homework_assignments?')) {\n    return json(assignmentRows);\n  }",
        'smoke assignment patch',
    )

    archive_test_pattern = r'''const archiveResponse = responseRecorder\(\);\nawait botHandler\(vkUpdate\('message_event', \{\n  event_id: 'event-archive'.*?\n\}\n\n(?=sessionState = \{\};\nconst registrationResponse)'''
    archive_test_replacement = '''assignmentRows = [{
  id: 'hw1', group_id: 'g1', topic: 'Архивируемое ДЗ', due_date: '2026-08-10',
  hw_type: 'detailed', archived_at: null,
}];
const archiveResponse = responseRecorder();
await botHandler(vkUpdate('message_event', {
  event_id: 'event-archive', peer_id: 123, user_id: 123,
  payload: { cmd: 'dz_arcok:hw1' },
}), archiveResponse);
assert.ok(assignmentPatches.at(-1).archived_at);
assert.ok(assignmentRows[0].archived_at);
assert.ok(vkCalls.some(call =>
  call.method === 'messages.send' && /убрано в архив/.test(call.message)
));

assignmentRows = [{
  id: 'a-current', group_id: 'g1', topic: 'Текущее ДЗ', due_date: '2026-09-01',
  hw_type: 'detailed', archived_at: null,
}];
submissionRows = [];

'''
    smoke = regex_once(smoke, archive_test_pattern, archive_test_replacement, 'smoke archive test')

    post_registration_marker = """assert.ok(vkCalls.some(call =>
  call.method === 'messages.send' && call.peer_id === '456' && /подключен как Иван Иванов/.test(call.message)
));

sessionState = { step: 'await_files:sub1', data: { files: [] } };"""
    post_registration_replacement = """assert.ok(vkCalls.some(call =>
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
    smoke = replace_once(smoke, post_registration_marker, post_registration_replacement, 'smoke student archive flow')

    smoke_path.write_text(smoke)

print('Readable archive patch applied')
