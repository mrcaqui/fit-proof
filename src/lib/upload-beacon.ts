import type { UploadLogEntry } from '@/lib/upload-logger'

const MAX_BEACON_BYTES = 60 * 1024

export interface SendLogsOnUnloadParams {
  supabaseUrl: string
  anonKey: string
  accessToken: string
  userId: string
  sessionId: string
  entries: UploadLogEntry[]
}

/**
 * pagehide/visibilitychange=hidden から呼ばれる一方向送信。
 * 戻り値: 「送信を開始できたか」を返す (真の成功可否ではない)。
 * keepalive fetch の結果はハンドラ内で観測できないため、呼び出し発行までの成否のみを報告する。
 */
export function sendLogsOnUnload(params: SendLogsOnUnloadParams): boolean {
  const { supabaseUrl, anonKey, accessToken, userId, sessionId, entries } = params

  if (!supabaseUrl || !anonKey || !accessToken) return false
  if (entries.length === 0) return false

  let body: string
  try {
    body = JSON.stringify({
      user_id: userId,
      session_id: sessionId,
      entries,
    })
  } catch {
    return false
  }

  // keepalive 上限 (通常 64KB) に対するマージン
  if (body.length > MAX_BEACON_BYTES) return false

  const url = `${supabaseUrl}/rest/v1/upload_logs?on_conflict=user_id,session_id`

  try {
    fetch(url, {
      method: 'POST',
      keepalive: true,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body,
    }).catch(() => {})
    return true
  } catch {
    return false
  }
}
