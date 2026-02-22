import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Database } from '@/types/database.types'

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

    return { items, loading, error, refetch: fetchItems }
}
