import {
  formatDate,
  homeworkOverview,
  humanDueDate,
  lessonDetail,
  lessonsOverview,
  percentOf,
  resultDetail,
  resultsOverview,
  studentByVk,
  submissionCard,
  todayMoscow,
} from './student-core.js';
import { sendVk, vkInlineButton, vkInlineKeyboard } from './channels.js';

const VK_GROUP_TOKEN = process.env.VK_GROUP_TOKEN;
const VK_API_VERSION = process.env.VK_API_VERSION || '5.199';
const OWNER_VK_ID = process.env.OWNER_VK_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const SB = {
  'Content-Type': 'application/json', apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

async function vk(method, params = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, access_token: VK_GROUP_TOKEN, v: VK_API_VERSION })) {
    if (value === undefined || value === null || value === '') continue;
    body.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const response = await fetch(`https://api.vk.com/method/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.error) throw new Error(`VK ${method}: ${result?.error?.error_msg || response.status}`);
  return result?.response;
}

const b = (text, command, color = 'secondary') => vkInlineButton(text, command, color);
const kb = rows => vkInlineKeyboard(rows);
const homeRows = () => [
  [b('✅ Надо выполнить', 'cjm:hw', 'primary')],
  [b('🎓 Занятия', 'cjm:lessons')],
  [b('📊 Результаты', 'cjm:results')],
];

async function resetSession(userId) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/vk_sessions`, {
    method: 'POST',
    headers: { ...SB, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ vk_user_id: userId, state: { step: 'student_cjm' }, updated_at: new Date().toISOString() }),
  }).catch(() => {});
}

function parsedCallback(update) {
  if (update?.type !== 'message_event') return null;
  const object = update.object || {};
  let payload = object.payload || {};
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = {}; } }
  let data = String(payload.cmd || payload.command || '');
  if (data === 'student:home') data = 'cjm:home';
  else if (data === 'student:homework') data = 'cjm:hw';
  else if (data === 'student:materials') data = 'cjm:lessons';
  else if (data === 'student:results' || data === 'my_stats_back') data = 'cjm:results';
  else if (data.startsWith('hw:')) data = `cjm:hwcard:${data.slice(3)}`;
  return {
    data,
    userId: object.user_id,
    peerId: object.peer_id,
    eventId: object.event_id,
    conversationMessageId: object.conversation_message_id,
  };
}

async function answer(cb) {
  if (!cb?.eventId) return;
  await vk('messages.sendMessageEventAnswer', {
    event_id: cb.eventId, user_id: cb.userId, peer_id: cb.peerId,
    event_data: JSON.stringify({ type: 'show_snackbar', text: '✓' }),
  }).catch(() => {});
}

async function render(cb, text, rows) {
  if (cb?.conversationMessageId) {
    try {
      await vk('messages.edit', {
        peer_id: cb.peerId,
        conversation_message_id: cb.conversationMessageId,
        message: text,
        keyboard: kb(rows),
      });
      return true;
    } catch (error) {
      console.warn('VK fast edit fallback:', error?.message || error);
    }
  }
  await sendVk(cb.peerId, text, { keyboard: kb(rows) });
  return true;
}

async function renderHome(cb, student) {
  await resetSession(cb.userId);
  return render(cb, `привет, ${student.name}!\n\nЗдесь то, что надо выполнить, занятия и твои результаты.`, homeRows());
}

async function renderHomework(cb, student) {
  const { todo, review } = await homeworkOverview(student);
  const rows = [];
  const lines = [];
  if (todo.length) {
    lines.push('Нужно сделать');
    for (const { submission, assignment } of todo) {
      const overdue = assignment.due_date && assignment.due_date < todayMoscow();
      lines.push(`${overdue ? '🔴' : '📚'} ${assignment.topic} · ${humanDueDate(assignment.due_date)}`);
      rows.push([b(`${overdue ? '🔴' : '📚'} ${assignment.topic}`.slice(0, 38), `cjm:hwcard:${submission.id}`, overdue ? 'negative' : 'primary')]);
    }
  }
  if (review.length) {
    if (lines.length) lines.push('');
    lines.push('На проверке');
    for (const { submission, assignment } of review) {
      lines.push(`⏳ ${assignment.topic}`);
      rows.push([b(`⏳ ${assignment.topic}`.slice(0, 38), `cjm:hwcard:${submission.id}`)]);
    }
  }
  if (!todo.length && !review.length) lines.push('Все текущие задания закрыты.');
  rows.push([b('← Меню', 'cjm:home')]);
  await resetSession(cb.userId);
  return render(cb, lines.join('\n'), rows);
}

async function renderHomeworkCard(cb, student, submissionId) {
  const row = await submissionCard(student, submissionId);
  if (!row) return render(cb, 'Задание не найдено.', homeRows());
  const { submission, assignment } = row;
  const status = submission.status === 'submitted' ? '⏳ на проверке' : submission.status === 'checked' ? '✅ проверено' : '📚 нужно сделать';
  const rows = [];
  if (assignment.file_id || assignment.telegram_file_id) rows.push([b('📎 Открыть задание', `cjm:hwfile:${assignment.id}`)]);
  if (submission.status === 'assigned') rows.push([b('📤 Сдать работу', `cjm:submit:${submission.id}`, 'primary')]);
  rows.push([b('← К списку', 'cjm:hw')]);
  let text = `${assignment.topic}\n\nстатус: ${status}`;
  if (assignment.due_date) text += `\nдедлайн: ${humanDueDate(assignment.due_date)}`;
  return render(cb, text, rows);
}

async function renderLessons(cb, student) {
  const lessons = await lessonsOverview(student);
  const rows = lessons.map(lesson => [b(`🎓 ${lesson.topic || `Занятие ${lesson.lesson_number || ''}`}`.slice(0, 38), `cjm:lesson:${lesson.id}`)]);
  rows.push([b('← Меню', 'cjm:home')]);
  await resetSession(cb.userId);
  return render(cb, lessons.length ? 'Занятия:' : 'Занятий с материалами пока нет.', rows);
}

async function renderLesson(cb, student, lessonId) {
  const data = await lessonDetail(student, lessonId);
  if (!data) return render(cb, 'Занятие не найдено.', [[b('← К занятиям', 'cjm:lessons')]]);
  const rows = [];
  for (const material of data.materials) {
    const icon = material.material_type === 'recording' ? '🎥' : '📝';
    rows.push([b(`${icon} ${material.title}`.slice(0, 38), `cjm:mat:${material.id}`)]);
  }
  for (const item of data.homework) {
    if (item.submission) rows.push([b(`📚 ${item.assignment.topic}`.slice(0, 38), `cjm:hwcard:${item.submission.id}`)]);
  }
  rows.push([b('← К занятиям', 'cjm:lessons')]);
  const date = data.lesson.scheduled_date || formatDate(data.lesson.created_at);
  return render(cb, `${data.lesson.topic || 'Занятие'}${date ? `\n${date}` : ''}`, rows);
}

async function renderResults(cb, student) {
  const data = await resultsOverview(student);
  const trial = data.lastTrial ? `${data.lastTrial.row.score}/${data.lastTrial.row.max_score || 100}${student.target_score ? ` · цель ${student.target_score}` : ''}` : 'ещё не проводился';
  let text = `📊 Результаты\n\nвыполнено: ${data.completed}/${data.total}\nпоследние 3 ДЗ: ${data.recentAverage === null ? '—' : `${data.recentAverage}%`}\nдинамика: ${data.trend === null ? 'мало данных' : `${data.trend >= 0 ? '+' : ''}${data.trend} п.п.`}\nпоследний пробник: ${trial}`;
  const rows = data.rows.map(({ submission, assignment }) => {
    const pct = percentOf(submission, assignment);
    return [b(`${pct === null ? '✅' : `${pct}%`} ${assignment.topic}`.slice(0, 38), `cjm:result:${submission.id}`)];
  });
  if (!rows.length) text += '\n\nПроверенных работ пока нет.';
  rows.push([b('← Меню', 'cjm:home')]);
  await resetSession(cb.userId);
  return render(cb, text, rows);
}

async function renderResult(cb, student, submissionId) {
  const data = await resultDetail(student, submissionId);
  if (!data) return render(cb, 'Результат не найден.', [[b('← К результатам', 'cjm:results')]]);
  const { submission, assignment, percent } = data;
  let text = `${assignment.topic}\n\n✅ проверено`;
  if (submission.score !== null && submission.score !== undefined) text += `: ${submission.score}/${submission.max_score || 100}${percent !== null ? ` · ${percent}%` : ''}`;
  if (submission.comment) text += `\n\n💬 комментарий:\n${submission.comment}`;
  if (assignment.due_date) text += `\n\n📅 дедлайн: ${assignment.due_date}`;
  if (submission.submitted_at) text += `\n📤 сдано: ${formatDate(submission.submitted_at)}`;
  if (submission.checked_at) text += `\n🔍 проверено: ${formatDate(submission.checked_at)}`;
  if (Array.isArray(submission.student_answers) && submission.student_answers.length) text += `\n\n📝 твои ответы: ${submission.student_answers.join('; ')}`;
  return render(cb, text, [[b('← К результатам', 'cjm:results')]]);
}

export async function handleVkStudentFastNav(update) {
  const cb = parsedCallback(update);
  if (!cb?.userId || !cb?.peerId || (OWNER_VK_ID && String(cb.userId) === String(OWNER_VK_ID))) return false;
  const data = cb.data;
  const supported = data === 'cjm:home' || data === 'cjm:hw' || data === 'cjm:lessons' || data === 'cjm:results'
    || data.startsWith('cjm:hwcard:') || data.startsWith('cjm:lesson:') || data.startsWith('cjm:result:');
  if (!supported) return false;

  // Acknowledge immediately so VK stops showing the loading state while data loads.
  await answer(cb);
  const student = await studentByVk(cb.userId);
  if (!student) return false;

  if (data === 'cjm:home') return renderHome(cb, student);
  if (data === 'cjm:hw') return renderHomework(cb, student);
  if (data === 'cjm:lessons') return renderLessons(cb, student);
  if (data === 'cjm:results') return renderResults(cb, student);
  if (data.startsWith('cjm:hwcard:')) return renderHomeworkCard(cb, student, data.slice('cjm:hwcard:'.length));
  if (data.startsWith('cjm:lesson:')) return renderLesson(cb, student, data.slice('cjm:lesson:'.length));
  if (data.startsWith('cjm:result:')) return renderResult(cb, student, data.slice('cjm:result:'.length));
  return false;
}
