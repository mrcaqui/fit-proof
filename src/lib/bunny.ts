import { supabase } from '@/lib/supabase'

export const BUNNY_RESOLUTION = '480p'  // 変更はここだけ

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
    return `https://${hostname}/${videoId}/play_${BUNNY_RESOLUTION}.mp4`
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
