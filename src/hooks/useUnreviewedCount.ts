import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

export function useUnreviewedCount(isAdmin: boolean) {
    const [count, setCount] = useState(0)

    const fetchCount = useCallback(async () => {
        if (!isAdmin) {
            setCount(0)
            return
        }

        const { count: c, error } = await supabase
            .from('submissions')
            .select('*', { count: 'exact', head: true })
            .is('reviewed_at', null)
            .eq('type', 'video')

        if (error) {
            console.error('Failed to fetch unreviewed count:', error)
            return
        }
        if (c !== null) setCount(c)
    }, [isAdmin])

    useEffect(() => {
        fetchCount()

        if (!isAdmin) return

        const channel = supabase
            .channel('unreviewed-submissions')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'submissions'
                },
                () => { fetchCount() }
            )
            .subscribe()

        return () => { supabase.removeChannel(channel) }
    }, [isAdmin, fetchCount])

    return { count }
}
