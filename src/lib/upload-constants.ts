export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024

export const ALLOWED_MIME_TYPES: readonly string[] = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/x-msvideo',
  'video/3gpp',
  'video/3gpp2',
  'video/mp2t',
]

export const ALLOWED_EXTENSIONS: readonly string[] = [
  '.mp4', '.m4v', '.mov', '.webm', '.mkv',
  '.avi', '.3gp', '.3g2', '.ts', '.mts',
]

export const ACCEPT_ATTRIBUTE = 'video/*'

export const FORMAT_LABEL = 'MP4, MOV, WebM, MKV, AVI, 3GP, TS等'

export const SIZE_LABEL = '2GB'

// --- Retry & Timeout ---

export const BUNNY_CREATE_MAX_ATTEMPTS = 3
export const BUNNY_CREATE_RETRY_DELAYS = [0, 2000, 5000]
export const MIN_PROCESSING_TIMEOUT_MS = 60_000
export const MAX_PROCESSING_TIMEOUT_MS = 300_000
export const PROCESSING_TIMEOUT_BYTES_PER_SEC = 500 * 1024

export const TUS_CHUNK_SIZE = 6 * 1024 * 1024  // iOS Safari の OOM 回避のため 6MB（2026-04-14 v2.8.3）
export const TUS_INITIAL_PROGRESS_TIMEOUT_MS = 30_000
export const TUS_STALLED_WARN_MS = 10_000
export const WAKELOCK_TIMEOUT_MS = 2_000

/** Calculate processing timeout based on file size */
export function getProcessingTimeout(fileSize: number): number {
  const dynamic = Math.round((fileSize / PROCESSING_TIMEOUT_BYTES_PER_SEC) * 1000)
  return Math.min(Math.max(dynamic, MIN_PROCESSING_TIMEOUT_MS), MAX_PROCESSING_TIMEOUT_MS)
}

export function isAllowedVideoFile(file: File): boolean {
  if (file.type && file.type !== 'application/octet-stream') {
    return ALLOWED_MIME_TYPES.includes(file.type)
  }
  const name = file.name.toLowerCase()
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) return false
  return ALLOWED_EXTENSIONS.includes(name.slice(dotIndex))
}
