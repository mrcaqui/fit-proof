CREATE OR REPLACE FUNCTION public.replace_submissions(
  p_user_id uuid,
  p_target_date date,
  p_submission_item_id bigint,
  p_bunny_video_id text,
  p_video_size bigint,
  p_video_hash text,
  p_duration integer,
  p_thumbnail_url text,
  p_file_name text,
  p_is_late boolean DEFAULT false
)
RETURNS TABLE(old_bunny_video_ids text[], new_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_ids text[];
  v_new_id bigint;
BEGIN
  -- 並行性制御: 同一キーに対する同時呼び出しを直列化する
  PERFORM pg_advisory_xact_lock(
    hashtext(p_user_id::text || p_target_date::text || COALESCE(p_submission_item_id::text, 'null'))
  );

  -- 同一条件の全既存行から bunny_video_id を収集（null を除外）
  SELECT array_agg(s.bunny_video_id) FILTER (WHERE s.bunny_video_id IS NOT NULL)
  INTO v_old_ids
  FROM submissions s
  WHERE s.user_id = p_user_id
    AND s.target_date = p_target_date
    AND s.submission_item_id IS NOT DISTINCT FROM p_submission_item_id;

  -- 全既存行を削除
  DELETE FROM submissions
  WHERE user_id = p_user_id
    AND target_date = p_target_date
    AND submission_item_id IS NOT DISTINCT FROM p_submission_item_id;

  -- 新行を挿入（BEFORE INSERT トリガーでストレージ制限チェックが発火）
  INSERT INTO submissions (
    user_id, type, target_date, submission_item_id,
    bunny_video_id, video_size, video_hash, duration,
    thumbnail_url, file_name, is_late, status
  ) VALUES (
    p_user_id, 'video', p_target_date, p_submission_item_id,
    p_bunny_video_id, p_video_size, p_video_hash, p_duration,
    p_thumbnail_url, p_file_name, p_is_late, null
  )
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT COALESCE(v_old_ids, ARRAY[]::text[]), v_new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_submissions(uuid, date, bigint, text, bigint, text, integer, text, text, boolean) TO authenticated;
