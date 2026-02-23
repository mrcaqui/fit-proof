CREATE OR REPLACE FUNCTION enforce_storage_limit_trigger_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE total_used bigint;
BEGIN
    IF NEW.r2_key IS NULL OR NEW.video_size IS NULL THEN
        RETURN NEW;
    END IF;
    -- トランザクションスコープの排他ロックで同時インサートを直列化する。
    -- BEFORE INSERT トリガーは READ COMMITTED 分離レベルで動作するため、
    -- 別の未コミットトランザクションが行ったインサートは SELECT SUM() に反映されない。
    -- pg_advisory_xact_lock は同一キーに対して同時に 1 トランザクションしか進めないことを
    -- 保証するため、競合状態を排除できる。ロックはトランザクション終了時に自動解放される。
    PERFORM pg_advisory_xact_lock(4242424242);
    SELECT COALESCE(SUM(video_size), 0) INTO total_used
    FROM submissions WHERE r2_key IS NOT NULL;
    IF total_used + NEW.video_size > 10737418240 THEN
        RAISE EXCEPTION 'STORAGE_LIMIT_EXCEEDED';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_storage_limit ON submissions;
CREATE TRIGGER enforce_storage_limit
    BEFORE INSERT ON submissions
    FOR EACH ROW EXECUTE FUNCTION enforce_storage_limit_trigger_fn();
