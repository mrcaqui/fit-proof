/**
 * ゲーミフィケーション設定バージョン管理フック
 * useSubmissionRules と同じ構造: Supabase Realtime 購読 + CRUD
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import {
    GamificationSettingVersion,
    VersionedSettings,
    DEFAULT_VERSIONED_SETTINGS,
} from '@/types/gamification.types'

/**
 * バージョン行から VersionedSettings を抽出するヘルパー
 */
function toVersionedSettings(v: GamificationSettingVersion): VersionedSettings {
    return {
        condition_type: v.condition_type,
        straight_count: v.straight_count,
        allow_shield: v.allow_shield,
        allow_revival: v.allow_revival,
        allow_late: v.allow_late,
        use_target_days: v.use_target_days,
        custom_required_days: v.custom_required_days,
    }
}

export function useGamificationVersions(userId?: string) {
    const [versions, setVersions] = useState<GamificationSettingVersion[]>([])
    const [loading, setLoading] = useState(true)

    const fetchVersions = useCallback(async () => {
        if (!userId) {
            setVersions([])
            setLoading(false)
            return
        }

        try {
            setLoading(true)
            const { data, error } = await (supabase
                .from('gamification_setting_versions' as any) as any)
                .select('*')
                .eq('user_id', userId)
                .order('effective_from', { ascending: false })
                .order('created_at', { ascending: false })
                .order('id', { ascending: false })

            if (error) throw error
            setVersions((data as GamificationSettingVersion[]) || [])
        } catch (err) {
            console.error('Failed to fetch gamification versions:', err)
            setVersions([])
        } finally {
            setLoading(false)
        }
    }, [userId])

    useEffect(() => {
        fetchVersions()

        if (!userId) return

        const channel = supabase
            .channel(`gamification-versions-${userId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'gamification_setting_versions',
                    filter: `user_id=eq.${userId}`
                },
                () => {
                    fetchVersions()
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [fetchVersions, userId])

    // active バージョン: effective_to === null の行
    const activeVersion = useMemo(() => {
        return versions.find(v => v.effective_to === null) ?? null
    }, [versions])

    // 削除済みバージョン: effective_to !== null の行
    const deletedVersions = useMemo(() => {
        return versions.filter(v => v.effective_to !== null)
    }, [versions])

    /**
     * 指定日に有効だった設定を返す
     * 複数マッチ時は effective_from DESC, created_at DESC, id DESC で最初のものを優先
     */
    const getSettingsForDate = useCallback((date: Date): VersionedSettings => {
        const dateStr = format(date, 'yyyy-MM-dd')

        // versions は既に effective_from DESC, created_at DESC, id DESC でソート済み
        for (const v of versions) {
            // [effective_from, effective_to) チェック
            if (v.effective_from > dateStr) continue
            if (v.effective_to && v.effective_to <= dateStr) continue
            return toVersionedSettings(v)
        }

        return DEFAULT_VERSIONED_SETTINGS
    }, [versions])

    /**
     * RPC save_gamification_version を呼び出し（トランザクション保証あり）
     */
    const saveNewVersion = useCallback(async (settings: VersionedSettings): Promise<boolean> => {
        if (!userId) return false

        const { error } = await (supabase.rpc as any)('save_gamification_version', {
            p_user_id: userId,
            p_condition_type: settings.condition_type,
            p_straight_count: settings.straight_count,
            p_allow_shield: settings.allow_shield,
            p_allow_revival: settings.allow_revival,
            p_allow_late: settings.allow_late,
            p_use_target_days: settings.use_target_days,
            p_custom_required_days: settings.custom_required_days,
        })

        if (error) {
            console.error('Failed to save gamification version:', error)
            return false
        }

        await fetchVersions()
        return true
    }, [userId, fetchVersions])

    /**
     * RPC reactivate_gamification_version を呼び出し（トランザクション保証あり）
     */
    const reactivateVersion = useCallback(async (version: GamificationSettingVersion): Promise<boolean> => {
        const { error } = await (supabase.rpc as any)('reactivate_gamification_version', {
            p_version_id: version.id,
        })

        if (error) {
            console.error('Failed to reactivate gamification version:', error)
            return false
        }

        await fetchVersions()
        return true
    }, [fetchVersions])

    /**
     * 削除済みバージョンの effective_to 日付を修正する
     */
    const updateVersionEffectiveTo = useCallback(async (id: number, newDate: string): Promise<boolean> => {
        const { error } = await (supabase
            .from('gamification_setting_versions' as any) as any)
            .update({ effective_to: newDate })
            .eq('id', id)

        if (error) {
            console.error('Failed to update version effective_to:', error)
            return false
        }

        await fetchVersions()
        return true
    }, [fetchVersions])

    return {
        versions,
        loading,
        activeVersion,
        deletedVersions,
        getSettingsForDate,
        saveNewVersion,
        reactivateVersion,
        updateVersionEffectiveTo,
        refetch: fetchVersions,
    }
}
