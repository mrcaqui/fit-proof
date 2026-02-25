-- Phase C: effective_from + 目標日の設定刷新
-- submission_items と submission_rules に effective_from 列を追加し、
-- submission_rules にグループ関連列と新 rule_type を追加する。

-- Step 1: submission_items に effective_from を追加
ALTER TABLE submission_items
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE submission_items SET effective_from = created_at;

-- Step 2: submission_rules に effective_from を追加
ALTER TABLE submission_rules
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE submission_rules SET effective_from = created_at;

-- Step 3: グループ用の列を追加
ALTER TABLE submission_rules
  ADD COLUMN IF NOT EXISTS group_id UUID DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS group_required_count INTEGER DEFAULT NULL;

-- Step 4: rule_type の CHECK 制約を拡張（'target_day' は残す）
ALTER TABLE submission_rules
  DROP CONSTRAINT IF EXISTS submission_rules_rule_type_check;

ALTER TABLE submission_rules
  ADD CONSTRAINT submission_rules_rule_type_check
  CHECK (rule_type IN ('deadline', 'target_day', 'rest_day', 'group'));

-- Step 5: 既存 target_day ルールの移行
-- 【事前確認クエリ】マイグレーション実行前に Supabase Studio で以下を実行し、
-- monthly scope の target_day ルールが存在しないことを確認する:
--   SELECT * FROM submission_rules WHERE rule_type='target_day' AND scope='monthly';
-- 該当行が存在する場合はデータ内容を確認し、不要であれば手動削除した上で
-- 本マイグレーションを実行すること（monthly scope の rest_day は isRestDayForDate で非対応）。

-- weekly: day_of_week で照合し、同曜日の later true が存在しない行のみ変換
UPDATE submission_rules r
  SET rule_type = 'rest_day', value = NULL
  WHERE rule_type = 'target_day' AND value = 'false' AND scope = 'weekly'
    AND NOT EXISTS (
      SELECT 1 FROM submission_rules r2
      WHERE r2.user_id = r.user_id
        AND r2.rule_type = 'target_day'
        AND r2.value = 'true'
        AND r2.scope = r.scope
        AND r2.day_of_week IS NOT DISTINCT FROM r.day_of_week
        AND (r2.created_at > r.created_at
          OR (r2.created_at = r.created_at AND r2.id > r.id))
    );

-- daily: specific_date で照合し、同 specific_date の later true が存在しない行のみ変換
UPDATE submission_rules r
  SET rule_type = 'rest_day', value = NULL
  WHERE rule_type = 'target_day' AND value = 'false' AND scope = 'daily'
    AND NOT EXISTS (
      SELECT 1 FROM submission_rules r2
      WHERE r2.user_id = r.user_id
        AND r2.rule_type = 'target_day'
        AND r2.value = 'true'
        AND r2.scope = r.scope
        AND r2.specific_date IS NOT DISTINCT FROM r.specific_date
        AND (r2.created_at > r.created_at
          OR (r2.created_at = r.created_at AND r2.id > r.id))
    );

-- value='true' 行は削除しない。
-- コード側は target_day を参照しなくなるため実害はなく、
-- 上記 NOT EXISTS により「false 後に true で再有効化」した行は変換対象外になる。
