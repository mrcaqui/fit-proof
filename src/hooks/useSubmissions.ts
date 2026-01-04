import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Database } from '@/types/database.types'
import { useAuth } from '@/context/AuthContext'

type Submission = Database['public']['Tables']['submissions']['Row']

export function useSubmissions() {
    const { user } = useAuth()
    const [submissions, setSubmissions] = useState<Submission[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchSubmissions = async () => {
        try {
            if (!user || !user.id) return
            setLoading(true)
            const { data, error } = await supabase
                .from('submissions')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })

            if (error) throw error
            setSubmissions(data || [])
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (!user) return
        fetchSubmissions()
    }, [user])

    return { submissions, loading, error, refetch: fetchSubmissions }
}
