/**
 * ゲーミフィケーション状態を管理するカスタムフック
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Database } from '@/types/database.types'
import { GamificationSettings, DEFAULT_GAMIFICATION_SETTINGS } from '@/types/gamification.types'
import { calculateStreak, isRevivalCandidate, SubmissionForStreak, IsRestDayFn, GroupConfig } from '@/utils/streakCalculator'
import { format, parseISO, startOfDay, eachDayOfInterval, startOfWeek } from 'date-fns'

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
}

export function useGamification({ targetUserId, submissions, isRestDay, groupConfigs }: UseGamificationOptions) {
    const { user } = useAuth()
    const effectiveUserId = targetUserId || user?.id

    const [gamificationProfile, setGamificationProfile] = useState<Partial<Profile>>({})
    const [gamificationSettings, setGamificationSettings] = useState<GamificationSettings>(DEFAULT_GAMIFICATION_SETTINGS)
    const [pendingNotifications, setPendingNotifications] = useState<PendingNotification[]>([])
    const [loading, setLoading] = useState(true)

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
                    setGamificationSettings({
                        ...DEFAULT_GAMIFICATION_SETTINGS,
                        ...gamification_settings
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
            is_revival: s.is_revival ?? false
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

    // 累積日数の計算
    const totalDays = useMemo(() => {
        const uniqueDates = new Set<string>()
        for (const s of filteredSubmissions) {
            if (s.target_date && s.status === 'success') {
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

    // シールド残数: effective_from 設定時は 0 リセット
    const effectiveShieldStock = effectiveFrom ? 0 : (gamificationProfile.shield_stock ?? 0)

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
            effectiveShieldStock,
            effectiveFrom,
            getGroupConfigsForDate
        )
    }, [submissionsForStreak, isRestDay, effectiveShieldStock, effectiveFrom, getGroupConfigsForDate])

    // リバイバル回数: effective_from がある場合はオンデマンド計算
    const revivalSuccessCount = useMemo(() => {
        if (!effectiveFrom) return gamificationProfile.revival_success_count ?? 0
        return filteredSubmissions
            .filter(s => s.status === 'success' && s.is_revival)
            .length
    }, [effectiveFrom, filteredSubmissions, gamificationProfile.revival_success_count])

    // ストレート達成回数: effective_from がある場合はオンデマンド計算
    const perfectWeekCount = useMemo(() => {
        if (!effectiveFrom) return gamificationProfile.perfect_week_count ?? 0
        return calculateCumulativePerfectWeeks(
            filteredSubmissions, isRestDay, gamificationSettings.straight.weekly_target, getGroupConfigsForDate
        )
    }, [effectiveFrom, filteredSubmissions, isRestDay, gamificationProfile.perfect_week_count, gamificationSettings.straight.weekly_target, getGroupConfigsForDate])

    // ゲーミフィケーション状態
    const state: GamificationState = useMemo(() => ({
        totalReps,
        totalDays,
        shieldStock: Math.max(0, effectiveShieldStock - streakResult.shieldsConsumed),
        perfectWeekCount,
        revivalSuccessCount,
        currentStreak: streakResult.currentStreak,
        shieldDays: streakResult.shieldDays,
        revivalDays: streakResult.revivalDays,
        pendingNotifications
    }), [totalReps, totalDays, effectiveShieldStock, streakResult, perfectWeekCount, revivalSuccessCount, pendingNotifications])

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
        clearNotification,
        clearAllNotifications,
        refetch: fetchGamificationData
    }
}

/**
 * 累積ストレート達成回数を計算
 * filteredSubmissions から、定休日を除いた日付を時系列で走査し、
 * シールド・リバイバル不使用で weeklyTarget 日連続達成するごとに +1 カウント
 */
function calculateCumulativePerfectWeeks(
    submissions: SubmissionForStreak[],
    isRestDay: IsRestDayFn,
    weeklyTarget: number,
    getGroupConfigs?: (date: Date) => GroupConfig[]
): number {
    const approvedDates = new Set(
        submissions.filter(s => s.status === 'success' && s.target_date).map(s => s.target_date!)
    )
    const revivalDates = new Set(
        submissions.filter(s => s.status === 'success' && s.is_revival && s.target_date).map(s => s.target_date!)
    )
    const today = format(startOfDay(new Date()), 'yyyy-MM-dd')
    const allDates = Array.from(approvedDates).filter(d => d <= today).sort()
    if (allDates.length === 0) return 0

    let perfectStreak = 0
    let count = 0
    const startDateObj = parseISO(allDates[0])
    const endDate = startOfDay(new Date())
    const days = eachDayOfInterval({ start: startDateObj, end: endDate })

    // グループ事前計算（正順）
    const groupApprovalCountMap = new Map<string, number>()
    for (const day of days) {
        const dateStr = format(day, 'yyyy-MM-dd')
        const dayOfWeek = day.getDay()
        const weekKey = format(startOfWeek(day, { weekStartsOn: 1 }), 'yyyy-MM-dd')
        const activeGroupConfigs = getGroupConfigs ? getGroupConfigs(day) : []
        for (const group of activeGroupConfigs) {
            if (!group.daysOfWeek.includes(dayOfWeek)) continue
            if (approvedDates.has(dateStr)) {
                const mapKey = `${weekKey}-${group.groupId}`
                groupApprovalCountMap.set(mapKey, (groupApprovalCountMap.get(mapKey) ?? 0) + 1)
            }
        }
    }

    for (const day of days) {
        if (isRestDay(day)) continue
        const dateStr = format(day, 'yyyy-MM-dd')
        const dayOfWeek = day.getDay()
        const weekKey = format(startOfWeek(day, { weekStartsOn: 1 }), 'yyyy-MM-dd')

        // グループスキップ判定
        const activeGroupConfigs = getGroupConfigs ? getGroupConfigs(day) : []
        let isGroupSkipDay = false
        for (const group of activeGroupConfigs) {
            if (!group.daysOfWeek.includes(dayOfWeek)) continue
            const mapKey = `${weekKey}-${group.groupId}`
            const totalApproved = groupApprovalCountMap.get(mapKey) ?? 0
            if (!approvedDates.has(dateStr) && totalApproved >= group.requiredCount) {
                isGroupSkipDay = true
                break
            }
        }
        if (isGroupSkipDay) continue

        if (approvedDates.has(dateStr) && !revivalDates.has(dateStr)) {
            perfectStreak++
            if (perfectStreak >= weeklyTarget && perfectStreak % weeklyTarget === 0) {
                count++
            }
        } else {
            perfectStreak = 0
        }
    }
    return count
}
