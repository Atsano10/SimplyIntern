-- 016: Drop the unused applications.max_stage column. Authored 2026-10-03.
--
-- max_stage was added by migration 011 (a stage-rank funnel), which was abandoned
-- in favour of the reached_interview milestone (012) and its file deleted. 012 never
-- dropped the column, so production kept a dead column nothing reads or writes.
-- IF EXISTS keeps this safe on fresh databases where 011 never ran.

ALTER TABLE applications DROP COLUMN IF EXISTS max_stage;
