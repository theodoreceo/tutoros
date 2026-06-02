-- Add missing columns to lessons table
-- Run this in Supabase SQL Editor

alter table lessons
  add column if not exists lesson_type text default 'lesson',
  add column if not exists start_time text,
  add column if not exists duration integer default 60,
  add column if not exists lesson_link text;
