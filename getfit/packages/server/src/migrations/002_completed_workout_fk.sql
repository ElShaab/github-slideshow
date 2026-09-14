-- scheduled_workouts.completed_workout_id is added as a real FK only after
-- completed_workouts exists, keeping 001 free of forward references.
ALTER TABLE scheduled_workouts
  ADD CONSTRAINT scheduled_workouts_completed_workout_fk
  FOREIGN KEY (completed_workout_id) REFERENCES completed_workouts(id) ON DELETE SET NULL;

CREATE INDEX scheduled_workouts_completed_idx ON scheduled_workouts (completed_workout_id);
