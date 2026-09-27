// api/remind.js — Vercel Cron Function (runs daily).
// Sends each reminder to every connected student channel.

import {
  sendStudentEverywhere,
  tgInlineKeyboard,
  vkInlineButton,
  vkInlineKeyboard,
} from './_lib/channels.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY;

const SB_HEADERS = {
  'Content-Type': 'application/json',
  apikey: SUPABASE_SECRET_KEY,
  Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
};

async function sbSelect(table, qs = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: SB_HEADERS });
  if (!r.ok) throw new Error(`sbSelect ${table}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function sbInsert(table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!r.ok && r.status !== 409) throw new Error(`sbInsert ${table}: ${r.status} ${await r.text()}`);
  return r.status !== 409;
}

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const submissions = await sbSelect(
    'homework_submissions',
    'status=in.(assigned,revision)&select=id,student_id,assignment_id'
  );
  if (!submissions.length) return res.status(200).json({ sent_students: 0, sent_channels: 0 });

  const assignmentIds = [...new Set(submissions.map(s => s.assignment_id))];
  const studentIds = [...new Set(submissions.map(s => s.student_id))];

  const [assignments, students] = await Promise.all([
    sbSelect('homework_assignments',
      `id=in.(${assignmentIds.join(',')})&due_date=eq.${tomorrowStr}` +
      '&archived_at=is.null&select=id,topic'),
    sbSelect('students',
      `id=in.(${studentIds.join(',')})&status=eq.active&select=id,vk_id,telegram_id,name`),
  ]);

  if (!assignments.length || !students.length) {
    return res.status(200).json({ sent_students: 0, sent_channels: 0 });
  }

  const aSet = new Set(assignments.map(a => a.id));
  const aMap = Object.fromEntries(assignments.map(a => [a.id, a]));
  const stuMap = Object.fromEntries(students.map(s => [s.id, s]));
  const targets = submissions.filter(sub => aSet.has(sub.assignment_id) && stuMap[sub.student_id]);

  let sentStudents = 0;
  let sentChannels = 0;
  let skipped = 0;
  let failedChannels = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const sub of targets) {
    const student = stuMap[sub.student_id];
    const assignment = aMap[sub.assignment_id];
    const isNew = await sbInsert('sent_reminders', {
      student_id: sub.student_id,
      assignment_id: sub.assignment_id,
      sent_date: today,
    });
    if (!isNew) { skipped++; continue; }

    const result = await sendStudentEverywhere(student, {
      text: `⏰ завтра дедлайн по ДЗ «<b>${assignment.topic}</b>». не забудь сдать!`,
      telegramReplyMarkup: tgInlineKeyboard([[
        { text: '📚 открыть задание', callback_data: `hw:${sub.id}` },
      ]]),
      vkKeyboard: vkInlineKeyboard([[
        vkInlineButton('📚 открыть задание', `hw:${sub.id}`),
      ]]),
    });

    const delivered = [result.telegram, result.vk].filter(value => value === true).length;
    const failed = [result.telegram, result.vk].filter(value => value === false).length;
    if (delivered) sentStudents++;
    sentChannels += delivered;
    failedChannels += failed;
  }

  return res.status(200).json({
    sent_students: sentStudents,
    sent_channels: sentChannels,
    failed_channels: failedChannels,
    skipped,
  });
}
