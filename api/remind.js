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

function moscowDate(offsetDays = 0) {
  const shifted = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(shifted);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const tomorrowStr = moscowDate(1);
  const today = moscowDate(0);

  const submissions = await sbSelect(
    'homework_submissions',
    'status=eq.assigned&select=id,student_id,assignment_id'
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

  for (const sub of targets) {
    const existing = await sbSelect(
      'sent_reminders',
      `student_id=eq.${encodeURIComponent(sub.student_id)}` +
      `&assignment_id=eq.${encodeURIComponent(sub.assignment_id)}` +
      `&sent_date=eq.${today}&select=student_id&limit=1`
    );
    if (existing.length) { skipped++; continue; }

    const student = stuMap[sub.student_id];
    const assignment = aMap[sub.assignment_id];
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
    if (delivered) {
      sentStudents++;
      await sbInsert('sent_reminders', {
        student_id: sub.student_id,
        assignment_id: sub.assignment_id,
        sent_date: today,
      });
    }
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
