-- Require profile emails to be legitimate email-shaped values.
-- The login "username" for Supabase Auth is the email address; public
-- profiles.username remains a display nickname and should not expose emails.

alter table public.profiles
  add constraint profiles_email_valid_chk
  check (email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$')
  not valid;

comment on constraint profiles_email_valid_chk on public.profiles is
  'Requires public.profiles.email to be a valid email-shaped login identifier for new or updated rows.';
