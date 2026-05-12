import { CACHE, dbInsert } from './store.js';
import { uid } from '../utils/helpers.js';
import { state } from './state.js';

export function addEvent(studentId, type, payload = {}) {
  return dbInsert('events', {
    id: uid(),
    studentId,
    type,
    payload,
    actor: state.currentRole ? state.currentRole.name : 'Система',
    createdAt: new Date().toISOString(),
  });
}

export function studentEvents(studentId) {
  return CACHE.events
    .filter(e => e.studentId === studentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Human-readable event label
export function eventLabel(ev) {
  const map = {
    status_change:   (p) => `Статус → ${p.to}${p.note ? ` (${p.note})` : ''}`,
    lesson_added:    (p) => `Урок добавлен: ${p.date || ''}`,
    lesson_done:     (p) => `Урок проведён: ${p.topic || ''}`,
    payment_added:   (p) => `Оплата ${p.amount ? p.amount + ' ₽' : ''}`,
    payment_deleted: ()  => 'Оплата удалена',
    note_added:      ()  => 'Заметка добавлена',
    task_created:    (p) => `Задача: ${p.title || ''}`,
  };
  const fn = map[ev.type] || ((p) => ev.type);
  return fn(ev.payload || {});
}
