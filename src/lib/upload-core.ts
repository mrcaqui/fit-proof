import * as tus from 'tus-js-client'
import { createBunnyVideo, deleteBunnyVideo, waitForBunnyProcessing, checkBunnyVideoStatus } from '@/lib/bunny'
import { supabase } from '@/lib/supabase'
import { UploadLogger } from '@/lib/upload-logger'
import {
  BUNNY_CREATE_MAX_ATTEMPTS,
  BUNNY_CREATE_RETRY_DELAYS,
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

export interface ExecuteUploadParams {
  file: File
  userId: string
  targetDate: string
  submissionItemId: number | null
  thumbnail: string | null
  duration: number | null
  hash: string | null
  isLate: boolean
  onProgress?: (progress: number) => void
  onPhaseChange?: (phase: 'uploading' | 'verifying' | 'saving') => void
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
    duration,
    hash,
    isLate,
    onProgress,
    onPhaseChange,
  } = params

  const logger = new UploadLogger(userId, file.name, file.size)
  let bunnyVideoId: string | null = null

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
    try {
      await new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(file, {
          endpoint: bunnyResult.tusEndpoint,
          retryDelays: [0, 1000, 3000, 5000],
          headers: {
            AuthorizationSignature: bunnyResult.authorizationSignature,
            AuthorizationExpire: String(bunnyResult.authorizationExpire),
            VideoId: bunnyResult.videoId,
            LibraryId: bunnyResult.libraryId,
          },
          metadata: { filetype: file.type, title: file.name },
          removeFingerprintOnSuccess: true,
          onError: (error) => reject(error),
          onProgress: (bytesUploaded, bytesTotal) => {
            onProgress?.(Math.round((bytesUploaded / bytesTotal) * 100))
          },
          onSuccess: () => resolve(),
        })
        upload
          .findPreviousUploads()
          .then((prev) => {
            if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0])
            upload.start()
          })
          .catch(() => upload.start())
      })
      tusPhase.complete()
    } catch (err) {
      tusPhase.fail(err)
      throw new UploadError(
        `TUS upload failed: ${err}`,
        'tus-upload',
        true,
        '動画のアップロード中にエラーが発生しました。ネットワーク接続を確認して再度お試しください。',
      )
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

    // Flush logs to server (fire-and-forget)
    logger.flush().catch(() => {})

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

    // Flush logs to server (fire-and-forget)
    logger.flush().catch(() => {})

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
}): Promise<void> {
  const { videoId, userId, targetDate, submissionItemId, file, thumbnail, duration, hash, isLate } =
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
    } as any)

    if (dbError) throw dbError
  }
}
