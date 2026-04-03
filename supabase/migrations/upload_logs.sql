-- Upload diagnostic logs table
CREATE TABLE IF NOT EXISTS upload_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id  text NOT NULL,
  entries     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE(user_id, session_id)
);

-- Index for admin queries (filter by user)
CREATE INDEX IF NOT EXISTS idx_upload_logs_user_id ON upload_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_upload_logs_created_at ON upload_logs(created_at DESC);

-- RLS
ALTER TABLE upload_logs ENABLE ROW LEVEL SECURITY;

-- INSERT: own logs only
CREATE POLICY upload_logs_insert ON upload_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: own logs only (needed for upsert ON CONFLICT DO UPDATE)
CREATE POLICY upload_logs_update ON upload_logs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- SELECT: own logs or admin
CREATE POLICY upload_logs_select ON upload_logs
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- DELETE: admin only
CREATE POLICY upload_logs_delete ON upload_logs
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );
