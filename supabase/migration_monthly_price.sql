-- Add monthly_price column to students table
alter table students add column if not exists monthly_price numeric default null;

-- Optional: migrate existing data from price_per_hour * lessons_per_month
update students
set monthly_price = price_per_hour * lessons_per_month
where monthly_price is null
  and price_per_hour is not null
  and lessons_per_month is not null
  and price_per_hour > 0
  and lessons_per_month > 0;
