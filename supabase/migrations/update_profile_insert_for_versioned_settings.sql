-- =============================================================
-- update_profile_insert_for_versioned_settings.sql
-- on_profile_insert() を更新して、初回ログイン時に
-- gamification_setting_versions テーブルへ初期バージョン行を INSERT
-- =============================================================

CREATE OR REPLACE FUNCTION on_profile_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email text;
    v_preconfig jsonb;
    v_rule jsonb;
    v_item jsonb;
    v_profile_settings jsonb;
    v_gs jsonb;
    v_vs jsonb;
BEGIN
    -- Step 1: auth.users からメールアドレスを取得
    SELECT email INTO v_email
    FROM auth.users
    WHERE id = NEW.id;

    IF v_email IS NULL THEN
        RETURN NEW;
    END IF;

    -- Step 2: authorized_users.user_id をリンク（NULL の場合のみ）
    UPDATE authorized_users
    SET user_id = NEW.id
    WHERE email = v_email
      AND user_id IS NULL;

    -- Step 3: preconfig 適用（エラー耐性あり）
    SELECT preconfig INTO v_preconfig
    FROM authorized_users
    WHERE email = v_email;

    IF v_preconfig IS NOT NULL THEN
        BEGIN
            -- profile_settings を profiles テーブルに適用
            v_profile_settings := v_preconfig -> 'profile_settings';
            IF v_profile_settings IS NOT NULL THEN
                UPDATE profiles SET
                    past_submission_days = COALESCE((v_profile_settings ->> 'past_submission_days')::integer, past_submission_days),
                    future_submission_days = COALESCE((v_profile_settings ->> 'future_submission_days')::integer, future_submission_days),
                    deadline_mode = COALESCE(v_profile_settings ->> 'deadline_mode', deadline_mode),
                    show_duplicate_to_user = COALESCE((v_profile_settings ->> 'show_duplicate_to_user')::boolean, show_duplicate_to_user),
                    video_retention_days = COALESCE((v_profile_settings ->> 'video_retention_days')::integer, video_retention_days),
                    gamification_settings = CASE
                        WHEN v_profile_settings -> 'gamification_settings' IS NOT NULL
                             AND v_profile_settings ->> 'gamification_settings' != 'null'
                        THEN v_profile_settings -> 'gamification_settings'
                        ELSE gamification_settings
                    END
                WHERE id = NEW.id;
            END IF;

            -- gamification_setting_versions に初期行を INSERT
            v_gs := v_profile_settings -> 'gamification_settings';
            v_vs := v_gs -> 'versioned_settings';

            INSERT INTO gamification_setting_versions (
                user_id, condition_type, straight_count,
                allow_shield, allow_revival, allow_late,
                use_target_days, custom_required_days,
                effective_from, effective_to
            ) VALUES (
                NEW.id,
                COALESCE(v_vs ->> 'condition_type', 'straight_count'),
                COALESCE((v_vs ->> 'straight_count')::integer, 1),
                COALESCE((v_vs ->> 'allow_shield')::boolean, false),
                COALESCE((v_vs ->> 'allow_revival')::boolean, false),
                COALESCE((v_vs ->> 'allow_late')::boolean, true),
                COALESCE((v_vs ->> 'use_target_days')::boolean, true),
                COALESCE((v_vs ->> 'custom_required_days')::integer, 7),
                '2020-01-01'::date,
                NULL
            );

            -- rules 配列を submission_rules に INSERT
            IF v_preconfig -> 'rules' IS NOT NULL AND jsonb_array_length(v_preconfig -> 'rules') > 0 THEN
                FOR v_rule IN SELECT * FROM jsonb_array_elements(v_preconfig -> 'rules')
                LOOP
                    INSERT INTO submission_rules (
                        user_id, rule_type, scope, day_of_week, specific_date,
                        value, effective_from, group_id, group_required_count, effective_to
                    ) VALUES (
                        NEW.id,
                        v_rule ->> 'rule_type',
                        v_rule ->> 'scope',
                        (v_rule ->> 'day_of_week')::smallint,
                        (v_rule ->> 'specific_date')::date,
                        v_rule ->> 'value',
                        COALESCE((v_rule ->> 'effective_from')::timestamptz, now()),
                        (v_rule ->> 'group_id')::uuid,
                        (v_rule ->> 'group_required_count')::integer,
                        (v_rule ->> 'effective_to')::timestamptz
                    );
                END LOOP;
            END IF;

            -- items 配列を submission_items に INSERT
            IF v_preconfig -> 'items' IS NOT NULL AND jsonb_array_length(v_preconfig -> 'items') > 0 THEN
                FOR v_item IN SELECT * FROM jsonb_array_elements(v_preconfig -> 'items')
                LOOP
                    INSERT INTO submission_items (
                        user_id, name, effective_from, effective_to
                    ) VALUES (
                        NEW.id,
                        v_item ->> 'name',
                        COALESCE((v_item ->> 'effective_from')::timestamptz, now()),
                        (v_item ->> 'effective_to')::timestamptz
                    );
                END LOOP;
            END IF;

            -- 成功時のみ preconfig を NULL にクリア
            UPDATE authorized_users SET preconfig = NULL WHERE email = v_email;

        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'preconfig apply failed for %: %', v_email, SQLERRM;
            -- preconfig は残す（管理者が確認・再設定可能）
        END;
    ELSE
        -- preconfig なしの場合もデフォルト初期バージョンを作成
        INSERT INTO gamification_setting_versions (
            user_id, effective_from, effective_to
        ) VALUES (
            NEW.id, '2020-01-01'::date, NULL
        ) ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

-- トリガーを再作成
DROP TRIGGER IF EXISTS trg_on_profile_insert ON profiles;
CREATE TRIGGER trg_on_profile_insert
    AFTER INSERT ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION on_profile_insert();
