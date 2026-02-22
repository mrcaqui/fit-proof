-- 論理削除撤廃マイグレーション
--
-- 方法A: データを保持しつつ deleted_at 列のみ削除（既存データがある場合）
-- 方法B: 管理者以外の全データを削除してまっさらにする場合は schema.sql から再作成
--
-- 以下は方法Aのマイグレーション:

-- 論理削除済みの行を物理削除
DELETE FROM submission_items WHERE deleted_at IS NOT NULL;
DELETE FROM submission_rules WHERE deleted_at IS NOT NULL;

-- deleted_at 列を削除
ALTER TABLE submission_items DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE submission_rules DROP COLUMN IF EXISTS deleted_at;
