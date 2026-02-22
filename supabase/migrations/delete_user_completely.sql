-- ユーザー完全削除RPC関数
-- 管理者のみが呼び出し可能。指定メールアドレスのユーザーに関連する全データを削除する。
-- 戻り値: target_user_id (uuid) と r2_keys (text[])

CREATE OR REPLACE FUNCTION public.delete_user_completely(target_email text)
RETURNS TABLE(target_user_id uuid, r2_keys text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_r2_keys text[];
  v_caller_role text;
BEGIN
  -- 呼び出し元が管理者であることを確認
  SELECT role INTO v_caller_role
  FROM profiles
  WHERE id = auth.uid();

  IF v_caller_role IS NULL OR v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'Permission denied: only admins can delete users';
  END IF;

  -- auth.usersからメールアドレスでユーザーIDを特定
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = target_email;

  -- ユーザーが見つからない場合（未ログインの招待ユーザー等）
  IF v_user_id IS NULL THEN
    -- authorized_usersからの削除のみ行う
    DELETE FROM authorized_users WHERE authorized_users.email = target_email;

    target_user_id := NULL;
    r2_keys := '{}';
    RETURN NEXT;
    RETURN;
  END IF;

  -- 自分自身の削除を防止
  IF v_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete yourself';
  END IF;

  -- submissionsからr2_keyを収集（NULL除外）
  SELECT COALESCE(array_agg(s.r2_key) FILTER (WHERE s.r2_key IS NOT NULL), '{}')
  INTO v_r2_keys
  FROM submissions s
  WHERE s.user_id = v_user_id;

  -- admin_commentsを削除（対象ユーザーのsubmissionsに紐づくコメント）
  DELETE FROM admin_comments
  WHERE submission_id IN (
    SELECT id FROM submissions WHERE user_id = v_user_id
  );

  -- admin_commentsを削除（対象ユーザーが管理者として投稿したコメント）
  DELETE FROM admin_comments
  WHERE user_id = v_user_id;

  -- submissionsを削除
  DELETE FROM submissions WHERE user_id = v_user_id;

  -- submission_itemsを削除
  DELETE FROM submission_items WHERE user_id = v_user_id;

  -- submission_rulesを削除
  DELETE FROM submission_rules WHERE user_id = v_user_id;

  -- profilesを削除
  DELETE FROM profiles WHERE id = v_user_id;

  -- authorized_usersから削除
  DELETE FROM authorized_users WHERE authorized_users.email = target_email;

  -- auth.usersから削除（次回ログイン時に完全新規のエントリが作成される）
  DELETE FROM auth.users WHERE id = v_user_id;

  target_user_id := v_user_id;
  r2_keys := v_r2_keys;
  RETURN NEXT;
  RETURN;
END;
$$;

-- RPC関数の実行権限を認証済みユーザーに付与（関数内で管理者チェックを行う）
GRANT EXECUTE ON FUNCTION public.delete_user_completely(text) TO authenticated;
