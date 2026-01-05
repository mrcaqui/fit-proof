import { useState, useRef, useEffect } from 'react'
import { PutObjectCommand } from '@aws-sdk/client-s3'
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
    submissionItemId?: number | null
}

export function UploadModal({ targetDate, onClose, onSuccess, submissionItemId }: UploadModalProps) {
    const { user } = useAuth()
    const [file, setFile] = useState<File | null>(null)
    const [thumbnail, setThumbnail] = useState<string | null>(null)
    const [uploading, setUploading] = useState(false)
    const [progress, setProgress] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Reset state when modal opens with new date
    useEffect(() => {
        if (targetDate) {
            setFile(null)
            setThumbnail(null)
            setError(null)
            setSuccess(false)
            setProgress(0)
        }
    }, [targetDate])

    if (!targetDate) return null

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0]
        setError(null)
        setSuccess(false)
        setThumbnail(null)

        if (!selectedFile) return

        if (!ALLOWED_TYPES.includes(selectedFile.type)) {
            setError('サポートされていないファイル形式です。MP4, MOV, WebM形式のみ対応しています。')
            return
        }

        if (selectedFile.size > MAX_FILE_SIZE) {
            setError('ファイルサイズが大きすぎます。100MB以下のファイルを選択してください。')
            return
        }

        setFile(selectedFile)

        try {
            const thumbUrl = await generateThumbnail(selectedFile)
            setThumbnail(thumbUrl)
        } catch (err) {
            console.error('Thumbnail generation failed:', err)
        }
    }

    const handleUpload = async () => {
        if (!file || !user) return

        setUploading(true)
        setProgress(0)
        setError(null)

        try {
            const timestamp = Date.now()
            const fileExtension = file.name.split('.').pop()
            const key = `uploads/${user.id}/${timestamp}.${fileExtension}`

            const arrayBuffer = await file.arrayBuffer()

            const command = new PutObjectCommand({
                Bucket: R2_BUCKET_NAME,
                Key: key,
                Body: new Uint8Array(arrayBuffer),
                ContentType: file.type,
            })

            await r2Client.send(command)
            setProgress(100)

            // Store the target date as ISO string (date only)
            const targetDateStr = format(targetDate, 'yyyy-MM-dd')

            const { error: dbError } = await supabase
                .from('submissions')
                .insert({
                    user_id: user.id,
                    type: 'video' as const,
                    r2_key: key,
                    thumbnail_url: thumbnail || null,
                    status: 'success' as const,
                    target_date: targetDateStr,
                    submission_item_id: submissionItemId || null
                } as any)

            if (dbError) {
                console.error('Supabase insert error:', dbError)
                throw new Error('Failed to save submission record')
            }

            setSuccess(true)
            setFile(null)
            setThumbnail(null)
            if (fileInputRef.current) {
                fileInputRef.current.value = ''
            }
            onSuccess?.()
        } catch (err) {
            console.error('Upload failed:', err)
            setError('アップロードに失敗しました。もう一度お試しください。')
        } finally {
            setUploading(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <div className="bg-background rounded-lg max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b">
                    <div>
                        <h3 className="font-semibold">動画をアップロード</h3>
                        <p className="text-sm text-muted-foreground">
                            {format(targetDate, 'yyyy年M月d日(E)', { locale: ja })} のワークアウト
                        </p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4 overflow-y-auto">
                    {/* File Input */}
                    <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center">
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="video/mp4,video/quicktime,video/webm"
                            onChange={handleFileSelect}
                            className="hidden"
                            id="modal-video-input"
                            disabled={uploading}
                        />
                        <label
                            htmlFor="modal-video-input"
                            className="cursor-pointer flex flex-col items-center gap-2"
                        >
                            <Film className="h-10 w-10 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                                クリックして動画を選択
                            </span>
                            <span className="text-xs text-muted-foreground">
                                MP4, MOV, WebM / 最大100MB
                            </span>
                        </label>
                    </div>

                    {/* Thumbnail Preview */}
                    {thumbnail && (
                        <div className="flex justify-center">
                            <img
                                src={thumbnail}
                                alt="Video thumbnail"
                                className="max-w-full max-h-40 rounded-lg shadow-md"
                            />
                        </div>
                    )}

                    {/* Selected File Info */}
                    {file && (
                        <div className="text-sm text-muted-foreground text-center">
                            {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                        </div>
                    )}

                    {/* Progress Bar */}
                    {uploading && (
                        <div className="space-y-2">
                            <Progress value={progress} className="w-full" />
                            <p className="text-sm text-center text-muted-foreground">
                                アップロード中...
                            </p>
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <div className="flex items-center gap-2 text-destructive text-sm justify-center">
                            <AlertCircle className="h-4 w-4" />
                            {error}
                        </div>
                    )}

                    {/* Success Message */}
                    {success && (
                        <div className="flex items-center gap-2 text-green-600 text-sm justify-center">
                            <CheckCircle className="h-4 w-4" />
                            アップロードが完了しました！
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t flex gap-2">
                    <Button variant="outline" onClick={onClose} className="flex-1">
                        キャンセル
                    </Button>
                    <Button
                        onClick={handleUpload}
                        disabled={!file || uploading}
                        className="flex-1"
                    >
                        <Upload className="mr-2 h-4 w-4" />
                        {uploading ? 'アップロード中...' : 'アップロード'}
                    </Button>
                </div>
            </div>
        </div>
    )
}
