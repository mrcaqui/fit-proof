import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Database } from '@/types/database.types'
import { parseISO } from 'date-fns'

type SubmissionItem = Database['public']['Tables']['submission_items']['Row']

export function useSubmissionItems(userId?: string) {
    const [items, setItems] = useState<SubmissionItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchItems = useCallback(async () => {
        if (!userId) {
            setLoading(false)
            setItems([])
            return
        }

        try {
            setLoading(true)
            const { data, error } = await supabase
                .from('submission_items')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: true })

            if (error) throw error
            setItems(data || [])
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [userId])

    useEffect(() => {
        fetchItems()

        if (!userId) return

        // リアルタイム購読の設定
        const channel = supabase
            .channel(`submission-items-${userId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'submission_items',
                    filter: `user_id=eq.${userId}`
                },
                () => {
                    fetchItems()
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [fetchItems, userId])

    // 指定日時点で有効なアイテムを取得
    const getEffectiveSubmissionItems = useCallback((date: Date): SubmissionItem[] => {
        const endOfTargetDate = new Date(date)
        endOfTargetDate.setHours(23, 59, 59, 999)
        return items.filter(item => {
            const effective = parseISO(item.effective_from)
            return effective <= endOfTargetDate
        })
    }, [items])

    // アイテムの適用開始日を更新
    const handleUpdateItemEffectiveFrom = useCallback(async (id: number, newDate: string): Promise<void> => {
        const client = supabase.from('submission_items' as any) as any
        const { error } = await client
            .update({ effective_from: new Date(newDate + 'T00:00:00').toISOString() })
            .eq('id', id)
        if (error) {
            alert('日付の更新に失敗しました: ' + error.message)
        } else {
            fetchItems()
        }
    }, [fetchItems])

    return { items, loading, error, refetch: fetchItems, getEffectiveSubmissionItems, handleUpdateItemEffectiveFrom }
}
