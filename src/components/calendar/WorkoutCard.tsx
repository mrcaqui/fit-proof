import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Play, CheckCircle2, Trash2, Loader2, XCircle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Database } from '@/types/database.types'
import { Button } from '@/components/ui/button'

type Submission = Database['public']['Tables']['submissions']['Row']

interface WorkoutCardProps {
    submission: Submission
    onDelete?: (id: number, r2Key: string | null) => Promise<any>
    isAdmin?: boolean
    onPlay?: (key: string) => void
    itemName?: string
}

export function WorkoutCard({ submission, onDelete, isAdmin, onPlay, itemName }: WorkoutCardProps) {
    const [isDeleting, setIsDeleting] = useState(false)

    const timeStr = submission.created_at
        ? format(parseISO(submission.created_at), 'yyyy/MM/dd HH:mm:ss')
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
        <Card className="overflow-hidden border shadow-sm bg-card hover:bg-accent/30 transition-all duration-200 group/card">
            <CardContent className="p-0">
                <div className="flex h-24 sm:h-28">
                    {/* Thumbnail Area (Left) */}
                    <div
                        className="relative w-24 sm:w-28 shrink-0 bg-muted cursor-pointer group/thumb"
                        onClick={() => submission.r2_key && onPlay?.(submission.r2_key)}
                    >
                        {submission.thumbnail_url ? (
                            <img
                                src={submission.thumbnail_url}
                                alt="Thumbnail"
                                className="w-full h-full object-cover transition-transform duration-500 group-hover/thumb:scale-110"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-muted">
                                <Play className="w-8 h-8 text-muted-foreground/40" />
                            </div>
                        )}

                        {/* Play Overlay */}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover/thumb:bg-black/30 transition-colors">
                            <div className="w-8 h-8 rounded-full bg-white/30 backdrop-blur-sm flex items-center justify-center opacity-80 group-hover/thumb:opacity-100 transition-all scale-90 group-hover/thumb:scale-100">
                                <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                            </div>
                        </div>

                        {/* Duration Badge */}
                        <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] px-1 py-0.5 rounded font-mono">
                            VIDEO
                        </div>
                    </div>

                    {/* Content Area (Right) */}
                    <div className="flex-1 flex flex-col justify-between p-3 min-w-0">
                        {/* Top Row: Item Name, Time, Delete */}
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <h4 className="font-bold text-sm sm:text-base text-card-foreground truncate leading-tight">
                                    {itemName || 'ワークアウト'}
                                </h4>
                                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                                    <span>{timeStr} 提出</span>
                                    {submission.status === 'success' && (
                                        <span className="flex items-center text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full text-[10px] font-medium border border-green-100 whitespace-nowrap">
                                            <CheckCircle2 className="w-3 h-3 mr-1" />
                                            承認済
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Client Delete Button */}
                            {onDelete && !isAdmin && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 -mt-1 -mr-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
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
                        </div>

                        {/* Bottom Row: Admin Actions or Status */}
                        {isAdmin && (
                            <div className="flex items-center justify-end gap-2 pt-1">
                                <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] sm:text-xs">
                                    <CheckCircle2 className="w-3 h-3 mr-1 text-green-600" />
                                    承認
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 px-2 text-[10px] sm:text-xs">
                                    <XCircle className="w-3 h-3 mr-1 text-red-600" />
                                    却下
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                    onClick={handleDelete}
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
