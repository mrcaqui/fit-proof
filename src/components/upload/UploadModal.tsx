import { useState, useRef, useEffect } from 'react'
import { Database } from "@/types/database.types"
import { useAuth } from '@/context/AuthContext'
import { generateThumbnail } from '@/utils/thumbnail'
import { executeUpload, UploadError, recheckVideoStatus, continueAfterRecheck } from '@/lib/upload-core'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Upload, CheckCircle, AlertCircle, Film, X, RefreshCw, RotateCcw } from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import {
  MAX_FILE_SIZE,
  HASH_THRESHOLD,
  ACCEPT_ATTRIBUTE,
  FORMAT_LABEL,
  SIZE_LABEL,
  isAllowedVideoFile,
} from '@/lib/upload-constants'

interface UploadModalProps {
    targetDate: Date | null
    onClose: () => void
    onSuccess?: () => void
    items: Database['public']['Tables']['submission_items']['Row'][]
    completedSubmissions: { id: number | null, item_id: number | null, file_name: string | null }[]
    isLate?: boolean
}

interface ItemUploadState {
    file: File | null
    thumbnail: string | null
    duration: number | null
    progress: number
    error: string | null
    success: boolean
    isUploading: boolean
    hash: string | null
    phase: 'uploading' | 'verifying' | 'saving' | null
    // For uncertain state (status -1)
    isRetryable: boolean
    isUncertain: boolean
    pendingVideoId: string | null
    isRechecking: boolean
}

const defaultState: ItemUploadState = {
    file: null, thumbnail: null, duration: null, progress: 0, error: null,
    success: false, isUploading: false, hash: null, phase: null,
    isRetryable: false, isUncertain: false, pendingVideoId: null, isRechecking: false,
}

export function UploadModal({ targetDate, onClose, onSuccess, items, completedSubmissions, isLate = false }: UploadModalProps) {
    const { user } = useAuth()
    const [uploadingState, setUploadingState] = useState<Record<number | string, ItemUploadState>>({})
    const fileInputRefs = useRef<Record<number | string, HTMLInputElement | null>>({})

    useEffect(() => {
        if (targetDate) setUploadingState({})
    }, [targetDate])

    if (!targetDate) return null

    const updateState = (id: number | string, newState: Partial<ItemUploadState>) => {
        setUploadingState(prev => ({
            ...prev,
            [id]: { ...(prev[id] || defaultState), ...newState }
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

    const calculateHash = async (file: File): Promise<string> => {
        const arrayBuffer = await file.arrayBuffer()
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    }

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = Math.floor(seconds % 60)
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, itemId: number | string) => {
        const selectedFile = e.target.files?.[0]
        updateState(itemId, { error: null, success: false, thumbnail: null, duration: null, isRetryable: false, isUncertain: false, pendingVideoId: null })

        if (!selectedFile) return

        if (!isAllowedVideoFile(selectedFile)) {
            updateState(itemId, { error: `サポートされていないファイル形式です。${FORMAT_LABEL}形式に対応しています。` })
            return
        }

        if (selectedFile.size > MAX_FILE_SIZE) {
            updateState(itemId, { error: `ファイルサイズが大きすぎます。${SIZE_LABEL}以下のファイルを選択してください。` })
            return
        }

        updateState(itemId, { file: selectedFile, thumbnail: null, duration: null, error: null, success: false })

        try {
            const tasks: Promise<any>[] = [
                generateThumbnail(selectedFile).catch(err => { console.error('Thumbnail generation failed:', err); return null }),
                getVideoDuration(selectedFile).catch(err => { console.error('Duration extraction failed:', err); return null }),
            ]

            if (selectedFile.size <= HASH_THRESHOLD) {
                tasks.push(calculateHash(selectedFile).catch(err => { console.error('Hash calculation failed:', err); return null }))
            } else {
                tasks.push(Promise.resolve(null))
            }

            const [thumbUrl, duration, hash] = await Promise.all(tasks)
            updateState(itemId, { thumbnail: thumbUrl, duration, hash: hash || null })
        } catch (err) {
            console.error('Metadata extraction failed:', err)
        }
    }

    const handleUpload = async (itemId: number | string) => {
        const state = uploadingState[itemId]
        if (!state?.file || !user) return

        updateState(itemId, {
            isUploading: true, progress: 0, error: null, phase: 'uploading',
            isRetryable: false, isUncertain: false, pendingVideoId: null,
        })

        try {
            const targetDateStr = format(targetDate, 'yyyy-MM-dd')
            const normalizedItemId = typeof itemId === 'number' ? itemId : null

            await executeUpload({
                file: state.file,
                userId: user.id,
                targetDate: targetDateStr,
                submissionItemId: normalizedItemId,
                thumbnail: state.thumbnail,
                duration: state.duration,
                hash: state.hash,
                isLate,
                onProgress: (progress) => updateState(itemId, { progress }),
                onPhaseChange: (phase) => updateState(itemId, { phase }),
            })

            updateState(itemId, { success: true, file: null, thumbnail: null, isUploading: false, phase: null })
            if (fileInputRefs.current[itemId]) {
                fileInputRefs.current[itemId]!.value = ''
            }
            onSuccess?.()
        } catch (err) {
            if (err instanceof UploadError) {
                updateState(itemId, {
                    error: err.userMessage,
                    isUploading: false,
                    phase: null,
                    isRetryable: err.isRetryable,
                    isUncertain: err.isUncertain,
                    pendingVideoId: err.pendingVideoId ?? null,
                })
            } else {
                console.error('Upload failed:', err)
                updateState(itemId, { error: 'アップロードに失敗しました。', isUploading: false, phase: null })
            }
        }
    }

    const handleRecheck = async (itemId: number | string) => {
        const state = uploadingState[itemId]
        if (!state?.pendingVideoId || !user || !state.file) return

        updateState(itemId, { isRechecking: true, error: null })

        try {
            const result = await recheckVideoStatus(state.pendingVideoId)

            if (result.outcome === 'ready') {
                const targetDateStr = format(targetDate, 'yyyy-MM-dd')
                const normalizedItemId = typeof itemId === 'number' ? itemId : null

                await continueAfterRecheck({
                    videoId: state.pendingVideoId,
                    userId: user.id,
                    targetDate: targetDateStr,
                    submissionItemId: normalizedItemId,
                    file: state.file,
                    thumbnail: state.thumbnail,
                    duration: state.duration,
                    hash: state.hash,
                    isLate,
                })

                updateState(itemId, {
                    success: true, file: null, thumbnail: null,
                    isRechecking: false, isUncertain: false, pendingVideoId: null,
                })
                if (fileInputRefs.current[itemId]) {
                    fileInputRefs.current[itemId]!.value = ''
                }
                onSuccess?.()
            } else if (result.outcome === 'failed') {
                updateState(itemId, {
                    error: 'CDN側でエラーが確認されました。再度アップロードしてください。',
                    isRechecking: false, isUncertain: false, pendingVideoId: null,
                    isRetryable: false,
                })
            } else {
                updateState(itemId, {
                    error: 'まだ処理中です。しばらくお待ちください。',
                    isRechecking: false, isUncertain: true,
                })
            }
        } catch (err) {
            console.error('Recheck failed:', err)
            updateState(itemId, {
                error: '状態の確認に失敗しました。再度お試しください。',
                isRechecking: false, isUncertain: true,
            })
        }
    }

    const getPhaseLabel = (phase: ItemUploadState['phase'], progress: number) => {
        switch (phase) {
            case 'uploading': return progress === 0 ? 'アップロード準備中...' : `アップロード中... ${progress}%`
            case 'verifying': return '処理を確認中...'
            case 'saving': return '保存中...'
            default: return 'アップロード中...'
        }
    }

    const renderUploadCard = (item?: Database['public']['Tables']['submission_items']['Row']) => {
        const itemId = item?.id || 'general'
        const state = uploadingState[itemId] || defaultState
        const submission = item
            ? completedSubmissions.find(s => s.item_id === item.id)
            : completedSubmissions.find(s => s.item_id === null)
        const isCompleted = !!submission

        return (
            <div key={itemId} className={`p-4 rounded-lg border-2 transition-all space-y-4 ${isCompleted ? 'bg-muted/30 border-muted' : 'bg-card border-muted-foreground/10 hover:border-primary/30'
                }`}>
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
                    {state.file && !state.isUploading && !state.success && !state.isRechecking && (
                        <Button size="sm" onClick={() => handleUpload(itemId)} className="h-8">
                            <Upload className="w-3 h-3 mr-1" /> アップロード
                        </Button>
                    )}
                </div>

                <div className="relative">
                    <input
                        ref={el => fileInputRefs.current[itemId] = el}
                        type="file"
                        accept={ACCEPT_ATTRIBUTE}
                        onChange={(e) => handleFileSelect(e, itemId)}
                        className="hidden"
                        id={`file-input-${itemId}`}
                        disabled={state.isUploading || state.isRechecking}
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
                                <span className="text-[10px] text-muted-foreground">{`${FORMAT_LABEL} / ${SIZE_LABEL}以内`}</span>
                            </>
                        )}

                        {state.file && (
                            <div className="flex items-center gap-4 w-full">
                                <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 bg-muted rounded overflow-hidden border shadow-sm flex items-center justify-center">
                                    {state.thumbnail ? (
                                        <img src={state.thumbnail} alt="Preview" className="w-full h-full object-cover" />
                                    ) : (
                                        <Film className="w-6 h-6 text-muted-foreground/40" />
                                    )}
                                </div>
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

                    {(state.isUploading || state.isRechecking) && (
                        <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center p-4 rounded-lg z-10 backdrop-blur-sm">
                            {state.isRechecking ? (
                                <>
                                    <div className="h-8 w-8 rounded-full border-3 border-primary/30
                                                    border-t-primary animate-spin mb-2" />
                                    <span className="text-xs font-medium animate-pulse">状態を確認中...</span>
                                </>
                            ) : state.phase === 'verifying' || state.phase === 'saving' ? (
                                <>
                                    <div className="h-8 w-8 rounded-full border-3 border-primary/30
                                                    border-t-primary animate-spin mb-2" />
                                    <span className="text-xs font-medium animate-pulse">
                                        {getPhaseLabel(state.phase, state.progress)}
                                    </span>
                                </>
                            ) : (
                                <>
                                    <Progress value={state.progress} className="w-full h-2 mb-2" />
                                    <span className="text-xs font-medium animate-pulse">
                                        {getPhaseLabel(state.phase, state.progress)}
                                    </span>
                                </>
                            )}
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
                    <div className="space-y-2">
                        <div className="flex items-center gap-1.5 text-destructive text-[11px] font-medium px-2">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {state.error}
                        </div>
                        <div className="flex items-center gap-2 px-2">
                            {state.isUncertain && state.pendingVideoId && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={() => handleRecheck(itemId)}
                                    disabled={state.isRechecking}
                                >
                                    <RefreshCw className="w-3 h-3 mr-1" /> 状態を再確認
                                </Button>
                            )}
                            {state.isRetryable && state.file && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={() => handleUpload(itemId)}
                                >
                                    <RotateCcw className="w-3 h-3 mr-1" /> 再試行
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-background rounded-xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
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

                <div className="p-4 space-y-4 overflow-y-auto custom-scrollbar">
                    {items.length > 0 ? (
                        items.map(item => renderUploadCard(item))
                    ) : (
                        renderUploadCard()
                    )}
                </div>

                <div className="p-4 border-t bg-muted/5">
                    <Button variant="ghost" onClick={onClose} className="w-full font-bold">
                        閉じる
                    </Button>
                </div>
            </div>
        </div>
    )
}
