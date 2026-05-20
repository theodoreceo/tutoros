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

export { CACHE, TABLES, dbInsert, dbUpdate, dbDelete, dbFind } from '../core/store.js';
