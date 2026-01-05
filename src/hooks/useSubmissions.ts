import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Database } from '@/types/database.types'
import { useAuth } from '@/context/AuthContext'
import { deleteR2Object } from '@/lib/r2'

type Submission = Database['public']['Tables']['submissions']['Row']

export function useSubmissions() {
    const { user } = useAuth()
    const [submissions, setSubmissions] = useState<Submission[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchSubmissions = async (silent = false) => {
        try {
            if (!user || !user.id) return
            if (!silent) setLoading(true)
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
            if (!silent) setLoading(false)
        }
    }

    const deleteSubmission = async (id: number, r2Key: string | null) => {
        try {
            // 1. Delete from R2 if key exists
            if (r2Key) {
                await deleteR2Object(r2Key)
            }

            // 2. Delete from Supabase
            const { error: dbError } = await supabase
                .from('submissions')
                .delete()
                .eq('id', id)

            if (dbError) throw dbError

            // 3. Refresh the list silently
            await fetchSubmissions(true)
            return { success: true }
        } catch (err: any) {
            console.error('Delete failed:', err)
            return { success: false, error: err.message }
        }
    }

    useEffect(() => {
        if (!user) return
        fetchSubmissions()
    }, [user])

    return { submissions, loading, error, refetch: fetchSubmissions, deleteSubmission }
}
