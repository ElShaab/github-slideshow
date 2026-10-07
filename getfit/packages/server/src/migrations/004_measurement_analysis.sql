-- Measurement-based body analysis.
--
-- Body composition is computed from tape measurements using published
-- anthropometric formulas, so an assessment now records which formula produced
-- the figure and the readings it was computed from. A photo becomes an optional
-- progress photo that is never analysed, and symmetry becomes nullable: it only
-- exists when a limb pair was actually measured.

ALTER TABLE body_assessments
  ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'bmi',
  ADD COLUMN IF NOT EXISTS measurements JSONB NOT NULL DEFAULT '{}'::JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'body_assessments_method_check'
  ) THEN
    ALTER TABLE body_assessments
      ADD CONSTRAINT body_assessments_method_check
      CHECK (method IN ('navy', 'bmi', 'vision'));
  END IF;
END $$;

ALTER TABLE body_assessments
  ALTER COLUMN symmetry_percent DROP NOT NULL;

-- Assessments written before this migration were produced by the previous
-- photo-hash analyser. Their symmetry figure was not measured, so it is cleared
-- rather than carried forward as if it had been, and the provider is marked so
-- the app never presents those rows as measured readings.
UPDATE body_assessments
   SET symmetry_percent = NULL
 WHERE provider = 'mock-v1';

DELETE FROM body_metrics
 WHERE metric_key = 'symmetry_percent'
   AND assessment_id IN (SELECT id FROM body_assessments WHERE provider = 'mock-v1');
