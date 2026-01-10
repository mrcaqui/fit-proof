import { useState, useRef, useEffect } from 'react'
import { Database } from "@/types/database.types"
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { r2Client, R2_BUCKET_NAME } from '@/lib/r2'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { generateThumbnail } from '@/utils/thumbnail'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Upload, CheckCircle, AlertCircle, Film, X } from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB
const ALLOWED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

interface UploadModalProps {
    targetDate: Date | null
    onClose: () => void
    onSuccess?: () => void
    items: Database['public']['Tables']['submission_items']['Row'][]
    completedSubmissions: { id: number | null, item_id: number | null, file_name: string | null }[]
    isLate?: boolean
    deadlineMode?: 'none' | 'mark' | 'block'
}

export function UploadModal({ targetDate, onClose, onSuccess, items, completedSubmissions, isLate = false, deadlineMode = 'none' }: UploadModalProps) {
    const { user } = useAuth()
    const isBlocked = deadlineMode === 'block' && isLate
    const [uploadingState, setUploadingState] = useState<Record<number | string, {
        file: File | null,
        thumbnail: string | null,
        duration: number | null,
        progress: number,
        error: string | null,
        success: boolean,
        isUploading: boolean
    }>>({})

    const fileInputRefs = useRef<Record<number | string, HTMLInputElement | null>>({})

    // Reset state when modal opens
    useEffect(() => {
        if (targetDate) {
            setUploadingState({})
        }
    }, [targetDate])

    if (!targetDate) return null

    const updateState = (id: number | string, newState: Partial<typeof uploadingState[number]>) => {
        setUploadingState(prev => ({
            ...prev,
            [id]: { ...(prev[id] || { file: null, thumbnail: null, duration: null, progress: 0, error: null, success: false, isUploading: false }), ...newState }
        }))
    }

    const getVideoDuration = (file: File): Promise<number> => {
        return new Promise((resolve) => {
            const video = document.createElement('video')
            video.preload = 'metadata'
            video.onloadedmetadata = () => {
                window.URL.revokeObjectURL(video.src)
                resolve(video.duration)
            }
            video.src = URL.createObjectURL(file)
        })
    }

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = Math.floor(seconds % 60)
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, itemId: number | string) => {
        const selectedFile = e.target.files?.[0]
        updateState(itemId, { error: null, success: false, thumbnail: null, duration: null })

        if (!selectedFile) return

        if (!ALLOWED_TYPES.includes(selectedFile.type)) {
            updateState(itemId, { error: 'サポートされていないファイル形式です。MP4, MOV, WebM形式のみ対応しています。' })
            return
        }

        if (selectedFile.size > MAX_FILE_SIZE) {
            updateState(itemId, { error: 'ファイルサイズが大きすぎます。100MB以下のファイルを選択してください。' })
            return
        }

        updateState(itemId, { file: selectedFile, thumbnail: null, duration: null, error: null, success: false })

        try {
            // generateThumbnailとgetVideoDurationを並行実行
            const [thumbUrl, duration] = await Promise.all([
                generateThumbnail(selectedFile).catch(err => {
                    console.error('Thumbnail generation failed:', err)
                    return null
                }),
                getVideoDuration(selectedFile).catch(err => {
                    console.error('Duration extraction failed:', err)
                    return null
                })
            ])

            updateState(itemId, { thumbnail: thumbUrl, duration })
        } catch (err) {
            console.error('Metadata extraction failed:', err)
        }
    }

    const handleUpload = async (itemId: number | string) => {
        const state = uploadingState[itemId]
        if (!state?.file || !user) return

        updateState(itemId, { isUploading: true, progress: 0, error: null })

        try {
            const timestamp = Date.now()
            const fileExtension = state.file.name.split('.').pop()
            const key = `uploads/${user.id}/${timestamp}.${fileExtension}`
            const arrayBuffer = await state.file.arrayBuffer()

            const targetDateStr = format(targetDate, 'yyyy-MM-dd')
            const normalizedItemId = typeof itemId === 'number' ? itemId : null

            // 既存のレコードを検索（同じユーザー、同じ日付、同じ項目）
            const { data: existing } = await supabase
                .from('submissions')
                .select('id, r2_key')
                .match({
                    user_id: user.id,
                    target_date: targetDateStr,
                    submission_item_id: normalizedItemId
                }) as { data: { id: number, r2_key: string | null }[] | null }

            // 既存レコードがあれば削除（DB & R2）
            if (existing && existing.length > 0) {
                for (const sub of existing) {
                    // DBから削除
                    await supabase.from('submissions').delete().eq('id', sub.id)
                    // R2からも削除
                    if (sub.r2_key) {
                        try {
                            await r2Client.send(new DeleteObjectCommand({
                                Bucket: R2_BUCKET_NAME,
                                Key: sub.r2_key
                            }))
                        } catch (e) {
                            console.error('Failed to delete old R2 object:', e)
                        }
                    }
                }
            }

            // 新規ファイルのアップロード実行
            updateState(itemId, { progress: 90 })
            await r2Client.send(new PutObjectCommand({
                Bucket: R2_BUCKET_NAME,
                Key: key,
                Body: new Uint8Array(arrayBuffer),
                ContentType: state.file.type,
            }))

            updateState(itemId, { progress: 100 })

            const { error: dbError } = await supabase
                .from('submissions')
                .insert({
                    user_id: user.id,
                    type: 'video' as const,
                    r2_key: key,
                    thumbnail_url: state.thumbnail || null,
                    status: null,
                    target_date: targetDateStr,
                    submission_item_id: normalizedItemId,
                    file_name: state.file.name,
                    duration: state.duration ? Math.round(state.duration) : null,
                    is_late: isLate
                } as any)

            if (dbError) throw new Error('Failed to save submission record')

            updateState(itemId, { success: true, file: null, thumbnail: null })
            if (fileInputRefs.current[itemId]) {
                fileInputRefs.current[itemId]!.value = ''
            }
            onSuccess?.()
        } catch (err) {
            console.error('Upload failed:', err)
            updateState(itemId, { error: 'アップロードに失敗しました。', isUploading: false })
        } finally {
            updateState(itemId, { isUploading: false })
        }
    }

    const renderUploadCard = (item?: Database['public']['Tables']['submission_items']['Row']) => {
        const itemId = item?.id || 'general'
        const state = uploadingState[itemId] || { file: null, thumbnail: null, duration: null, progress: 0, error: null, success: false, isUploading: false }
        const submission = item
            ? completedSubmissions.find(s => s.item_id === item.id)
            : completedSubmissions.find(s => s.item_id === null)
        const isCompleted = !!submission

        return (
            <div key={itemId} className={`p-4 rounded-lg border-2 transition-all space-y-4 ${isBlocked ? 'bg-destructive/5 border-destructive/30' : isCompleted ? 'bg-muted/30 border-muted' : 'bg-card border-muted-foreground/10 hover:border-primary/30'
                }`}>
                {/* ブロックモード時の警告 */}
                {isBlocked && (
                    <div className="flex items-center gap-2 text-destructive text-sm font-medium bg-destructive/10 p-3 rounded-lg">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        <span>期限を過ぎたため、投稿できません</span>
                    </div>
                )}
                <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-col gap-0.5">
                        <h4 className="font-bold flex items-center gap-2 text-sm sm:text-base">
                            {item ? item.name : '動画をアップロード'}
                            {isCompleted && (
                                <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 rounded-full flex items-center gap-1 font-bold">
                                    <CheckCircle className="w-3 h-3" /> 提出済み
                                </span>
                            )}
                        </h4>
                        {isCompleted && submission.file_name && (
                            <p className="text-[10px] text-muted-foreground truncate max-w-[200px] font-medium leading-none">
                                {submission.file_name}
                            </p>
                        )}
                    </div>
                    {state.file && !state.isUploading && !state.success && !isBlocked && (
                        <Button size="sm" onClick={() => handleUpload(itemId)} className="h-8">
                            <Upload className="w-3 h-3 mr-1" /> アップロード
                        </Button>
                    )}
                </div>

                <div className="relative">
                    <input
                        ref={el => fileInputRefs.current[itemId] = el}
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        onChange={(e) => handleFileSelect(e, itemId)}
                        className="hidden"
                        id={`file-input-${itemId}`}
                        disabled={state.isUploading || isBlocked}
                    />
                    <label
                        htmlFor={`file-input-${itemId}`}
                        className={`cursor-pointer flex flex-col items-center gap-2 p-6 rounded-lg border-2 border-dashed transition-colors ${state.file ? 'bg-muted/30 border-primary/30' : 'hover:bg-muted/50 border-muted-foreground/20'
                            }`}
                    >
                        {!state.file && (
                            <>
                                <Film className="h-8 w-8 text-muted-foreground" />
                                <span className="text-sm font-medium">クリックして動画を選択</span>
                                <span className="text-[10px] text-muted-foreground">MP4, MOV, WebM / 100MB以内</span>
                            </>
                        )}

                        {state.file && (
                            <div className="flex items-center gap-4 w-full">
                                {/* Thumbnail Preview */}
                                <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 bg-muted rounded overflow-hidden border shadow-sm flex items-center justify-center">
                                    {state.thumbnail ? (
                                        <img src={state.thumbnail} alt="Preview" className="w-full h-full object-cover" />
                                    ) : (
                                        <Film className="w-6 h-6 text-muted-foreground/40" />
                                    )}
                                </div>

                                {/* File Details */}
                                <div className="flex-1 min-w-0 space-y-1">
                                    <p className="text-xs font-bold text-foreground truncate break-all">
                                        {state.file.name}
                                    </p>
                                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-medium">
                                        <span className="bg-background px-1.5 py-0.5 rounded border">
                                            {(state.file.size / 1024 / 1024).toFixed(1)} MB
                                        </span>
                                        {state.duration && (
                                            <span className="bg-background px-1.5 py-0.5 rounded border">
                                                {formatDuration(state.duration)}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[9px] text-primary font-bold animate-pulse mt-1">
                                        {!state.thumbnail ? '読み込み中...' : 'アップロード準備完了'}
                                    </p>
                                </div>
                            </div>
                        )}
                    </label>

                    {state.isUploading && (
                        <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center p-4 rounded-lg z-10 backdrop-blur-sm">
                            <Progress value={state.progress} className="w-full h-2 mb-2" />
                            <span className="text-xs font-medium animate-pulse">アップロード中...</span>
                        </div>
                    )}

                    {state.success && (
                        <div className="absolute inset-0 bg-green-50/90 flex flex-col items-center justify-center p-4 rounded-lg z-10 border-2 border-green-200">
                            <CheckCircle className="h-10 w-10 text-green-500 mb-2" />
                            <span className="text-sm font-bold text-green-700">完了！</span>
                        </div>
                    )}
                </div>

                {state.error && (
                    <div className="flex items-center gap-1.5 text-destructive text-[11px] font-medium px-2">
                        <AlertCircle className="h-3.5 w-3.5" /> {state.error}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-background rounded-xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b bg-muted/10">
                    <div>
                        <h3 className="text-lg font-bold leading-none mb-1">投稿する項目</h3>
                        <p className="text-xs text-muted-foreground font-medium">
                            {format(targetDate, 'yyyy年M月d日(E)', { locale: ja })}
                        </p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full hover:bg-muted">
                        <X className="h-5 w-5" />
                    </Button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4 overflow-y-auto custom-scrollbar">
                    {items.length > 0 ? (
                        items.map(item => renderUploadCard(item))
                    ) : (
                        renderUploadCard()
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t bg-muted/5">
                    <Button variant="ghost" onClick={onClose} className="w-full font-bold">
                        閉じる
                    </Button>
                </div>
            </div>
        </div>
    )
}
