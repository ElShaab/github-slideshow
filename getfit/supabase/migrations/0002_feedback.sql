-- GetFit feedback.
--
-- What the user types into the feedback sheet, and nothing else. It is kept
-- apart from 0001 because it is not the user's data in the sense those tables
-- mean: nothing syncs it back down, no screen reads it, and the device treats
-- a sent message as gone. It travels one way, to whoever is reading feedback.
--
-- Deliberately write-only from the app. There is an insert policy and no
-- select, update or delete policy at all, so the shipped publishable key can
-- add a row and can never read one back — not even the row it just wrote.
-- Feedback is read in the Supabase dashboard, or with the service key on a
-- machine that is allowed to hold one.

create table if not exists public.feedback (
  user_id uuid not null references auth.users (id) on delete cascade,

  -- The id the device minted when the user pressed Send. Paired with user_id
  -- as the primary key so a retry after a lost response is an upsert that
  -- changes nothing, rather than the same message arriving twice. The device
  -- queues feedback it could not deliver, so retries are the normal path, not
  -- the exception.
  id text not null,

  message text not null check (length(btrim(message)) between 1 and 2000),

  -- Which build it came from. Feedback that cannot be tied to a version is
  -- guesswork the moment two versions are in the wild.
  app_version text check (length(app_version) <= 40),
  platform text check (platform in ('ios', 'android', 'web')),

  -- When the user wrote it, not when it arrived. A message typed on a plane
  -- and delivered two days later is dated from the plane.
  written_at timestamptz not null,
  created_at timestamptz not null default now(),

  primary key (user_id, id)
);

comment on table public.feedback is
  'Free-text feedback from the app. Insert-only for clients; read it in the dashboard.';

-- Newest first is the only way anyone reads this table.
create index if not exists feedback_created_at_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

-- `with check` is the whole policy: there is no `using` because there is no
-- read, update or delete to qualify. Without it a client could file feedback
-- under another account's id, which is worth blocking even though nothing here
-- can be read back.
drop policy if exists "insert own feedback" on public.feedback;
create policy "insert own feedback" on public.feedback
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Same stance as every table in 0001: the publishable key identifies the
-- project and is not a credential. Feedback from a signed-out device waits on
-- the device until there is an account behind it.
revoke all on public.feedback from anon;
grant insert on public.feedback to authenticated;
