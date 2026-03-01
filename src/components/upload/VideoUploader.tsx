import { useState, useRef } from 'react'
import * as tus from 'tus-js-client'
import { createBunnyVideo, deleteBunnyVideo } from '@/lib/bunny'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { generateThumbnail } from '@/utils/thumbnail'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Upload, CheckCircle, AlertCircle, Film } from 'lucide-react'

const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB
const ALLOWED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']

export function VideoUploader() {
    const { user } = useAuth()
    const [file, setFile] = useState<File | null>(null)
    const [thumbnail, setThumbnail] = useState<string | null>(null)
    const [uploading, setUploading] = useState(false)
    const [progress, setProgress] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0]
        setError(null)
        setSuccess(false)
        setThumbnail(null)

        if (!selectedFile) return

        // Validate file type
        if (!ALLOWED_TYPES.includes(selectedFile.type)) {
            setError('サポートされていないファイル形式です。MP4, MOV, WebM形式のみ対応しています。')
            return
        }

        // Validate file size
        if (selectedFile.size > MAX_FILE_SIZE) {
            setError('ファイルサイズが大きすぎます。500MB以下のファイルを選択してください。')
            return
        }

        setFile(selectedFile)

        // Generate thumbnail
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

        let bunnyVideoId: string | null = null

        try {
            // Bunny にビデオ作成 + TUS 認証情報取得
            const bunnyResult = await createBunnyVideo(file.name)
            bunnyVideoId = bunnyResult.videoId

            // TUS アップロード
            await new Promise<void>((resolve, reject) => {
                const upload = new tus.Upload(file, {
                    endpoint: bunnyResult.tusEndpoint,
                    retryDelays: [0, 1000, 3000, 5000],
                    headers: {
                        AuthorizationSignature: bunnyResult.authorizationSignature,
                        AuthorizationExpire: String(bunnyResult.authorizationExpire),
                        VideoId: bunnyResult.videoId,
                        LibraryId: bunnyResult.libraryId,
                    },
                    metadata: { filetype: file.type, title: file.name },
                    onError: (error) => reject(error),
                    onProgress: (bytesUploaded, bytesTotal) => {
                        setProgress(Math.round((bytesUploaded / bytesTotal) * 100))
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

            // Create submission record in Supabase
            const { error: dbError } = await supabase
                .from('submissions')
                .insert({
                    user_id: user.id,
                    type: 'video' as const,
                    bunny_video_id: bunnyResult.videoId,
                    thumbnail_url: thumbnail || null,
                    status: 'success' as const,
                } as any)

            if (dbError) {
                await deleteBunnyVideo(bunnyResult.videoId).catch(e => console.error('Bunny cleanup failed:', e))
                throw new Error('Failed to save submission record')
            }

            setSuccess(true)
            setFile(null)
            setThumbnail(null)
            if (fileInputRef.current) {
                fileInputRef.current.value = ''
            }
        } catch (err) {
            console.error('Upload failed:', err)
            if (bunnyVideoId) {
                await deleteBunnyVideo(bunnyVideoId).catch(e => console.error('Bunny cleanup failed:', e))
            }
            setError('アップロードに失敗しました。もう一度お試しください。')
        } finally {
            setUploading(false)
        }
    }

    return (
        <div className="space-y-6">
            {/* File Input */}
            <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="video-input"
                    disabled={uploading}
                />
                <label
                    htmlFor="video-input"
                    className="cursor-pointer flex flex-col items-center gap-2"
                >
                    <Film className="h-12 w-12 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                        クリックして動画を選択（MP4, MOV, WebM / 最大500MB）
                    </span>
                </label>
            </div>

            {/* Thumbnail Preview */}
            {thumbnail && (
                <div className="flex justify-center">
                    <img
                        src={thumbnail}
                        alt="Video thumbnail"
                        className="max-w-xs rounded-lg shadow-md"
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

            {/* Upload Button */}
            <Button
                onClick={handleUpload}
                disabled={!file || uploading}
                className="w-full"
            >
                <Upload className="mr-2 h-4 w-4" />
                {uploading ? 'アップロード中...' : 'アップロード'}
            </Button>
        </div>
    )
}
