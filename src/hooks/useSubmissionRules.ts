import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Database } from '@/types/database.types'
import { isSameDay, parseISO } from 'date-fns'

type SubmissionRule = Database['public']['Tables']['submission_rules']['Row']

export function useSubmissionRules(clientId?: string) {
    const [rules, setRules] = useState<SubmissionRule[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchRules = useCallback(async () => {
        if (!clientId) {
            setLoading(false)
            return
        }

        try {
            setLoading(true)
            const { data, error } = await supabase
                .from('submission_rules')
                .select('*')
                .eq('client_id', clientId)
                .order('created_at', { ascending: false })

            if (error) throw error
            setRules(data || [])
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [clientId])

    useEffect(() => {
        fetchRules()
    }, [fetchRules])

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

    return { rules, loading, error, refetch: fetchRules, getRuleForDate }
}
