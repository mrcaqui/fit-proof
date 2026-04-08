/**
 * Wake Lock API ユーティリティ
 * 無操作による自動画面ロックを防止する（手動ロック・アプリ切替は防げない）
 */

export async function acquireWakeLock(): Promise<() => void> {
  if (!('wakeLock' in navigator)) {
    return () => {}
  }

  let wakeLock: WakeLockSentinel | null = null
  let released = false

  const requestLock = async () => {
    if (released) return
    try {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener('release', () => {
        wakeLock = null
      })
    } catch {
      // Permission denied or other error — no-op
    }
  }

  // Safari は hidden 遷移時に自動解放するため、visible 復帰時に再取得
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && !wakeLock && !released) {
      requestLock()
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)
  await requestLock()

  return () => {
    released = true
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    wakeLock?.release().catch(() => {})
    wakeLock = null
  }
}
