-- Add color field to roles (for calendar display)
ALTER TABLE roles ADD COLUMN IF NOT EXISTS color text;
