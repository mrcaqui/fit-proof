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
        let video: HTMLVideoElement | null = document.createElement('video')
        video.preload = 'metadata'
        video.muted = true
        video.playsInline = true

        let canvas: HTMLCanvasElement | null = document.createElement('canvas')
        let ctx: CanvasRenderingContext2D | null = canvas.getContext('2d')

        const objectUrl = URL.createObjectURL(file)

        // Add timeout for generation
        const timeout = setTimeout(() => {
            cleanup()
            reject(new Error('Thumbnail generation timed out'))
        }, 5000)

        // iOS WebKit の decoder / GPU バッファを確実に解放するため、video と canvas を
        // 段階的に teardown して参照も落とす。
        const cleanup = () => {
            clearTimeout(timeout)
            if (video) {
                try { video.pause() } catch { /* ignore */ }
                try { video.removeAttribute('src') } catch { /* ignore */ }
                try { (video as any).srcObject = null } catch { /* ignore */ }
                try { video.load() } catch { /* ignore */ }
            }
            URL.revokeObjectURL(objectUrl)
            if (canvas) {
                canvas.width = 0
                canvas.height = 0
            }
            ctx = null
            canvas = null
            video = null
        }

        video.onloadedmetadata = () => {
            if (!video) return
            // Seek to the desired time (or end if video is shorter)
            video.currentTime = Math.min(seekTime, video.duration)
        }

        video.onseeked = () => {
            if (!video || !canvas) return
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

        video.src = objectUrl
    })
}
