import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Download, Trash2, ChevronDown, ChevronRight, Loader2, AlertCircle, CheckCircle, RotateCcw, Search, Info, ArrowUpCircle, PlayCircle } from 'lucide-react'
import type { UploadLogEntry } from '@/lib/upload-logger'

interface UploadLogRow {
    id: number
    user_id: string
    session_id: string
    entries: UploadLogEntry[]
    created_at: string
    display_name?: string | null
}

type ProfileMap = Record<string, string>

export default function UploadLogsPage() {
    const [logs, setLogs] = useState<UploadLogRow[]>([])
    const [profileMap, setProfileMap] = useState<ProfileMap>({})
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [expandedProgressGroups, setExpandedProgressGroups] = useState<Set<string>>(new Set())

    useEffect(() => {
        fetchLogs()
    }, [])

    const fetchLogs = async () => {
        setLoading(true)

        // Fetch logs and profiles in parallel
        const [logsResult, profilesResult] = await Promise.all([
            supabase
                .from('upload_logs' as any)
                .select('*')
                .order('created_at', { ascending: false })
                .limit(100) as any,
            supabase
                .from('profiles')
                .select('id, display_name') as any,
        ])

        if (logsResult.error) {
            console.error('Failed to fetch upload logs:', logsResult.error)
        }

        // Build userId → display_name map
        const pMap: ProfileMap = {}
        if (profilesResult.data) {
            for (const p of profilesResult.data as { id: string; display_name: string | null }[]) {
                if (p.display_name) pMap[p.id] = p.display_name
            }
        }

        setProfileMap(pMap)
        setLogs((logsResult.data as UploadLogRow[]) || [])
        setLoading(false)
    }

    const toggleSession = (sessionId: string) => {
        setExpandedSessions(prev => {
            const next = new Set(prev)
            if (next.has(sessionId)) next.delete(sessionId)
            else next.add(sessionId)
            return next
        })
    }

    const handleExport = () => {
        // Export currently displayed (filtered) logs
        const target = filteredLogs.map(log => ({
            ...log,
            display_name: getUserName(log),
        }))
        const json = JSON.stringify(target, null, 2)
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `upload-logs-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
    }

    const handleClearAll = async () => {
        setDeleting(true)
        const { error } = await (supabase.from('upload_logs' as any).delete().neq('id', 0) as any)
        if (error) {
            console.error('Failed to clear logs:', error)
        } else {
            setLogs([])
        }
        setDeleting(false)
        setDeleteDialogOpen(false)
    }

    const getUserName = (log: UploadLogRow): string => {
        return profileMap[log.user_id] || log.user_id.slice(0, 8)
    }

    const getSessionSummary = (entries: UploadLogEntry[]) => {
        const fileName = entries.find(e => e.fileName)?.fileName ?? '—'
        const fileSize = entries.find(e => e.fileSize)?.fileSize
        const hasError = entries.some(e => e.status === 'fail')
        const isComplete = entries.some(e => e.phase === 'complete' && e.status === 'success')
        const totalDuration = entries.reduce((sum, e) => sum + (e.durationMs || 0), 0)
        const retryCount = entries.filter(e => e.status === 'retry').length
        const networkEvents = entries.filter(e => e.status === 'info').length
        const progressEvents = entries.filter(e => e.status === 'progress').length

        return { fileName, fileSize, hasError, isComplete, totalDuration, retryCount, networkEvents, progressEvents }
    }

    const formatBytes = (bytes: number) => {
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }

    const formatMs = (ms: number) => {
        if (ms < 1000) return `${ms}ms`
        return `${(ms / 1000).toFixed(1)}s`
    }

    const phaseLabel = (phase: string): { name: string; desc: string } => {
        const labels: Record<string, { name: string; desc: string }> = {
            'file-select': { name: 'ファイル選択', desc: 'ユーザが動画ファイルを選択' },
            'metadata':    { name: '既存レコード確認', desc: 'DB上の同日・同項目の提出済みレコードを検索' },
            'bunny-create': { name: '動画枠の作成', desc: 'Bunny CDNに動画エントリを作成しアップロード認証を取得' },
            'tus-upload':  { name: '動画アップロード', desc: 'TUSプロトコルでBunny CDNにファイル転送' },
            'bunny-processing': { name: 'CDN処理確認', desc: 'Bunny CDN側の動画エンコード・受理状態をポーリング確認' },
            'db-save':     { name: 'データベース保存', desc: '提出レコードをSupabaseに保存（新規or置換）' },
            'complete':    { name: 'アップロード完了', desc: '全フェーズ正常終了' },
            'error':       { name: 'エラー', desc: 'いずれかのフェーズで異常終了' },
        }
        return labels[phase] || { name: phase, desc: '' }
    }

    const statusLabel = (status: string): string => {
        switch (status) {
            case 'success': return '成功'
            case 'fail': return '失敗'
            case 'retry': return 'リトライ'
            case 'start': return '開始'
            case 'info': return '情報'
            case 'progress': return '進捗'
            default: return status
        }
    }

    const statusIcon = (status: string) => {
        switch (status) {
            case 'start': return <PlayCircle className="w-3 h-3 text-muted-foreground" />
            case 'success': return <CheckCircle className="w-3 h-3 text-green-500" />
            case 'fail': return <AlertCircle className="w-3 h-3 text-destructive" />
            case 'retry': return <RotateCcw className="w-3 h-3 text-yellow-500" />
            case 'info': return <Info className="w-3 h-3 text-blue-500" />
            case 'progress': return <ArrowUpCircle className="w-3 h-3 text-sky-500" />
            default: return null
        }
    }

    const getDeviceInfoFromEntries = (entries: UploadLogEntry[]) => {
        const selectEntry = entries.find(
            e => e.phase === 'file-select' && e.status === 'success' && e.extra
        )
        if (!selectEntry?.extra) return null
        const device = selectEntry.extra.device as { browser?: string; os?: string; isPWA?: boolean } | undefined
        const appVersion = selectEntry.extra.appVersion as string | undefined
        if (!device && !appVersion) return null
        return { browser: device?.browser, os: device?.os, isPWA: device?.isPWA, appVersion }
    }

    const toggleProgressGroup = (groupKey: string) => {
        setExpandedProgressGroups(prev => {
            const next = new Set(prev)
            if (next.has(groupKey)) next.delete(groupKey)
            else next.add(groupKey)
            return next
        })
    }

    /** エントリ配列を走査し、連続する tus-upload progress をグループ化した表示用配列を返す */
    const groupEntries = (entries: UploadLogEntry[], sessionId: string) => {
        type EntryItem = { type: 'entry'; entry: UploadLogEntry; idx: number }
        type GroupItem = { type: 'progress-group'; entries: UploadLogEntry[]; groupKey: string }
        const result: (EntryItem | GroupItem)[] = []
        let progressBuf: UploadLogEntry[] = []
        let groupCounter = 0

        const flushProgress = () => {
            if (progressBuf.length === 0) return
            groupCounter++
            result.push({
                type: 'progress-group',
                entries: [...progressBuf],
                groupKey: `${sessionId}-pg-${groupCounter}`,
            })
            progressBuf = []
        }

        entries.forEach((entry, idx) => {
            if (entry.phase === 'tus-upload' && entry.status === 'progress') {
                progressBuf.push(entry)
            } else {
                flushProgress()
                result.push({ type: 'entry', entry, idx })
            }
        })
        flushProgress()

        return result
    }

    const filteredLogs = searchQuery
        ? logs.filter(log => {
            const name = getUserName(log).toLowerCase()
            const fileName = log.entries?.find(e => e.fileName)?.fileName?.toLowerCase() ?? ''
            const q = searchQuery.toLowerCase()
            return name.includes(q) || fileName.includes(q)
        })
        : logs

    return (
        <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-xl font-bold shrink-0">アップロードログ</h1>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleExport} disabled={filteredLogs.length === 0}>
                        <Download className="w-4 h-4 mr-1" />
                        {searchQuery ? `${filteredLogs.length}件` : '全件'}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)} disabled={logs.length === 0}>
                        <Trash2 className="w-4 h-4 mr-1" /> クリア
                    </Button>
                </div>
            </div>

            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                    placeholder="ユーザ名またはファイル名で検索..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                />
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
            ) : filteredLogs.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                    {searchQuery ? '該当するログが見つかりません' : 'ログがありません'}
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredLogs.map((log) => {
                        const summary = getSessionSummary(log.entries || [])
                        const isExpanded = expandedSessions.has(log.session_id)

                        return (
                            <Card key={log.id} className="overflow-hidden">
                                <button
                                    onClick={() => toggleSession(log.session_id)}
                                    className="w-full text-left p-4 hover:bg-muted/30 transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        {isExpanded
                                            ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                                            : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                                        }
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-sm font-bold truncate">{getUserName(log)}</span>
                                                {summary.isComplete && (
                                                    <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-bold shrink-0">
                                                        成功
                                                    </span>
                                                )}
                                                {summary.hasError && !summary.isComplete && (
                                                    <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full font-bold shrink-0">
                                                        エラー
                                                    </span>
                                                )}
                                                {summary.retryCount > 0 && (
                                                    <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded-full font-bold shrink-0">
                                                        リトライ {summary.retryCount}回
                                                    </span>
                                                )}
                                                {summary.networkEvents > 0 && (
                                                    <span className="text-[10px] px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded-full font-bold shrink-0">
                                                        イベント {summary.networkEvents}件
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                                <span>{new Date(log.created_at).toLocaleString('ja-JP')}</span>
                                                <span className="truncate max-w-[150px]">{summary.fileName}</span>
                                                {summary.fileSize && <span>{formatBytes(summary.fileSize)}</span>}
                                                {summary.totalDuration > 0 && <span>{formatMs(summary.totalDuration)}</span>}
                                            </div>
                                            {(() => {
                                                const info = getDeviceInfoFromEntries(log.entries || [])
                                                if (!info) return null
                                                const parts = [info.browser, info.os, info.isPWA ? 'PWA' : null].filter(Boolean)
                                                return (
                                                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                        {parts.length > 0 && (
                                                            <span className="text-[10px] px-1.5 py-0.5 bg-muted text-muted-foreground rounded">
                                                                {parts.join(' / ')}
                                                            </span>
                                                        )}
                                                        {info.appVersion && (
                                                            <span className="text-[10px] px-1.5 py-0.5 bg-muted text-muted-foreground rounded">
                                                                v{info.appVersion}
                                                            </span>
                                                        )}
                                                    </div>
                                                )
                                            })()}
                                        </div>
                                    </div>
                                </button>

                                {isExpanded && (
                                    <CardContent className="pt-0 pb-4 px-4">
                                        <div className="ml-7 border-l-2 border-muted pl-4 space-y-3">
                                            {groupEntries(log.entries || [], log.session_id).map((item) => {
                                                if (item.type === 'progress-group') {
                                                    const group = item.entries
                                                    const firstPercent = (group[0].extra as any)?.percent ?? 0
                                                    const lastPercent = (group[group.length - 1].extra as any)?.percent ?? 100
                                                    const isGroupExpanded = expandedProgressGroups.has(item.groupKey)
                                                    return (
                                                        <div key={item.groupKey}>
                                                            <button
                                                                onClick={() => toggleProgressGroup(item.groupKey)}
                                                                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                                                            >
                                                                <div className="shrink-0 mt-0.5">
                                                                    <ArrowUpCircle className="w-3 h-3 text-sky-500" />
                                                                </div>
                                                                <span>
                                                                    進捗: {firstPercent}% → {lastPercent}% ({group.length}件のログ)
                                                                </span>
                                                                {isGroupExpanded
                                                                    ? <ChevronDown className="w-3 h-3" />
                                                                    : <ChevronRight className="w-3 h-3" />
                                                                }
                                                            </button>
                                                            {isGroupExpanded && (
                                                                <div className="ml-5 mt-1 space-y-2">
                                                                    {group.map((entry, gi) => (
                                                                        <div key={gi} className="flex items-start gap-2 text-xs">
                                                                            <div className="shrink-0 mt-0.5">{statusIcon(entry.status)}</div>
                                                                            <div className="flex-1 min-w-0">
                                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                                    <span className="font-bold">{phaseLabel(entry.phase).name}</span>
                                                                                    <span className="text-muted-foreground">{statusLabel(entry.status)}</span>
                                                                                </div>
                                                                                {entry.extra && Object.keys(entry.extra).length > 0 && (
                                                                                    <div className="text-muted-foreground mt-0.5 font-mono text-[10px] break-all">
                                                                                        {JSON.stringify(entry.extra)}
                                                                                    </div>
                                                                                )}
                                                                                <div className="text-muted-foreground/60 text-[10px]">
                                                                                    {new Date(entry.timestamp).toLocaleTimeString('ja-JP')}
                                                                                    {!entry.networkState?.online && ' (offline)'}
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )
                                                }

                                                const entry = item.entry
                                                const phase = phaseLabel(entry.phase)
                                                return (
                                                    <div key={item.idx} className="flex items-start gap-2 text-xs">
                                                        <div className="shrink-0 mt-0.5">{statusIcon(entry.status)}</div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="font-bold">{phase.name}</span>
                                                                <span className="text-muted-foreground">
                                                                    {statusLabel(entry.status)}
                                                                </span>
                                                                {entry.durationMs != null && (
                                                                    <span className="text-muted-foreground">
                                                                        ({formatMs(entry.durationMs)})
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {entry.status === 'start' && phase.desc && (
                                                                <p className="text-muted-foreground/70 text-[10px] mt-0.5">
                                                                    {phase.desc}
                                                                </p>
                                                            )}
                                                            {entry.error && (
                                                                <div className="text-destructive mt-0.5 break-all">
                                                                    {entry.error.message}
                                                                </div>
                                                            )}
                                                            {entry.extra && Object.keys(entry.extra).length > 0 && (
                                                                <div className="text-muted-foreground mt-0.5 font-mono text-[10px] break-all">
                                                                    {JSON.stringify(entry.extra)}
                                                                </div>
                                                            )}
                                                            <div className="text-muted-foreground/60 text-[10px]">
                                                                {new Date(entry.timestamp).toLocaleTimeString('ja-JP')}
                                                                {!entry.networkState?.online && ' (offline)'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </CardContent>
                                )}
                            </Card>
                        )
                    })}
                </div>
            )}

            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>ログをすべて削除</AlertDialogTitle>
                        <AlertDialogDescription>
                            すべてのアップロードログが完全に削除されます。この操作は取り消せません。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>キャンセル</AlertDialogCancel>
                        <Button variant="destructive" onClick={handleClearAll} disabled={deleting}>
                            {deleting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                            削除する
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
