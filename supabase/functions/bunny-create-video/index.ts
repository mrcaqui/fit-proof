// @ts-nocheck
// This file runs in Deno (Supabase Edge Functions), not in Node.js/browser.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ENABLED_RESOLUTIONS = '480p'  // 変更時: '720p' に書き換えて再デプロイ

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
        const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
        const BUNNY_STREAM_API_KEY = Deno.env.get('BUNNY_STREAM_API_KEY')!
        const BUNNY_STREAM_LIBRARY_ID = Deno.env.get('BUNNY_STREAM_LIBRARY_ID')!

        if (!BUNNY_STREAM_API_KEY || !BUNNY_STREAM_LIBRARY_ID) {
            throw new Error('Missing Bunny Stream environment variables. Please set BUNNY_STREAM_API_KEY and BUNNY_STREAM_LIBRARY_ID in Supabase Edge Function Secrets.')
        }

        // JWT でユーザー認証を確認
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            global: { headers: { Authorization: authHeader } },
        })

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        const body = await req.json()
        const action = body.action || 'create'

        if (action === 'delete') {
            // Bunny API でビデオ削除
            const videoId = body.videoId
            if (!videoId) {
                return new Response(JSON.stringify({ error: 'Missing videoId' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                })
            }

            const deleteRes = await fetch(
                `https://video.bunnycdn.com/library/${BUNNY_STREAM_LIBRARY_ID}/videos/${videoId}`,
                {
                    method: 'DELETE',
                    headers: { AccessKey: BUNNY_STREAM_API_KEY },
                }
            )

            // 404（既に削除済み）も成功扱い（冪等）
            if (!deleteRes.ok && deleteRes.status !== 404) {
                const errText = await deleteRes.text()
                throw new Error(`Bunny delete failed: ${deleteRes.status} ${errText}`)
            }

            return new Response(JSON.stringify({ success: true }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }

        // action === 'create': ビデオ作成 + TUS 認証情報返却
        const title = body.title || 'untitled'

        // Bunny API でビデオプレースホルダーを作成
        const createRes = await fetch(
            `https://video.bunnycdn.com/library/${BUNNY_STREAM_LIBRARY_ID}/videos`,
            {
                method: 'POST',
                headers: {
                    AccessKey: BUNNY_STREAM_API_KEY,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title,
                    enabledResolutions: ENABLED_RESOLUTIONS,
                }),
            }
        )

        if (!createRes.ok) {
            const errText = await createRes.text()
            throw new Error(`Bunny video creation failed: ${createRes.status} ${errText}`)
        }

        const videoData = await createRes.json()
        const videoId = videoData.guid

        // TUS 署名を生成: SHA256(library_id + api_key + expiration_time + video_id)
        const expirationTime = Math.floor(Date.now() / 1000) + 3600 // 1時間有効
        const signaturePayload = BUNNY_STREAM_LIBRARY_ID + BUNNY_STREAM_API_KEY + expirationTime + videoId
        const encoder = new TextEncoder()
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(signaturePayload))
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        const authorizationSignature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

        return new Response(
            JSON.stringify({
                videoId,
                libraryId: BUNNY_STREAM_LIBRARY_ID,
                tusEndpoint: 'https://video.bunnycdn.com/tusupload',
                authorizationSignature,
                authorizationExpire: expirationTime,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('bunny-create-video error:', message)
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }
})
