-- 011: Track the furthest funnel stage each application reached. Authored 2026-10-02.
--
-- The tracker stores only a single CURRENT status, so an application that
-- interviewed and was later rejected looks identical to one rejected outright --
-- which made the Insights funnel undercount interviews/offers. max_stage records
-- the furthest funnel stage reached so those counts stay accurate after a rejection.
--
-- Stage ranks:  0 Applied/Pending · 1 interview · 2 2nd-round · 3 offer (Accepted)
--
-- App-side rule (see tracker.js): when the status is set to a real STAGE, max_stage
-- follows that stage's rank -- so correcting a mis-set status fixes the funnel
-- immediately. Only when the status is 'Rejected' (an outcome with no stage) does
-- max_stage PRESERVE the furthest stage already reached.
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
