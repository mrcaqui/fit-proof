-- deadlines テーブル削除（コードで未使用）
DROP TABLE IF EXISTS deadlines;

-- profiles から未使用の streak_count 列を削除
ALTER TABLE profiles DROP COLUMN IF EXISTS streak_count;

-- 管理者以外のデータをクリーンアップ
-- admin の email: estacercadeaqui@gmail.com
-- 1. admin_comments を全削除
DELETE FROM admin_comments;
-- 2. submissions を全削除（admin以外）
DELETE FROM submissions WHERE user_id NOT IN (
  SELECT id FROM profiles WHERE role = 'admin'
);
-- 3. submission_items を全削除（admin以外）
DELETE FROM submission_items WHERE user_id NOT IN (
  SELECT id FROM profiles WHERE role = 'admin'
);
-- 4. submission_rules を全削除（admin以外）
DELETE FROM submission_rules WHERE user_id NOT IN (
  SELECT id FROM profiles WHERE role = 'admin'
);
-- 5. admin 以外の profiles を削除（role IS NULL の行も含む）
DELETE FROM profiles WHERE role IS DISTINCT FROM 'admin';
-- 6. authorized_users の admin 以外のエントリの user_id を null に
--    (profiles 削除で ON DELETE SET NULL により自動的に null になるはず)

-- admin のゲーミフィケーション統計をリセット
UPDATE profiles SET
  total_reps = 0,
  shield_stock = 0,
  perfect_week_count = 0,
  revival_success_count = 0,
  gamification_settings = NULL;
