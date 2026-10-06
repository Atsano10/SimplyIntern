-- 024: Drop applications.data_applied, a misspelled duplicate of date_applied.
-- Authored 2026-10-06.
--
-- It was in the live table when the schema was captured (003) and nothing in the app
-- reads or writes it. In case a row somehow has a value there, it's copied into
-- date_applied first (only where date_applied is empty), so no date is lost.
--
-- Safe to re-run: does nothing once the column is gone.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'applications'
               AND column_name = 'data_applied') THEN
    UPDATE public.applications
    SET date_applied = data_applied
    WHERE date_applied IS NULL AND data_applied IS NOT NULL;

    ALTER TABLE public.applications DROP COLUMN data_applied;
  END IF;
END $$;
