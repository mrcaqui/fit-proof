/**
 * Wake Lock API ユーティリティ
 * 無操作による自動画面ロックを防止する（手動ロック・アプリ切替は防げない）
 */

import { WAKELOCK_TIMEOUT_MS } from '@/lib/upload-constants'

export interface WakeLockHandle {
  release: () => void
  acquired: boolean
  elapsedMs: number
  timedOut: boolean
}

export async function acquireWakeLock(options?: { timeoutMs?: number }): Promise<WakeLockHandle> {
  const timeoutMs = options?.timeoutMs ?? WAKELOCK_TIMEOUT_MS
  const startedAt = performance.now()

  let wakeLock: WakeLockSentinel | null = null
  let released = false

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && !wakeLock && !released) {
      // Safari は hidden 遷移時に自動解放するため、visible 復帰時に再取得
      requestLock().catch(() => {})
    }
  }

  const release = () => {
    if (released) return
    released = true
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    wakeLock?.release().catch(() => {})
    wakeLock = null
  }

  const requestLock = async (): Promise<boolean> => {
    if (released) return false
    try {
      const lock = await navigator.wakeLock.request('screen')
      // タイムアウト後に遅れて resolve された場合は即座に release
      if (released) {
        lock.release().catch(() => {})
        return false
      }
      wakeLock = lock
      wakeLock.addEventListener('release', () => {
        wakeLock = null
      })
      return true
    } catch {
      return false
    }
  }

  if (!('wakeLock' in navigator)) {
    return {
      release: () => {},
      acquired: false,
      elapsedMs: 0,
      timedOut: false,
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)

  let timedOut = false
  const timeoutPromise = new Promise<false>((resolve) => {
    setTimeout(() => {
      timedOut = true
      resolve(false)
    }, timeoutMs)
  })

  const acquired = await Promise.race([requestLock(), timeoutPromise])
  const elapsedMs = Math.round(performance.now() - startedAt)

  return {
    release,
    acquired: acquired === true,
    elapsedMs,
    timedOut,
  }
}
