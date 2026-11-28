-- GetFit user data.
--
-- The app is offline-first: every read and write still goes to the four
-- documents in on-device storage, and this schema is the copy that survives a
-- lost phone and follows the user to a second one. Shapes here mirror
-- packages/mobile/src/local/documents.ts — profile, program, workouts,
-- assessments — normalised where the data is genuinely row-shaped and left as
-- jsonb where it is a nested tree nothing queries into.
--
-- Primary keys are (user_id, id) with a text id. The id is the one the device
-- generated, so a push is an idempotent upsert and a pull hands back rows the
-- local documents already reference. Pairing it with user_id also makes a
-- cross-user id collision impossible rather than merely unlikely.
--
-- Every table is row-level-secured to auth.uid(). There is no service role in
-- the mobile app and no view that spans users: a signed-in client can reach
-- its own rows and nothing else.

/* ------------------------------- profile ------------------------------ */

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- The identity the device minted before there were accounts. Assessments and
  -- programmes carry it, so it is kept rather than rewritten on sign-in.
  local_user_id text,

  age smallint check (age between 13 and 100),
  sex text check (sex in ('male', 'female')),
  height_cm numeric(5, 1) check (height_cm between 100 and 250),
  weight_kg numeric(5, 1) check (weight_kg between 30 and 300),
  training_level text check (training_level in ('beginner', 'intermediate', 'advanced')),
  training_location text check (training_location in ('home', 'gym')),
  training_days smallint check (training_days between 1 and 7),
  session_duration_minutes smallint check (session_duration_minutes in (15, 30, 45, 60)),
  onboarding_completed boolean not null default false,

  -- True when the user chose their exercises rather than accepting the
  -- generated set. Drives whether onboarding asks again.
  preferences_chosen boolean not null default false,

  theme_mode text not null default 'dark' check (theme_mode in ('dark', 'light', 'system')),
  reduced_motion boolean not null default false,
  units text not null default 'metric' check (units in ('metric', 'imperial')),

  profile_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per account: the user''s body and training settings. Mirrors ProfileDocument.';

create table if not exists public.user_goals (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  goal_type text not null check (
    goal_type in ('muscle_gain', 'fat_loss', 'recomposition', 'strength', 'general_fitness')
  ),
  target_value numeric,
  target_unit text,
  target_exercise_id text,
  start_value numeric,
  is_active boolean not null default true,
  goal_created_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.user_equipment (
  user_id uuid not null references auth.users (id) on delete cascade,
  equipment_id text not null,
  primary key (user_id, equipment_id)
);

create table if not exists public.exercise_preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  muscle_group text not null,
  exercise_ids text[] not null default '{}',
  -- False when the user picked these themselves.
  auto_generated boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, muscle_group)
);

/* ------------------------------- program ------------------------------ */

create table if not exists public.programs (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  version integer not null default 1,
  split_name text not null,
  training_days smallint not null check (training_days between 1 and 7),
  session_duration_minutes smallint not null,
  is_active boolean not null default true,
  generated_at timestamptz,

  -- The day-by-day plan: exercises, sets, rep ranges, cardio. A nested tree the
  -- app always reads whole and never filters on, so it stays a document.
  days jsonb not null default '[]'::jsonb,
  -- Planned weekly volume per muscle (direct + secondary = effective).
  volume_summary jsonb not null default '{}'::jsonb,

  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.scheduled_workouts (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  program_day_id text not null,
  day_number smallint not null,
  focus text not null,
  scheduled_date date not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'missed', 'rescheduled')),
  duration_minutes smallint not null,
  -- The workout that closed this slot. Deliberately not a foreign key: the
  -- device may push the slot before the workout that filled it.
  completed_workout_id text,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- "What is due today" is the one query the schedule answers on every launch.
create index if not exists scheduled_workouts_due_idx
  on public.scheduled_workouts (user_id, scheduled_date)
  where status = 'scheduled';

/* ------------------------------ workouts ------------------------------ */

create table if not exists public.completed_workouts (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  program_day_id text,
  day_number smallint not null,
  focus text not null,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  duration_seconds integer not null check (duration_seconds >= 0),
  total_sets integer not null check (total_sets >= 0),
  total_volume_kg numeric(10, 2) not null default 0,
  cardio_minutes integer not null default 0,

  -- Every set logged, in order. Rows per set would be the textbook shape, but
  -- the app writes a whole workout at once and reads it back whole, and a set
  -- is never queried on its own — so one document per workout it is.
  exercises jsonb not null default '[]'::jsonb,
  -- The records set during this session, kept with the workout so the log
  -- reads back whole. The standing list lives in personal_records below.
  personal_records jsonb not null default '[]'::jsonb,

  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Progress screens read history newest-first.
create index if not exists completed_workouts_recent_idx
  on public.completed_workouts (user_id, completed_at desc);

create table if not exists public.personal_records (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  exercise_id text not null,
  record_type text not null
    check (record_type in ('weight', 'reps', 'estimated_1rm', 'volume')),
  value numeric(10, 2) not null,
  previous_value numeric(10, 2),
  achieved_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists personal_records_exercise_idx
  on public.personal_records (user_id, exercise_id, achieved_at desc);

/* ----------------------------- assessments ---------------------------- */

create table if not exists public.assessments (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,

  assessment_number integer not null check (assessment_number > 0),
  assessed_at timestamptz not null,
  weight_kg numeric(5, 1) not null,

  body_fat_percent numeric(5, 2) not null,
  estimated_muscle_mass_kg numeric(5, 2) not null,
  waist_body_ratio numeric(5, 3) not null,
  -- Null only for readings taken before the estimate existed.
  symmetry_percent numeric(5, 2),
  symmetry_method text,
  method text not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  provider text not null,

  -- The figure the app renders, and the tape readings it was computed from.
  hologram_data jsonb not null default '{}'::jsonb,
  measurements jsonb not null default '{}'::jsonb,

  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Progress photos are deliberately absent. A photo is optional, is never
-- analysed, and stays in the app's private directory on the device; the local
-- record keeps a file path, and that path is not synced because it means
-- nothing anywhere else. Nothing here uploads an image.

create index if not exists assessments_recent_idx
  on public.assessments (user_id, assessed_at desc);

/* ----------------------------- updated_at ----------------------------- */

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'user_goals', 'exercise_preferences', 'programs',
    'scheduled_workouts', 'completed_workouts', 'personal_records', 'assessments'
  ] loop
    execute format(
      'drop trigger if exists touch_updated_at on public.%I', table_name
    );
    execute format(
      'create trigger touch_updated_at before update on public.%I
         for each row execute function public.touch_updated_at()',
      table_name
    );
  end loop;
end;
$$;

/* -------------------------- row level security ------------------------ */

-- Without these policies RLS denies everything, which is the safe default but
-- also a broken app. Each one says the same thing: a row belongs to exactly one
-- account, and only that account may read or write it. `with check` matters as
-- much as `using` — without it a client could insert rows under someone else's
-- id even though it could never read them back.
--
-- auth.uid() is wrapped in a select so Postgres evaluates it once per statement
-- rather than once per row.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'user_goals', 'user_equipment', 'exercise_preferences', 'programs',
    'scheduled_workouts', 'completed_workouts', 'personal_records', 'assessments'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "own rows" on public.%I', table_name);
    execute format(
      'create policy "own rows" on public.%I
         for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))',
      table_name
    );
  end loop;
end;
$$;

-- Anonymous callers get nothing at all. The publishable key alone is not a
-- credential: it identifies the project, and every row above needs a signed-in
-- user behind it.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'user_goals', 'user_equipment', 'exercise_preferences', 'programs',
    'scheduled_workouts', 'completed_workouts', 'personal_records', 'assessments'
  ] loop
    execute format('revoke all on public.%I from anon', table_name);
    execute format(
      'grant select, insert, update, delete on public.%I to authenticated', table_name
    );
  end loop;
end;
$$;

/* --------------------------- account deletion ------------------------- */

-- Deleting the auth record itself needs privileges the app must never carry: a
-- service-role key bypasses every policy above, so one inside a shipped binary
-- would hand anyone who unpacked it the whole database. Instead the privilege
-- lives here, in a function that can delete exactly one row — the caller's own.
--
-- security definer runs it as the owner; the body is not parameterised by
-- anything the caller supplies, and auth.uid() cannot be spoofed by a client,
-- so there is no id to pass and no way to aim it at somebody else. search_path
-- is pinned to empty so a schema on the caller's path cannot shadow auth.users.
--
-- Every table above cascades from auth.users, so this removes the rows too.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not signed in';
  end if;

  delete from auth.users where id = caller;
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
