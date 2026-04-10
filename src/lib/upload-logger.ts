import { supabase } from '@/lib/supabase'
import { sendLogsOnUnload } from '@/lib/upload-beacon'

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
const AUTO_FLUSH_INTERVAL_MS = 2_000

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
  private lastAutoFlushAt = 0
  private flushInFlight: Promise<void> | null = null
  private nextPending: { finalRequested: boolean; promise: Promise<void> } | null = null
  private beaconCleanup: (() => void) | null = null
  private beaconSent = false

  constructor(userId: string, fileName?: string, fileSize?: number) {
    this.userId = userId
    this.sessionId = crypto.randomUUID()
    this.fileName = fileName ?? null
    this.fileSize = fileSize ?? null
  }

  /** 任意エントリを追加し、pendingフラグと自動flushをスケジュール */
  private recordEntry(entry: UploadLogEntry) {
    this.entries.push(entry)
    this.persistToLocalStorage()
    this.markPendingFlush()
    this.scheduleAutoFlush()
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

    this.recordEntry(entry)
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
        this.recordEntry(completeEntry)
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
        this.recordEntry(failEntry)
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
    this.recordEntry(retryEntry)
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
    this.recordEntry(progressEntry)
    console.log(`[upload][${phase}][progress]`, extra)
  }

  /** info チェックポイントをログに記録する */
  logInfo(phase: UploadPhase, event: string, extra?: Record<string, unknown>) {
    const infoEntry: UploadLogEntry = {
      userId: this.userId,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      phase,
      status: 'info',
      durationMs: null,
      fileSize: this.fileSize,
      fileName: this.fileName,
      error: null,
      networkState: getNetworkState(),
      extra: { event, ...(extra ?? {}) },
    }
    this.recordEntry(infoEntry)
    console.log(`[upload][${phase}][info]`, { event, ...extra })
  }

  /** TUSアップロード中のonline/offlineイベントを監視してログに記録する */
  startNetworkMonitor(): () => void {
    const handleOffline = () => {
      this.logInfo('tus-upload', 'network-offline')
    }
    const handleOnline = () => {
      this.logInfo('tus-upload', 'network-online')
    }
    const handleVisibilityChange = () => {
      this.logInfo('tus-upload', `visibility-${document.visibilityState}`)
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

  /**
   * pagehide / visibilitychange=hidden 時に最新エントリを fetch keepalive で送信する
   * @param getAccessToken pagehide 時点で同期的に最新 token を取得するためのコールバック
   */
  installUnloadBeacon(getAccessToken: () => string | null): void {
    if (this.beaconCleanup) return

    const sendOnce = () => {
      if (this.beaconSent) return
      const token = getAccessToken()
      if (!token) return
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
      if (!supabaseUrl || !anonKey) return
      const ok = sendLogsOnUnload({
        supabaseUrl,
        anonKey,
        accessToken: token,
        userId: this.userId,
        sessionId: this.sessionId,
        entries: this.entries.slice(),
      })
      if (ok) this.beaconSent = true
    }

    const handlePageHide = () => sendOnce()
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') sendOnce()
    }

    window.addEventListener('pagehide', handlePageHide)
    document.addEventListener('visibilitychange', handleVisibility)

    this.beaconCleanup = () => {
      window.removeEventListener('pagehide', handlePageHide)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }

  uninstallUnloadBeacon(): void {
    this.beaconCleanup?.()
    this.beaconCleanup = null
  }

  /**
   * 直列化された flush。進行中があれば待機し、final 要求は batch 内で OR 集約する。
   */
  async flush(options?: { final?: boolean }): Promise<void> {
    const wantFinal = options?.final === true

    if (this.flushInFlight) {
      if (!this.nextPending) {
        const batch = {
          finalRequested: wantFinal,
          promise: null as unknown as Promise<void>,
        }
        batch.promise = this.flushInFlight.then(async () => {
          // batch を取り出してから次の flush を走らせる。
          // 参照を外すことで、次の flush 中に来る caller が新しい batch を作れる。
          this.nextPending = null
          await this._runFlush({ final: batch.finalRequested })
        })
        this.nextPending = batch
      } else {
        this.nextPending.finalRequested = this.nextPending.finalRequested || wantFinal
      }
      return this.nextPending.promise
    }

    return this._runFlush({ final: wantFinal })
  }

  private _runFlush(options: { final: boolean }): Promise<void> {
    const p = this._doFlush(options).finally(() => {
      if (this.flushInFlight === p) this.flushInFlight = null
    })
    this.flushInFlight = p
    return p
  }

  private async _doFlush(options: { final: boolean }): Promise<void> {
    const currentCount = this.entries.length
    const hasNewEntries = currentCount > 0 && currentCount !== this.lastFlushedCount
    let sendOk = true

    if (hasNewEntries) {
      try {
        const { error } = await supabase.from('upload_logs' as any).upsert(
          {
            user_id: this.userId,
            session_id: this.sessionId,
            entries: this.entries.slice(),
          } as any,
          { onConflict: 'user_id,session_id' }
        )

        if (error) {
          console.error('[upload-logger] Flush to server failed:', error)
          this.markPendingFlush()
          sendOk = false
        } else {
          this.lastFlushedCount = currentCount
        }
      } catch (e) {
        console.error('[upload-logger] Flush network error:', e)
        this.markPendingFlush()
        sendOk = false
      }
    }

    this.lastAutoFlushAt = Date.now()

    // final 呼び出し時のみ pending 除外を評価 (送信不要 or 送信成功の場合のみ)
    if (options.final && sendOk) {
      this.removePendingFlag()
    }
  }

  /** 2秒節流で自動 flush を走らせる (fire-and-forget) */
  private scheduleAutoFlush() {
    const now = Date.now()
    if (now - this.lastAutoFlushAt < AUTO_FLUSH_INTERVAL_MS) return
    // 進行中 flush がある場合は直列化により内部で待機される
    this.flush().catch(() => {})
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
