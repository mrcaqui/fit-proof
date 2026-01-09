import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Database } from '@/types/database.types'
import { useAuth } from '@/context/AuthContext'
import { deleteR2Object } from '@/lib/r2'

type Submission = Database['public']['Tables']['submissions']['Row'] & {
    admin_comments?: Database['public']['Tables']['admin_comments']['Row'][]
}

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

            // 投稿を取得
            const { data: submissionsData, error: submissionsError } = await supabase
                .from('submissions')
                .select('*')
                .eq('user_id', effectiveUserId)
                .order('target_date', { ascending: false })
                .order('created_at', { ascending: false })

            if (submissionsError) throw submissionsError

            // このユーザーの投稿ID一覧を取得
            const submissionIds = ((submissionsData || []) as any[]).map(s => s.id)

            // コメントを別途取得
            let commentsData: any[] = []
            if (submissionIds.length > 0) {
                const { data: comments, error: commentsError } = await (supabase
                    .from('admin_comments') as any)
                    .select('*')
                    .in('submission_id', submissionIds)

                if (commentsError) {
                    console.warn('Comments fetch error:', commentsError)
                } else {
                    commentsData = comments || []
                }
            }

            // 投稿とコメントをマージ
            const workoutsWithComments = ((submissionsData || []) as any[]).map(s => ({
                ...s,
                admin_comments: commentsData.filter(c => c.submission_id === s.id)
            }))

            setWorkouts(workoutsWithComments)
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

    const addAdminComment = async (submissionId: number, content: string) => {
        if (!user?.id) return { success: false }
        try {
            const { error: dbError } = await (supabase
                .from('admin_comments') as any)
                .upsert({
                    submission_id: submissionId,
                    admin_id: user.id,
                    content,
                    read_at: null
                }, { onConflict: 'submission_id' })

            if (dbError) throw dbError
            await fetchWorkouts(true)
            return { success: true }
        } catch (err: any) {
            console.error('Add comment failed:', err)
            return { success: false, error: err.message }
        }
    }

    const markCommentAsRead = async (commentId: string) => {
        try {
            const { error: dbError } = await (supabase
                .from('admin_comments') as any)
                .update({ read_at: new Date().toISOString() })
                .eq('id', commentId)
                .is('read_at', null)

            if (dbError) throw dbError
            await fetchWorkouts(true)
            return { success: true }
        } catch (err: any) {
            console.error('Mark as read failed:', err)
            return { success: false, error: err.message }
        }
    }

    useEffect(() => {
        fetchWorkouts()

        const effectiveUserId = targetUserId || user?.id
        if (!effectiveUserId) return

        // リアルタイム購読の設定
        const submissionsChannel = supabase
            .channel(`submissions-changes-${effectiveUserId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'submissions',
                    filter: `user_id=eq.${effectiveUserId}`
                },
                () => fetchWorkouts(true)
            )
            .subscribe()

        const commentsChannel = supabase
            .channel(`comments-changes-${effectiveUserId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'admin_comments'
                    // クライアント側では submission_id によるフィルタリングが必要だが、
                    // 全体を取得し直すのであれば、このユーザーに関連する全コメントの変更を検知する
                },
                () => fetchWorkouts(true)
            )
            .subscribe()

        return () => {
            supabase.removeChannel(submissionsChannel)
            supabase.removeChannel(commentsChannel)
        }
    }, [fetchWorkouts, targetUserId, user?.id])

    return {
        workouts,
        loading,
        error,
        refetch: fetchWorkouts,
        deleteWorkout,
        updateWorkoutStatus,
        addAdminComment,
        markCommentAsRead
    }
}
