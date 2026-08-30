from pathlib import Path

p = Path('api/bot.js')
s = p.read_text(encoding='utf-8')

marker = "const botId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);\n"
helper = r'''const botId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

async function assignActiveHomeworkToStudent(student) {
  if (!student?.id || !student?.group_id || student.status !== 'active') return 0;

  const assignments = await sbSelect('homework_assignments',
    `group_id=eq.${encodeURIComponent(student.group_id)}&archived_at=is.null&select=id`);
  if (!assignments.length) return 0;

  const assignmentIds = assignments.map(assignment => assignment.id);
  const existing = await sbSelect('homework_submissions',
    `student_id=eq.${encodeURIComponent(student.id)}` +
    `&assignment_id=in.(${assignmentIds.join(',')})&select=assignment_id`);
  const existingIds = new Set(existing.map(row => row.assignment_id));
  const missing = assignments.filter(assignment => !existingIds.has(assignment.id));

  let created = 0;
  for (const assignment of missing) {
    try {
      await sbInsert('homework_submissions', {
        id: botId(),
        assignment_id: assignment.id,
        student_id: student.id,
        status: 'assigned',
        source: 'vk',
        submitted_at: null,
        score: null,
        comment: '',
      });
      created += 1;
    } catch (error) {
      if (!/duplicate key|23505/i.test(String(error?.message || error))) throw error;
    }
  }
  return created;
}
'''
if 'async function assignActiveHomeworkToStudent' not in s:
    if marker not in s:
        raise SystemExit('botId marker not found')
    s = s.replace(marker, helper, 1)

# Assign immediately when a mini-group student record is created.
old = "  const student = inserted?.[0];\n  const token = student?.reg_token;\n"
new = "  const student = inserted?.[0];\n  await assignActiveHomeworkToStudent(student);\n  const token = student?.reg_token;\n"
if old in s:
    s = s.replace(old, new, 1)

# Safety net when a student connects using the invite link/code.
old_reg = "    await sbPatch('students', `id=eq.${sm.id}`, { vk_id: tid });\n    await setSession(tid, { step: 'student' });\n"
new_reg = "    await sbPatch('students', `id=eq.${sm.id}`, { vk_id: tid });\n    await assignActiveHomeworkToStudent({ ...sm, vk_id: tid });\n    await setSession(tid, { step: 'student' });\n"
if old_reg in s:
    s = s.replace(old_reg, new_reg, 1)

# Self-heal missing submission rows whenever the student opens My Assignments.
old_list = "async function handleStudentListHw(chatId, student) {\n  const subs = await sbSelect('homework_submissions',\n"
new_list = "async function handleStudentListHw(chatId, student) {\n  await assignActiveHomeworkToStudent(student);\n  const subs = await sbSelect('homework_submissions',\n"
if old_list in s:
    s = s.replace(old_list, new_list, 1)

p.write_text(s, encoding='utf-8')
