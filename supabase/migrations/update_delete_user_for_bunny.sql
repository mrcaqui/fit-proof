-- delete_user_completely の戻り値を r2_keys → bunny_video_ids に変更する
-- CREATE OR REPLACE では OUT パラメータを変更できないため、DROP → 再作成が必要

DROP FUNCTION IF EXISTS public.delete_user_completely(text);

CREATE FUNCTION public.delete_user_completely(target_email text)
RETURNS TABLE(target_user_id uuid, bunny_video_ids text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_bunny_video_ids text[];
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
    DELETE FROM authorized_users WHERE authorized_users.email = target_email;

    target_user_id := NULL;
    bunny_video_ids := '{}';
    RETURN NEXT;
    RETURN;
  END IF;

  -- 自分自身の削除を防止
  IF v_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete yourself';
  END IF;

  -- submissionsからbunny_video_idを収集（NULL除外）
  SELECT COALESCE(array_agg(s.bunny_video_id) FILTER (WHERE s.bunny_video_id IS NOT NULL), '{}')
  INTO v_bunny_video_ids
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

  -- auth.usersから削除
  DELETE FROM auth.users WHERE id = v_user_id;

  target_user_id := v_user_id;
  bunny_video_ids := v_bunny_video_ids;
  RETURN NEXT;
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_user_completely(text) TO authenticated;
