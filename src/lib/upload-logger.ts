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

export type UploadStatus = 'start' | 'success' | 'fail' | 'retry'

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
  private flushed = false

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

    // Log start to console only (not persisted to localStorage)
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

  /** Flush session entries to Supabase (upsert) */
  async flush(): Promise<void> {
    if (this.entries.length === 0 || this.flushed) return

    try {
      const { error } = await supabase.from('upload_logs' as any).upsert(
        {
          user_id: this.userId,
          session_id: this.sessionId,
          entries: this.entries,
        } as any,
        { onConflict: 'user_id,session_id' }
      )

      if (error) {
        console.error('[upload-logger] Flush to server failed:', error)
        this.markPendingFlush()
        return
      }

      this.flushed = true
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

  /** Retry flushing pending sessions for a user */
  static async retryPendingFlush(userId: string): Promise<void> {
    try {
      const pendingKey = `${storageKey(userId)}:pending`
      const pending: string[] = JSON.parse(localStorage.getItem(pendingKey) || '[]')
      if (pending.length === 0) return

      const allEntries = UploadLogger.readLocalEntries(userId)

      for (const sessionId of pending) {
        const sessionEntries = allEntries.filter((e) => e.sessionId === sessionId)
        if (sessionEntries.length === 0) continue

        try {
          const { error } = await supabase.from('upload_logs' as any).upsert(
            {
              user_id: userId,
              session_id: sessionId,
              entries: sessionEntries,
            } as any,
            { onConflict: 'user_id,session_id' }
          )

          if (!error) {
            const updated = pending.filter((id) => id !== sessionId)
            if (updated.length === 0) {
              localStorage.removeItem(pendingKey)
            } else {
              localStorage.setItem(pendingKey, JSON.stringify(updated))
            }
          }
        } catch {
          // Will retry next time
        }
      }
    } catch {
      // Ignore
    }
  }
}
