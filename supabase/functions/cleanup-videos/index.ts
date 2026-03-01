// @ts-nocheck
// This file runs in Deno (Supabase Edge Functions), not in Node.js/browser.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * Edge Function to clean up old videos from Bunny Stream.
 * - Reads retention period per client from profiles.video_retention_days
 * - Deletes orphaned Bunny videos (in Bunny but not in DB) with a 5-minute grace window
 * Called automatically when admin opens the app.
 */
Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const BUNNY_STREAM_API_KEY = Deno.env.get('BUNNY_STREAM_API_KEY')!
        const BUNNY_STREAM_LIBRARY_ID = Deno.env.get('BUNNY_STREAM_LIBRARY_ID')!

        if (!BUNNY_STREAM_API_KEY || !BUNNY_STREAM_LIBRARY_ID) {
            throw new Error('Missing Bunny Stream environment variables. Please set BUNNY_STREAM_API_KEY and BUNNY_STREAM_LIBRARY_ID in Supabase Edge Function Secrets.')
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

        // Bunny ビデオ削除ヘルパー
        const deleteBunnyVideo = async (videoId: string): Promise<void> => {
            const res = await fetch(
                `https://video.bunnycdn.com/library/${BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}`,
                {
                    method: 'DELETE',
                    headers: { AccessKey: BUNNY_STREAM_API_KEY },
                }
            )
            // 404（既に削除済み）も成功扱い（冪等）
            if (!res.ok && res.status !== 404) {
                throw new Error(`Bunny delete failed: ${res.status} ${await res.text()}`)
            }
        }

        // 1. 全クライアントの保持期間設定を取得
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
                .select('id, bunny_video_id, comment_text')
                .eq('user_id', client.id)
                .not('bunny_video_id', 'is', null)
                .lt('created_at', expiryDate.toISOString())

            if (fetchError) {
                console.error(`Failed to fetch old submissions for client ${client.id}:`, fetchError)
                continue
            }

            for (const sub of oldSubmissions || []) {
                if (!sub.bunny_video_id) continue
                try {
                    await deleteBunnyVideo(sub.bunny_video_id)
                    console.log(`Deleted from Bunny: ${sub.bunny_video_id}`)
                    await supabase
                        .from('submissions')
                        .update({
                            bunny_video_id: null,
                            comment_text: (sub.comment_text || '') + ` [Video auto-deleted after ${retentionDays} days]`
                        })
                        .eq('id', sub.id)
                    expiredCount++
                } catch (err) {
                    console.error(`Failed to delete ${sub.bunny_video_id}:`, err)
                }
            }
        }

        console.log(`Expired videos deleted: ${expiredCount}`)

        // 3. 孤立 Bunny 動画の自動クリーンアップ
        // Bunny Stream API で全ビデオ一覧を取得し、DB と照合して孤立ビデオを検出・削除する
        console.log(`Starting Bunny orphan cleanup (library: ${BUNNY_STREAM_LIBRARY_ID})`)

        const graceWindowMs = 5 * 60 * 1000 // 5分
        const graceThreshold = new Date(Date.now() - graceWindowMs)

        // ページネーション付きで全ビデオを取得
        const allBunnyVideos: { guid: string; dateUploaded: string }[] = []
        let page = 1
        const itemsPerPage = 100

        while (true) {
            const listRes = await fetch(
                `https://video.bunnycdn.com/library/${BUNNY_STREAM_LIBRARY_ID}/videos?page=${page}&itemsPerPage=${itemsPerPage}`,
                { headers: { AccessKey: BUNNY_STREAM_API_KEY } }
            )

            if (!listRes.ok) {
                console.error(`Bunny list failed: ${listRes.status}`)
                break
            }

            const listData = await listRes.json()
            const items = listData.items || []

            for (const item of items) {
                allBunnyVideos.push({ guid: item.guid, dateUploaded: item.dateUploaded })
            }

            // totalItems で残りページを判定
            if (page * itemsPerPage >= (listData.totalItems || 0)) {
                break
            }
            page++
        }

        // 4. DB 上に存在する bunny_video_id の一覧を取得
        const { data: dbRecords, error: dbError } = await supabase
            .from('submissions')
            .select('bunny_video_id')
            .not('bunny_video_id', 'is', null)
            .limit(100000)

        if (dbError) throw dbError

        const dbVideoIdSet = new Set(
            (dbRecords || []).map((r: { bunny_video_id: string | null }) => r.bunny_video_id)
        )

        // 5. Bunny 上にあるが DB にない = 孤立ビデオ → 削除
        // 作成から 5 分以上経過したもののみ（アップロード中の誤削除を防ぐ）
        let orphanCount = 0
        for (const video of allBunnyVideos) {
            if (!dbVideoIdSet.has(video.guid)) {
                const uploadedAt = new Date(video.dateUploaded)
                if (uploadedAt < graceThreshold) {
                    try {
                        await deleteBunnyVideo(video.guid)
                        console.log(`Deleted orphan Bunny video: ${video.guid}`)
                        orphanCount++
                    } catch (err) {
                        console.error(`Failed to delete orphan ${video.guid}:`, err)
                    }
                }
            }
        }

        console.log(`Orphan videos deleted: ${orphanCount}`)

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
