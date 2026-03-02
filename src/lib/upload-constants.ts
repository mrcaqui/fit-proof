export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024

export const HASH_THRESHOLD = 100 * 1024 * 1024

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

export function isAllowedVideoFile(file: File): boolean {
  if (file.type && file.type !== 'application/octet-stream') {
    return ALLOWED_MIME_TYPES.includes(file.type)
  }
  const name = file.name.toLowerCase()
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) return false
  return ALLOWED_EXTENSIONS.includes(name.slice(dotIndex))
}
