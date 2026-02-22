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
            // 現在の投稿を取得（削除前に減算用データを取得）
            const targetWorkout = workouts.find(w => w.id === id)
            const userId = targetWorkout?.user_id
            const reps = targetWorkout?.reps || 0
            const isApproved = targetWorkout?.status === 'success'
            const isRevival = (targetWorkout as any)?.is_revival === true

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

            // 3. Profiles を更新（承認済みだった場合のみ減算）
            if (userId && isApproved) {
                const { data: profileData } = await supabase
                    .from('profiles')
                    .select('total_reps, revival_success_count')
                    .eq('id', userId)
                    .single()

                if (profileData) {
                    const updates: any = {}
                    const currentTotal = (profileData as any).total_reps || 0
                    const currentRevival = (profileData as any).revival_success_count || 0

                    if (reps > 0) {
                        updates.total_reps = Math.max(0, currentTotal - reps)
                    }

                    if (isRevival) {
                        updates.revival_success_count = Math.max(0, currentRevival - 1)
                    }

                    if (Object.keys(updates).length > 0) {
                        await (supabase.from('profiles') as any)
                            .update(updates)
                            .eq('id', userId)
                    }
                }
            }

            // 4. Refresh the list silently
            await fetchWorkouts(true)
            return { success: true }
        } catch (err: any) {
            console.error('Delete failed:', err)
            return { success: false, error: err.message }
        }
    }

    // ステータス更新ロジック（承認/却下/取り消し）
    const updateWorkoutStatus = async (
        id: number,
        status: 'success' | 'fail' | 'excused' | null,
        reps?: number | null
    ) => {
        try {
            // 現在の投稿を取得（取り消し時に前のrepsを取得するため）
            const currentWorkout = workouts.find(w => w.id === id)
            const previousReps = currentWorkout?.reps || 0
            const previousStatus = currentWorkout?.status
            const userId = currentWorkout?.user_id
            const targetDate = currentWorkout?.target_date

            // 承認時はrepsも保存、取り消し時はrepsをnullにリセット
            const updateData: {
                status: typeof status;
                reviewed_at: string | null;
                reps?: number | null;
                is_revival?: boolean;
            } = {
                status,
                reviewed_at: status ? new Date().toISOString() : null
            }

            // 承認時はrepsを設定
            if (status === 'success' && reps !== undefined) {
                updateData.reps = reps
            }
            // 取り消し時はrepsをnullにリセット
            if (status === null) {
                updateData.reps = null
                updateData.is_revival = false
            }

            // 新規承認時のリバイバル自動判定
            let isRevival = false
            if (status === 'success' && previousStatus !== 'success' && targetDate) {
                // この日付に他の承認済み投稿があるか確認
                const hasOtherApproved = workouts.some(w =>
                    w.id !== id &&
                    w.target_date === targetDate &&
                    w.status === 'success'
                )

                // 過去の日付で、他に承認済みがなければリバイバル候補
                const targetDateObj = new Date(targetDate)
                const today = new Date()
                today.setHours(0, 0, 0, 0)
                targetDateObj.setHours(0, 0, 0, 0)

                if (targetDateObj < today && !hasOtherApproved) {
                    // 過去日かつ初回承認 → リバイバル
                    isRevival = true
                    updateData.is_revival = true

                    // クライアント向けに通知をlocalStorageに保存
                    if (userId) {
                        const notificationKey = `pending_revival_${userId}`
                        const existing = localStorage.getItem(notificationKey)
                        const notifications = existing ? JSON.parse(existing) : []
                        notifications.push({
                            type: 'revival_success',
                            message: '🔥 不屈の復活！過去の空白を埋めました！',
                            targetDate,
                            createdAt: new Date().toISOString()
                        })
                        localStorage.setItem(notificationKey, JSON.stringify(notifications))
                    }
                }
            }

            // 1. submissions テーブルを更新
            const { error: dbError } = await (supabase
                .from('submissions') as any)
                .update(updateData)
                .eq('id', id)

            if (dbError) throw dbError

            // 2. profiles.total_reps を更新
            if (userId) {
                // 現在のプロフィールを取得
                const { data: profileData } = await supabase
                    .from('profiles')
                    .select('total_reps, revival_success_count')
                    .eq('id', userId)
                    .single()

                const currentTotalReps = (profileData as any)?.total_reps || 0
                const currentRevivalCount = (profileData as any)?.revival_success_count || 0
                let newTotalReps = currentTotalReps
                let newRevivalCount = currentRevivalCount

                // 承認時: repsを加算（以前も承認済みだった場合は差分を計算）
                if (status === 'success' && reps !== undefined && reps !== null) {
                    if (previousStatus === 'success') {
                        // 再承認の場合: 差分を適用
                        newTotalReps = currentTotalReps - previousReps + reps
                    } else {
                        // 新規承認の場合: 加算
                        newTotalReps = currentTotalReps + reps
                    }

                    // リバイバルカウント加算
                    if (isRevival) {
                        newRevivalCount = currentRevivalCount + 1
                    }
                }
                // 取り消し・却下時: 以前承認済みだったならrepsを減算
                else if ((status === null || status === 'fail') && previousStatus === 'success') {
                    if (previousReps > 0) {
                        newTotalReps = Math.max(0, currentTotalReps - previousReps)
                    }
                    // リバイバルカウントも減算
                    if (currentWorkout && (currentWorkout as any).is_revival === true) {
                        newRevivalCount = Math.max(0, currentRevivalCount - 1)
                    }
                }

                // プロフィールを更新
                const profileUpdates: any = {}
                if (newTotalReps !== currentTotalReps) {
                    profileUpdates.total_reps = newTotalReps
                }
                if (newRevivalCount !== currentRevivalCount) {
                    profileUpdates.revival_success_count = newRevivalCount
                }

                if (Object.keys(profileUpdates).length > 0) {
                    const { error: profileError } = await (supabase
                        .from('profiles') as any)
                        .update(profileUpdates)
                        .eq('id', userId)

                    if (profileError) {
                        console.error('Profile update failed:', profileError)
                    }
                }
            }

            await fetchWorkouts(true)
            return { success: true, isRevival }
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
                    user_id: user.id,
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

    const deleteAdminComment = async (commentId: string) => {
        try {
            const { error: dbError } = await (supabase
                .from('admin_comments') as any)
                .delete()
                .eq('id', commentId)

            if (dbError) throw dbError
            await fetchWorkouts(true)
            return { success: true }
        } catch (err: any) {
            console.error('Delete comment failed:', err)
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
        deleteAdminComment,
        markCommentAsRead
    }
}
