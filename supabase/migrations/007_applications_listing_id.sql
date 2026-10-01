-- 007: Link applications to the listing they came from. Authored 2026-10-01.
--
-- The search page tracked "applied" state by matching position + company string
-- equality (frontend/js/search.js), which collides when the same title exists at
-- the same company (e.g. two "Software Engineer Intern" roles at one company).
-- A stable listing_id removes the ambiguity.
--
-- Nullable on purpose: existing rows (and anything created before the frontend
-- starts sending listing_id) keep working and simply fall back to the old
-- string match in the UI. ON DELETE SET NULL so a listing being removed by the
-- daily refresh never deletes a user's tracked application.
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS listing_id uuid REFERENCES listings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS applications_listing_id_idx ON applications (listing_id);
