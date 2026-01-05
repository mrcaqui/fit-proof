import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Play, CheckCircle2, Trash2, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Database } from '@/types/database.types'
import { Button } from '@/components/ui/button'

type Submission = Database['public']['Tables']['submissions']['Row']

interface WorkoutCardProps {
    submission: Submission
    onDelete?: (id: number, r2Key: string | null) => Promise<any>
    isAdmin?: boolean
    onPlay?: (key: string) => void
}

export function WorkoutCard({ submission, onDelete, isAdmin, onPlay }: WorkoutCardProps) {
    const [isDeleting, setIsDeleting] = useState(false)

    const timeStr = submission.created_at
        ? format(parseISO(submission.created_at), 'HH:mm')
        : '--:--'

    const handleDelete = async (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()

        if (!onDelete) return

        if (!window.confirm('この動画を削除してもよろしいですか？')) {
            return
        }

        setIsDeleting(true)
        try {
            await onDelete(submission.id, submission.r2_key)
        } finally {
            setIsDeleting(false)
        }
    }

    return (
        <Card className="overflow-hidden border-none shadow-sm bg-card hover:bg-accent/50 transition-colors group/card">
            <CardContent className="p-0">
                <div className="flex flex-col relative">
                    {/* Delete Button Overlay */}
                    {onDelete && !isAdmin && (
                        <Button
                            variant="destructive"
                            size="icon"
                            className="absolute top-2 right-2 z-30 h-8 w-8 opacity-100 sm:opacity-0 sm:group-hover/card:opacity-100 transition-opacity"
                            onClick={handleDelete}
                            disabled={isDeleting}
                        >
                            {isDeleting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Trash2 className="h-4 w-4" />
                            )}
                        </Button>
                    )}

                    {/* Thumbnail Area */}
                    <div
                        className="relative aspect-video bg-muted group cursor-pointer"
                        onClick={() => submission.r2_key && onPlay?.(submission.r2_key)}
                    >
                        {submission.thumbnail_url ? (
                            <img
                                src={submission.thumbnail_url}
                                alt="Workout thumbnail"
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                <Play className="w-12 h-12 text-muted-foreground/50" />
                            </div>
                        )}

                        {/* Play button overlay */}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                <Play className="w-6 h-6 text-white fill-white" />
                            </div>
                        </div>

                        {/* Duration badge (placeholder) */}
                        <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-medium">
                            3:15
                        </div>
                    </div>

                    {/* Info Area */}
                    <div className="p-3">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                                {timeStr}
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1 text-muted-foreground">
                                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                                </div>
                            </div>
                        </div>

                        {/* Admin Action Buttons */}
                        {isAdmin && (
                            <div className="flex flex-wrap gap-2 pt-2 border-t mt-2">
                                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] bg-green-50 text-green-700 border-green-200 hover:bg-green-100">
                                    承認
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] bg-red-50 text-red-700 border-red-200 hover:bg-red-100">
                                    却下
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100">
                                    コメント
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
