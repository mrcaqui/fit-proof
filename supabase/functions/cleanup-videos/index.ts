// @ts-nocheck
// This file runs in Deno (Supabase Edge Functions), not in Node.js/browser.
// TypeScript LS errors for URL imports and Deno globals are expected and can be ignored.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AwsClient } from 'https://esm.sh/aws4fetch@1'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * Edge Function to clean up old videos from R2.
 * - Reads retention period per client from profiles.video_retention_days
 * - Deletes orphaned R2 objects (in R2 but not in DB) with a 5-minute grace window
 * Called automatically when admin opens the app.
 *
 * NOTE: @aws-sdk/client-s3 は defaultsMode: 'standard' でも @smithy/shared-ini-file-loader
 *       経由で fs.readFile を呼ぶため Deno で動作しない。
 *       代わりに aws4fetch（Deno/Edge 対応の fetch ベース AWS4 署名ライブラリ）を使用する。
 */
Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID')!
        const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY')!
        const R2_ENDPOINT = Deno.env.get('R2_ENDPOINT')!
        const R2_BUCKET_NAME = Deno.env.get('R2_BUCKET_NAME')!

        if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
            throw new Error('Missing R2 environment variables. Please set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME in Supabase Edge Function Secrets.')
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

        // aws4fetch: fetch ベースの AWS4 署名ライブラリ。
        // @aws-sdk と異なり fs.readFile を一切呼ばず Deno/Edge 環境で動作する。
        const r2 = new AwsClient({
            accessKeyId: R2_ACCESS_KEY_ID,
            secretAccessKey: R2_SECRET_ACCESS_KEY,
            service: 's3',
            region: 'auto',
        })

        const bucketUrl = `${R2_ENDPOINT.replace(/\/$/, '')}/${R2_BUCKET_NAME}`

        // R2オブジェクト削除ヘルパー
        const deleteObject = async (key: string): Promise<void> => {
            const res = await r2.fetch(`${bucketUrl}/${key}`, { method: 'DELETE' })
            // S3 DELETE は成功時 204 No Content を返す（200 も許容）
            if (!res.ok && res.status !== 204) {
                throw new Error(`R2 delete failed: ${res.status} ${await res.text()}`)
            }
        }

        // 1. 全クライアントの保持期間設定を取得
        // 注意: .eq('role', 'client') でクライアントのみを対象にする。
        // 管理者（role = 'admin'）は動画をアップロードしない運用前提であるため対象外。
        const { data: clients, error: clientsError } = await supabase
            .from('profiles')
            .select('id, video_retention_days')
            .eq('role', 'client')

        if (clientsError) throw clientsError

        // 2. クライアントごとに保持期間に基づいて古い動画を削除
        let expiredCount = 0
        for (const client of clients || []) {
            const retentionDays = client.video_retention_days || 30
            const expiryDate = new Date()
            expiryDate.setDate(expiryDate.getDate() - retentionDays)

            const { data: oldSubmissions, error: fetchError } = await supabase
                .from('submissions')
                .select('id, r2_key, comment_text')
                .eq('user_id', client.id)
                .not('r2_key', 'is', null)
                .lt('created_at', expiryDate.toISOString())

            if (fetchError) {
                console.error(`Failed to fetch old submissions for client ${client.id}:`, fetchError)
                continue
            }

            for (const sub of oldSubmissions || []) {
                if (!sub.r2_key) continue
                try {
                    await deleteObject(sub.r2_key)
                    console.log(`Deleted from R2: ${sub.r2_key}`)
                    await supabase
                        .from('submissions')
                        .update({
                            r2_key: null,
                            comment_text: (sub.comment_text || '') + ` [Video auto-deleted after ${retentionDays} days]`
                        })
                        .eq('id', sub.id)
                    expiredCount++
                } catch (err) {
                    console.error(`Failed to delete ${sub.r2_key}:`, err)
                }
            }
        }

        console.log(`Expired videos deleted: ${expiredCount}`)

        // 3. 孤立 R2 オブジェクトの自動クリーンアップ
        // アップロードフローは「R2 書き込み → DB INSERT」の順。
        // グレースウィンドウ（5分）以内に更新されたオブジェクトはスキップして
        // アップロード中のファイルの誤削除を防ぐ。
        console.log(`Starting R2 orphan cleanup (bucket: ${R2_BUCKET_NAME})`)

        const graceWindowMs = 5 * 60 * 1000 // 5分
        const graceThreshold = new Date(Date.now() - graceWindowMs)

        const allR2Keys: string[] = []
        let continuationToken: string | undefined

        do {
            const params = new URLSearchParams({ 'list-type': '2', 'prefix': 'uploads/' })
            if (continuationToken) params.set('continuation-token', continuationToken)

            const res = await r2.fetch(`${bucketUrl}?${params}`)
            if (!res.ok) {
                throw new Error(`R2 list failed: ${res.status} ${await res.text()}`)
            }

            const xmlText = await res.text()

            // <Contents> ブロックを正規表現でパース。
            // DOMParser は S3 XML のネームスペース（xmlns="..."）との相性問題があるため使用しない。
            for (const block of xmlText.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
                const key = block[1].match(/<Key>(.*?)<\/Key>/)?.[1]
                const lastModifiedStr = block[1].match(/<LastModified>(.*?)<\/LastModified>/)?.[1]
                if (!key) continue
                const lastModified = lastModifiedStr ? new Date(lastModifiedStr) : null
                // グレースウィンドウ内（最近アップロード）はスキップ
                if (!lastModified || lastModified < graceThreshold) {
                    allR2Keys.push(key)
                }
            }

            const isTruncated = /<IsTruncated>true<\/IsTruncated>/.test(xmlText)
            continuationToken = isTruncated
                ? xmlText.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/)?.[1]
                : undefined

        } while (continuationToken)

        // 4. DB 上に存在する r2_key の一覧を取得
        // .limit(100000) を付与することで Supabase のデフォルト 1000 行制限を回避する。
        const { data: dbRecords, error: dbError } = await supabase
            .from('submissions')
            .select('r2_key')
            .not('r2_key', 'is', null)
            .limit(100000)

        if (dbError) throw dbError

        const dbKeySet = new Set((dbRecords || []).map((r: { r2_key: string | null }) => r.r2_key))

        // 5. R2 にあるが DB にない = 孤立ファイル → 削除
        let orphanCount = 0
        for (const key of allR2Keys) {
            if (!dbKeySet.has(key)) {
                try {
                    await deleteObject(key)
                    console.log(`Deleted orphan R2 object: ${key}`)
                    orphanCount++
                } catch (err) {
                    console.error(`Failed to delete orphan ${key}:`, err)
                }
            }
        }

        console.log(`Orphan objects deleted: ${orphanCount}`)

        return new Response(
            JSON.stringify({ expired: expiredCount, orphans: orphanCount }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('cleanup-videos error:', message)
        if (error instanceof Error && error.stack) {
            console.error('Stack:', error.stack.split('\n').slice(0, 5).join(' | '))
        }
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }
})
