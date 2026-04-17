import { useState, useRef, useEffect } from 'react'
import { Database } from '@/types/database.types'
import { useAuth } from '@/context/AuthContext'
import { generateThumbnail } from '@/utils/thumbnail'
import { calculateFileHash } from '@/utils/hash'
import { executeUpload, UploadError, recheckVideoStatus, continueAfterRecheck, type UploadStage, type ThumbnailStrategy } from '@/lib/upload-core'
import { isIOS } from '@/lib/upload-logger'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Upload, Film, AlertCircle, AlertTriangle, X, RefreshCw, RotateCcw } from 'lucide-react'
import { format } from 'date-fns'
import {
  MAX_FILE_SIZE,
  ACCEPT_ATTRIBUTE,
  FORMAT_LABEL,
  SIZE_LABEL,
  LARGE_FILE_THUMBNAIL_SKIP_THRESHOLD_BYTES,
  isAllowedVideoFile,
} from '@/lib/upload-constants'
import { useUploadGuard } from '@/hooks/useUploadGuard'

type SubmissionItem = Database['public']['Tables']['submission_items']['Row']

interface PendingUploadCardProps {
    item: SubmissionItem
    targetDate: Date
    onSuccess?: () => void
    isLate?: boolean
    readOnly?: boolean
}

interface UploadState {
    file: File | null
    thumbnail: string | null
    thumbnailStrategy: ThumbnailStrategy
    duration: number | null
    progress: number
    error: string | null
    success: boolean
    isUploading: boolean
    hash: string | null
    fileLastModified: string | null
    phase: 'uploading' | 'verifying' | 'saving' | null
    stage: UploadStage | null
    isPreparing: boolean
    isRetryable: boolean
    isUncertain: boolean
    pendingVideoId: string | null
    isRechecking: boolean
}

const initialState: UploadState = {
    file: null, thumbnail: null, thumbnailStrategy: 'downscaled', duration: null, progress: 0, error: null,
    success: false, isUploading: false, hash: null, fileLastModified: null, phase: null,
    stage: null, isPreparing: false, isRetryable: false, isUncertain: false, pendingVideoId: null, isRechecking: false,
}

export function PendingUploadCard({ item, targetDate, onSuccess, isLate = false, readOnly = false }: PendingUploadCardProps) {
    const { user } = useAuth()
    const fileInputRef = useRef<HTMLInputElement>(null)
    const fileSelectCounterRef = useRef<number>(0)
    const hashAbortRef = useRef<AbortController | null>(null)
    const [state, setState] = useState<UploadState>(initialState)
    useUploadGuard(state.isUploading)

    useEffect(() => {
        if (readOnly) {
            fileSelectCounterRef.current++
            updateState(initialState)
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
    }, [readOnly])

    const updateState = (newState: Partial<UploadState>) => {
        setState(prev => ({ ...prev, ...newState }))
    }

    const getVideoDuration = (file: File): Promise<number> => {
        return new Promise((resolve, reject) => {
            let video: HTMLVideoElement | null = document.createElement('video')
            video.preload = 'metadata'
            const objectUrl = URL.createObjectURL(file)

            const timeout = setTimeout(() => {
                cleanup()
                reject(new Error('Duration extraction timed out'))
            }, 5000)

            const cleanup = () => {
                clearTimeout(timeout)
                if (video) {
                    try { video.pause() } catch { /* ignore */ }
                    try { video.removeAttribute('src') } catch { /* ignore */ }
                    try { (video as any).srcObject = null } catch { /* ignore */ }
                    try { video.load() } catch { /* ignore */ }
                }
                URL.revokeObjectURL(objectUrl)
                video = null
            }

            video.onloadedmetadata = () => {
                if (!video) return
                const duration = video.duration
                cleanup()
                resolve(duration)
            }
            video.onerror = () => {
                cleanup()
                reject(new Error('Error loading video for duration'))
            }
            video.src = objectUrl
        })
    }

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = Math.floor(seconds % 60)
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (readOnly) return
        const selectedFile = e.target.files?.[0]
        const counter = ++fileSelectCounterRef.current
        updateState({ error: null, success: false, thumbnail: null, duration: null, isRetryable: false, isUncertain: false, pendingVideoId: null })

        if (!selectedFile) return

        if (!isAllowedVideoFile(selectedFile)) {
            updateState({ error: `サポートされていないファイル形式です。${FORMAT_LABEL}形式に対応しています。` })
            return
        }

        if (selectedFile.size > MAX_FILE_SIZE) {
            updateState({ error: `ファイルサイズが大きすぎます。${SIZE_LABEL}以下のファイルを選択してください。` })
            return
        }

        const fileLastModified = selectedFile.lastModified
            ? new Date(selectedFile.lastModified).toISOString()
            : null

        updateState({ file: selectedFile, thumbnail: null, thumbnailStrategy: 'downscaled', duration: null, error: null, success: false, isPreparing: true, fileLastModified })

        // 前回のハッシュ計算を中断
        hashAbortRef.current?.abort()

        try {
            // Step 1: サムネイル生成と動画長抽出
            // iOS + 大容量では <video> decode + canvas drawImage + toDataURL の native メモリ
            // ピークが jetsam の主因と推定されるためサムネ生成自体をスキップする。
            // それ以外は直列化（Promise.all だと <video> を 2 本同時に保持するため）。
            const skipThumbnail = isIOS() && selectedFile.size >= LARGE_FILE_THUMBNAIL_SKIP_THRESHOLD_BYTES
            let thumbUrl: string | null = null
            let strategy: ThumbnailStrategy = 'downscaled'
            if (skipThumbnail) {
                strategy = 'skipped'
            } else {
                try {
                    thumbUrl = await generateThumbnail(selectedFile)
                    strategy = 'downscaled'
                } catch (err) {
                    console.error('Thumbnail generation failed:', err)
                    thumbUrl = null
                    strategy = 'failed'
                }
            }
            if (fileSelectCounterRef.current !== counter) return

            const duration = await getVideoDuration(selectedFile).catch(() => null)
            if (fileSelectCounterRef.current !== counter) return

            // サムネイルを即時反映してからハッシュ計算へ
            updateState({ thumbnail: thumbUrl, thumbnailStrategy: strategy, duration })

            // Step 2: ハッシュ計算（AbortSignal付き）
            const abortController = new AbortController()
            hashAbortRef.current = abortController
            const hash = await calculateFileHash(selectedFile, abortController.signal)
            if (fileSelectCounterRef.current !== counter) return

            updateState({ hash: hash || null, isPreparing: false })
        } catch (err) {
            console.error('Metadata extraction failed:', err)
            if (fileSelectCounterRef.current === counter) {
                updateState({ isPreparing: false })
            }
        }
    }

    const handleClearFile = () => {
        if (readOnly) return
        fileSelectCounterRef.current++
        updateState({ file: null, thumbnail: null, thumbnailStrategy: 'downscaled', duration: null, hash: null, fileLastModified: null, error: null, isPreparing: false, isRetryable: false, isUncertain: false, pendingVideoId: null })
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const handleUpload = async () => {
        if (readOnly) return
        if (!state.file || !user) return

        updateState({
            isUploading: true, progress: 0, error: null, phase: 'uploading', stage: 'preparing-video',
            isRetryable: false, isUncertain: false, pendingVideoId: null,
        })

        try {
            const targetDateStr = format(targetDate, 'yyyy-MM-dd')

            await executeUpload({
                file: state.file,
                userId: user.id,
                targetDate: targetDateStr,
                submissionItemId: item.id,
                thumbnail: state.thumbnail,
                thumbnailStrategy: state.thumbnailStrategy,
                duration: state.duration,
                hash: state.hash,
                isLate,
                fileLastModified: state.fileLastModified,
                onProgress: (progress) => updateState({ progress }),
                onPhaseChange: (phase) => updateState({ phase }),
                onStageChange: (stage) => updateState({ stage }),
            })

            updateState({ success: true, file: null, thumbnail: null, isUploading: false, phase: null, stage: null })
            if (fileInputRef.current) fileInputRef.current.value = ''
            onSuccess?.()
        } catch (err) {
            if (err instanceof UploadError) {
                updateState({
                    error: err.userMessage,
                    isUploading: false,
                    phase: null,
                    stage: null,
                    isRetryable: err.isRetryable,
                    isUncertain: err.isUncertain,
                    pendingVideoId: err.pendingVideoId ?? null,
                })
            } else {
                console.error('Upload failed:', err)
                updateState({ error: 'アップロードに失敗しました。', isUploading: false, phase: null, stage: null })
            }
        }
    }

    const handleRecheck = async () => {
        if (!state.pendingVideoId || !user || !state.file) return

        updateState({ isRechecking: true, error: null })

        try {
            const result = await recheckVideoStatus(state.pendingVideoId)

            if (result.outcome === 'ready') {
                const targetDateStr = format(targetDate, 'yyyy-MM-dd')

                await continueAfterRecheck({
                    videoId: state.pendingVideoId,
                    userId: user.id,
                    targetDate: targetDateStr,
                    submissionItemId: item.id,
                    file: state.file,
                    thumbnail: state.thumbnail,
                    duration: state.duration,
                    hash: state.hash,
                    isLate,
                    fileLastModified: state.fileLastModified,
                })

                updateState({
                    success: true, file: null, thumbnail: null,
                    isRechecking: false, isUncertain: false, pendingVideoId: null,
                })
                if (fileInputRef.current) fileInputRef.current.value = ''
                onSuccess?.()
            } else if (result.outcome === 'failed') {
                updateState({
                    error: 'CDN側でエラーが確認されました。再度アップロードしてください。',
                    isRechecking: false, isUncertain: false, pendingVideoId: null,
                    isRetryable: false,
                })
            } else {
                updateState({
                    error: 'まだ処理中です。しばらくお待ちください。',
                    isRechecking: false, isUncertain: true,
                })
            }
        } catch (err) {
            console.error('Recheck failed:', err)
            updateState({
                error: '状態の確認に失敗しました。再度お試しください。',
                isRechecking: false, isUncertain: true,
            })
        }
    }

    const getPhaseLabel = (phase: UploadState['phase'], stage: UploadState['stage'], progress: number) => {
        if (phase === 'uploading') {
            switch (stage) {
                case 'preparing-video': return '動画を作成中...'
                case 'preparing-wakelock':
                case 'preparing-tus': return 'アップロード準備中...'
                case 'stalled':
                case 'uploading':
                    return progress === 0 ? 'アップロードを開始しています...' : `アップロード中... ${progress}%`
                default:
                    return progress === 0 ? 'アップロード準備中...' : `アップロード中...`
            }
        }
        switch (phase) {
            case 'verifying': return '処理を確認中...'
            case 'saving': return '保存中...'
            default: return 'アップロード中...'
        }
    }

    // Hide on success (replaced by WorkoutCard)
    if (state.success) return null

    return (
        <Card className="overflow-hidden border-2 border-dashed shadow-sm transition-all duration-200 border-muted-foreground/20 bg-card/50 hover:border-primary/30">
            <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                    <h4 className="font-bold text-sm text-card-foreground">
                        {item.name}
                    </h4>
                    <div className="flex items-center gap-1">
                        {!readOnly && state.file && !state.isUploading && !state.isRechecking && !state.isPreparing && (
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
                        accept={ACCEPT_ATTRIBUTE}
                        onChange={handleFileSelect}
                        className="hidden"
                        id={`file-input-${item.id}`}
                        disabled={readOnly || state.isUploading || state.isRechecking}
                    />
                    <label
                        htmlFor={`file-input-${item.id}`}
                        className={`${readOnly ? 'cursor-default' : 'cursor-pointer'} flex items-center gap-3 p-3 rounded-lg border border-dashed transition-colors ${state.file ? 'bg-muted/30 border-primary/30' : readOnly ? 'border-muted-foreground/20' : 'hover:bg-muted/50 border-muted-foreground/20'
                            }`}
                    >
                        {!state.file && (
                            <>
                                <Film className="h-6 w-6 text-muted-foreground shrink-0" />
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs font-medium">{readOnly ? '（閲覧専用）' : 'クリックして動画を選択'}</span>
                                    {!readOnly && <span className="text-[9px] text-muted-foreground">{`${FORMAT_LABEL} / ${SIZE_LABEL}以内`}</span>}
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
                                        {state.isPreparing ? '読み込み中...' : 'アップロード準備完了'}
                                    </p>
                                    {state.thumbnailStrategy === 'skipped' && !state.isPreparing && (
                                        <p className="text-[8px] text-muted-foreground">
                                            端末メモリ制約のためサムネを省略しています
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </label>

                    {(state.isUploading || state.isRechecking) && (
                        <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center p-3 rounded-lg z-10 backdrop-blur-sm">
                            {state.isRechecking ? (
                                <>
                                    <div className="h-6 w-6 rounded-full border-2 border-primary/30
                                                    border-t-primary animate-spin mb-1.5" />
                                    <span className="text-[10px] font-medium animate-pulse">状態を確認中...</span>
                                </>
                            ) : state.phase === 'verifying' || state.phase === 'saving' ? (
                                <>
                                    <div className="h-6 w-6 rounded-full border-2 border-primary/30
                                                    border-t-primary animate-spin mb-1.5" />
                                    <span className="text-[10px] font-medium animate-pulse">
                                        {getPhaseLabel(state.phase, state.stage, state.progress)}
                                    </span>
                                </>
                            ) : (
                                <>
                                    <Progress value={state.progress} className="w-full h-1.5 mb-1.5" />
                                    <span className="text-[10px] font-medium animate-pulse">
                                        {getPhaseLabel(state.phase, state.stage, state.progress)}
                                    </span>
                                    {state.stage === 'stalled' && (
                                        <span className="text-[10px] text-yellow-600 font-semibold mt-1 flex items-center gap-1">
                                            <AlertTriangle className="w-3 h-3" />
                                            通信が遅延しています。お待ちください
                                        </span>
                                    )}
                                    {state.phase === 'uploading' && state.stage !== 'stalled' && (
                                        <span className="text-[10px] text-muted-foreground mt-1">
                                            アップロード中は画面を閉じないでください
                                        </span>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>

                {state.error && (
                    <div className="space-y-1.5 mt-2">
                        <div className="flex items-center gap-1 text-destructive text-[10px] font-medium">
                            <AlertCircle className="h-3 w-3 shrink-0" /> {state.error}
                        </div>
                        <div className="flex items-center gap-1.5">
                            {state.isUncertain && state.pendingVideoId && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-[10px] px-2"
                                    onClick={handleRecheck}
                                    disabled={state.isRechecking}
                                >
                                    <RefreshCw className="w-2.5 h-2.5 mr-1" /> 状態を再確認
                                </Button>
                            )}
                            {state.isRetryable && state.file && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 text-[10px] px-2"
                                    onClick={handleUpload}
                                >
                                    <RotateCcw className="w-2.5 h-2.5 mr-1" /> 再試行
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
