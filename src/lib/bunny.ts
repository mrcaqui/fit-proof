import { supabase } from '@/lib/supabase'

export interface BunnyUploadCredentials {
    videoId: string
    libraryId: string
    tusEndpoint: string
    authorizationSignature: string
    authorizationExpire: number
}

/**
 * Edge Function 呼び出し → Bunny にビデオ作成 + TUS 認証情報取得
 */
export async function createBunnyVideo(title: string): Promise<BunnyUploadCredentials> {
    const { data, error } = await supabase.functions.invoke('bunny-create-video', {
        body: { title },
    })

    if (error) {
        throw new Error(`Bunny video creation failed: ${error.message}`)
    }

    return data as BunnyUploadCredentials
}

/**
 * Bunny CDN の再生 URL を構築
 */
export function getBunnyVideoUrl(videoId: string): string {
    const hostname = import.meta.env.VITE_BUNNY_CDN_HOSTNAME
    if (!hostname) {
        console.error('[bunny] VITE_BUNNY_CDN_HOSTNAME is not set. Video playback will fail.')
    }
    return `https://${hostname}/${videoId}/playlist.m3u8`
}

/**
 * Bunny API 経由で動画を削除（Edge Function 経由）
 * API キーをクライアントに露出させないため、必ずサーバー側で処理する
 */
export async function deleteBunnyVideo(videoId: string): Promise<void> {
    const { error } = await supabase.functions.invoke('bunny-create-video', {
        body: { action: 'delete', videoId },
    })

    if (error) {
        throw new Error(`Bunny video deletion failed: ${error.message}`)
    }
}

/**
 * Bunny API 経由で動画のステータスを取得（Edge Function 経由）
 * 戻り値: 0=Created, 1=Uploaded, 2=Processing, 3=Transcoding, 4=Finished, 5=Error, 6=UploadFailed
 * 一時的なネットワーク障害時は null を返す（throwしない）
 */
export async function checkBunnyVideoStatus(videoId: string): Promise<number | null> {
    try {
        const { data, error } = await supabase.functions.invoke('bunny-create-video', {
            body: { action: 'status', videoId },
        })
        if (error) {
            console.error('[bunny] Status check error:', error.message)
            return null
        }
        return (data as { status: number }).status
    } catch (e) {
        console.error('[bunny] Status check network error:', e)
        return null
    }
}

/**
 * Bunny側で動画が Processing 以上になるまでポーリングで待機。
 * 一時的なステータス取得失敗はリトライし、連続 MAX_CONSECUTIVE_FAILURES 回失敗で中断。
 */
export async function waitForBunnyProcessing(
    videoId: string,
    options: {
        intervalMs?: number
        timeoutMs?: number
        onStatusChange?: (status: number) => void
    } = {}
): Promise<{ success: boolean; status: number }> {
    const { intervalMs = 2500, timeoutMs = 60000, onStatusChange } = options
    const MAX_CONSECUTIVE_FAILURES = 5
    const startTime = Date.now()
    let consecutiveFailures = 0

    while (Date.now() - startTime < timeoutMs) {
        const status = await checkBunnyVideoStatus(videoId)

        if (status === null) {
            consecutiveFailures++
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                return { success: false, status: -1 }
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs))
            continue
        }

        consecutiveFailures = 0
        onStatusChange?.(status)

        if (status >= 2 && status <= 4) {
            return { success: true, status }
        }
        if (status === 5 || status === 6) {
            return { success: false, status }
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs))
    }

    const finalStatus = await checkBunnyVideoStatus(videoId)
    if (finalStatus === null) return { success: false, status: -1 }
    return { success: finalStatus >= 2 && finalStatus <= 4, status: finalStatus }
}

const STORAGE_LIMIT = 10 * 1024 * 1024 * 1024 // 10GB

/**
 * DB に記録された全 submission の video_size 合計を返す。
 * bunny_video_id が設定されている行のみ対象。
 */
export async function getTotalStorageUsedBytes(): Promise<number> {
    const { data, error } = await (supabase
        .from('submissions')
        .select('video_size')
        .not('bunny_video_id', 'is', null)
        .limit(100000) as unknown as Promise<{ data: { video_size: number | null }[] | null, error: any }>)

    if (error) {
        console.error('Storage usage fetch failed:', error)
        return 0
    }
    return (data || []).reduce((sum, row) => sum + (row.video_size || 0), 0)
}

/**
 * アップロード前にストレージ残量をチェック（早期 UX フィードバック用）
 */
export async function checkStorageAvailable(
    uploadSizeBytes: number,
    existingVideoSizeBytes: number = 0
): Promise<{ available: boolean; usedBytes: number }> {
    const usedBytes = await getTotalStorageUsedBytes()
    return {
        available: usedBytes - existingVideoSizeBytes + uploadSizeBytes <= STORAGE_LIMIT,
        usedBytes
    }
}
