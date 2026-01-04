import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Play, User, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { VideoPlayerModal } from '@/components/admin/VideoPlayerModal'

type Submission = {
    id: number
    user_id: string
    type: 'video' | 'comment'
    r2_key: string | null
    thumbnail_url: string | null
    duration: number | null
    comment_text: string | null
    status: 'success' | 'fail' | 'excused'
    created_at: string
    profiles?: {
        display_name: string | null
    }
}

export default function SubmissionsPage() {
    const { profile } = useAuth()
    const [submissions, setSubmissions] = useState<Submission[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedVideo, setSelectedVideo] = useState<string | null>(null)

    useEffect(() => {
        if (profile?.role !== 'admin') return

        const fetchSubmissions = async () => {
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

        fetchSubmissions()
    }, [profile])

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

    const getVideoUrl = (r2Key: string) => {
        // Cloudflare R2 public URL format
        const endpoint = import.meta.env.VITE_R2_PUBLIC_URL || import.meta.env.VITE_R2_ENDPOINT
        return `${endpoint}/${r2Key}`
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
                        <Card key={submission.id} className="overflow-hidden">
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
                                        onClick={() => setSelectedVideo(getVideoUrl(submission.r2_key!))}
                                    >
                                        <Play className="h-6 w-6" />
                                    </Button>
                                )}
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
                                    {getStatusIcon(submission.status)}
                                    <span className="capitalize">{submission.status}</span>
                                </div>
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
