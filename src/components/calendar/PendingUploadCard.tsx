import { useState, useRef } from 'react'
import { Database } from '@/types/database.types'
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { r2Client, R2_BUCKET_NAME } from '@/lib/r2'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { generateThumbnail } from '@/utils/thumbnail'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Upload, Film, AlertCircle, X } from 'lucide-react'
import { format } from 'date-fns'

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB
const ALLOWED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

type SubmissionItem = Database['public']['Tables']['submission_items']['Row']

interface PendingUploadCardProps {
    item: SubmissionItem
    targetDate: Date
    onSuccess?: () => void
    isLate?: boolean
    deadlineMode?: 'none' | 'mark' | 'block'
}

export function PendingUploadCard({ item, targetDate, onSuccess, isLate = false, deadlineMode = 'none' }: PendingUploadCardProps) {
    const { user } = useAuth()
    const isBlocked = deadlineMode === 'block' && isLate
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [state, setState] = useState<{
        file: File | null
        thumbnail: string | null
        duration: number | null
        progress: number
        error: string | null
        success: boolean
        isUploading: boolean
        hash: string | null
        arrayBuffer: ArrayBuffer | null
    }>({
        file: null,
        thumbnail: null,
        duration: null,
        progress: 0,
        error: null,
        success: false,
        isUploading: false,
        hash: null,
        arrayBuffer: null
    })

    const updateState = (newState: Partial<typeof state>) => {
        setState(prev => ({ ...prev, ...newState }))
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

    const calculateHash = async (file: File): Promise<{ hash: string; arrayBuffer: ArrayBuffer }> => {
        const arrayBuffer = await file.arrayBuffer()
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
        return { hash, arrayBuffer }
    }

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0]
        updateState({ error: null, success: false, thumbnail: null, duration: null })

        if (!selectedFile) return

        if (!ALLOWED_TYPES.includes(selectedFile.type)) {
            updateState({ error: 'サポートされていないファイル形式です。MP4, MOV, WebM形式のみ対応しています。' })
            return
        }

        if (selectedFile.size > MAX_FILE_SIZE) {
            updateState({ error: 'ファイルサイズが大きすぎます。100MB以下のファイルを選択してください。' })
            return
        }

        updateState({ file: selectedFile, thumbnail: null, duration: null, error: null, success: false })

        try {
            const [thumbUrl, duration, hashResult] = await Promise.all([
                generateThumbnail(selectedFile).catch(() => null),
                getVideoDuration(selectedFile).catch(() => null),
                calculateHash(selectedFile).catch(err => {
                    console.error('Hash calculation failed:', err)
                    return null
                })
            ])
            updateState({
                thumbnail: thumbUrl,
                duration,
                hash: hashResult?.hash || null,
                arrayBuffer: hashResult?.arrayBuffer || null
            })
        } catch (err) {
            console.error('Metadata extraction failed:', err)
        }
    }

    const handleClearFile = () => {
        updateState({ file: null, thumbnail: null, duration: null, error: null })
        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }

    const handleUpload = async () => {
        if (!state.file || !user) return

        updateState({ isUploading: true, progress: 0, error: null })

        try {
            const timestamp = Date.now()
            const fileExtension = state.file.name.split('.').pop()
            const key = `uploads/${user.id}/${timestamp}.${fileExtension}`
            const targetDateStr = format(targetDate, 'yyyy-MM-dd')

            // 既存のレコードを検索
            const { data: existing } = await supabase
                .from('submissions')
                .select('id, r2_key')
                .match({
                    user_id: user.id,
                    target_date: targetDateStr,
                    submission_item_id: item.id
                }) as { data: { id: number, r2_key: string | null }[] | null }

            // 既存レコードがあれば削除
            if (existing && existing.length > 0) {
                for (const sub of existing) {
                    await supabase.from('submissions').delete().eq('id', sub.id)
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

            // アップロード実行
            updateState({ progress: 90 })
            await r2Client.send(new PutObjectCommand({
                Bucket: R2_BUCKET_NAME,
                Key: key,
                Body: new Uint8Array(state.arrayBuffer!),
                ContentType: state.file.type,
            }))

            updateState({ progress: 100 })

            const { error: dbError } = await supabase
                .from('submissions')
                .insert({
                    user_id: user.id,
                    type: 'video' as const,
                    r2_key: key,
                    thumbnail_url: state.thumbnail || null,
                    status: null,
                    target_date: targetDateStr,
                    submission_item_id: item.id,
                    file_name: state.file.name,
                    duration: state.duration ? Math.round(state.duration) : null,
                    is_late: isLate,
                    video_size: state.file.size,
                    video_hash: state.hash
                } as any)

            if (dbError) throw new Error('Failed to save submission record')

            updateState({ success: true, file: null, thumbnail: null })
            if (fileInputRef.current) {
                fileInputRef.current.value = ''
            }
            onSuccess?.()
        } catch (err) {
            console.error('Upload failed:', err)
            updateState({ error: 'アップロードに失敗しました。', isUploading: false })
        } finally {
            updateState({ isUploading: false })
        }
    }

    // アップロード成功時は何も表示しない（WorkoutCardに置き換わる）
    if (state.success) {
        return null
    }

    return (
        <Card className={`overflow-hidden border-2 border-dashed shadow-sm transition-all duration-200 ${isBlocked ? 'border-destructive/30 bg-destructive/5' : 'border-muted-foreground/20 bg-card/50 hover:border-primary/30'}`}>
            <CardContent className="p-3">
                {/* ブロックモード時の警告 */}
                {isBlocked && (
                    <div className="flex items-center gap-2 text-destructive text-xs font-medium bg-destructive/10 p-2 rounded mb-2">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        <span>期限を過ぎたため、投稿できません</span>
                    </div>
                )}
                <div className="flex items-center justify-between gap-2 mb-2">
                    <h4 className="font-bold text-sm text-card-foreground">
                        {item.name}
                    </h4>
                    <div className="flex items-center gap-1">
                        {state.file && !state.isUploading && !isBlocked && (
                            <>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    onClick={handleClearFile}
                                >
                                    <X className="w-4 h-4" />
                                </Button>
                                <Button size="sm" onClick={handleUpload} className="h-7 text-xs" disabled={!state.hash}>
                                    <Upload className="w-3 h-3 mr-1" /> {!state.hash ? '計算中...' : 'アップロード'}
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                <div className="relative">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        onChange={handleFileSelect}
                        className="hidden"
                        id={`file-input-${item.id}`}
                        disabled={state.isUploading || isBlocked}
                    />
                    <label
                        htmlFor={`file-input-${item.id}`}
                        className={`cursor-pointer flex items-center gap-3 p-3 rounded-lg border border-dashed transition-colors ${state.file ? 'bg-muted/30 border-primary/30' : 'hover:bg-muted/50 border-muted-foreground/20'
                            }`}
                    >
                        {!state.file && (
                            <>
                                <Film className="h-6 w-6 text-muted-foreground shrink-0" />
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs font-medium">クリックして動画を選択</span>
                                    <span className="text-[9px] text-muted-foreground">MP4, MOV, WebM / 100MB以内</span>
                                </div>
                            </>
                        )}

                        {state.file && (
                            <div className="flex items-center gap-3 w-full">
                                <div className="w-12 h-12 shrink-0 bg-muted rounded overflow-hidden border flex items-center justify-center">
                                    {state.thumbnail ? (
                                        <img src={state.thumbnail} alt="Preview" className="w-full h-full object-cover" />
                                    ) : (
                                        <Film className="w-5 h-5 text-muted-foreground/40" />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0 space-y-0.5">
                                    <p className="text-xs font-bold text-foreground truncate">
                                        {state.file.name}
                                    </p>
                                    <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                                        <span>{(state.file.size / 1024 / 1024).toFixed(1)} MB</span>
                                        {state.duration && <span>{formatDuration(state.duration)}</span>}
                                    </div>
                                    <p className="text-[8px] text-primary font-bold">
                                        {!state.thumbnail ? '読み込み中...' : 'アップロード準備完了'}
                                    </p>
                                </div>
                            </div>
                        )}
                    </label>

                    {state.isUploading && (
                        <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center p-3 rounded-lg z-10 backdrop-blur-sm">
                            <Progress value={state.progress} className="w-full h-1.5 mb-1.5" />
                            <span className="text-[10px] font-medium animate-pulse">アップロード中...</span>
                        </div>
                    )}
                </div>

                {state.error && (
                    <div className="flex items-center gap-1 text-destructive text-[10px] font-medium mt-2">
                        <AlertCircle className="h-3 w-3" /> {state.error}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
