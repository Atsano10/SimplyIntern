-- 012: Remember whether an application ever reached an interview. Authored 2026-10-02.
--
-- The Insights funnel reads current status, which means an application that
-- interviewed and was then accepted/rejected stops counting as "interviewed" --
-- even though the interview really happened. This one boolean is the minimal
-- memory needed to keep the interview count honest.
--
-- It is a MILESTONE: the app turns it on when any interview round is reached, keeps
-- it through a later accept/reject, and clears it only when the status returns to
-- Pending (an explicit restart, via edit or the Reset button). "Offers" stays based
-- on the CURRENT status (Accepted), so a rescinded/rejected offer drops to 0.
--
-- Deliberately NOT a stage rank: that's what made the earlier attempt infer an
-- interview from an offer (pending → accepted wrongly counted as interviewed).
--
-- Historical caveat: rows already at Accepted/Rejected can't have their past
-- recovered, so they backfill to false unless they are CURRENTLY at an interview
-- round. Accuracy is forward-looking.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS reached_interview boolean NOT NULL DEFAULT false;

UPDATE applications SET reached_interview = true
WHERE status IN ('1st Round Interview', '2nd Round Interview', 'Interview');
