-- 011: Track the furthest funnel stage each application reached. Authored 2026-10-02.
--
-- The tracker stores only a single CURRENT status, so an application that
-- interviewed and was later rejected looks identical to one rejected outright --
-- which made the Insights funnel undercount interviews/offers. This adds a
-- high-water mark that the app bumps on every status change and never lowers, so
-- "reached interview" / "reached offer" stay accurate after a later rejection.
--
-- Stage ranks:  0 Applied/Pending · 1 interview · 2 2nd-round · 3 offer (Accepted)
-- Rejected carries no rank (it's an outcome, not a stage), so it leaves max_stage
-- at whatever the application had already reached.
--
-- Historical caveat: rows ALREADY sitting at 'Rejected' can't have their past
-- recovered, so they backfill to rank 0. Accuracy is forward-looking.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS max_stage smallint NOT NULL DEFAULT 0;

-- Backfill from current status. GREATEST(...) makes this safe to re-run: it can
-- only raise an existing high-water mark, never lower one.
UPDATE applications SET max_stage = GREATEST(max_stage, CASE
  WHEN status = 'Accepted'            THEN 3
  WHEN status = '2nd Round Interview' THEN 2
  WHEN status IN ('1st Round Interview', 'Interview') THEN 1
  ELSE 0
END);
