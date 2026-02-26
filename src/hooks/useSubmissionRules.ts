import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Database } from '@/types/database.types'
import { isSameDay, parseISO, format } from 'date-fns'
import { GroupConfig } from '@/utils/streakCalculator'

type SubmissionRule = Database['public']['Tables']['submission_rules']['Row']

/** ルールが指定日に有効かを判定するヘルパー（[effective_from, effective_to) セマンティクス） */
function isRuleActiveForDate(rule: SubmissionRule, dateStr: string): boolean {
    const ruleFrom = format(parseISO(rule.effective_from), 'yyyy-MM-dd')
    if (ruleFrom > dateStr) return false
    if (rule.effective_to) {
        const ruleTo = format(parseISO(rule.effective_to), 'yyyy-MM-dd')
        if (ruleTo <= dateStr) return false
    }
    return true
}

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

        const dateStr = format(date, 'yyyy-MM-dd')

        const effectiveRules = rules.filter(r => {
            return r.rule_type === type && isRuleActiveForDate(r, dateStr)
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

    // 休息日判定関数（latest-wins 方式 + effective_to フィルタ）
    const isRestDayForDate = useCallback((date: Date): boolean => {
        const dateStr = format(date, 'yyyy-MM-dd')
        const dayOfWeek = date.getDay()

        // effective_from <= date かつ (effective_to IS NULL OR effective_to > date) の rest_day ルールをフィルタ
        const restDayRules = rules.filter(r => {
            if (r.rule_type !== 'rest_day') return false
            return isRuleActiveForDate(r, dateStr)
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

    // 日付ベースのグループ設定取得（effective_to 対応）
    const getGroupConfigsForDate = useCallback((date: Date): GroupConfig[] => {
        const dateStr = format(date, 'yyyy-MM-dd')
        const groupRules = rules.filter(r =>
            r.rule_type === 'group' && r.group_id !== null && isRuleActiveForDate(r, dateStr)
        )

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
            const effectiveFrom = groupRuleList
                .map(r => format(parseISO(r.effective_from), 'yyyy-MM-dd'))
                .sort()[0]
            const effectiveTo = groupRuleList[0].effective_to
                ? format(parseISO(groupRuleList[0].effective_to), 'yyyy-MM-dd')
                : null
            configs.push({ groupId, daysOfWeek, requiredCount, effectiveFrom, effectiveTo })
        }

        return configs
    }, [rules])

    // アクティブなグループ設定のみ取得（effective_to IS NULL、管理画面バリデーション用）
    const getAllActiveGroupConfigs = useCallback((): GroupConfig[] => {
        const groupRules = rules.filter(r =>
            r.rule_type === 'group' && r.group_id !== null && r.effective_to === null
        )

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
            const effectiveFrom = groupRuleList
                .map(r => format(parseISO(r.effective_from), 'yyyy-MM-dd'))
                .sort()[0]
            configs.push({ groupId, daysOfWeek, requiredCount, effectiveFrom, effectiveTo: null })
        }

        return configs
    }, [rules])

    // 後方互換: getAllGroupConfigs は getAllActiveGroupConfigs のエイリアス
    const getAllGroupConfigs = getAllActiveGroupConfigs

    // 週目標日数を計算
    const getTargetDaysPerWeek = useCallback((date?: Date): number => {
        const targetDate = date || new Date()
        const dateStr = format(targetDate, 'yyyy-MM-dd')

        // effective_from <= date かつ effective_to フィルタの有効ルールをフィルタ
        const activeRules = rules.filter(r => isRuleActiveForDate(r, dateStr))

        // 休息日の曜日数（重複排除）
        const restDayCount = new Set(
            activeRules
                .filter(r => r.rule_type === 'rest_day' && r.scope === 'weekly' && r.day_of_week !== null)
                .map(r => r.day_of_week)
        ).size

        // グループによる削減日数
        const groupReduceCount = getGroupConfigsForDate(targetDate)
            .reduce((sum, g) => sum + (g.daysOfWeek.length - g.requiredCount), 0)

        return 7 - restDayCount - groupReduceCount
    }, [rules, getGroupConfigsForDate])

    return {
        rules, loading, error, refetch: fetchRules,
        getRuleForDate, isDeadlinePassed,
        isRestDayForDate, getAllGroupConfigs, getAllActiveGroupConfigs,
        getGroupConfigsForDate, getTargetDaysPerWeek
    }
}
