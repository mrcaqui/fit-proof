ALTER TABLE profiles ADD COLUMN IF NOT EXISTS video_retention_days integer DEFAULT 30;
