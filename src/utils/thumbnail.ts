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

        video.onloadedmetadata = () => {
            // Seek to the desired time (or end if video is shorter)
            video.currentTime = Math.min(seekTime, video.duration)
        }

        video.onseeked = () => {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight

            if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8)
                URL.revokeObjectURL(video.src)
                resolve(dataUrl)
            } else {
                reject(new Error('Could not get canvas context'))
            }
        }

        video.onerror = () => {
            URL.revokeObjectURL(video.src)
            reject(new Error('Error loading video for thumbnail'))
        }

        video.src = URL.createObjectURL(file)
    })
}
