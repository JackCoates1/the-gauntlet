-- Security boundary: client-provided event timestamps are not evidence of
-- pacing. Every newly ingested event gets this value from Date.now() in the
-- Pages Function, and seal-time plausibility reads this column exclusively.
ALTER TABLE events ADD COLUMN received_at INTEGER;
CREATE INDEX IF NOT EXISTS events_run_id_received_at ON events(run_id, received_at);
