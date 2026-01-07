import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Play, CheckCircle2, Trash2, Loader2, XCircle, Clock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Database } from '@/types/database.types'
import { Button } from '@/components/ui/button'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

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

    const formatDuration = (seconds: number | null) => {
        if (!seconds) return null
        const mins = Math.floor(seconds / 60)
        const secs = Math.floor(seconds % 60)
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    const fileName = (submission as any).file_name
    const duration = submission.duration

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
        <Card className="overflow-hidden border shadow-sm bg-card hover:bg-accent/30 transition-all duration-200 group/card relative">
            {/* Delete Button (Unified to Top-Right) */}
            {onDelete && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-1 right-1 h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 z-10 transition-opacity"
                    onClick={handleDelete}
                    disabled={isDeleting}
                >
                    {isDeleting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                    )}
                </Button>
            )}

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
                            <div className="w-7 h-7 rounded-full bg-white/30 backdrop-blur-sm flex items-center justify-center opacity-80 group-hover/thumb:opacity-100 transition-all scale-90 group-hover/thumb:scale-100 border border-white/20">
                                <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" />
                            </div>
                        </div>

                        {/* Duration Badge */}
                        {duration && (
                            <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] px-1 py-0.5 rounded font-mono border border-white/10">
                                {formatDuration(duration)}
                            </div>
                        )}
                        {!duration && (
                            <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[8px] px-1 py-0.5 rounded font-mono">
                                VIDEO
                            </div>
                        )}
                    </div>

                    {/* Content Area (Right) */}
                    <div className="flex-1 flex flex-col justify-between p-2 sm:p-2.5 min-w-0">
                        <div className="min-w-0 pr-6 relative"> {/* pr-6 for delete button space */}
                            {/* Title & Badge */}
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                <h4 className="font-bold text-[13px] sm:text-[14px] text-card-foreground truncate leading-tight max-w-[150px]">
                                    {fileName || 'ワークアウト動画'}
                                </h4>
                                {itemName && (
                                    <span className="text-[9px] px-1.5 py-0.5 bg-secondary text-secondary-foreground rounded font-bold border border-secondaryShadow shrink-0">
                                        {itemName}
                                    </span>
                                )}
                            </div>

                            {/* Meta Info Area */}
                            <div className="mt-2 space-y-1.5 overflow-hidden">
                                <div className="flex items-center justify-between gap-2">
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/80 font-medium font-mono min-w-0 cursor-pointer active:opacity-60 transition-opacity">
                                                <Clock className="w-2.5 h-2.5 shrink-0" />
                                                <span className="truncate">{timeStr}</span>
                                            </div>
                                        </PopoverTrigger>
                                        <PopoverContent side="top" className="w-auto p-2 bg-popover/95 backdrop-blur-sm border shadow-xl z-[200]">
                                            <p className="text-[11px] font-mono leading-none">{timeStr}</p>
                                        </PopoverContent>
                                    </Popover>
                                    <div className="shrink-0 flex items-center gap-1">
                                        {submission.status === 'success' && (
                                            <span className="flex items-center text-green-600 bg-green-50/50 px-1.5 py-0.5 rounded text-[9px] font-bold border border-green-100 whitespace-nowrap">
                                                <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                                                承認済
                                            </span>
                                        )}
                                        {submission.status === 'fail' && (
                                            <span className="flex items-center text-red-600 bg-red-50/50 px-1.5 py-0.5 rounded text-[9px] font-bold border border-red-100 whitespace-nowrap">
                                                <XCircle className="w-2.5 h-2.5 mr-0.5" />
                                                却下
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Bottom Row: Admin Actions */}
                        {isAdmin && (
                            <div className="flex items-center justify-start gap-2 pt-1 mt-auto">
                                <Button size="sm" variant="outline" className={`h-7 px-2 text-[10px] border-green-200 hover:bg-green-50 shadow-sm ${submission.status === 'success' ? 'bg-green-50' : 'bg-background'}`}>
                                    <CheckCircle2 className="w-3 h-3 mr-1 text-green-600" />
                                    承認
                                </Button>
                                <Button size="sm" variant="outline" className={`h-7 px-2 text-[10px] border-red-200 hover:bg-red-50 shadow-sm ${submission.status === 'fail' ? 'bg-red-50' : 'bg-background'}`}>
                                    <XCircle className="w-3 h-3 mr-1 text-red-600" />
                                    却下
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
