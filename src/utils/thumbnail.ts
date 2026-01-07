/**
 * Extracts a thumbnail frame from a video file at the specified time.
 * Returns a base64 data URL of the thumbnail image.
 */
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
        }

        video.onloadedmetadata = () => {
            // Seek to the desired time (or end if video is shorter)
            video.currentTime = Math.min(seekTime, video.duration)
        }

        video.onseeked = () => {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight

            if (ctx) {
                try {
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
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
