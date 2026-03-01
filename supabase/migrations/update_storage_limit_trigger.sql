CREATE OR REPLACE FUNCTION enforce_storage_limit_trigger_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE total_used bigint;
BEGIN
    -- r2_key または bunny_video_id のいずれかが設定されている場合にチェック
    IF (NEW.r2_key IS NULL AND NEW.bunny_video_id IS NULL) OR NEW.video_size IS NULL THEN
        RETURN NEW;
    END IF;
    PERFORM pg_advisory_xact_lock(4242424242);
    SELECT COALESCE(SUM(video_size), 0) INTO total_used
    FROM submissions WHERE r2_key IS NOT NULL OR bunny_video_id IS NOT NULL;
    IF total_used + NEW.video_size > 10737418240 THEN
        RAISE EXCEPTION 'STORAGE_LIMIT_EXCEEDED';
    END IF;
    RETURN NEW;
END;
$$;
