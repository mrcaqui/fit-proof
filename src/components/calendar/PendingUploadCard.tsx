import { useState, useRef } from 'react'
import { Database } from '@/types/database.types'
import * as tus from 'tus-js-client'
import { createBunnyVideo, deleteBunnyVideo, checkStorageAvailable } from '@/lib/bunny'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { generateThumbnail } from '@/utils/thumbnail'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Upload, Film, AlertCircle, X } from 'lucide-react'
import { format } from 'date-fns'

const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB
const HASH_THRESHOLD = 100 * 1024 * 1024 // 100MB超はハッシュスキップ
const ALLOWED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

type SubmissionItem = Database['public']['Tables']['submission_items']['Row']

interface PendingUploadCardProps {
    item: SubmissionItem
    targetDate: Date
    onSuccess?: () => void
    isLate?: boolean
}

export function PendingUploadCard({ item, targetDate, onSuccess, isLate = false }: PendingUploadCardProps) {
    const { user } = useAuth()
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
    }>({
        file: null,
        thumbnail: null,
        duration: null,
        progress: 0,
        error: null,
        success: false,
        isUploading: false,
        hash: null,
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

    const calculateHash = async (file: File): Promise<string> => {
        const arrayBuffer = await file.arrayBuffer()
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
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
            updateState({ error: 'ファイルサイズが大きすぎます。500MB以下のファイルを選択してください。' })
            return
        }

        updateState({ file: selectedFile, thumbnail: null, duration: null, error: null, success: false })

        try {
            const tasks: Promise<any>[] = [
                generateThumbnail(selectedFile).catch(() => null),
                getVideoDuration(selectedFile).catch(() => null),
            ]

            if (selectedFile.size <= HASH_THRESHOLD) {
                tasks.push(
                    calculateHash(selectedFile).catch(err => {
                        console.error('Hash calculation failed:', err)
                        return null
                    })
                )
            } else {
                tasks.push(Promise.resolve(null))
            }

            const [thumbUrl, duration, hash] = await Promise.all(tasks)
            updateState({
                thumbnail: thumbUrl,
                duration,
                hash: hash || null,
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

        let bunnyVideoId: string | null = null

        try {
            const targetDateStr = format(targetDate, 'yyyy-MM-dd')

            // 既存のレコードを検索
            const { data: existing } = await supabase
                .from('submissions')
                .select('id, bunny_video_id, video_size')
                .match({
                    user_id: user.id,
                    target_date: targetDateStr,
                    submission_item_id: item.id
                }) as { data: { id: number, bunny_video_id: string | null, video_size: number | null }[] | null }

            const existingTotalSize = (existing || []).reduce((sum, r) => sum + (r.video_size || 0), 0)

            // 早期 UX チェック
            const storageCheck = await checkStorageAvailable(state.file.size, existingTotalSize)
            if (!storageCheck.available) {
                updateState({
                    error: 'ストレージが一杯のため、アップロードできません。管理者に連絡してください。',
                    isUploading: false
                })
                return
            }

            // Bunny にビデオ作成 + TUS 認証情報取得
            const bunnyResult = await createBunnyVideo(state.file.name)
            bunnyVideoId = bunnyResult.videoId

            // TUS アップロード
            await new Promise<void>((resolve, reject) => {
                const upload = new tus.Upload(state.file!, {
                    endpoint: bunnyResult.tusEndpoint,
                    retryDelays: [0, 1000, 3000, 5000],
                    headers: {
                        AuthorizationSignature: bunnyResult.authorizationSignature,
                        AuthorizationExpire: String(bunnyResult.authorizationExpire),
                        VideoId: bunnyResult.videoId,
                        LibraryId: bunnyResult.libraryId,
                    },
                    metadata: { filetype: state.file!.type, title: state.file!.name },
                    onError: (error) => reject(error),
                    onProgress: (bytesUploaded, bytesTotal) => {
                        updateState({ progress: Math.round((bytesUploaded / bytesTotal) * 100) })
                    },
                    onSuccess: () => resolve(),
                })
                upload.findPreviousUploads().then((previousUploads) => {
                    if (previousUploads.length > 0) {
                        upload.resumeFromPreviousUpload(previousUploads[0])
                    }
                    upload.start()
                }).catch(() => {
                    upload.start()
                })
            })

            // 既存レコードがある場合は replace_submissions RPC でアトミック置換
            if (existing && existing.length > 0) {
                const { data: rpcData, error: rpcError } = await supabase.rpc('replace_submissions', {
                    p_user_id: user.id,
                    p_target_date: targetDateStr,
                    p_submission_item_id: item.id,
                    p_bunny_video_id: bunnyResult.videoId,
                    p_video_size: state.file.size,
                    p_video_hash: state.hash,
                    p_duration: state.duration ? Math.round(state.duration) : null,
                    p_thumbnail_url: state.thumbnail || null,
                    p_file_name: state.file.name,
                    p_is_late: isLate
                })

                if (rpcError) {
                    await deleteBunnyVideo(bunnyResult.videoId).catch(e => console.error('Bunny cleanup failed:', e))
                    if (rpcError.message?.includes('STORAGE_LIMIT_EXCEEDED')) {
                        updateState({
                            error: 'ストレージが一杯のため、アップロードできません。管理者に連絡してください。',
                            isUploading: false
                        })
                        return
                    }
                    throw new Error('Failed to save submission record')
                }

                if (rpcData?.[0]?.old_bunny_video_ids) {
                    for (const oldId of rpcData[0].old_bunny_video_ids) {
                        await deleteBunnyVideo(oldId).catch(e => console.error('Old video cleanup failed:', e))
                    }
                }
            } else {
                // 新規 INSERT
                const { error: dbError } = await supabase
                    .from('submissions')
                    .insert({
                        user_id: user.id,
                        type: 'video' as const,
                        bunny_video_id: bunnyResult.videoId,
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

                if (dbError) {
                    await deleteBunnyVideo(bunnyResult.videoId).catch(e => console.error('Bunny cleanup failed:', e))
                    if (dbError.message?.includes('STORAGE_LIMIT_EXCEEDED')) {
                        updateState({
                            error: 'ストレージが一杯のため、アップロードできません。管理者に連絡してください。',
                            isUploading: false
                        })
                        return
                    }
                    throw new Error('Failed to save submission record')
                }
            }

            updateState({ success: true, file: null, thumbnail: null })
            if (fileInputRef.current) {
                fileInputRef.current.value = ''
            }
            onSuccess?.()
        } catch (err) {
            console.error('Upload failed:', err)
            if (bunnyVideoId) {
                await deleteBunnyVideo(bunnyVideoId).catch(e => console.error('Bunny cleanup failed:', e))
            }
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
        <Card className="overflow-hidden border-2 border-dashed shadow-sm transition-all duration-200 border-muted-foreground/20 bg-card/50 hover:border-primary/30">
            <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                    <h4 className="font-bold text-sm text-card-foreground">
                        {item.name}
                    </h4>
                    <div className="flex items-center gap-1">
                        {state.file && !state.isUploading && (
                            <>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                    onClick={handleClearFile}
                                >
                                    <X className="w-4 h-4" />
                                </Button>
                                <Button size="sm" onClick={handleUpload} className="h-7 text-xs">
                                    <Upload className="w-3 h-3 mr-1" /> アップロード
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
                        disabled={state.isUploading}
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
                                    <span className="text-[9px] text-muted-foreground">MP4, MOV, WebM / 500MB以内</span>
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
