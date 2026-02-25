import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Database } from '@/types/database.types'
import { isSameDay, parseISO, format } from 'date-fns'
import { GroupConfig } from '@/utils/streakCalculator'

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
                .order('effective_from', { ascending: false })
                .order('id', { ascending: false })

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

        const endOfTargetDate = new Date(date)
        endOfTargetDate.setHours(23, 59, 59, 999)

        const effectiveRules = rules.filter(r => {
            const ruleEffective = parseISO(r.effective_from)
            return ruleEffective <= endOfTargetDate && r.rule_type === type
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

    // 休息日判定関数（latest-wins 方式）
    const isRestDayForDate = useCallback((date: Date): boolean => {
        const dateStr = format(date, 'yyyy-MM-dd')
        const dayOfWeek = date.getDay()

        // effective_from <= date の rest_day ルールをフィルタ
        const restDayRules = rules.filter(r => {
            if (r.rule_type !== 'rest_day') return false
            const ruleDate = format(parseISO(r.effective_from), 'yyyy-MM-dd')
            return ruleDate <= dateStr
        })

        // weekly スコープ: 同曜日の最新 effective_from を採用
        const weeklyMatch = restDayRules.find(r =>
            r.scope === 'weekly' && r.day_of_week === dayOfWeek
        )
        if (weeklyMatch) return true

        // daily スコープ: 同 specific_date の最新 effective_from を採用
        const dailyMatch = restDayRules.find(r =>
            r.scope === 'daily' && r.specific_date === dateStr
        )
        if (dailyMatch) return true

        return false
    }, [rules])

    // 全グループ設定を取得
    const getAllGroupConfigs = useCallback((): GroupConfig[] => {
        const groupRules = rules.filter(r => r.rule_type === 'group' && r.group_id !== null)

        // group_id でグルーピング
        const groupMap = new Map<string, SubmissionRule[]>()
        for (const r of groupRules) {
            const gid = r.group_id!
            if (!groupMap.has(gid)) groupMap.set(gid, [])
            groupMap.get(gid)!.push(r)
        }

        const configs: GroupConfig[] = []
        for (const [groupId, groupRuleList] of groupMap) {
            const daysOfWeek = groupRuleList
                .filter(r => r.day_of_week !== null)
                .map(r => r.day_of_week!)
            const requiredCount = groupRuleList[0].group_required_count ?? 1
            // effectiveFrom はグループ内最古の effective_from（yyyy-MM-dd 正規化）
            const effectiveFrom = groupRuleList
                .map(r => format(parseISO(r.effective_from), 'yyyy-MM-dd'))
                .sort()[0]
            configs.push({ groupId, daysOfWeek, requiredCount, effectiveFrom })
        }

        return configs
    }, [rules])

    // 週目標日数を計算
    const getTargetDaysPerWeek = useCallback((date?: Date): number => {
        const targetDate = date || new Date()
        const dateStr = format(targetDate, 'yyyy-MM-dd')

        // effective_from <= date の有効ルールをフィルタ
        const activeRules = rules.filter(r => {
            return format(parseISO(r.effective_from), 'yyyy-MM-dd') <= dateStr
        })

        // 休息日の曜日数（重複排除）
        const restDayCount = new Set(
            activeRules
                .filter(r => r.rule_type === 'rest_day' && r.scope === 'weekly' && r.day_of_week !== null)
                .map(r => r.day_of_week)
        ).size

        // グループによる削減日数
        const groupReduceCount = getAllGroupConfigs()
            .filter(g => g.effectiveFrom <= dateStr)
            .reduce((sum, g) => sum + (g.daysOfWeek.length - g.requiredCount), 0)

        return 7 - restDayCount - groupReduceCount
    }, [rules, getAllGroupConfigs])

    return {
        rules, loading, error, refetch: fetchRules,
        getRuleForDate, isDeadlinePassed,
        isRestDayForDate, getAllGroupConfigs, getTargetDaysPerWeek
    }
}
