import { supabase } from '@/lib/supabase'

// --- Types ---

export type UploadPhase =
  | 'file-select'
  | 'metadata'
  | 'bunny-create'
  | 'tus-upload'
  | 'bunny-processing'
  | 'db-save'
  | 'complete'
  | 'error'

export type UploadStatus = 'start' | 'success' | 'fail' | 'retry' | 'info' | 'progress'

export interface UploadLogEntry {
  userId: string
  sessionId: string
  timestamp: string
  phase: UploadPhase
  status: UploadStatus
  durationMs: number | null
  fileSize: number | null
  fileName: string | null
  error: { message: string; stack?: string; code?: string } | null
  networkState: { online: boolean; effectiveType?: string; downlink?: number }
  extra: Record<string, unknown> | null
}

interface PhaseHandle {
  complete(extra?: Record<string, unknown>): void
  fail(error: unknown, extra?: Record<string, unknown>): void
}

// --- Device Info ---

export interface DeviceInfo {
  browser: string
  os: string
  deviceType: string
  isPWA: boolean
}

export function getDeviceInfo(): DeviceInfo {
  const ua = navigator.userAgent

  // Browser detection
  let browser = 'Unknown'
  if (/CriOS\/(\d+)/.test(ua)) {
    browser = `Chrome ${RegExp.$1}` // Chrome on iOS
  } else if (/Chrome\/(\d+)/.test(ua) && !/Edg\//.test(ua)) {
    browser = `Chrome ${RegExp.$1}`
  } else if (/Edg\/(\d+)/.test(ua)) {
    browser = `Edge ${RegExp.$1}`
  } else if (/Version\/(\d+(\.\d+)?).*Safari/.test(ua)) {
    browser = `Safari ${RegExp.$1}`
  } else if (/Firefox\/(\d+)/.test(ua)) {
    browser = `Firefox ${RegExp.$1}`
  }

  // OS detection
  let os = 'Unknown'
  if (/iPhone OS (\d+[_]\d+)/.test(ua)) {
    os = `iOS ${RegExp.$1.replace('_', '.')}`
  } else if (/iPad.*OS (\d+[_]\d+)/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) {
    const m = ua.match(/OS (\d+[_]\d+)/)
    os = m ? `iPadOS ${m[1].replace('_', '.')}` : 'iPadOS'
  } else if (/Android (\d+(\.\d+)?)/.test(ua)) {
    os = `Android ${RegExp.$1}`
  } else if (/Windows NT/.test(ua)) {
    os = 'Windows'
  } else if (/Mac OS X (\d+[._]\d+)/.test(ua)) {
    os = `macOS ${RegExp.$1.replace('_', '.')}`
  } else if (/Linux/.test(ua)) {
    os = 'Linux'
  }

  // Device type
  let deviceType = 'desktop'
  if (/Mobi|Android.*Mobile|iPhone/.test(ua)) {
    deviceType = 'mobile'
  } else if (/iPad|Android(?!.*Mobile)|Tablet/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) {
    deviceType = 'tablet'
  }

  // PWA detection
  const isPWA =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true

  return { browser, os, deviceType, isPWA }
}

// --- Constants ---

const MAX_SESSIONS = 50
const STORAGE_PREFIX = 'fit-proof:upload-logs:'

// --- Helpers ---

function getNetworkState(): UploadLogEntry['networkState'] {
  const conn = (navigator as any).connection
  return {
    online: navigator.onLine,
    effectiveType: conn?.effectiveType,
    downlink: conn?.downlink,
  }
}

function serializeError(err: unknown): UploadLogEntry['error'] {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack, code: (err as any).code }
  }
  return { message: String(err) }
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`
}

// --- UploadLogger Class ---

export class UploadLogger {
  readonly sessionId: string
  private userId: string
  private fileSize: number | null
  private fileName: string | null
  private entries: UploadLogEntry[] = []
  private lastFlushedCount = 0

  constructor(userId: string, fileName?: string, fileSize?: number) {
    this.userId = userId
    this.sessionId = crypto.randomUUID()
    this.fileName = fileName ?? null
    this.fileSize = fileSize ?? null
  }

  /** Start a phase and get a handle to complete/fail it */
  startPhase(phase: UploadPhase): PhaseHandle {
    const startTime = performance.now()

    const entry: UploadLogEntry = {
      userId: this.userId,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      phase,
      status: 'start',
      durationMs: null,
      fileSize: this.fileSize,
      fileName: this.fileName,
      error: null,
      networkState: getNetworkState(),
      extra: null,
    }

    // Persist start entry to localStorage (evidence that phase began)
    this.entries.push(entry)
    this.persistToLocalStorage()
    console.log(`[upload][${phase}][start]`, { sessionId: this.sessionId })

    return {
      complete: (extra?: Record<string, unknown>) => {
        const durationMs = Math.round(performance.now() - startTime)
        const completeEntry: UploadLogEntry = {
          ...entry,
          timestamp: new Date().toISOString(),
          status: 'success',
          durationMs,
          extra: extra ?? null,
          networkState: getNetworkState(),
        }
        this.entries.push(completeEntry)
        this.persistToLocalStorage()
        console.log(`[upload][${phase}][success]`, { durationMs, ...extra })
      },
      fail: (error: unknown, extra?: Record<string, unknown>) => {
        const durationMs = Math.round(performance.now() - startTime)
        const failEntry: UploadLogEntry = {
          ...entry,
          timestamp: new Date().toISOString(),
          status: 'fail',
          durationMs,
          error: serializeError(error),
          extra: extra ?? null,
          networkState: getNetworkState(),
        }
        this.entries.push(failEntry)
        this.persistToLocalStorage()
        console.log(`[upload][${phase}][fail]`, { durationMs, error })
      },
    }
  }

  /** Log a retry event for a phase */
  logRetry(phase: UploadPhase, attempt: number, error: unknown) {
    const retryEntry: UploadLogEntry = {
      userId: this.userId,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      phase,
      status: 'retry',
      durationMs: null,
      fileSize: this.fileSize,
      fileName: this.fileName,
      error: serializeError(error),
      networkState: getNetworkState(),
      extra: { attempt },
    }
    this.entries.push(retryEntry)
    this.persistToLocalStorage()
    console.log(`[upload][${phase}][retry]`, { attempt, error })
  }

  /** Log a progress checkpoint for a phase */
  logProgress(phase: UploadPhase, extra: Record<string, unknown>) {
    const progressEntry: UploadLogEntry = {
      userId: this.userId,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      phase,
      status: 'progress',
      durationMs: null,
      fileSize: this.fileSize,
      fileName: this.fileName,
      error: null,
      networkState: getNetworkState(),
      extra,
    }
    this.entries.push(progressEntry)
    this.persistToLocalStorage()
    console.log(`[upload][${phase}][progress]`, extra)
  }

  /** TUSアップロード中のonline/offlineイベントを監視してログに記録する */
  startNetworkMonitor(): () => void {
    const handleOffline = () => {
      this.entries.push({
        userId: this.userId,
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        phase: 'tus-upload',
        status: 'info',
        durationMs: null,
        fileSize: this.fileSize,
        fileName: this.fileName,
        error: null,
        networkState: getNetworkState(),
        extra: { event: 'network-offline' },
      })
      this.persistToLocalStorage()
    }
    const handleOnline = () => {
      this.entries.push({
        userId: this.userId,
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        phase: 'tus-upload',
        status: 'info',
        durationMs: null,
        fileSize: this.fileSize,
        fileName: this.fileName,
        error: null,
        networkState: getNetworkState(),
        extra: { event: 'network-online' },
      })
      this.persistToLocalStorage()
    }
    const handleVisibilityChange = () => {
      this.entries.push({
        userId: this.userId,
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        phase: 'tus-upload',
        status: 'info',
        durationMs: null,
        fileSize: this.fileSize,
        fileName: this.fileName,
        error: null,
        networkState: getNetworkState(),
        extra: { event: `visibility-${document.visibilityState}` },
      })
      this.persistToLocalStorage()
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }

  /** Flush session entries to Supabase (upsert) — 複数回呼び出し可能（watermark方式） */
  async flush(): Promise<void> {
    const currentCount = this.entries.length
    if (currentCount === 0 || currentCount === this.lastFlushedCount) return

    try {
      const { error } = await supabase.from('upload_logs' as any).upsert(
        {
          user_id: this.userId,
          session_id: this.sessionId,
          entries: this.entries.slice(),  // スナップショットを送信
        } as any,
        { onConflict: 'user_id,session_id' }
      )

      if (error) {
        console.error('[upload-logger] Flush to server failed:', error)
        this.markPendingFlush()
        return
      }

      // flush開始時点の件数で更新（flush中に増えた分は次回flushで送信される）
      this.lastFlushedCount = currentCount
      this.removePendingFlag()
    } catch (e) {
      console.error('[upload-logger] Flush network error:', e)
      this.markPendingFlush()
    }
  }

  // --- LocalStorage persistence ---

  private persistToLocalStorage() {
    const key = storageKey(this.userId)
    try {
      const existing = UploadLogger.readLocalEntries(this.userId)
      // Replace or append this session's entries
      const otherSessions = existing.filter((e) => e.sessionId !== this.sessionId)
      const updated = [...otherSessions, ...this.entries]
      // Enforce circular buffer: keep latest MAX_SESSIONS sessions
      const sessionIds = [...new Set(updated.map((e) => e.sessionId))]
      if (sessionIds.length > MAX_SESSIONS) {
        const keepIds = new Set(sessionIds.slice(sessionIds.length - MAX_SESSIONS))
        const trimmed = updated.filter((e) => keepIds.has(e.sessionId))
        localStorage.setItem(key, JSON.stringify(trimmed))
      } else {
        localStorage.setItem(key, JSON.stringify(updated))
      }
    } catch (e) {
      if ((e as DOMException)?.name === 'QuotaExceededError') {
        // Remove oldest session entries and retry
        try {
          const existing = UploadLogger.readLocalEntries(this.userId)
          const sessionIds = [...new Set(existing.map((e) => e.sessionId))]
          if (sessionIds.length > 1) {
            const keepIds = new Set(sessionIds.slice(1))
            const trimmed = existing.filter((e) => keepIds.has(e.sessionId))
            localStorage.setItem(key, JSON.stringify(trimmed))
          }
        } catch {
          // Give up silently
        }
      }
    }
  }

  private markPendingFlush() {
    try {
      const pendingKey = `${storageKey(this.userId)}:pending`
      const pending: string[] = JSON.parse(localStorage.getItem(pendingKey) || '[]')
      if (!pending.includes(this.sessionId)) {
        pending.push(this.sessionId)
        localStorage.setItem(pendingKey, JSON.stringify(pending))
      }
    } catch {
      // Ignore
    }
  }

  private removePendingFlag() {
    try {
      const pendingKey = `${storageKey(this.userId)}:pending`
      const pending: string[] = JSON.parse(localStorage.getItem(pendingKey) || '[]')
      const updated = pending.filter((id) => id !== this.sessionId)
      if (updated.length === 0) {
        localStorage.removeItem(pendingKey)
      } else {
        localStorage.setItem(pendingKey, JSON.stringify(updated))
      }
    } catch {
      // Ignore
    }
  }

  // --- Static methods ---

  /** Read all local log entries for a user */
  static readLocalEntries(userId: string): UploadLogEntry[] {
    try {
      const raw = localStorage.getItem(storageKey(userId))
      return raw ? (JSON.parse(raw) as UploadLogEntry[]) : []
    } catch {
      return []
    }
  }

  /** Get all local logs (all users) — for admin debug */
  static getAllLogs(): UploadLogEntry[] {
    const entries: UploadLogEntry[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(STORAGE_PREFIX) && !key.endsWith(':pending')) {
        try {
          const data = JSON.parse(localStorage.getItem(key) || '[]')
          entries.push(...data)
        } catch {
          // Skip corrupt entries
        }
      }
    }
    return entries
  }

  /** Export all local logs as JSON string */
  static exportAsJSON(): string {
    return JSON.stringify(UploadLogger.getAllLogs(), null, 2)
  }

  /** Clear local logs for a specific user */
  static clear(userId: string) {
    localStorage.removeItem(storageKey(userId))
    localStorage.removeItem(`${storageKey(userId)}:pending`)
  }

  /** Retry flushing pending sessions for a user（一括書き戻し方式） */
  static async retryPendingFlush(userId: string): Promise<void> {
    try {
      const pendingKey = `${storageKey(userId)}:pending`
      const pending: string[] = JSON.parse(localStorage.getItem(pendingKey) || '[]')
      if (pending.length === 0) return

      const allEntries = UploadLogger.readLocalEntries(userId)
      const flushedIds: string[] = []

      for (const sessionId of pending) {
        const sessionEntries = allEntries.filter((e) => e.sessionId === sessionId)
        if (sessionEntries.length === 0) {
          flushedIds.push(sessionId) // entriesが無いpendingも除去
          continue
        }

        try {
          const { error } = await supabase.from('upload_logs' as any).upsert(
            {
              user_id: userId,
              session_id: sessionId,
              entries: sessionEntries,
            } as any,
            { onConflict: 'user_id,session_id' }
          )
          if (!error) flushedIds.push(sessionId)
        } catch {
          // Will retry next time
        }
      }

      // 一括書き戻し
      const remaining = pending.filter((id) => !flushedIds.includes(id))
      if (remaining.length === 0) {
        localStorage.removeItem(pendingKey)
      } else {
        localStorage.setItem(pendingKey, JSON.stringify(remaining))
      }
    } catch {
      // Ignore
    }
  }
}
