-- Phase D: ゲーミフィケーション刷新
-- 1. submissions.type に 'shield' を追加
ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_type_check;
ALTER TABLE submissions ADD CONSTRAINT submissions_type_check CHECK (type IN ('video', 'comment', 'shield'));

-- 2. シールドの重複防止: 同一ユーザー・同一日に1つだけ
CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_shield_unique
    ON submissions (user_id, target_date) WHERE type = 'shield';

-- 3. シールド適用 RPC（アトミックな INSERT + stock 減算）
CREATE OR REPLACE FUNCTION apply_shield(p_user_id uuid, p_target_date date)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    v_stock integer;
    v_has_submission boolean;
BEGIN
    -- ユーザー+日付の組み合わせで排他ロック（同時実行による race condition 防止）
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text || p_target_date::text));

    -- 通常投稿（video/comment）が既に存在する日にはシールドを適用しない
    SELECT EXISTS(
        SELECT 1 FROM submissions
        WHERE user_id = p_user_id AND target_date = p_target_date AND type IN ('video', 'comment')
    ) INTO v_has_submission;
    IF v_has_submission THEN
        RETURN false;
    END IF;

    -- stock を排他ロック付きで取得
    SELECT shield_stock INTO v_stock FROM profiles WHERE id = p_user_id FOR UPDATE;
    IF v_stock IS NULL OR v_stock <= 0 THEN
        RETURN false;
    END IF;

    -- shield 行を挿入（UNIQUE 制約で重複は自動拒否）
    INSERT INTO submissions (user_id, type, target_date, status)
    VALUES (p_user_id, 'shield', p_target_date, 'success');

    -- stock を減算
    UPDATE profiles SET shield_stock = shield_stock - 1 WHERE id = p_user_id;

    RETURN true;
EXCEPTION WHEN unique_violation THEN
    -- 既に適用済み
    RETURN false;
END;
$$;

-- 4. シールド取り消し RPC（アトミックな DELETE + stock 加算）
CREATE OR REPLACE FUNCTION remove_shield(p_user_id uuid, p_target_date date)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted integer;
BEGIN
    -- shield 行を削除
    DELETE FROM submissions
    WHERE user_id = p_user_id AND type = 'shield' AND target_date = p_target_date;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted = 0 THEN
        RETURN false;  -- 削除対象なし → stock は変えない
    END IF;

    -- stock を加算
    UPDATE profiles SET shield_stock = shield_stock + 1 WHERE id = p_user_id;

    RETURN true;
END;
$$;
