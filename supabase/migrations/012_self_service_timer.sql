-- Self-service QR timer MVP (guest-only)
ALTER TABLE timer_sessions
  ADD COLUMN IF NOT EXISTS table_number    text,
  ADD COLUMN IF NOT EXISTS created_via     text NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE timer_sessions DROP CONSTRAINT IF EXISTS timer_sessions_table_number_fkey;

ALTER TABLE timer_sessions DROP CONSTRAINT IF EXISTS timer_sessions_created_via_check;
ALTER TABLE timer_sessions ADD CONSTRAINT timer_sessions_created_via_check
  CHECK (created_via IN ('admin', 'booking', 'self_service'));

CREATE INDEX IF NOT EXISTS idx_timer_sessions_table_status ON timer_sessions(table_number, status);
CREATE INDEX IF NOT EXISTS idx_timer_sessions_created_via ON timer_sessions(created_via);
CREATE UNIQUE INDEX IF NOT EXISTS idx_timer_sessions_idempotency_key
  ON timer_sessions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
