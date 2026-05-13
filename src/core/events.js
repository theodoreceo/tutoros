import { CACHE, dbInsert } from './store.js';
import { uid } from '../utils/helpers.js';

export async function addEvent(entity_type, entity_id, event_type, payload = {}) {
  const ev = { id: uid(), entity_type, entity_id, event_type, payload, created_at: new Date().toISOString() };
  await dbInsert('events', ev);
  if (!CACHE.events) CACHE.events = [];
  CACHE.events.push(ev);
  return ev;
}

export function studentEvents(sid) {
  return (CACHE.events || []).filter(e => e.entity_id === sid).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}
