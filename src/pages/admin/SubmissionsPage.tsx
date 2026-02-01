import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Play, User, Clock, CheckCircle, XCircle, AlertCircle, Trash2, Loader2 } from 'lucide-react'
import { VideoPlayerModal } from '@/components/admin/VideoPlayerModal'
import { deleteR2Object, getR2PublicUrl } from '@/lib/r2'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

type Submission = {
    id: number
    user_id: string
    type: 'video' | 'comment'
    r2_key: string | null
    thumbnail_url: string | null
    duration: number | null
    comment_text: string | null
    status: 'success' | 'fail' | 'excused' | null
    created_at: string
    target_date: string | null
    file_name: string | null
    video_size: number | null
    video_hash: string | null
    profiles?: {
        display_name: string | null
    }
}

export default function SubmissionsPage() {
    const { profile } = useAuth()
    const [submissions, setSubmissions] = useState<Submission[]>([])
    const [loading, setLoading] = useState(true)
    const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set())
    const [selectedVideo, setSelectedVideo] = useState<string | null>(null)

    const fetchSubmissions = async () => {
        setLoading(true)
        const { data, error } = await supabase
            .from('submissions')
            .select(`
                *,
                profiles (display_name)
            `)
            .order('created_at', { ascending: false })

        if (error) {
            console.error('Error fetching submissions:', error)
        } else {
            setSubmissions(data as Submission[])
        }
        setLoading(false)
    }

    useEffect(() => {
        if (profile?.role !== 'admin') return
        fetchSubmissions()
    }, [profile])

    const handleDelete = async (id: number, r2Key: string | null) => {
        if (!window.confirm('この提出を削除してもよろしいですか？（動画ファイルも削除されます）')) {
            return
        }

        setDeletingIds(prev => new Set(prev).add(id))
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

            // 3. Update local state
            setSubmissions(prev => prev.filter(s => s.id !== id))
        } catch (err) {
            console.error('Delete failed:', err)
            alert('削除に失敗しました。')
        } finally {
            setDeletingIds(prev => {
                const next = new Set(prev)
                next.delete(id)
                return next
            })
        }
    }

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'success':
                return <CheckCircle className="h-4 w-4 text-green-500" />
            case 'fail':
                return <XCircle className="h-4 w-4 text-red-500" />
            case 'excused':
                return <AlertCircle className="h-4 w-4 text-orange-500" />
            default:
                return null
        }
    }


    if (profile?.role !== 'admin') {
        return (
            <div className="text-center py-8">
                <p className="text-muted-foreground">管理者権限が必要です。</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">提出一覧</h2>
                <p className="text-muted-foreground">全ユーザーの提出状況を確認できます。</p>
            </div>

            {loading ? (
                <div className="text-center py-8">
                    <p className="text-muted-foreground">読み込み中...</p>
                </div>
            ) : submissions.length === 0 ? (
                <div className="text-center py-8">
                    <p className="text-muted-foreground">提出がありません。</p>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {submissions.map((submission) => (
                        <Card key={submission.id} className="overflow-hidden group">
                            {/* Thumbnail */}
                            <div className="relative aspect-video bg-muted">
                                {submission.thumbnail_url ? (
                                    <img
                                        src={submission.thumbnail_url}
                                        alt="Thumbnail"
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <Play className="h-12 w-12 text-muted-foreground" />
                                    </div>
                                )}
                                {submission.r2_key && (
                                    <Button
                                        size="icon"
                                        variant="secondary"
                                        className="absolute inset-0 m-auto w-12 h-12 rounded-full opacity-80 hover:opacity-100"
                                        onClick={() => setSelectedVideo(getR2PublicUrl(submission.r2_key!))}
                                    >
                                        <Play className="h-6 w-6" />
                                    </Button>
                                )}

                                {/* Delete Button Admin Overlay */}
                                <Button
                                    variant="destructive"
                                    size="icon"
                                    className="absolute top-2 right-2 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => handleDelete(submission.id, submission.r2_key)}
                                    disabled={deletingIds.has(submission.id)}
                                >
                                    {deletingIds.has(submission.id) ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Trash2 className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>

                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <User className="h-4 w-4" />
                                    {submission.profiles?.display_name || '不明なユーザー'}
                                </CardTitle>
                            </CardHeader>

                            <CardContent className="space-y-2">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Clock className="h-4 w-4" />
                                    {format(new Date(submission.created_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                    {getStatusIcon(submission.status || '')}
                                    <span className="capitalize">{submission.status || 'pending'}</span>
                                </div>
                                {(() => {
                                    // 同じユーザーの他の提出と比較
                                    const userSubmissions = submissions.filter(s => s.id !== submission.id && s.user_id === submission.user_id)

                                    // Hash一致チェック
                                    const hashMatch = submission.video_hash ? userSubmissions.find(s => s.video_hash === submission.video_hash) : null
                                    if (hashMatch) {
                                        return (
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <div className="flex items-center gap-1 text-[11px] font-bold text-destructive bg-destructive/10 p-1.5 rounded-md mt-2 cursor-pointer active:opacity-60 transition-opacity">
                                                        <AlertCircle className="h-3 w-3" />
                                                        <span>重複の可能性</span>
                                                    </div>
                                                </PopoverTrigger>
                                                <PopoverContent side="top" className="w-auto p-2 bg-popover/95 backdrop-blur-sm border shadow-xl z-[200]">
                                                    <div className="space-y-1">
                                                        <p className="text-[11px] font-mono leading-none">Hash値一致（同一動画）</p>
                                                        <p className="text-[10px] text-muted-foreground leading-tight">
                                                            重複元: {hashMatch.target_date || '日付不明'} / {hashMatch.file_name || '不明'}
                                                        </p>
                                                    </div>
                                                </PopoverContent>
                                            </Popover>
                                        )
                                    }

                                    // Duration一致チェック（Hashは違うが時間が同じ）
                                    const durationMatch = (submission.duration && submission.duration > 0) ? userSubmissions.find(s => s.video_hash !== submission.video_hash && s.duration === submission.duration) : null
                                    if (durationMatch) {
                                        return (
                                            <Popover>
                                                <PopoverTrigger asChild>
                                                    <div className="flex items-center gap-1 text-[11px] font-bold text-destructive bg-destructive/10 p-1.5 rounded-md mt-2 cursor-pointer active:opacity-60 transition-opacity">
                                                        <AlertCircle className="h-3 w-3" />
                                                        <span>重複の可能性</span>
                                                    </div>
                                                </PopoverTrigger>
                                                <PopoverContent side="top" className="w-auto p-2 bg-popover/95 backdrop-blur-sm border shadow-xl z-[200]">
                                                    <div className="space-y-1">
                                                        <p className="text-[11px] font-mono leading-none">同じ動画時間（リサイズされた可能性）</p>
                                                        <p className="text-[10px] text-muted-foreground leading-tight">
                                                            重複元: {durationMatch.target_date || '日付不明'} / {durationMatch.file_name || '不明'}
                                                        </p>
                                                    </div>
                                                </PopoverContent>
                                            </Popover>
                                        )
                                    }

                                    return null
                                })()}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Video Player Modal */}
            <VideoPlayerModal
                videoUrl={selectedVideo}
                onClose={() => setSelectedVideo(null)}
            />
        </div>
    )
}
