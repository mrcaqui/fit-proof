import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
    CheckCircle2,
    XCircle,
    Play,
    Clock,
    Trash2,
    Loader2,
    AlertCircle,
    RotateCcw,
    MessageSquare,
    Send
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Database } from '@/types/database.types'
import { Button } from '@/components/ui/button'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from '@/components/ui/input'

type Submission = Database['public']['Tables']['submissions']['Row']

interface WorkoutCardProps {
    submission: Submission
    onDelete?: (id: number, r2Key: string | null) => Promise<any>
    isAdmin?: boolean
    onPlay?: (key: string) => void
    itemName?: string
    onUpdateStatus?: (id: number, status: 'success' | 'fail' | 'excused' | null, reps?: number | null) => Promise<any>
    onAddComment?: (submissionId: number, content: string) => Promise<any>
    onDeleteComment?: (commentId: string) => Promise<any>
    onMarkAsRead?: (commentId: string) => Promise<any>
    deadlineMode?: 'none' | 'mark' | 'block'
    isDuplicate?: boolean
}

export function WorkoutCard({ submission, onDelete, isAdmin, onPlay, itemName, onUpdateStatus, onAddComment, onDeleteComment, onMarkAsRead, deadlineMode = 'none', isDuplicate }: WorkoutCardProps) {
    const [isDeleting, setIsDeleting] = useState(false)
    const [commentText, setCommentText] = useState((submission as any).admin_comments?.[0]?.content || '')
    const [isCommenting, setIsCommenting] = useState(false)
    const [isDeletingComment, setIsDeletingComment] = useState(false)
    const [repsInput, setRepsInput] = useState<string>(submission.reps?.toString() || '')
    const [isApproveOpen, setIsApproveOpen] = useState(false)
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false)

    const reviewedAtStr = submission.reviewed_at
        ? format(parseISO(submission.reviewed_at), 'MM/dd HH:mm')
        : null

    const handleStatusUpdate = async (status: 'success' | 'fail' | 'excused' | null, reps?: number | null) => {
        if (!onUpdateStatus) return
        setIsUpdatingStatus(true)
        try {
            await onUpdateStatus(submission.id, status, reps)
            if (status === 'success') {
                setIsApproveOpen(false)
            }
        } finally {
            setIsUpdatingStatus(false)
        }
    }

    const handleApproveWithReps = async () => {
        const reps = parseInt(repsInput, 10)
        if (isNaN(reps) || reps < 0) {
            return
        }
        await handleStatusUpdate('success', reps)
    }

    const handleAddComment = async () => {
        if (!onAddComment || !commentText.trim()) return
        setIsCommenting(true)
        try {
            await onAddComment(submission.id, commentText)
        } finally {
            setIsCommenting(false)
        }
    }

    const handleDeleteComment = async () => {
        const comment = (submission as any).admin_comments?.[0]
        if (!onDeleteComment || !comment) return

        if (!window.confirm('管理者コメントを削除してもよろしいですか？')) {
            return
        }

        setIsDeletingComment(true)
        try {
            await onDeleteComment(comment.id)
            setCommentText('')
        } finally {
            setIsDeletingComment(false)
        }
    }

    const handleReadComment = async () => {
        const comment = (submission as any).admin_comments?.[0]
        if (comment && !comment.read_at && onMarkAsRead) {
            await onMarkAsRead(comment.id)
        }
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
    const adminComment = (submission as any).admin_comments?.[0]

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
                    <div className="flex items-center gap-1 -mt-1">
                        {reviewedAtStr && (
                            <span className="text-[7px] text-muted-foreground font-mono">
                                {reviewedAtStr}
                            </span>
                        )}
                        {submission.reps != null && (
                            <span className="bg-green-600 text-white text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center shadow-sm border border-white">
                                {submission.reps}
                            </span>
                        )}
                    </div>
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
                                        {/* 承認ボタン（回数入力付きポップオーバー） */}
                                        <Popover open={isApproveOpen} onOpenChange={setIsApproveOpen}>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    size="icon"
                                                    variant="outline"
                                                    className={`h-6 w-6 ${submission.status === 'success' ? 'bg-green-100 border-green-300' : 'border-muted-foreground/20 hover:bg-green-50 hover:border-green-200'}`}
                                                    title="承認"
                                                >
                                                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent side="top" className="w-56 p-3 bg-white shadow-xl z-[200]">
                                                <div className="space-y-3">
                                                    <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider">承認 + 回数入力</h5>
                                                    <div className="flex items-center gap-2">
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            placeholder="回数"
                                                            value={repsInput}
                                                            onChange={(e) => setRepsInput(e.target.value)}
                                                            className="h-8 text-sm"
                                                        />
                                                        <span className="text-sm text-muted-foreground">回</span>
                                                    </div>
                                                    {submission.reps != null && (
                                                        <p className="text-[10px] text-muted-foreground">現在: {submission.reps}回</p>
                                                    )}
                                                    <Button
                                                        size="sm"
                                                        className="w-full h-8 gap-1.5 bg-green-600 hover:bg-green-700"
                                                        onClick={handleApproveWithReps}
                                                        disabled={isUpdatingStatus || !repsInput || parseInt(repsInput, 10) < 0}
                                                    >
                                                        {isUpdatingStatus ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                                                        承認する
                                                    </Button>
                                                </div>
                                            </PopoverContent>
                                        </Popover>
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

                                        {/* コメントボタン (管理者) */}
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    size="icon"
                                                    variant="outline"
                                                    className={`h-6 w-6 border-muted-foreground/20 hover:bg-blue-50 relative ${adminComment ? 'bg-blue-50 border-blue-200' : ''}`}
                                                    title="コメント"
                                                >
                                                    <MessageSquare className={`w-3.5 h-3.5 ${adminComment ? 'text-blue-600' : 'text-muted-foreground'}`} />
                                                    {adminComment && !adminComment.read_at && (
                                                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-orange-500 rounded-full border border-white" />
                                                    )}
                                                    {adminComment && adminComment.read_at && (
                                                        <CheckCircle2 className="absolute -top-1 -right-1 w-2.5 h-2.5 text-blue-600 bg-white rounded-full" />
                                                    )}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent side="top" className="w-80 p-3 bg-white shadow-xl z-[200]">
                                                <div className="space-y-3">
                                                    <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider">管理者コメント</h5>
                                                    <textarea
                                                        className="w-full text-sm p-2 border rounded-md focus:outline-none focus:ring-1 focus:ring-primary min-h-[80px] bg-slate-50"
                                                        placeholder="フィードバックを入力..."
                                                        value={commentText}
                                                        onChange={(e) => setCommentText(e.target.value)}
                                                    />
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-[10px] text-muted-foreground">
                                                            {adminComment?.read_at ? `既読: ${format(parseISO(adminComment.read_at), 'MM/dd HH:mm')}` : '未読'}
                                                        </span>
                                                        <div className="flex gap-2">
                                                            {adminComment && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-8 text-destructive hover:bg-destructive/10"
                                                                    onClick={handleDeleteComment}
                                                                    disabled={isDeletingComment}
                                                                >
                                                                    {isDeletingComment ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3 mr-1" />}
                                                                    削除
                                                                </Button>
                                                            )}
                                                            <Button
                                                                size="sm"
                                                                className="h-8 gap-1.5"
                                                                onClick={handleAddComment}
                                                                disabled={isCommenting || !commentText.trim()}
                                                            >
                                                                {isCommenting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                                                                保存
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                )}

                                {isDuplicate && (
                                    <div className="flex items-center gap-1 text-[10px] font-bold text-destructive bg-destructive/10 p-1 rounded-md w-fit">
                                        <AlertCircle className="h-2.5 w-2.5" />
                                        <span>重複の可能性</span>
                                    </div>
                                )}

                                {/* Admin Comment Indicator (Client side) */}
                                {!isAdmin && adminComment && (
                                    <Popover onOpenChange={(open) => open && handleReadComment()}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-6 gap-1 px-1.5 border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-700 text-[10px] font-bold"
                                            >
                                                <MessageSquare className="w-3 h-3" />
                                                コメントあり
                                                {!adminComment.read_at && (
                                                    <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
                                                )}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent side="top" className="w-72 p-3 bg-white shadow-xl z-[200]">
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <MessageSquare className="w-3.5 h-3.5 text-orange-600" />
                                                    <h5 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">管理者からのメッセージ</h5>
                                                </div>
                                                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                                                    {adminComment.content}
                                                </p>
                                                <div className="text-[9px] text-muted-foreground text-right pt-1">
                                                    {format(parseISO(adminComment.created_at), 'yyyy/MM/dd HH:mm')}
                                                </div>
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                )}

                                {/* Status indicator for non-admin view */}
                                {!isAdmin && !submission.status && (
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-normal text-amber-700 leading-none w-fit">
                                            <Clock className="w-2.5 h-2.5 mr-1" />
                                            未承認
                                        </span>
                                        {/* 期限超過バッジ（markモードのみ表示） */}
                                        {deadlineMode === 'mark' && (submission as any).is_late && (
                                            <span className="inline-flex items-center rounded-full border border-orange-300 bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-700 leading-none w-fit">
                                                期限超過
                                            </span>
                                        )}
                                    </div>
                                )}
                                {/* 期限超過バッジ（承認済みや却下時も表示、markモードのみ） */}
                                {deadlineMode === 'mark' && (submission as any).is_late && submission.status && (
                                    <span className="inline-flex items-center rounded-full border border-orange-300 bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-700 leading-none w-fit mt-1">
                                        期限超過
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card >
    )
}

