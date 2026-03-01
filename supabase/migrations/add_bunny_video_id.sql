ALTER TABLE submissions ADD COLUMN IF NOT EXISTS bunny_video_id text DEFAULT NULL;
-- テストデータ全削除（本番クライアントデータなし）
DELETE FROM submissions WHERE r2_key IS NOT NULL;
