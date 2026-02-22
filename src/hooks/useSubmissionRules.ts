import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Database } from '@/types/database.types'
import { isSameDay, parseISO } from 'date-fns'

type SubmissionRule = Database['public']['Tables']['submission_rules']['Row']

export function useSubmissionRules(userId?: string) {
    const [rules, setRules] = useState<SubmissionRule[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchRules = useCallback(async () => {
        if (!userId) {
            setLoading(false)
            return
        }

        try {
            setLoading(true)
            const { data, error } = await supabase
                .from('submission_rules')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })

            if (error) throw error
            setRules(data || [])
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [userId])

    useEffect(() => {
        fetchRules()

        if (!userId) return

        // リアルタイム購読の設定
        const channel = supabase
            .channel(`submission-rules-${userId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'submission_rules',
                    filter: `user_id=eq.${userId}`
                },
                () => {
                    fetchRules()
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [fetchRules, userId])

    const getRuleForDate = useCallback((date: Date, type: 'deadline' | 'target_day') => {
        if (!rules.length) return null

        // Filter rules that are effective for the target date (created_at <= date)
        // Note: created_at is UTC, we compare with the start of the next day of the target date to be safe,
        // or just compare the ISO strings if we assume local time alignment.
        // For simplicity and correctness with "date" (which is the target calendar day), 
        // we should compare with the rule's created_at.
        // However, the requirement is "apply to future dates only".
        // Let's assume rules created TODAY apply to today and future.
        const effectiveRules = rules.filter(r => {
            const ruleCreated = parseISO(r.created_at)
            const ruleDeleted = r.deleted_at ? parseISO(r.deleted_at) : null

            // Rule is effective if it was created before or on the target date.
            const endOfTargetDate = new Date(date)
            endOfTargetDate.setHours(23, 59, 59, 999)

            // 1. Must be created at or before target date
            const isCreated = ruleCreated <= endOfTargetDate
            // 2. Must not be deleted, OR must be deleted AFTER the target date
            const isNotDeleted = !ruleDeleted || ruleDeleted > endOfTargetDate

            return isCreated && isNotDeleted && r.rule_type === type
        })

        if (!effectiveRules.length) return null

        // 1. Check Daily (Daily > Weekly > Monthly)
        const dailyRule = effectiveRules.find(r =>
            r.scope === 'daily' && r.specific_date && isSameDay(parseISO(r.specific_date), date)
        )
        if (dailyRule) return dailyRule.value

        // 2. Check Weekly
        const dayOfWeek = date.getDay() // 0 is Sunday
        const weeklyRule = effectiveRules.find(r =>
            r.scope === 'weekly' && r.day_of_week === dayOfWeek
        )
        if (weeklyRule) return weeklyRule.value

        // 3. Check Monthly (Default)
        const monthlyRule = effectiveRules.find(r => r.scope === 'monthly')
        if (monthlyRule) return monthlyRule.value

        return null
    }, [rules])

    // 期限超過判定関数: 指定日の期限時間を過ぎているかどうかを判定
    const isDeadlinePassed = useCallback((targetDate: Date): boolean => {
        const deadlineTime = getRuleForDate(targetDate, 'deadline')
        if (!deadlineTime) {
            // 期限が設定されていない場合は超過とみなさない
            return false
        }

        // 期限時間をパース (例: "19:00")
        const [hours, minutes] = deadlineTime.split(':').map(Number)

        // targetDateの期限時刻を作成
        const deadlineDateTime = new Date(targetDate)
        deadlineDateTime.setHours(hours, minutes, 0, 0)

        // 現在時刻と比較
        const now = new Date()
        return now > deadlineDateTime
    }, [getRuleForDate])

    return { rules, loading, error, refetch: fetchRules, getRuleForDate, isDeadlinePassed }
}
