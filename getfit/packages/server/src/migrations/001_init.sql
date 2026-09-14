-- GetFit — initial schema.
-- Every user-owned row carries a user_id FK with ON DELETE CASCADE so that
-- account deletion removes the user's data in one statement.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE,
  password_hash   TEXT,
  is_guest        BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX users_email_unique_idx ON users (LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX users_created_at_idx ON users (created_at);

CREATE TABLE user_profiles (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  age                      INTEGER NOT NULL CHECK (age BETWEEN 13 AND 100),
  sex                      TEXT NOT NULL CHECK (sex IN ('male', 'female')),
  height_cm                NUMERIC(5,1) NOT NULL CHECK (height_cm BETWEEN 120 AND 250),
  weight_kg                NUMERIC(5,1) NOT NULL CHECK (weight_kg BETWEEN 30 AND 300),
  training_level           TEXT NOT NULL CHECK (training_level IN ('beginner','intermediate','advanced')),
  training_location        TEXT NOT NULL CHECK (training_location IN ('home','gym')),
  training_days            INTEGER NOT NULL CHECK (training_days BETWEEN 1 AND 7),
  session_duration_minutes INTEGER NOT NULL CHECK (session_duration_minutes IN (15,30,45,60)),
  onboarding_completed     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX user_profiles_user_id_idx ON user_profiles (user_id);

CREATE TABLE user_goals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_type          TEXT NOT NULL CHECK (goal_type IN ('muscle_gain','fat_loss','recomposition','strength','general_fitness')),
  target_value       NUMERIC(8,2),
  target_unit        TEXT,
  target_exercise_id TEXT,
  start_value        NUMERIC(8,2),
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX user_goals_active_unique_idx ON user_goals (user_id, goal_type) WHERE is_active;
CREATE INDEX user_goals_user_id_idx ON user_goals (user_id);

CREATE TABLE user_equipment (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  equipment_id TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, equipment_id)
);

CREATE INDEX user_equipment_user_id_idx ON user_equipment (user_id);

/* ------------------------------------------------------------------ */
/* Exercise library                                                    */
/* ------------------------------------------------------------------ */

CREATE TABLE muscle_groups (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  region           TEXT NOT NULL CHECK (region IN ('upper','lower','core')),
  is_major         BOOLEAN NOT NULL,
  weekly_sets_min  INTEGER NOT NULL,
  weekly_sets_max  INTEGER NOT NULL,
  display_order    INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE exercises (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  primary_muscle    TEXT NOT NULL REFERENCES muscle_groups(id),
  secondary_muscles TEXT[] NOT NULL DEFAULT '{}',
  equipment         TEXT[] NOT NULL DEFAULT '{}',
  availability      TEXT NOT NULL CHECK (availability IN ('home','gym','both')),
  difficulty        TEXT NOT NULL CHECK (difficulty IN ('beginner','intermediate','advanced')),
  is_compound       BOOLEAN NOT NULL,
  category          TEXT NOT NULL,
  instructions      TEXT NOT NULL,
  setup             TEXT[] NOT NULL DEFAULT '{}',
  execution         TEXT[] NOT NULL DEFAULT '{}',
  common_mistakes   TEXT[] NOT NULL DEFAULT '{}',
  rep_range_min     INTEGER NOT NULL,
  rep_range_max     INTEGER NOT NULL,
  rest_seconds      INTEGER NOT NULL,
  illustration      TEXT NOT NULL,
  load_factor       NUMERIC(5,3),
  is_bodyweight     BOOLEAN NOT NULL DEFAULT FALSE,
  is_unilateral     BOOLEAN NOT NULL DEFAULT FALSE,
  is_timed          BOOLEAN NOT NULL DEFAULT FALSE,
  is_cardio         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX exercises_primary_muscle_idx ON exercises (primary_muscle);
CREATE INDEX exercises_availability_idx ON exercises (availability);
CREATE INDEX exercises_equipment_idx ON exercises USING GIN (equipment);
CREATE INDEX exercises_secondary_idx ON exercises USING GIN (secondary_muscles);

CREATE TABLE exercise_preferences (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muscle_group   TEXT NOT NULL REFERENCES muscle_groups(id),
  exercise_ids   TEXT[] NOT NULL DEFAULT '{}',
  auto_generated BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, muscle_group),
  -- Enforces the product rule at the storage layer, not just in the UI.
  CONSTRAINT exercise_preferences_max_three CHECK (array_length(exercise_ids, 1) IS NULL OR array_length(exercise_ids, 1) <= 3)
);

CREATE INDEX exercise_preferences_user_id_idx ON exercise_preferences (user_id);

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

CREATE TABLE user_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key   TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  byte_size     INTEGER NOT NULL,
  checksum      TEXT NOT NULL,
  purpose       TEXT NOT NULL DEFAULT 'assessment',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX user_photos_user_id_idx ON user_photos (user_id);
CREATE UNIQUE INDEX user_photos_storage_key_idx ON user_photos (storage_key);

/* ------------------------------------------------------------------ */
/* Body assessments                                                    */
/* ------------------------------------------------------------------ */

CREATE TABLE body_assessments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assessment_number  INTEGER NOT NULL,
  weight_kg          NUMERIC(5,1) NOT NULL,
  body_fat_percent   NUMERIC(4,1) NOT NULL,
  muscle_mass_kg     NUMERIC(5,1) NOT NULL,
  waist_body_ratio   NUMERIC(4,3) NOT NULL,
  symmetry_percent   NUMERIC(4,1) NOT NULL,
  confidence         NUMERIC(4,3) NOT NULL,
  provider           TEXT NOT NULL,
  hologram_data      JSONB NOT NULL,
  source_photo_id    UUID REFERENCES user_photos(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, assessment_number)
);

CREATE INDEX body_assessments_user_created_idx ON body_assessments (user_id, created_at DESC);

-- Individual metric rows make trend queries cheap and allow new metrics to be
-- added without a schema migration.
CREATE TABLE body_metrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assessment_id UUID NOT NULL REFERENCES body_assessments(id) ON DELETE CASCADE,
  metric_key    TEXT NOT NULL,
  metric_value  NUMERIC(10,3) NOT NULL,
  unit          TEXT NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX body_metrics_user_key_idx ON body_metrics (user_id, metric_key, recorded_at);
CREATE INDEX body_metrics_assessment_idx ON body_metrics (assessment_id);

-- Hologram geometry is versioned separately so a future real 3D renderer can
-- store richer payloads without touching the assessment row.
CREATE TABLE body_holograms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assessment_id UUID NOT NULL UNIQUE REFERENCES body_assessments(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL DEFAULT 1,
  seed          BIGINT NOT NULL,
  geometry      JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX body_holograms_user_idx ON body_holograms (user_id);

/* ------------------------------------------------------------------ */
/* Programs                                                            */
/* ------------------------------------------------------------------ */

CREATE TABLE workout_programs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version                  INTEGER NOT NULL DEFAULT 1,
  split_name               TEXT NOT NULL,
  training_days            INTEGER NOT NULL,
  session_duration_minutes INTEGER NOT NULL,
  volume_summary           JSONB NOT NULL DEFAULT '{}'::JSONB,
  generation_reason        TEXT NOT NULL DEFAULT 'initial',
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  generated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at              TIMESTAMPTZ
);

CREATE UNIQUE INDEX workout_programs_active_idx ON workout_programs (user_id) WHERE is_active;
CREATE INDEX workout_programs_user_idx ON workout_programs (user_id, generated_at DESC);

CREATE TABLE workout_days (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id       UUID NOT NULL REFERENCES workout_programs(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_number       INTEGER NOT NULL,
  focus            TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  cardio_type      TEXT,
  cardio_minutes   INTEGER NOT NULL DEFAULT 0,
  cardio_exercise_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (program_id, day_number)
);

CREATE INDEX workout_days_program_idx ON workout_days (program_id);
CREATE INDEX workout_days_user_idx ON workout_days (user_id);

CREATE TABLE workout_exercises (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_day_id  UUID NOT NULL REFERENCES workout_days(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id     TEXT NOT NULL REFERENCES exercises(id),
  order_index     INTEGER NOT NULL,
  sets            INTEGER NOT NULL,
  warmup_sets     INTEGER NOT NULL DEFAULT 0,
  reps_min        INTEGER NOT NULL,
  reps_max        INTEGER NOT NULL,
  starting_weight NUMERIC(6,2),
  rest_seconds    INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workout_day_id, order_index)
);

CREATE INDEX workout_exercises_day_idx ON workout_exercises (workout_day_id);
CREATE INDEX workout_exercises_user_exercise_idx ON workout_exercises (user_id, exercise_id);

CREATE TABLE prescribed_sets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_exercise_id UUID NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_number          INTEGER NOT NULL,
  prescribed_weight   NUMERIC(6,2),
  prescribed_reps_min INTEGER NOT NULL,
  prescribed_reps_max INTEGER NOT NULL,
  rest_seconds        INTEGER NOT NULL,
  is_warmup           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workout_exercise_id, set_number)
);

CREATE INDEX prescribed_sets_exercise_idx ON prescribed_sets (workout_exercise_id);

/* ------------------------------------------------------------------ */
/* Schedule                                                            */
/* ------------------------------------------------------------------ */

CREATE TABLE scheduled_workouts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id          UUID NOT NULL REFERENCES workout_programs(id) ON DELETE CASCADE,
  workout_day_id      UUID NOT NULL REFERENCES workout_days(id) ON DELETE CASCADE,
  scheduled_date      DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled','completed','missed','rescheduled')),
  completed_workout_id UUID,
  rescheduled_from    DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX scheduled_workouts_user_date_idx ON scheduled_workouts (user_id, scheduled_date);
CREATE INDEX scheduled_workouts_status_idx ON scheduled_workouts (user_id, status);

/* ------------------------------------------------------------------ */
/* Completed training                                                  */
/* ------------------------------------------------------------------ */

CREATE TABLE completed_workouts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id       UUID REFERENCES workout_programs(id) ON DELETE SET NULL,
  workout_day_id   UUID REFERENCES workout_days(id) ON DELETE SET NULL,
  day_number       INTEGER NOT NULL,
  focus            TEXT NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL,
  completed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_seconds INTEGER NOT NULL,
  total_sets       INTEGER NOT NULL DEFAULT 0,
  total_volume_kg  NUMERIC(10,2) NOT NULL DEFAULT 0,
  cardio_minutes   INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX completed_workouts_user_idx ON completed_workouts (user_id, completed_at DESC);

CREATE TABLE completed_exercises (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  completed_workout_id UUID NOT NULL REFERENCES completed_workouts(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id          TEXT NOT NULL REFERENCES exercises(id),
  workout_exercise_id  UUID REFERENCES workout_exercises(id) ON DELETE SET NULL,
  order_index          INTEGER NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX completed_exercises_workout_idx ON completed_exercises (completed_workout_id);
CREATE INDEX completed_exercises_user_exercise_idx ON completed_exercises (user_id, exercise_id, created_at DESC);

-- Prescribed values are copied onto each completed set so the prescription is
-- never overwritten by what the user actually lifted.
CREATE TABLE completed_sets (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  completed_exercise_id  UUID NOT NULL REFERENCES completed_exercises(id) ON DELETE CASCADE,
  workout_exercise_id    UUID REFERENCES workout_exercises(id) ON DELETE SET NULL,
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_number             INTEGER NOT NULL,
  actual_weight          NUMERIC(6,2),
  actual_reps            INTEGER,
  prescribed_weight      NUMERIC(6,2),
  prescribed_reps_min    INTEGER NOT NULL DEFAULT 0,
  prescribed_reps_max    INTEGER NOT NULL DEFAULT 0,
  is_warmup              BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX completed_sets_exercise_idx ON completed_sets (completed_exercise_id);
CREATE INDEX completed_sets_user_idx ON completed_sets (user_id, completed_at DESC);

CREATE TABLE personal_records (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id    TEXT NOT NULL REFERENCES exercises(id),
  record_type    TEXT NOT NULL CHECK (record_type IN ('weight','reps','estimated_1rm','volume')),
  value          NUMERIC(10,2) NOT NULL,
  previous_value NUMERIC(10,2),
  completed_workout_id UUID REFERENCES completed_workouts(id) ON DELETE SET NULL,
  achieved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX personal_records_user_idx ON personal_records (user_id, achieved_at DESC);
CREATE INDEX personal_records_lookup_idx ON personal_records (user_id, exercise_id, record_type, value DESC);

-- Denormalised progress snapshots keep the Progress tab fast as history grows.
CREATE TABLE progress_records (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_date  DATE NOT NULL,
  record_type  TEXT NOT NULL,
  reference_id TEXT,
  value        NUMERIC(12,3) NOT NULL,
  unit         TEXT NOT NULL,
  metadata     JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX progress_records_user_type_idx ON progress_records (user_id, record_type, record_date);

/* ------------------------------------------------------------------ */
/* Subscriptions                                                       */
/* ------------------------------------------------------------------ */

CREATE TABLE subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'none'
                        CHECK (status IN ('none','active','expired','cancelled','pending','failed','restored')),
  platform              TEXT CHECK (platform IN ('apple','google','mock')),
  product_id            TEXT,
  price_usd             NUMERIC(6,2),
  original_transaction_id TEXT,
  latest_receipt        TEXT,
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  cancel_at_period_end  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX subscriptions_status_idx ON subscriptions (status, current_period_end);
CREATE INDEX subscriptions_original_txn_idx ON subscriptions (original_transaction_id);

-- Append-only audit trail. Entitlement is always derived from subscriptions,
-- never from anything the client asserts.
CREATE TABLE subscription_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,
  from_status     TEXT,
  to_status       TEXT,
  platform        TEXT,
  payload         JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX subscription_events_user_idx ON subscription_events (user_id, created_at DESC);

/* ------------------------------------------------------------------ */
/* App settings                                                        */
/* ------------------------------------------------------------------ */

CREATE TABLE app_settings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  theme_mode     TEXT NOT NULL DEFAULT 'dark' CHECK (theme_mode IN ('dark','light','system')),
  reduced_motion BOOLEAN NOT NULL DEFAULT FALSE,
  units          TEXT NOT NULL DEFAULT 'metric',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

/* ------------------------------------------------------------------ */
/* Triggers                                                            */
/* ------------------------------------------------------------------ */

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_profiles_updated_at BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_goals_updated_at BEFORE UPDATE ON user_goals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER exercise_preferences_updated_at BEFORE UPDATE ON exercise_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER scheduled_workouts_updated_at BEFORE UPDATE ON scheduled_workouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER app_settings_updated_at BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER exercises_updated_at BEFORE UPDATE ON exercises
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
