import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Database } from '@/types/database.types'

type Deadline = Database['public']['Tables']['deadlines']['Row']

export function useDeadlines() {
    const [deadlines, setDeadlines] = useState<Deadline[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        async function fetchDeadlines() {
            try {
                setLoading(true)
                const { data, error } = await supabase
                    .from('deadlines')
                    .select('*')
                    .order('id', { ascending: true })

                if (error) throw error
                setDeadlines(data || [])
            } catch (err: any) {
                setError(err.message)
            } finally {
                setLoading(false)
            }
        }

        fetchDeadlines()
    }, [])

    return { deadlines, loading, error }
}
