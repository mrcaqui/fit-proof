// @ts-nocheck
// This file runs in Deno (Supabase Edge Functions), not in Node.js/browser.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
        const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
        const BUNNY_ACCOUNT_API_KEY = Deno.env.get('BUNNY_ACCOUNT_API_KEY')
        const BUNNY_STREAM_LIBRARY_ID = Deno.env.get('BUNNY_STREAM_LIBRARY_ID')

        if (!BUNNY_ACCOUNT_API_KEY || !BUNNY_STREAM_LIBRARY_ID) {
            throw new Error(
                'Missing Bunny environment variables. Please set BUNNY_ACCOUNT_API_KEY and BUNNY_STREAM_LIBRARY_ID in Supabase Edge Function Secrets.'
            )
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

        // Bunny API を並列呼び出し
        const [libraryRes, billingRes] = await Promise.all([
            fetch(`https://api.bunny.net/videolibrary/${BUNNY_STREAM_LIBRARY_ID}`, {
                headers: { AccessKey: BUNNY_ACCOUNT_API_KEY },
            }),
            fetch('https://api.bunny.net/billing', {
                headers: { AccessKey: BUNNY_ACCOUNT_API_KEY },
            }),
        ])

        if (!libraryRes.ok) {
            const errText = await libraryRes.text()
            throw new Error(`Bunny videolibrary API failed: ${libraryRes.status} ${errText}`)
        }
        if (!billingRes.ok) {
            const errText = await billingRes.text()
            throw new Error(`Bunny billing API failed: ${billingRes.status} ${errText}`)
        }

        const library = await libraryRes.json()
        const billing = await billingRes.json()

        const result = {
            storageUsedBytes: library.StorageUsage ?? 0,
            trafficUsedBytes: library.TrafficUsage ?? 0,
            videoCount: library.VideoCount ?? 0,
            billing: {
                thisMonthCharges: billing.ThisMonthCharges ?? 0,
                balance: billing.Balance ?? 0,
                storageCharges: billing.MonthlyChargesStorage ?? 0,
                trafficCharges: {
                    eu: billing.MonthlyChargesEUTraffic ?? 0,
                    us: billing.MonthlyChargesUSTraffic ?? 0,
                    asia: billing.MonthlyChargesASIATraffic ?? 0,
                    af: billing.MonthlyChargesAFTraffic ?? 0,
                    sa: billing.MonthlyChargesSATraffic ?? 0,
                },
            },
        }

        return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })

    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('bunny-stats error:', message)
        return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }
})
