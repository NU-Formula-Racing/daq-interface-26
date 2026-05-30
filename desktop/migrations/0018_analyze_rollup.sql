-- The v0.7.4 backfill populated sd_rollup_1s but did not run ANALYZE,
-- so the planner's stats for that table reflected the post-CREATE empty
-- state. With no stats it defaulted to a sequential scan over the entire
-- rollup on every query — which exactly explains the 1.1 s floor we saw
-- on the example session even though only ~21 k rollup rows mattered.
-- Run ANALYZE once at migration time so existing installs get the index
-- path immediately; new populates from v0.7.6 onward run ANALYZE inline.

ANALYZE sd_rollup_1s;
