/**
 * ゲーミフィケーション状態を管理するカスタムフック
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Database } from '@/types/database.types'
import { calculateStreak, isRevivalCandidate, SubmissionForStreak } from '@/utils/streakCalculator'
import { format, parseISO } from 'date-fns'

type Profile = Database['public']['Tables']['profiles']['Row']
type Submission = Database['public']['Tables']['submissions']['Row']

export interface GamificationState {
    // プロフィールから取得
    totalReps: number
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
}

export function useGamification({ targetUserId, submissions, isRestDay }: UseGamificationOptions) {
    const { user } = useAuth()
    const effectiveUserId = targetUserId || user?.id

    const [gamificationProfile, setGamificationProfile] = useState<Partial<Profile>>({})
    const [pendingNotifications, setPendingNotifications] = useState<PendingNotification[]>([])
    const [loading, setLoading] = useState(true)

    // プロフィールからゲーミフィケーションデータを取得
    const fetchGamificationData = useCallback(async () => {
        if (!effectiveUserId) return

        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('total_reps, shield_stock, perfect_week_count, revival_success_count')
                .eq('id', effectiveUserId)
                .single()

            if (error) throw error
            setGamificationProfile(data || {})
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

    // ストリーク計算（オンデマンド）
    const streakResult = useMemo(() => {
        return calculateStreak(
            submissionsForStreak,
            isRestDay,
            gamificationProfile.shield_stock ?? 0
        )
    }, [submissionsForStreak, isRestDay, gamificationProfile.shield_stock])

    // ゲーミフィケーション状態
    const state: GamificationState = useMemo(() => ({
        totalReps: gamificationProfile.total_reps ?? 0,
        shieldStock: gamificationProfile.shield_stock ?? 0,
        perfectWeekCount: gamificationProfile.perfect_week_count ?? 0,
        revivalSuccessCount: gamificationProfile.revival_success_count ?? 0,
        currentStreak: streakResult.currentStreak,
        shieldDays: streakResult.shieldDays,
        revivalDays: streakResult.revivalDays,
        pendingNotifications
    }), [gamificationProfile, streakResult, pendingNotifications])

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
