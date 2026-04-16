/**
 * Extracts a thumbnail frame from a video file at the specified time.
 * Returns a base64 data URL of the thumbnail image.
 */

// 長辺 640px にクランプ。iOS Safari での jetsam 回避のため、4K 原寸 canvas が
// 約 33MB になるのを避ける（v2.8.4、2026-04-16）。
const MAX_LONG_EDGE = 640

export async function generateThumbnail(
    file: File,
    seekTime: number = 1 // seconds into video to capture
): Promise<string> {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video')
        video.preload = 'metadata'
        video.muted = true
        video.playsInline = true

        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')

        // Add timeout for generation
        const timeout = setTimeout(() => {
            cleanup()
            reject(new Error('Thumbnail generation timed out'))
        }, 5000)

        const cleanup = () => {
            clearTimeout(timeout)
            URL.revokeObjectURL(video.src)
            video.src = ''
            video.load()
            // GPU バックバッファを即解放する
            canvas.width = 0
            canvas.height = 0
        }

        video.onloadedmetadata = () => {
            // Seek to the desired time (or end if video is shorter)
            video.currentTime = Math.min(seekTime, video.duration)
        }

        video.onseeked = () => {
            const srcW = video.videoWidth
            const srcH = video.videoHeight
            const scale = Math.min(1, MAX_LONG_EDGE / Math.max(srcW, srcH))
            const dstW = Math.max(1, Math.round(srcW * scale))
            const dstH = Math.max(1, Math.round(srcH * scale))
            canvas.width = dstW
            canvas.height = dstH

            if (ctx) {
                try {
                    ctx.drawImage(video, 0, 0, dstW, dstH)
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.75)
                    cleanup()
                    resolve(dataUrl)
                } catch (err) {
                    cleanup()
                    reject(err)
                }
            } else {
                cleanup()
                reject(new Error('Could not get canvas context'))
            }
        }

        video.onerror = () => {
            cleanup()
            reject(new Error('Error loading video for thumbnail'))
        }

        video.src = URL.createObjectURL(file)
    })
}
