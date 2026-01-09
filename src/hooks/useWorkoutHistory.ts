import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Database } from '@/types/database.types'
import { useAuth } from '@/context/AuthContext'
import { deleteR2Object } from '@/lib/r2'

type Submission = Database['public']['Tables']['submissions']['Row']

export function useWorkoutHistory(targetUserId?: string) {
    const { user } = useAuth()
    const [workouts, setWorkouts] = useState<Submission[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchWorkouts = useCallback(async (silent = false) => {
        const effectiveUserId = targetUserId || user?.id
        if (!effectiveUserId) return

        try {
            if (!silent) setLoading(true)
            const { data, error } = await supabase
                .from('submissions')
                .select('*')
                .eq('user_id', effectiveUserId)
                .order('target_date', { ascending: false })
                .order('created_at', { ascending: false })

            if (error) throw error
            setWorkouts(data || [])
        } catch (err: any) {
            setError(err.message)
        } finally {
            if (!silent) setLoading(false)
        }
    }, [user?.id, targetUserId])

    const deleteWorkout = async (id: number, r2Key: string | null) => {
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
            await fetchWorkouts(true)
            return { success: true }
        } catch (err: any) {
            console.error('Delete failed:', err)
            return { success: false, error: err.message }
        }
    }

    // Placeholder for status update logic (Approve / Reject)
    const updateWorkoutStatus = async (id: number, status: 'success' | 'fail' | 'excused' | null) => {
        try {
            const updateData: { status: typeof status; reviewed_at: string | null } = {
                status,
                reviewed_at: status ? new Date().toISOString() : null
            }
            const { error: dbError } = await (supabase
                .from('submissions') as any)
                .update(updateData)
                .eq('id', id)

            if (dbError) throw dbError
            await fetchWorkouts(true)
            return { success: true }
        } catch (err: any) {
            console.error('Status update failed:', err)
            return { success: false, error: err.message }
        }
    }

    useEffect(() => {
        fetchWorkouts()

        const effectiveUserId = targetUserId || user?.id
        if (!effectiveUserId) return

        // リアルタイム購読の設定
        const channel = supabase
            .channel(`submissions-changes-${effectiveUserId}`)
            .on(
                'postgres_changes',
                {
                    event: '*', // INSERT, UPDATE, DELETE すべて
                    schema: 'public',
                    table: 'submissions',
                    filter: `user_id=eq.${effectiveUserId}`
                },
                () => {
                    // 変更があったらサイレントに再取得
                    fetchWorkouts(true)
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [fetchWorkouts, targetUserId, user?.id])

    return {
        workouts,
        loading,
        error,
        refetch: fetchWorkouts,
        deleteWorkout,
        updateWorkoutStatus
    }
}
