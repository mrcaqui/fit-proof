import { sha256 } from 'js-sha256'

export async function calculateFileHash(file: File): Promise<string | null> {
  try {
    const hash = sha256.create()
    const reader = file.stream().getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
    }
    return hash.hex()
  } catch (err) {
    console.error('Hash calculation failed:', err)
    return null
  }
}
