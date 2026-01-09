import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
    CheckCircle2,
    XCircle,
    Play,
    Clock,
    Trash2,
    Loader2,
    RotateCcw
} from 'lucide-react'
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
    onUpdateStatus?: (id: number, status: 'success' | 'fail' | 'excused' | null) => Promise<any>
}

export function WorkoutCard({ submission, onDelete, isAdmin, onPlay, itemName, onUpdateStatus }: WorkoutCardProps) {
    const [isDeleting, setIsDeleting] = useState(false)

    const reviewedAtStr = submission.reviewed_at
        ? format(parseISO(submission.reviewed_at), 'MM/dd HH:mm')
        : null

    const handleStatusUpdate = async (status: 'success' | 'fail' | 'excused' | null) => {
        if (!onUpdateStatus) return
        await onUpdateStatus(submission.id, status)
    }

    const timeStr = submission.created_at
        ? format(parseISO(submission.created_at), 'yyyy/MM/dd HH:mm:ss')
        : '--:--'

    const formatDuration = (seconds: number | null) => {
        if (!seconds) return null
        const mins = Math.floor(seconds / 60)
        const secs = Math.floor(seconds % 60)
        return `${mins}:${secs.toString().padStart(2, '0')} `
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

            {/* Stamp Overlay - positioned at right center of the card */}
            {submission.status === 'success' && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col items-center z-[5] pointer-events-none">
                    <img
                        src="/assets/stamps/azasu-120.png"
                        alt="Approved"
                        className="w-14 h-14 object-contain rotate-[-5deg] drop-shadow-md"
                    />
                    {reviewedAtStr && (
                        <span className="text-[7px] text-muted-foreground font-mono -mt-1">
                            {reviewedAtStr}
                        </span>
                    )}
                </div>
            )}
            {submission.status === 'fail' && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col items-center z-[5] pointer-events-none">
                    <img
                        src="/assets/stamps/yousyuusei-120.png"
                        alt="Rejected"
                        className="w-14 h-14 object-contain rotate-[5deg] drop-shadow-md"
                    />
                    {reviewedAtStr && (
                        <span className="text-[7px] text-muted-foreground font-mono -mt-1">
                            {reviewedAtStr}
                        </span>
                    )}
                </div>
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
                            <div className="mt-1 space-y-1 overflow-hidden">
                                {/* Timestamp */}
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/80 font-medium font-mono min-w-0 cursor-pointer active:opacity-60 transition-opacity w-fit">
                                            <Clock className="w-2.5 h-2.5 shrink-0" />
                                            <span className="truncate">{timeStr}</span>
                                        </div>
                                    </PopoverTrigger>
                                    <PopoverContent side="top" className="w-auto p-2 bg-popover/95 backdrop-blur-sm border shadow-xl z-[200]">
                                        <p className="text-[11px] font-mono leading-none">{timeStr}</p>
                                    </PopoverContent>
                                </Popover>

                                {/* Admin Actions - Compact icon buttons below timestamp */}
                                {isAdmin && (
                                    <div className="flex items-center gap-1 pt-0.5">
                                        <Button
                                            size="icon"
                                            variant="outline"
                                            onClick={() => handleStatusUpdate('success')}
                                            className={`h-6 w-6 ${submission.status === 'success' ? 'bg-green-100 border-green-300' : 'border-muted-foreground/20 hover:bg-green-50 hover:border-green-200'}`}
                                            title="承認"
                                        >
                                            <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                                        </Button>
                                        <Button
                                            size="icon"
                                            variant="outline"
                                            onClick={() => handleStatusUpdate('fail')}
                                            className={`h-6 w-6 ${submission.status === 'fail' ? 'bg-red-100 border-red-300' : 'border-muted-foreground/20 hover:bg-red-50 hover:border-red-200'}`}
                                            title="却下"
                                        >
                                            <XCircle className="w-3.5 h-3.5 text-red-600" />
                                        </Button>
                                        <Button
                                            size="icon"
                                            variant="outline"
                                            onClick={() => handleStatusUpdate(null)}
                                            disabled={!submission.status}
                                            className="h-6 w-6 border-muted-foreground/20 hover:bg-muted disabled:opacity-30"
                                            title="戻す"
                                        >
                                            <RotateCcw className="w-3.5 h-3.5 text-muted-foreground" />
                                        </Button>
                                    </div>
                                )}

                                {/* Status indicator for non-admin view */}
                                {!isAdmin && !submission.status && (
                                    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-normal text-amber-700 leading-none w-fit">
                                        <Clock className="w-2.5 h-2.5 mr-1" />
                                        未承認
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

