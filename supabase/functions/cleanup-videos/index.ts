import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { S3Client, DeleteObjectCommand } from 'https://esm.sh/@aws-sdk/client-s3@3'

// Setup env vars (In Supabase dashboard)
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID')!
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY')!
const R2_ENDPOINT = Deno.env.get('R2_ENDPOINT')!
const R2_BUCKET_NAME = Deno.env.get('R2_BUCKET_NAME')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const s3Client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
})

/**
 * Edge Function to clean up old videos from R2.
 * Recommended schedule: Cron job once a day.
 */
Deno.serve(async (req) => {
    try {
        // 1. Find submissions older than 120 days (approx. 4 months) that still have an R2 key
        const retentionDays = 120
        const expiryDate = new Date()
        expiryDate.setDate(expiryDate.getDate() - retentionDays)

        const { data: oldSubmissions, error: fetchError } = await supabase
            .from('submissions')
            .select('id, r2_key, comment_text')
            .not('r2_key', 'is', null)
            .lt('created_at', expiryDate.toISOString())

        if (fetchError) throw fetchError

        console.log(`Found ${oldSubmissions?.length || 0} videos to clean up.`)

        if (oldSubmissions && oldSubmissions.length > 0) {
            for (const sub of oldSubmissions) {
                if (!sub.r2_key) continue

                // 2. Delete from R2
                try {
                    await s3Client.send(new DeleteObjectCommand({
                        Bucket: R2_BUCKET_NAME,
                        Key: sub.r2_key,
                    }))
                    console.log(`Deleted from R2: ${sub.r2_key}`)

                    // 3. Update DB: Set r2_key to null (or a "deleted" state) to indicate video is gone
                    // but keep the record for streak/history for 120 days.
                    await supabase
                        .from('submissions')
                        .update({
                            r2_key: null,
                            comment_text: (sub.comment_text || '') + ' [Video auto-deleted after 120 days]'
                        })
                        .eq('id', sub.id)

                } catch (err) {
                    console.error(`Failed to delete ${sub.r2_key}:`, err)
                }
            }
        }

        return new Response(JSON.stringify({ success: true, count: oldSubmissions?.length || 0 }), {
            headers: { 'Content-Type': 'application/json' },
        })

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        })
    }
})
