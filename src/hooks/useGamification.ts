/**
 * ゲーミフィケーション状態を管理するカスタムフック
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Database } from '@/types/database.types'
import { GamificationSettings, DEFAULT_GAMIFICATION_SETTINGS } from '@/types/gamification.types'
import { calculateStreak, isRevivalCandidate, calculatePerfectWeeks, SubmissionForStreak, GroupConfig } from '@/utils/streakCalculator'
import { format, parseISO, startOfDay } from 'date-fns'

type Profile = Database['public']['Tables']['profiles']['Row']
type Submission = Database['public']['Tables']['submissions']['Row']

export interface GamificationState {
    // プロフィールから取得（または effective_from 時はオンデマンド計算）
    totalReps: number
    totalDays: number
    shieldStock: number
    perfectWeekCount: number
    revivalSuccessCount: number
    // 計算結果
    currentStreak: number
    shieldDays: string[]
    revivalDays: string[]
    // 通知用
    pendingNotifications: PendingNotification[]
}

export interface PendingNotification {
    type: 'shield_consumed' | 'revival_success' | 'perfect_week'
    message: string
    count?: number
}

interface UseGamificationOptions {
    targetUserId?: string
    submissions: Submission[]
    isRestDay: (date: Date) => boolean
    groupConfigs?: GroupConfig[]
    getTargetDaysPerWeek?: (date: Date) => number
    dataLoading?: boolean
    onRefreshSubmissions?: () => Promise<void> | void
}

export function useGamification({ targetUserId, submissions, isRestDay, groupConfigs, getTargetDaysPerWeek, dataLoading, onRefreshSubmissions }: UseGamificationOptions) {
    const { user } = useAuth()
    const effectiveUserId = targetUserId || user?.id

    const [gamificationProfile, setGamificationProfile] = useState<Partial<Profile>>({})
    const [gamificationSettings, setGamificationSettings] = useState<GamificationSettings>(DEFAULT_GAMIFICATION_SETTINGS)
    const [pendingNotifications, setPendingNotifications] = useState<PendingNotification[]>([])
    const [loading, setLoading] = useState(true)

    const isReady = !loading && !dataLoading

    // プロフィールからゲーミフィケーションデータを取得
    const fetchGamificationData = useCallback(async () => {
        if (!effectiveUserId) return

        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('total_reps, shield_stock, perfect_week_count, revival_success_count, gamification_settings')
                .eq('id', effectiveUserId)
                .single() as { data: { total_reps: number | null, shield_stock: number | null, perfect_week_count: number | null, revival_success_count: number | null, gamification_settings: GamificationSettings | null } | null, error: any }

            if (error) throw error
            if (data) {
                // gamification_settingsを除外してプロフィールにセット
                const { gamification_settings, ...profileData } = data
                setGamificationProfile(profileData as Partial<Profile>)
                if (gamification_settings) {
                    // deep merge で後方互換性を確保
                    setGamificationSettings({
                        ...DEFAULT_GAMIFICATION_SETTINGS,
                        ...gamification_settings,
                        straight: {
                            ...DEFAULT_GAMIFICATION_SETTINGS.straight,
                            ...(gamification_settings.straight ?? {}),
                        },
                        shield: {
                            ...DEFAULT_GAMIFICATION_SETTINGS.shield,
                            ...(gamification_settings.shield ?? {}),
                        },
                    })
                }
            }
        } catch (err) {
            console.error('Failed to fetch gamification data:', err)
        } finally {
            setLoading(false)
        }
    }, [effectiveUserId])

    useEffect(() => {
        fetchGamificationData()
    }, [fetchGamificationData])

    // submissionsが更新されたらプロフィールも再取得
    // statusやrepsの変更も検知するためにシリアライズしたキーを使用
    const submissionsKey = useMemo(() => {
        return submissions.map(s => `${s.id}:${s.status}:${s.reps}`).join(',')
    }, [submissions])

    useEffect(() => {
        if (submissions.length > 0) {
            fetchGamificationData()
        }
    }, [submissionsKey, fetchGamificationData])

    // プロフィールのリアルタイム購読
    useEffect(() => {
        if (!effectiveUserId) return

        const channel = supabase
            .channel(`profile-changes-${effectiveUserId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'profiles',
                    filter: `id=eq.${effectiveUserId}`
                },
                () => {
                    fetchGamificationData()
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [effectiveUserId, fetchGamificationData])

    // 投稿データをストリーク計算用に変換
    const submissionsForStreak: SubmissionForStreak[] = useMemo(() => {
        return submissions.map(s => ({
            target_date: s.target_date,
            status: s.status,
            is_revival: s.is_revival ?? false,
            type: s.type
        }))
    }, [submissions])

    // effective_from を gamificationSettings から取得
    const effectiveFrom = useMemo(() => {
        return gamificationSettings.effective_from
            ? parseISO(gamificationSettings.effective_from)
            : undefined
    }, [gamificationSettings.effective_from])

    // submissions のフィルタリング（effective_from 以降のみ）
    const filteredSubmissions = useMemo(() => {
        if (!effectiveFrom) return submissionsForStreak
        const cutoff = format(effectiveFrom, 'yyyy-MM-dd')
        return submissionsForStreak.filter(s =>
            s.target_date && s.target_date >= cutoff
        )
    }, [submissionsForStreak, effectiveFrom])

    // 累積日数の計算（shield は除外）
    const totalDays = useMemo(() => {
        const uniqueDates = new Set<string>()
        for (const s of filteredSubmissions) {
            if (s.target_date && s.status === 'success' && s.type !== 'shield') {
                uniqueDates.add(s.target_date)
            }
        }
        return uniqueDates.size
    }, [filteredSubmissions])

    // 累積回数: effective_from がある場合はオンデマンド計算
    const totalReps = useMemo(() => {
        if (!effectiveFrom) return gamificationProfile.total_reps ?? 0
        // effective_from 設定時: filteredSubmissions の reps を対象に計算
        // SubmissionForStreak には reps がないため submissions から直接計算
        const cutoff = format(effectiveFrom, 'yyyy-MM-dd')
        return submissions
            .filter(s => s.status === 'success' && s.reps && s.target_date && s.target_date >= cutoff)
            .reduce((sum, s) => sum + (s.reps ?? 0), 0)
    }, [effectiveFrom, submissions, gamificationProfile.total_reps])

    // シールド残数: effective_from 設定時はストレートから獲得数を計算
    // perfectWeekCount 確定後に計算するため、一旦仮の変数で宣言（後で perfectWeekCount から算出）
    const shieldStockFromDB = gamificationProfile.shield_stock ?? 0

    // グループ設定を日付関数として生成
    const getGroupConfigsForDate = useCallback((date: Date): GroupConfig[] => {
        if (!groupConfigs) return []
        const dateStr = format(date, 'yyyy-MM-dd')
        return groupConfigs.filter(g => g.effectiveFrom <= dateStr)
    }, [groupConfigs])

    // ストリーク計算（オンデマンド）
    const streakResult = useMemo(() => {
        return calculateStreak(
            submissionsForStreak,
            isRestDay,
            effectiveFrom,
            getGroupConfigsForDate
        )
    }, [submissionsForStreak, isRestDay, effectiveFrom, getGroupConfigsForDate])

    // リバイバル回数: effective_from がある場合はオンデマンド計算
    const revivalSuccessCount = useMemo(() => {
        if (!effectiveFrom) return gamificationProfile.revival_success_count ?? 0
        return filteredSubmissions
            .filter(s => s.status === 'success' && s.is_revival)
            .length
    }, [effectiveFrom, filteredSubmissions, gamificationProfile.revival_success_count])

    // 確定基準日の算出（D-4）: 今日より前に終了した週（日曜 < 今日）のみカウント
    // pastSubmissionDays ではなく「週が完了したか」で判定する
    const confirmedBeforeDate = useMemo(() => {
        return startOfDay(new Date())
    }, [])

    // ストレート達成回数: 常にオンデマンド計算（週単位判定に統一）
    const perfectWeekCount = useMemo(() => {
        const defaultTarget = (_date: Date) => gamificationSettings.straight.custom_required_days
        const weeklyTarget = gamificationSettings.straight.use_target_days
            ? (getTargetDaysPerWeek ?? defaultTarget)
            : defaultTarget

        return calculatePerfectWeeks(
            filteredSubmissions,
            isRestDay,
            weeklyTarget,
            getGroupConfigsForDate,
            gamificationSettings.straight.allow_revival,
            gamificationSettings.straight.allow_shield,
            confirmedBeforeDate
        )
    }, [filteredSubmissions, isRestDay, gamificationSettings, getGroupConfigsForDate, getTargetDaysPerWeek, confirmedBeforeDate])

    // シールド残数の最終計算（perfectWeekCount 確定後）
    const shieldStock = useMemo(() => {
        if (!effectiveFrom) return shieldStockFromDB
        if (!gamificationSettings.shield.enabled) return 0

        // ストレート達成数からシールド獲得数を計算
        let earnedShields = 0
        if (gamificationSettings.shield.condition_type === 'straight_count') {
            const requiredStraights = gamificationSettings.shield.straight_count || 1
            earnedShields = Math.floor(perfectWeekCount / requiredStraights)
        }
        // TODO: monthly_perfect 条件タイプ

        // 使用済みシールド数（shield タイプの承認済み投稿）
        const usedShields = filteredSubmissions.filter(s => s.type === 'shield' && s.status === 'success').length

        return Math.max(0, earnedShields - usedShields)
    }, [effectiveFrom, shieldStockFromDB, gamificationSettings.shield, perfectWeekCount, filteredSubmissions])

    // effective_from 設定時、計算済みの shield_stock / perfect_week_count を DB に同期する
    // RPC 呼び出し直前にのみ使用する（useEffect での自動同期は行わない）
    const syncGamificationProfile = useCallback(async (): Promise<boolean> => {
        if (!effectiveUserId || !effectiveFrom) return true
        if (!isReady) {
            console.warn('syncGamificationProfile called before data is ready, skipping')
            return false
        }
        if (shieldStock === shieldStockFromDB && perfectWeekCount === (gamificationProfile.perfect_week_count ?? 0)) return true

        const { error } = await supabase
            .from('profiles')
            .update({
                shield_stock: shieldStock,
                perfect_week_count: perfectWeekCount,
            })
            .eq('id', effectiveUserId)
        if (error) {
            console.error('Failed to sync gamification profile:', error)
            return false
        }
        return true
    }, [effectiveUserId, effectiveFrom, isReady, shieldStock, shieldStockFromDB, perfectWeekCount, gamificationProfile.perfect_week_count])

    // シールドを適用（DB RPC でアトミックに実行）
    const applyShield = useCallback(async (targetDate: string): Promise<boolean> => {
        if (!effectiveUserId) return false
        if (shieldStock <= 0) return false
        try {
            const synced = await syncGamificationProfile()
            if (!synced) return false

            const { data, error } = await (supabase.rpc as any)('apply_shield', {
                p_user_id: effectiveUserId,
                p_target_date: targetDate
            })
            if (error) throw error
            if (data === false) return false

            // profiles と submissions の両方を再取得して
            // フロントエンド計算値（shieldStock 含む）を即座に更新する
            await fetchGamificationData()
            await onRefreshSubmissions?.()
            return true
        } catch (err) {
            console.error('Failed to apply shield:', err)
            return false
        }
    }, [effectiveUserId, shieldStock, syncGamificationProfile, fetchGamificationData, onRefreshSubmissions])

    // シールドを取り消す（DB RPC でアトミックに実行）
    const removeShield = useCallback(async (targetDate: string): Promise<boolean> => {
        if (!effectiveUserId) return false
        try {
            const synced = await syncGamificationProfile()
            if (!synced) return false

            const { data, error } = await (supabase.rpc as any)('remove_shield', {
                p_user_id: effectiveUserId,
                p_target_date: targetDate
            })
            if (error) throw error
            if (data === false) return false

            await fetchGamificationData()
            await onRefreshSubmissions?.()
            return true
        } catch (err) {
            console.error('Failed to remove shield:', err)
            return false
        }
    }, [effectiveUserId, syncGamificationProfile, fetchGamificationData, onRefreshSubmissions])

    // ゲーミフィケーション状態
    const state: GamificationState = useMemo(() => ({
        totalReps,
        totalDays,
        shieldStock: shieldStock,
        perfectWeekCount,
        revivalSuccessCount,
        currentStreak: streakResult.currentStreak,
        shieldDays: streakResult.shieldDays,
        revivalDays: streakResult.revivalDays,
        pendingNotifications
    }), [totalReps, totalDays, shieldStock, streakResult, perfectWeekCount, revivalSuccessCount, pendingNotifications])

    // 日付がシールド消費日かどうか
    const isShieldDay = useCallback((date: Date): boolean => {
        const dateStr = format(date, 'yyyy-MM-dd')
        return streakResult.shieldDays.includes(dateStr)
    }, [streakResult.shieldDays])

    // 日付がリバイバル日かどうか
    const isRevivalDay = useCallback((date: Date): boolean => {
        const dateStr = format(date, 'yyyy-MM-dd')
        return streakResult.revivalDays.includes(dateStr)
    }, [streakResult.revivalDays])

    // 承認時にrepsとリバイバルを更新
    const handleApproval = useCallback(async (
        submissionId: number,
        reps: number,
        targetDate: string
    ): Promise<{ success: boolean; isRevival: boolean }> => {
        if (!effectiveUserId) return { success: false, isRevival: false }

        try {
            const targetDateObj = parseISO(targetDate)

            // リバイバル判定（この投稿を除外した状態で判定）
            const otherSubmissions = submissionsForStreak.filter(s =>
                s.target_date !== targetDate
            )
            const isRevival = isRevivalCandidate(targetDateObj, otherSubmissions, isRestDay)

            // submission を更新
            const { error: submissionError } = await (supabase
                .from('submissions') as any)
                .update({
                    reps,
                    is_revival: isRevival
                })
                .eq('id', submissionId)

            if (submissionError) throw submissionError

            // プロフィールを更新
            const updates: any = {
                total_reps: (gamificationProfile.total_reps ?? 0) + reps
            }

            if (isRevival) {
                updates.revival_success_count = (gamificationProfile.revival_success_count ?? 0) + 1
                setPendingNotifications(prev => [...prev, {
                    type: 'revival_success',
                    message: '不屈の復活！過去の空白を埋めました！'
                }])
            }

            const { error: profileError } = await (supabase
                .from('profiles') as any)
                .update(updates)
                .eq('id', effectiveUserId)

            if (profileError) throw profileError

            // データを再取得
            await fetchGamificationData()

            return { success: true, isRevival }
        } catch (err) {
            console.error('Failed to handle approval:', err)
            return { success: false, isRevival: false }
        }
    }, [effectiveUserId, submissionsForStreak, isRestDay, gamificationProfile, fetchGamificationData])

    // 承認取り消し時にrepsを減算
    const handleApprovalCancel = useCallback(async (
        submissionId: number,
        previousReps: number | null
    ): Promise<boolean> => {
        if (!effectiveUserId) return false

        try {
            // submission をリセット
            const { error: submissionError } = await (supabase
                .from('submissions') as any)
                .update({
                    reps: null,
                    is_revival: false
                })
                .eq('id', submissionId)

            if (submissionError) throw submissionError

            // プロフィールを更新（repsを減算）
            if (previousReps && previousReps > 0) {
                const newTotalReps = Math.max(0, (gamificationProfile.total_reps ?? 0) - previousReps)
                const { error: profileError } = await (supabase
                    .from('profiles') as any)
                    .update({ total_reps: newTotalReps })
                    .eq('id', effectiveUserId)

                if (profileError) throw profileError
            }

            await fetchGamificationData()
            return true
        } catch (err) {
            console.error('Failed to cancel approval:', err)
            return false
        }
    }, [effectiveUserId, gamificationProfile, fetchGamificationData])

    // 通知をクリア
    const clearNotification = useCallback((index: number) => {
        setPendingNotifications(prev => prev.filter((_, i) => i !== index))
    }, [])

    const clearAllNotifications = useCallback(() => {
        setPendingNotifications([])
    }, [])

    return {
        state,
        settings: gamificationSettings,
        loading,
        isShieldDay,
        isRevivalDay,
        handleApproval,
        handleApprovalCancel,
        applyShield,
        removeShield,
        clearNotification,
        clearAllNotifications,
        refetch: fetchGamificationData
    }
}
