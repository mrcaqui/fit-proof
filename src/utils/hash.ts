import { sha256 } from 'js-sha256'

export async function calculateFileHash(file: File, signal?: AbortSignal): Promise<string | null> {
  try {
    const hash = sha256.create()
    const reader = file.stream().getReader()

    // abort時にreader.read()の待機中でも即座にストリームを閉じる
    const onAbort = () => reader.cancel().catch(() => {})
    signal?.addEventListener('abort', onAbort)

    try {
      while (true) {
        if (signal?.aborted) return null
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
      }
      return hash.hex()
    } finally {
      signal?.removeEventListener('abort', onAbort)
      reader.cancel().catch(() => {})
    }
  } catch (err) {
    if (signal?.aborted) return null
    console.error('Hash calculation failed:', err)
    return null
  }
}
