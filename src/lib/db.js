// Data access adapter — swap this file's implementation when migrating to Supabase.
//
// Supabase migration checklist:
//   1. npm install @supabase/supabase-js
//   2. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env
//   3. Create tables matching the schema in src/core/store.js (TABLES constant)
//   4. Enable Row Level Security on every table; add policies per role
//   5. Replace the re-exports below with Supabase-backed implementations
//   6. Replace auth.js PIN logic with supabase.auth (email/password or magic link)
//
// Schema notes for Supabase:
//   - All tables need: id uuid primary key, created_at timestamptz default now()
//   - students: enable realtime so all 5 team members see live CRM updates
//   - history_log: insert-only; disable UPDATE and DELETE via RLS
//   - roles table maps to Supabase custom claims or a separate profiles table
//
// RLS policy template (repeat per table):
//   create policy "team_access" on <table>
//     for all using (auth.role() = 'authenticated');
//
// homework_assignments: group_id references groups(id); lesson_id references lessons(id)
// homework_submissions: assignment_id references homework_assignments(id); student_id references students(id)
// assistant_groups: assistant_id references roles(id); group_id references groups(id); unique(assistant_id, group_id)

import { CACHE, dbInsert, dbUpdate, dbDelete, dbFind, TABLES } from '../core/store.js';
import { uid } from '../utils/helpers.js';

export { CACHE, TABLES, dbInsert, dbUpdate, dbDelete, dbFind };

export const db = {
  homeworks: {
    async getAssignments(groupId) {
      return (CACHE.homework_assignments || []).filter(a => a.group_id === groupId);
    },
    async getQueue(assistantId) {
      // brief-answer HW doesn't go to the review queue
      const briefIds = new Set(
        (CACHE.homework_assignments || []).filter(a => a.hw_type === 'brief').map(a => a.id)
      );
      // null/undefined assistantId = owner = see all submitted
      if (!assistantId) {
        return (CACHE.homework_submissions || []).filter(s => s.status === 'submitted' && !briefIds.has(s.assignment_id));
      }
      const myGroups = await db.assistantGroups.getGroupsByAssistant(assistantId);
      const groupIds = new Set(myGroups.map(ag => ag.group_id));
      const myAssignmentIds = new Set(
        (CACHE.homework_assignments || []).filter(a => groupIds.has(a.group_id)).map(a => a.id)
      );
      return (CACHE.homework_submissions || []).filter(s =>
        s.status === 'submitted' && myAssignmentIds.has(s.assignment_id) && !briefIds.has(s.assignment_id)
      );
    },
    async getSubmission(id) {
      return (CACHE.homework_submissions || []).find(s => s.id === id) || null;
    },
    async createAssignment(data) {
      const record = { id: uid(), assigned_at: new Date().toISOString(), ...data };
      await dbInsert('homework_assignments', record);
      return record;
    },
    async createSubmission(data) {
      const record = {
        id: uid(), submitted_at: null, status: 'assigned', score: null,
        comment: '', errors: [], checked_by: null, checked_at: null,
        source: 'manual', submission_url: '',
        ...data,
      };
      await dbInsert('homework_submissions', record);
      return record;
    },
    async saveReview(submissionId, { score, comment, errors, checkedBy, taskScores, maxScore }) {
      const patch = {
        score, comment, errors: errors || [],
        checked_by: checkedBy, checked_at: new Date().toISOString(), status: 'checked',
      };
      if (taskScores != null) patch.task_scores = taskScores;
      if (maxScore   != null) patch.max_score   = maxScore;
      await dbUpdate('homework_submissions', submissionId, patch);
    },
  },
  assistantGroups: {
    async getGroupsByAssistant(assistantId) {
      return (CACHE.assistant_groups || []).filter(ag => ag.assistant_id === assistantId);
    },
    async getAssistantsByGroup(groupId) {
      return (CACHE.assistant_groups || []).filter(ag => ag.group_id === groupId);
    },
    async assign(assistantId, groupId) {
      const exists = (CACHE.assistant_groups || []).find(ag => ag.assistant_id === assistantId && ag.group_id === groupId);
      if (exists) return;
      await dbInsert('assistant_groups', { id: uid(), assistant_id: assistantId, group_id: groupId });
    },
    async unassign(assistantId, groupId) {
      const rec = (CACHE.assistant_groups || []).find(ag => ag.assistant_id === assistantId && ag.group_id === groupId);
      if (!rec) return;
      await dbDelete('assistant_groups', rec.id);
    },
  },
};
