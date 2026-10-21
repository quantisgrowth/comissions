-- Existing tables remain private; no permissions or policies are changed.
alter table public.cm_invites
  add column if not exists attempts integer not null default 0
  check (attempts between 0 and 3);
