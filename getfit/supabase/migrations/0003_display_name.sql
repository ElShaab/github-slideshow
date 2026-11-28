-- What to call the user.
--
-- Asked for during account setup, straight after the password, and shown on
-- Home. It lives on profiles rather than in auth.users metadata so it travels
-- with the rest of the profile: the same row, the same policy, the same
-- cascade on account deletion, and no second place to look when someone asks
-- what we hold about them.
--
-- Nullable, and stays nullable. Accounts created before this existed have no
-- name, and somebody who skips the step still has a working app — Home just
-- greets them without one.

alter table public.profiles
  add column if not exists display_name text
  check (display_name is null or length(btrim(display_name)) between 1 and 60);

comment on column public.profiles.display_name is
  'What the user asked to be called. Shown on Home; never used for matching.';
