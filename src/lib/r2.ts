import { S3Client, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"
import { supabase } from '@/lib/supabase'

export const r2Client = new S3Client({
    region: "auto",
    endpoint: import.meta.env.VITE_R2_ENDPOINT,
    credentials: {
        accessKeyId: import.meta.env.VITE_R2_ACCESS_KEY_ID,
        secretAccessKey: import.meta.env.VITE_R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
})

export const R2_BUCKET_NAME = import.meta.env.VITE_R2_BUCKET_NAME as string

export async function deleteR2Object(key: string) {
    const command = new DeleteObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
    })
    return await r2Client.send(command)
}

export async function listR2ObjectsByPrefix(prefix: string): Promise<string[]> {
    const keys: string[] = []
    let continuationToken: string | undefined

    do {
        const command = new ListObjectsV2Command({
            Bucket: R2_BUCKET_NAME,
            Prefix: prefix,
            ContinuationToken: continuationToken,
        })
        const response = await r2Client.send(command)

        if (response.Contents) {
            for (const obj of response.Contents) {
                if (obj.Key) {
                    keys.push(obj.Key)
                }
            }
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (continuationToken)

    return keys
}

export async function deleteR2ObjectsByPrefix(prefix: string): Promise<number> {
    const keys = await listR2ObjectsByPrefix(prefix)
    const chunkSize = 100

    for (let i = 0; i < keys.length; i += chunkSize) {
        const chunk = keys.slice(i, i + chunkSize)
        await Promise.all(chunk.map((key) => deleteR2Object(key)))
    }

    return keys.length
}

export function getR2PublicUrl(key: string) {
    const endpoint = import.meta.env.VITE_R2_PUBLIC_URL || import.meta.env.VITE_R2_ENDPOINT
    return `${endpoint}/${key}`
}

const R2_STORAGE_LIMIT = 10 * 1024 * 1024 * 1024 // 10GB

/**
 * DB に記録された全 submission の video_size 合計を返す。
 * .limit(100000) で Supabase デフォルト 1000 行制限を回避する。
 * submissions 行数は到底 100000 を超えないため全件取得と等価。
 */
export async function getTotalStorageUsedBytes(): Promise<number> {
    const { data, error } = await (supabase
        .from('submissions')
        .select('video_size')
        .not('r2_key', 'is', null)
        .limit(100000) as unknown as Promise<{ data: { video_size: number | null }[] | null, error: any }>)

    if (error) {
        console.error('Storage usage fetch failed:', error)
        return 0
    }
    return (data || []).reduce((sum, row) => sum + (row.video_size || 0), 0)
}

/**
 * アップロード前に R2 ストレージ残量をチェックする。
 * existingVideoSizeBytes: 上書きアップロード時に削除予定の既存ファイルサイズ（差分判定）。
 * 上書きフローは「既存 DB 削除 → R2 アップロード → DB INSERT」の順のため、
 * INSERT 時には旧レコードが既に削除されており、DB ベースのトリガーでは差分チェックが自動的に正しく機能する。
 * このクライアントサイドチェックは早期 UX フィードバック用（非原子的）。
 */
export async function checkR2StorageAvailable(
    uploadSizeBytes: number,
    existingVideoSizeBytes: number = 0
): Promise<{ available: boolean; usedBytes: number }> {
    const usedBytes = await getTotalStorageUsedBytes()
    return {
        available: usedBytes - existingVideoSizeBytes + uploadSizeBytes <= R2_STORAGE_LIMIT,
        usedBytes
    }
}
