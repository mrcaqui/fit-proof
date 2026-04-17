import * as tus from 'tus-js-client'
import { createBunnyVideo, deleteBunnyVideo, waitForBunnyProcessing, checkBunnyVideoStatus } from '@/lib/bunny'
import { supabase } from '@/lib/supabase'
import { UploadLogger, getDeviceInfo, isIOS } from '@/lib/upload-logger'
import { acquireWakeLock } from '@/lib/upload-wakelock'
import {
  BUNNY_CREATE_MAX_ATTEMPTS,
  BUNNY_CREATE_RETRY_DELAYS,
  LARGE_FILE_CHUNK_SHRINK_THRESHOLD_BYTES,
  TUS_CHUNK_SIZE,
  TUS_CHUNK_SIZE_IOS_LARGE,
  TUS_INITIAL_PROGRESS_TIMEOUT_MS,
  TUS_STALLED_WARN_MS,
  getProcessingTimeout,
} from '@/lib/upload-constants'

// --- UploadError ---

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly phase: string,
    public readonly isRetryable: boolean,
    public readonly userMessage: string,
    public readonly isUncertain: boolean = false,
    public readonly pendingVideoId?: string,
  ) {
    super(message)
    this.name = 'UploadError'
  }
}

// --- retryAsync ---

interface RetryOptions {
  maxAttempts: number
  delays: number[]
  shouldRetry?: (error: unknown) => boolean
}

async function retryAsync<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  logger?: UploadLogger,
  phase?: string,
): Promise<T> {
  const { maxAttempts, delays, shouldRetry } = options
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt >= maxAttempts) break
      if (shouldRetry && !shouldRetry(err)) break

      const delay = delays[attempt - 1] ?? delays[delays.length - 1]
      if (logger && phase) {
        logger.logRetry(phase as any, attempt, err)
      }
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError
}

// --- executeUpload ---

export type UploadStage =
  | 'preparing-video'
  | 'preparing-wakelock'
  | 'preparing-tus'
  | 'uploading'
  | 'stalled'

export type ThumbnailStrategy = 'downscaled' | 'skipped' | 'failed'

export interface ExecuteUploadParams {
  file: File
  userId: string
  targetDate: string
  submissionItemId: number | null
  thumbnail: string | null
  thumbnailStrategy: ThumbnailStrategy
  duration: number | null
  hash: string | null
  isLate: boolean
  fileLastModified: string | null
  onProgress?: (progress: number) => void
  onPhaseChange?: (phase: 'uploading' | 'verifying' | 'saving') => void
  onStageChange?: (stage: UploadStage) => void
}

export interface ExecuteUploadResult {
  success: true
}

export async function executeUpload(params: ExecuteUploadParams): Promise<ExecuteUploadResult> {
  const {
    file,
    userId,
    targetDate,
    submissionItemId,
    thumbnail,
    thumbnailStrategy,
    duration,
    hash,
    isLate,
    fileLastModified,
    onProgress,
    onPhaseChange,
    onStageChange,
  } = params

  const logger = new UploadLogger(userId, file.name, file.size)
  let bunnyVideoId: string | null = null

  // file-select フェーズ: バージョン・デバイス情報を記録（online check より前）
  const selectPhase = logger.startPhase('file-select')
  selectPhase.complete({
    appVersion: __APP_VERSION__,
    device: getDeviceInfo(),
    fileType: file.type,
    fileSize: file.size,
  })

  // 前回失敗したflushをリトライ（fire-and-forget）
  UploadLogger.retryPendingFlush(userId).catch(() => {})

  try {
    // 1. Online check
    if (!navigator.onLine) {
      throw new UploadError(
        'Device is offline',
        'online-check',
        false,
        'インターネット接続を確認してください。',
      )
    }

    // 2. Check existing record
    const metaPhase = logger.startPhase('metadata')
    const { data: existing } = await supabase
      .from('submissions')
      .select('id, bunny_video_id')
      .match({
        user_id: userId,
        target_date: targetDate,
        submission_item_id: submissionItemId,
      }) as { data: { id: number; bunny_video_id: string | null }[] | null }
    metaPhase.complete({ existingCount: existing?.length ?? 0 })

    // 3. Create Bunny video (with retry)
    onPhaseChange?.('uploading')
    onStageChange?.('preparing-video')
    const bunnyPhase = logger.startPhase('bunny-create')
    let bunnyResult: Awaited<ReturnType<typeof createBunnyVideo>>
    try {
      bunnyResult = await retryAsync(
        () => createBunnyVideo(file.name),
        {
          maxAttempts: BUNNY_CREATE_MAX_ATTEMPTS,
          delays: BUNNY_CREATE_RETRY_DELAYS,
        },
        logger,
        'bunny-create',
      )
      bunnyVideoId = bunnyResult.videoId
      bunnyPhase.complete({ videoId: bunnyResult.videoId })
      // 早期flush: TUS失敗しても「アップロード試行あり」の証拠をサーバーに残す (non-final)
      logger.flush().catch(() => {})
    } catch (err) {
      bunnyPhase.fail(err)
      throw new UploadError(
        `Bunny create failed: ${err}`,
        'bunny-create',
        true,
        '動画の準備に失敗しました。再度お試しください。',
      )
    }

    // 4. TUS upload
    const tusPhase = logger.startPhase('tus-upload')
    const stopNetworkMonitor = logger.startNetworkMonitor()

    // Token キャッシュ + refresh 追跡 (unload beacon 用)
    const { data: { session: initialSession } } = await supabase.auth.getSession()
    let currentAccessToken: string | null = initialSession?.access_token ?? null
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((_event, session) => {
      currentAccessToken = session?.access_token ?? null
    })
    logger.installUnloadBeacon(() => currentAccessToken)

    onStageChange?.('preparing-wakelock')
    logger.logInfo('tus-upload', 'wakelock-acquire-start')
    const wl = await acquireWakeLock()
    logger.logInfo('tus-upload', 'wakelock-acquire-done', {
      acquired: wl.acquired,
      elapsedMs: wl.elapsedMs,
      timedOut: wl.timedOut,
    })
    const releaseWakeLock = wl.release
    onStageChange?.('preparing-tus')
    try {
      let tusRetryCount = 0
      let lastLoggedPercent = -10
      let lastLoggedTime = Date.now()
      let firstProgressReceived = false
      const tusStartTime = Date.now()
      let initialProgressTimeout: ReturnType<typeof setTimeout> | null = null
      let stalledWarnTimeout: ReturnType<typeof setTimeout> | null = null
      let stalledSignaled = false
      let lastUiProgressAt = 0
      let resumeOffsetBytes = 0
      let lastCheckpointSessionChunk = -1

      // iOS + 大容量で chunkSize を縮小する safeMode
      const useIOSLargeSafeMode =
        isIOS() && file.size >= LARGE_FILE_CHUNK_SHRINK_THRESHOLD_BYTES
      const effectiveChunkSize = useIOSLargeSafeMode
        ? TUS_CHUNK_SIZE_IOS_LARGE
        : TUS_CHUNK_SIZE
      const safeMode: 'ios-large-file' | 'normal' = useIOSLargeSafeMode
        ? 'ios-large-file'
        : 'normal'

      const clearInitialTimers = () => {
        if (initialProgressTimeout) {
          clearTimeout(initialProgressTimeout)
          initialProgressTimeout = null
        }
        if (stalledWarnTimeout) {
          clearTimeout(stalledWarnTimeout)
          stalledWarnTimeout = null
        }
      }

      await new Promise<void>((resolve, reject) => {
        logger.logInfo('tus-upload', 'tus-construct-start', {
          chunkSize: effectiveChunkSize,
          fileSize: file.size,
          safeMode,
          thumbnailStrategy,
        })
        const upload = new tus.Upload(file, {
          endpoint: bunnyResult.tusEndpoint,
          chunkSize: effectiveChunkSize,
          retryDelays: [0, 1000, 3000, 5000],
          headers: {
            AuthorizationSignature: bunnyResult.authorizationSignature,
            AuthorizationExpire: String(bunnyResult.authorizationExpire),
            VideoId: bunnyResult.videoId,
            LibraryId: bunnyResult.libraryId,
          },
          metadata: { filetype: file.type, title: file.name },
          removeFingerprintOnSuccess: true,
          onShouldRetry: (error, _retryAttempt, _options) => {
            // 既定判定を再現：4xx（409/423除く）はリトライしない、オフライン時もしない
            // ⚠️ tus-js-client v4.x の defaultOnShouldRetry 準拠 — ライブラリ更新時に要確認
            const status = (error as any).originalResponse
              ? (error as any).originalResponse.getStatus()
              : 0
            const is4xx = status >= 400 && status < 500
            const isRetryable4xx = status === 409 || status === 423
            if (is4xx && !isRetryable4xx) return false
            if (!navigator.onLine) return false

            // リトライする場合のみカウント・ログ記録
            tusRetryCount++
            logger.logRetry('tus-upload', tusRetryCount, error)
            return true
          },
          onError: (error) => {
            clearInitialTimers()
            reject(error)
          },
          onProgress: (bytesUploaded, bytesTotal) => {
            const percent = Math.round((bytesUploaded / bytesTotal) * 100)
            const now = Date.now()

            if (!firstProgressReceived) {
              firstProgressReceived = true
              clearInitialTimers()
              // tus-js-client v4 は HEAD 成功直後に _emitProgress(offset, size) を発火するため、
              // 多くの場合この値は resume offset の厳密値と一致する（best-effort 近似）。
              resumeOffsetBytes = bytesUploaded
              logger.logInfo('tus-upload', 'first-progress', {
                bytesUploaded,
                resumeOffsetBytes,
                elapsedMs: now - tusStartTime,
              })
              if (stalledSignaled) {
                onStageChange?.('uploading')
                stalledSignaled = false
              } else {
                onStageChange?.('uploading')
              }
            }

            // 250ms throttle: iOS Safari の React state 更新頻度を抑える
            if (now - lastUiProgressAt >= 250) {
              lastUiProgressAt = now
              onProgress?.(percent)
            }

            // Throttled progress log: every 10% or 30 seconds
            if (percent - lastLoggedPercent >= 10 || now - lastLoggedTime >= 30_000) {
              logger.logProgress('tus-upload', {
                event: 'tus-progress',
                percent,
                bytesUploaded,
                bytesTotal,
              })
              lastLoggedPercent = percent
              lastLoggedTime = now
            }

            // chunk-checkpoint: 10 チャンク境界で session/絶対両軸を記録
            const sessionPatchBytes = Math.max(0, bytesUploaded - resumeOffsetBytes)
            const sessionChunkIndex = Math.floor(sessionPatchBytes / effectiveChunkSize)
            if (
              sessionChunkIndex > 0 &&
              sessionChunkIndex % 10 === 0 &&
              sessionChunkIndex !== lastCheckpointSessionChunk
            ) {
              lastCheckpointSessionChunk = sessionChunkIndex
              logger.logInfo('tus-upload', 'chunk-checkpoint', {
                sessionChunkIndex,
                sessionPatchBytes,
                resumeOffsetBytes,
                bytesUploaded,
                absoluteChunkIndex: Math.floor(bytesUploaded / effectiveChunkSize),
                percent,
                elapsedMs: now - tusStartTime,
              })
            }
          },
          onSuccess: () => {
            clearInitialTimers()
            resolve()
          },
        })
        logger.logInfo('tus-upload', 'tus-construct-done')

        logger.logInfo('tus-upload', 'find-previous-start')
        upload
          .findPreviousUploads()
          .then((prev) => {
            logger.logInfo('tus-upload', 'find-previous-done', { count: prev.length })
            if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0])
            upload.start()
            logger.logInfo('tus-upload', 'upload-start-called')
          })
          .catch((err) => {
            logger.logInfo('tus-upload', 'find-previous-fail', { error: String(err) })
            upload.start()
            logger.logInfo('tus-upload', 'upload-start-called')
          })

        // 初動 30 秒タイムアウト
        initialProgressTimeout = setTimeout(() => {
          if (firstProgressReceived) return
          logger.logInfo('tus-upload', 'no-progress-timeout', {
            elapsedMs: TUS_INITIAL_PROGRESS_TIMEOUT_MS,
          })
          upload.abort().catch(() => {})
          reject(new Error('TUS upload stalled: no progress in 30s'))
        }, TUS_INITIAL_PROGRESS_TIMEOUT_MS)

        // 10 秒 stalled 警告
        stalledWarnTimeout = setTimeout(() => {
          if (firstProgressReceived) return
          stalledSignaled = true
          onStageChange?.('stalled')
        }, TUS_STALLED_WARN_MS)
      })
      tusPhase.complete({ tusRetries: tusRetryCount })
    } catch (err) {
      tusPhase.fail(err)
      throw new UploadError(
        `TUS upload failed: ${err}`,
        'tus-upload',
        true,
        '動画のアップロード中にエラーが発生しました。ネットワーク接続を確認して再度お試しください。',
      )
    } finally {
      stopNetworkMonitor()
      releaseWakeLock()
      logger.uninstallUnloadBeacon()
      authSub.unsubscribe()
    }

    // 5. Wait for Bunny processing (file-size-dependent timeout)
    onProgress?.(100)
    onPhaseChange?.('verifying')
    const procPhase = logger.startPhase('bunny-processing')
    const timeoutMs = getProcessingTimeout(file.size)

    const processingResult = await waitForBunnyProcessing(bunnyResult.videoId, {
      intervalMs: 2500,
      timeoutMs,
    })

    if (!processingResult.success) {
      procPhase.fail(new Error(`Processing status: ${processingResult.status}`), {
        status: processingResult.status,
      })

      if (processingResult.status === -1) {
        // Uncertain state — don't delete, might still be processing
        throw new UploadError(
          'Processing timeout (status -1)',
          'bunny-processing',
          false,
          '動画の処理確認がタイムアウトしました。動画は処理中の可能性があります。',
          true, // isUncertain
          bunnyResult.videoId,
        )
      }

      // Definite failure — clean up
      await deleteBunnyVideo(bunnyResult.videoId).catch((e) =>
        console.error('Bunny cleanup after processing failure:', e),
      )
      bunnyVideoId = null

      if (processingResult.status === 5 || processingResult.status === 6) {
        throw new UploadError(
          `Bunny processing failed (status ${processingResult.status})`,
          'bunny-processing',
          true,
          'CDN側でエラーが発生しました。再度お試しください。',
        )
      }

      throw new UploadError(
        `Processing timeout (status ${processingResult.status})`,
        'bunny-processing',
        true,
        'アップロードの確認がタイムアウトしました。再度お試しください。',
      )
    }
    procPhase.complete({ status: processingResult.status })

    // 6. DB save
    onPhaseChange?.('saving')
    const dbPhase = logger.startPhase('db-save')
    try {
      if (existing && existing.length > 0) {
        const { data: rpcData, error: rpcError } = await supabase.rpc('replace_submissions', {
          p_user_id: userId,
          p_target_date: targetDate,
          p_submission_item_id: submissionItemId,
          p_bunny_video_id: bunnyResult.videoId,
          p_video_size: file.size,
          p_video_hash: hash,
          p_duration: duration ? Math.round(duration) : null,
          p_thumbnail_url: thumbnail || null,
          p_file_name: file.name,
          p_is_late: isLate,
          p_file_last_modified: fileLastModified ?? undefined,
        })

        if (rpcError) throw rpcError

        // Clean up old videos (best-effort)
        if (rpcData?.[0]?.old_bunny_video_ids) {
          for (const oldId of rpcData[0].old_bunny_video_ids) {
            await deleteBunnyVideo(oldId).catch((e) =>
              console.error('Old video cleanup failed:', e),
            )
          }
        }
      } else {
        const { error: dbError } = await supabase.from('submissions').insert({
          user_id: userId,
          type: 'video' as const,
          bunny_video_id: bunnyResult.videoId,
          thumbnail_url: thumbnail || null,
          status: null,
          target_date: targetDate,
          submission_item_id: submissionItemId,
          file_name: file.name,
          duration: duration ? Math.round(duration) : null,
          is_late: isLate,
          video_size: file.size,
          video_hash: hash,
          file_last_modified: fileLastModified,
        } as any)

        if (dbError) throw dbError
      }
      dbPhase.complete()
    } catch (err) {
      dbPhase.fail(err)
      // Clean up Bunny video on DB failure
      await deleteBunnyVideo(bunnyResult.videoId).catch((e) =>
        console.error('Bunny cleanup failed:', e),
      )
      bunnyVideoId = null
      throw new UploadError(
        `DB save failed: ${err}`,
        'db-save',
        true,
        'データの保存に失敗しました。再度お試しください。',
      )
    }

    // 7. Complete
    const completePhase = logger.startPhase('complete')
    completePhase.complete()

    // Flush logs to server (final — pending 削除を確定させる)
    await logger.flush({ final: true }).catch(() => {})

    return { success: true }
  } catch (err) {
    // If not already an UploadError, wrap it
    if (!(err instanceof UploadError)) {
      const errorPhase = logger.startPhase('error')
      errorPhase.fail(err)

      // Clean up Bunny video if needed
      if (bunnyVideoId) {
        await deleteBunnyVideo(bunnyVideoId).catch((e) =>
          console.error('Bunny cleanup failed:', e),
        )
      }
    } else if (err.isUncertain) {
      // For uncertain errors, don't clean up — just log
      const errorPhase = logger.startPhase('error')
      errorPhase.fail(err, { uncertain: true, pendingVideoId: err.pendingVideoId })
    } else if (bunnyVideoId && !err.pendingVideoId) {
      // Clean up Bunny video for non-uncertain errors
      await deleteBunnyVideo(bunnyVideoId).catch((e) =>
        console.error('Bunny cleanup failed:', e),
      )
    }

    // Flush logs to server (final — エラーハンドリング完了)
    await logger.flush({ final: true }).catch(() => {})

    if (err instanceof UploadError) throw err

    throw new UploadError(
      `Upload failed: ${err}`,
      'unknown',
      false,
      'アップロードに失敗しました。',
    )
  }
}

// --- recheckVideoStatus (for uncertain state) ---

export interface RecheckResult {
  /** 'ready' = DB save can continue, 'failed' = re-upload needed, 'still-processing' = wait more */
  outcome: 'ready' | 'failed' | 'still-processing'
  status: number | null
}

export async function recheckVideoStatus(videoId: string): Promise<RecheckResult> {
  const status = await checkBunnyVideoStatus(videoId)

  if (status === null || status === 0 || status === 1) {
    return { outcome: 'still-processing', status }
  }
  if (status >= 2 && status <= 4) {
    return { outcome: 'ready', status }
  }
  if (status === 5 || status === 6) {
    // Confirmed failure — clean up
    await deleteBunnyVideo(videoId).catch((e) =>
      console.error('Bunny cleanup after confirmed failure:', e),
    )
    return { outcome: 'failed', status }
  }
  return { outcome: 'still-processing', status }
}

/** Continue DB save after recheck confirms video is ready */
export async function continueAfterRecheck(params: {
  videoId: string
  userId: string
  targetDate: string
  submissionItemId: number | null
  file: File
  thumbnail: string | null
  duration: number | null
  hash: string | null
  isLate: boolean
  fileLastModified: string | null
}): Promise<void> {
  const { videoId, userId, targetDate, submissionItemId, file, thumbnail, duration, hash, isLate, fileLastModified } =
    params

  const { data: existing } = await supabase
    .from('submissions')
    .select('id, bunny_video_id')
    .match({
      user_id: userId,
      target_date: targetDate,
      submission_item_id: submissionItemId,
    }) as { data: { id: number; bunny_video_id: string | null }[] | null }

  if (existing && existing.length > 0) {
    const { data: rpcData, error: rpcError } = await supabase.rpc('replace_submissions', {
      p_user_id: userId,
      p_target_date: targetDate,
      p_submission_item_id: submissionItemId,
      p_bunny_video_id: videoId,
      p_video_size: file.size,
      p_video_hash: hash,
      p_duration: duration ? Math.round(duration) : null,
      p_thumbnail_url: thumbnail || null,
      p_file_name: file.name,
      p_is_late: isLate,
      p_file_last_modified: fileLastModified ?? undefined,
    })

    if (rpcError) throw rpcError

    if (rpcData?.[0]?.old_bunny_video_ids) {
      for (const oldId of rpcData[0].old_bunny_video_ids) {
        await deleteBunnyVideo(oldId).catch((e) => console.error('Old video cleanup failed:', e))
      }
    }
  } else {
    const { error: dbError } = await supabase.from('submissions').insert({
      user_id: userId,
      type: 'video' as const,
      bunny_video_id: videoId,
      thumbnail_url: thumbnail || null,
      status: null,
      target_date: targetDate,
      submission_item_id: submissionItemId,
      file_name: file.name,
      duration: duration ? Math.round(duration) : null,
      is_late: isLate,
      video_size: file.size,
      video_hash: hash,
      file_last_modified: fileLastModified,
    } as any)

    if (dbError) throw dbError
  }
}
