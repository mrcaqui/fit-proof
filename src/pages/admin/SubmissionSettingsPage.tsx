import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { GamificationSettings, DEFAULT_GAMIFICATION_SETTINGS } from '@/types/gamification.types'
import { useSubmissionRules } from '@/hooks/useSubmissionRules'
import { useSubmissionItems } from '@/hooks/useSubmissionItems'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Plus, Trash2, Calendar as CalendarIcon, Clock, Gamepad2, HardDrive, Info } from 'lucide-react'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { Progress } from '@/components/ui/progress'
import { getTotalStorageUsedBytes } from '@/lib/r2'
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import { Settings } from 'lucide-react'

const DAYS_OF_WEEK = [
    { label: '日', value: 0 },
    { label: '月', value: 1 },
    { label: '火', value: 2 },
    { label: '水', value: 3 },
    { label: '木', value: 4 },
    { label: '金', value: 5 },
    { label: '土', value: 6 },
]

const SUBMISSION_DAYS_OPTIONS = [
    { label: '当日のみ', value: 0 },
    { label: '3日まで', value: 3 },
    { label: '7日まで', value: 7 },
    { label: '14日まで', value: 14 },
    { label: '30日まで', value: 30 },
    { label: '無制限', value: 9999 },
]

export default function SubmissionSettingsPage() {
    const [selectedClientId, setSelectedClientId] = useState<string>('')
    const [clients, setClients] = useState<{ id: string; display_name: string | null }[]>([])
    const { rules, loading, refetch } = useSubmissionRules(selectedClientId)

    // Deadline form state
    const [d_scope, setDScope] = useState<'monthly' | 'weekly' | 'daily'>('monthly')
    const [d_days, setDDays] = useState<number[]>([])
    const [d_date, setDDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
    const [d_time, setDTime] = useState('19:00')

    // TargetDay form state
    const [t_scope, setTScope] = useState<'monthly' | 'weekly' | 'daily'>('weekly')
    const [t_days, setTDays] = useState<number[]>([])
    const [t_date, setTDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
    const [t_value, setTValue] = useState(false)

    // Calendar submission limit state
    const [pastSubmissionDays, setPastSubmissionDays] = useState<number>(0)
    const [futureSubmissionDays, setFutureSubmissionDays] = useState<number>(0)
    const [deadlineMode, setDeadlineMode] = useState<'none' | 'mark'>('none')
    const [showDuplicateToUser, setShowDuplicateToUser] = useState<boolean>(false)
    const [isUpdatingCalendarSettings, setIsUpdatingCalendarSettings] = useState(false)

    // Gamification settings state
    const [gamificationSettings, setGamificationSettings] = useState<GamificationSettings>(DEFAULT_GAMIFICATION_SETTINGS)
    const [isUpdatingGamification, setIsUpdatingGamification] = useState(false)

    // Storage management state
    const [videoRetentionDays, setVideoRetentionDays] = useState<number>(30)
    const [storageUsedBytes, setStorageUsedBytes] = useState<number>(0)

    // Fetch clients
    useEffect(() => {
        const fetchClients = async () => {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, display_name')
                .eq('role', 'client')
            if (!error && data) {
                const clientData = data as { id: string; display_name: string | null }[]
                const sorted = [...clientData].sort((a, b) =>
                    (a.display_name || '').localeCompare(b.display_name || '', 'ja')
                )
                setClients(sorted)
                if (sorted.length > 0 && !selectedClientId) {
                    setSelectedClientId(sorted[0].id)
                }
            }
        }
        fetchClients()
    }, [selectedClientId])

    // Fetch current calendar settings when client changes
    useEffect(() => {
        const fetchCalendarSettings = async () => {
            if (!selectedClientId) return

            const { data, error } = await supabase
                .from('profiles')
                .select('past_submission_days, future_submission_days, deadline_mode, show_duplicate_to_user, video_retention_days')
                .eq('id', selectedClientId)
                .single() as { data: { past_submission_days: number | null, future_submission_days: number | null, deadline_mode: 'none' | 'mark' | null, show_duplicate_to_user: boolean | null, video_retention_days: number | null } | null, error: any }

            if (!error && data) {
                setPastSubmissionDays(data.past_submission_days ?? 0)
                setFutureSubmissionDays(data.future_submission_days ?? 0)
                setDeadlineMode(data.deadline_mode ?? 'none')
                setShowDuplicateToUser(data.show_duplicate_to_user ?? false)
                setVideoRetentionDays(data.video_retention_days ?? 30)
            }
        }

        const fetchStorageUsage = async () => {
            const totalBytes = await getTotalStorageUsedBytes()
            setStorageUsedBytes(totalBytes)
        }

        const fetchGamificationSettings = async () => {
            if (!selectedClientId) return

            const { data, error } = await supabase
                .from('profiles')
                .select('gamification_settings')
                .eq('id', selectedClientId)
                .single() as { data: { gamification_settings: GamificationSettings | null } | null, error: any }

            if (!error && data?.gamification_settings) {
                setGamificationSettings({
                    ...DEFAULT_GAMIFICATION_SETTINGS,
                    ...data.gamification_settings
                })
            } else {
                setGamificationSettings(DEFAULT_GAMIFICATION_SETTINGS)
            }
        }

        fetchCalendarSettings()
        fetchGamificationSettings()
        fetchStorageUsage()
    }, [selectedClientId])

    const handleUpdateCalendarSettings = async () => {
        if (!selectedClientId) return

        setIsUpdatingCalendarSettings(true)
        const client = supabase.from('profiles') as any
        const { error } = await client
            .update({
                past_submission_days: pastSubmissionDays,
                future_submission_days: futureSubmissionDays,
                deadline_mode: deadlineMode,
                show_duplicate_to_user: showDuplicateToUser,
                video_retention_days: videoRetentionDays
            })
            .eq('id', selectedClientId)

        if (error) {
            alert('設定の保存に失敗しました: ' + error.message)
        }
        setIsUpdatingCalendarSettings(false)
    }

    // ゲーミフィケーション設定の保存
    const handleUpdateGamificationSettings = async () => {
        if (!selectedClientId) return

        setIsUpdatingGamification(true)
        const client = supabase.from('profiles') as any
        const { error } = await client
            .update({
                gamification_settings: gamificationSettings
            })
            .eq('id', selectedClientId)

        if (error) {
            alert('ゲーミフィケーション設定の保存に失敗しました: ' + error.message)
        }
        setIsUpdatingGamification(false)
    }

    // ゲーミフィケーション設定のヘルパー関数
    const updateStraightSettings = (updates: Partial<GamificationSettings['straight']>) => {
        setGamificationSettings(prev => ({
            ...prev,
            straight: { ...prev.straight, ...updates }
        }))
    }

    const updateShieldSettings = (updates: Partial<GamificationSettings['shield']>) => {
        setGamificationSettings(prev => ({
            ...prev,
            shield: { ...prev.shield, ...updates }
        }))
    }

    const updateRevivalSettings = (updates: Partial<GamificationSettings['revival']>) => {
        setGamificationSettings(prev => ({
            ...prev,
            revival: { ...prev.revival, ...updates }
        }))
    }

    const updateStreakSettings = (updates: Partial<GamificationSettings['streak']>) => {
        setGamificationSettings(prev => ({
            ...prev,
            streak: { ...prev.streak, ...updates }
        }))
    }

    const updateTotalRepsSettings = (updates: Partial<GamificationSettings['total_reps']>) => {
        setGamificationSettings(prev => ({
            ...prev,
            total_reps: { ...prev.total_reps, ...updates }
        }))
    }

    const { items: submissionItems, refetch: refetchItems } = useSubmissionItems(selectedClientId)
    const [newItemName, setNewItemName] = useState('')

    const handleUpdateItemCreatedAt = async (id: number, newDate: string) => {
        const client = supabase.from('submission_items' as any) as any
        const { error } = await client
            .update({ created_at: new Date(newDate + 'T00:00:00').toISOString() })
            .eq('id', id)
        if (error) {
            alert('日付の更新に失敗しました: ' + error.message)
        } else {
            refetchItems()
        }
    }

    const handleUpdateRuleCreatedAt = async (id: number, newDate: string) => {
        const client = supabase.from('submission_rules' as any) as any
        const { error } = await client
            .update({ created_at: new Date(newDate + 'T00:00:00').toISOString() })
            .eq('id', id)
        if (error) {
            alert('日付の更新に失敗しました: ' + error.message)
        } else {
            refetch()
        }
    }

    const handleAddItem = async () => {
        if (!selectedClientId || !newItemName.trim()) return

        const { error } = await supabase
            .from('submission_items' as any)
            .insert({
                user_id: selectedClientId,
                name: newItemName.trim()
            } as any)

        if (error) {
            alert('Error adding item: ' + error.message)
        } else {
            setNewItemName('')
            refetchItems()
        }
    }

    const handleDeleteItem = async (id: number) => {
        if (!confirm('この項目を削除してよろしいですか？')) return

        const { error } = await supabase
            .from('submission_items' as any)
            .delete()
            .eq('id', id) as any

        if (error) {
            alert('Error deleting item: ' + error.message)
        } else {
            refetchItems()
        }
    }

    // Existing handlers...
    const handleAddRule = async (type: 'deadline' | 'target_day') => {
        if (!selectedClientId) return

        const scope = type === 'deadline' ? d_scope : t_scope
        const value = type === 'deadline' ? d_time : String(t_value)
        const specificDate = type === 'deadline' ? d_date : t_date
        const days = type === 'deadline' ? d_days : t_days

        if (scope === 'weekly' && days.length === 0) {
            alert('曜日を選択してください')
            return
        }

        const inserts = []

        if (scope === 'weekly') {
            days.forEach(day => {
                inserts.push({
                    user_id: selectedClientId,
                    rule_type: type,
                    scope: 'weekly',
                    day_of_week: day,
                    value: value
                })
            })
        } else {
            inserts.push({
                user_id: selectedClientId,
                rule_type: type,
                scope: scope,
                specific_date: scope === 'daily' ? specificDate : null,
                value: value
            })
        }

        const { error } = await supabase.from('submission_rules' as any).insert(inserts as any)

        if (error) {
            alert('Error adding rule: ' + error.message)
        } else {
            // Reset week selection
            if (type === 'deadline') setDDays([])
            else setTDays([])
            refetch()
        }
    }

    const handleDeleteRule = async (id: number) => {
        if (!confirm('この設定を削除してよろしいですか？')) return

        const { error } = await supabase
            .from('submission_rules' as any)
            .delete()
            .eq('id', id) as any

        if (error) {
            alert('Error deleting rule: ' + error.message)
        } else {
            refetch()
        }
    }

    if (loading && clients.length === 0) return <div className="p-8 text-center animate-pulse">読み込み中...</div>

    const toggleDay = (day: number, type: 'deadline' | 'target_day') => {
        if (type === 'deadline') {
            setDDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])
        } else {
            setTDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])
        }
    }

    return (
        <div className="space-y-6 pb-10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="text-3xl font-bold tracking-tight">提出設定</h2>
                <div className="flex items-center gap-3">
                    <Label htmlFor="client-select" className="whitespace-nowrap">クライアント:</Label>
                    <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                        <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="クライアントを選択" />
                        </SelectTrigger>
                        <SelectContent>
                            {clients.map(c => (
                                <SelectItem key={c.id} value={c.id}>{c.display_name || '名称未設定'}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {/* Calendar Submission Limit Card */}
                <div className="space-y-6 md:col-span-1 xl:col-span-2">
                    <Card className="border-primary/20 shadow-md">
                        <CardHeader className="bg-primary/5 border-b">
                            <CardTitle className="flex items-center gap-2 text-primary">
                                <Settings className="w-5 h-5" /> カレンダー投稿制限
                            </CardTitle>
                            <CardDescription>
                                クライアントがカレンダー上で投稿できる日の範囲を制限します。<br />
                                本日は常に投稿可能です。
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label>過去の投稿を許可</Label>
                                    <Select
                                        value={String(pastSubmissionDays)}
                                        onValueChange={(v) => setPastSubmissionDays(Number(v))}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {SUBMISSION_DAYS_OPTIONS.map(opt => (
                                                <SelectItem key={opt.value} value={String(opt.value)}>
                                                    {opt.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                        例: 3日まで = 3日前まで投稿可能
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <Label>未来の投稿を許可</Label>
                                    <Select
                                        value={String(futureSubmissionDays)}
                                        onValueChange={(v) => setFutureSubmissionDays(Number(v))}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {SUBMISSION_DAYS_OPTIONS.map(opt => (
                                                <SelectItem key={opt.value} value={String(opt.value)}>
                                                    {opt.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                        例: 7日まで = 7日後まで投稿可能
                                    </p>
                                </div>
                            </div>

                            <Button
                                onClick={handleUpdateCalendarSettings}
                                disabled={isUpdatingCalendarSettings}
                                className="w-full"
                            >
                                {isUpdatingCalendarSettings ? '保存中...' : '設定を保存'}
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                {/* Duplicate Display Settings Card */}
                <div className="space-y-6 md:col-span-1 xl:col-span-2">
                    <Card className="border-primary/20 shadow-md">
                        <CardHeader className="bg-primary/5 border-b">
                            <CardTitle className="flex items-center gap-2 text-primary">
                                <Settings className="w-5 h-5" /> 重複の表示
                            </CardTitle>
                            <CardDescription>
                                同じ動画・同じ長さの動画がアップロードされた場合の「重複の可能性」表示をクライアントに見せるかどうかを設定します。
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4 pt-6">
                            <div className="space-y-2">
                                <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                                    <input
                                        type="radio"
                                        name="showDuplicateToUser"
                                        value="false"
                                        checked={!showDuplicateToUser}
                                        onChange={() => setShowDuplicateToUser(false)}
                                        className="mt-1"
                                    />
                                    <div>
                                        <div className="font-medium">管理者のみ表示（デフォルト）</div>
                                        <p className="text-xs text-muted-foreground">
                                            重複の可能性はクライアントには表示されません
                                        </p>
                                    </div>
                                </label>
                                <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                                    <input
                                        type="radio"
                                        name="showDuplicateToUser"
                                        value="true"
                                        checked={showDuplicateToUser}
                                        onChange={() => setShowDuplicateToUser(true)}
                                        className="mt-1"
                                    />
                                    <div>
                                        <div className="font-medium">クライアントにも表示</div>
                                        <p className="text-xs text-muted-foreground">
                                            重複の可能性がクライアント側にも表示されます
                                        </p>
                                    </div>
                                </label>
                            </div>
                            <Button
                                onClick={handleUpdateCalendarSettings}
                                disabled={isUpdatingCalendarSettings}
                                className="w-full"
                            >
                                {isUpdatingCalendarSettings ? '保存中...' : '設定を保存'}
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                {/* Gamification Settings Card */}
                <div className="space-y-6 md:col-span-1 xl:col-span-2">
                    <Card className="border-primary/20 shadow-md">
                        <CardHeader className="bg-primary/5 border-b">
                            <CardTitle className="flex items-center gap-2 text-primary">
                                <Gamepad2 className="w-5 h-5" /> ゲーミフィケーション
                            </CardTitle>
                            <CardDescription>
                                ストリーク、シールド、ストレート達成などのゲーム要素を設定します。<br />
                                無効にした項目はクライアントのカレンダー画面に表示されません。
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            {/* ストレート達成 */}
                            <div className="space-y-3 p-4 rounded-lg border bg-muted/10">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg">👑</span>
                                        <Label className="font-semibold">ストレート達成</Label>
                                    </div>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={gamificationSettings.straight.enabled}
                                            onChange={(e) => updateStraightSettings({ enabled: e.target.checked })}
                                            className="w-4 h-4 rounded"
                                        />
                                        <span className="text-sm">表示する</span>
                                    </label>
                                </div>
                                {gamificationSettings.straight.enabled && (
                                    <div className="flex items-center gap-3 pl-7">
                                        <Label className="text-sm text-muted-foreground">週</Label>
                                        <Select
                                            value={String(gamificationSettings.straight.weekly_target)}
                                            onValueChange={(v) => updateStraightSettings({ weekly_target: Number(v) })}
                                        >
                                            <SelectTrigger className="w-20">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {[1, 2, 3, 4, 5, 6, 7].map(n => (
                                                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Label className="text-sm text-muted-foreground">日達成でストレート獲得</Label>
                                    </div>
                                )}
                            </div>

                            {/* シールド */}
                            <div className="space-y-3 p-4 rounded-lg border bg-muted/10">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg">🛡️</span>
                                        <Label className="font-semibold">シールド</Label>
                                    </div>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={gamificationSettings.shield.enabled}
                                            onChange={(e) => updateShieldSettings({ enabled: e.target.checked })}
                                            className="w-4 h-4 rounded"
                                        />
                                        <span className="text-sm">表示する</span>
                                    </label>
                                </div>
                                {gamificationSettings.shield.enabled && (
                                    <div className="space-y-3 pl-7">
                                        <label className="flex items-center gap-3 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="shieldCondition"
                                                checked={gamificationSettings.shield.condition_type === 'straight_count'}
                                                onChange={() => updateShieldSettings({ condition_type: 'straight_count' })}
                                            />
                                            <span className="text-sm">ストレート達成</span>
                                            <Select
                                                value={String(gamificationSettings.shield.straight_count)}
                                                onValueChange={(v) => updateShieldSettings({ straight_count: Number(v) })}
                                                disabled={gamificationSettings.shield.condition_type !== 'straight_count'}
                                            >
                                                <SelectTrigger className="w-16">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {[1, 2, 3, 4, 5].map(n => (
                                                        <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <span className="text-sm">回でシールド獲得</span>
                                        </label>
                                        <label className="flex items-center gap-3 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="shieldCondition"
                                                checked={gamificationSettings.shield.condition_type === 'monthly_all'}
                                                onChange={() => updateShieldSettings({ condition_type: 'monthly_all' })}
                                            />
                                            <span className="text-sm">月の全対象日をストレート達成でシールド獲得</span>
                                        </label>
                                    </div>
                                )}
                            </div>

                            {/* リバイバル */}
                            <div className="space-y-3 p-4 rounded-lg border bg-muted/10">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg">🔥</span>
                                        <Label className="font-semibold">リバイバル</Label>
                                    </div>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={gamificationSettings.revival.enabled}
                                            onChange={(e) => updateRevivalSettings({ enabled: e.target.checked })}
                                            className="w-4 h-4 rounded"
                                        />
                                        <span className="text-sm">表示する</span>
                                    </label>
                                </div>
                                <p className="text-xs text-muted-foreground pl-7">
                                    過去の空白日を後から埋めてストリークを復活させる機能
                                </p>
                            </div>

                            {/* 連続日数 */}
                            <div className="space-y-3 p-4 rounded-lg border bg-muted/10">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg">📅</span>
                                        <Label className="font-semibold">連続日数</Label>
                                    </div>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={gamificationSettings.streak.enabled}
                                            onChange={(e) => updateStreakSettings({ enabled: e.target.checked })}
                                            className="w-4 h-4 rounded"
                                        />
                                        <span className="text-sm">表示する</span>
                                    </label>
                                </div>
                                <p className="text-xs text-muted-foreground pl-7">
                                    投稿を続けた日数。週明け月曜に前週のノルマ達成を判定、未達ならリセット
                                </p>
                            </div>

                            {/* 累積記録 */}
                            <div className="space-y-3 p-4 rounded-lg border bg-muted/10">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg">📊</span>
                                        <Label className="font-semibold">累積記録</Label>
                                    </div>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={gamificationSettings.total_reps.enabled}
                                            onChange={(e) => updateTotalRepsSettings({ enabled: e.target.checked })}
                                            className="w-4 h-4 rounded"
                                        />
                                        <span className="text-sm">表示する</span>
                                    </label>
                                </div>
                                <p className="text-xs text-muted-foreground pl-7">
                                    承認された提出の累積日数とRep数を表示
                                </p>
                            </div>

                            {/* 適用開始日 */}
                            <div className="space-y-3 p-4 rounded-lg border bg-primary/5">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg">📅</span>
                                    <Label className="font-semibold">適用開始日</Label>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    全ゲーミフィケーション項目（連続日数、ストレート達成、シールド、リバイバル、累積記録）の計算開始日を指定します。
                                    この日付以降の提出データのみが対象となります。未設定の場合は全期間が対象です。
                                </p>
                                <div className="flex items-center gap-3 pl-7">
                                    <Input
                                        type="date"
                                        value={gamificationSettings.effective_from || ''}
                                        onChange={(e) => setGamificationSettings(prev => ({
                                            ...prev,
                                            effective_from: e.target.value || null
                                        }))}
                                        className="w-48"
                                    />
                                    {gamificationSettings.effective_from && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setGamificationSettings(prev => ({
                                                ...prev,
                                                effective_from: null
                                            }))}
                                        >
                                            クリア
                                        </Button>
                                    )}
                                </div>
                            </div>

                            <Button
                                onClick={handleUpdateGamificationSettings}
                                disabled={isUpdatingGamification}
                                className="w-full"
                            >
                                {isUpdatingGamification ? '保存中...' : 'ゲーミフィケーション設定を保存'}
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                {/* Storage Management Card */}
                <div className="space-y-6 md:col-span-1 xl:col-span-2">
                    <Card className="border-primary/20 shadow-md">
                        <CardHeader className="bg-primary/5 border-b">
                            <CardTitle className="flex items-center gap-2 text-primary">
                                <HardDrive className="w-5 h-5" /> ストレージ管理
                            </CardTitle>
                            <CardDescription>
                                動画ファイルの保持期間とストレージ使用量を管理します。
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            {/* 使用量表示 */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    <Label>現在の使用量（全クライアント合計）</Label>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <button className="text-muted-foreground hover:text-foreground transition-colors">
                                                <Info className="w-4 h-4" />
                                            </button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-80 text-sm space-y-2">
                                            <p className="text-muted-foreground">
                                                ストレージ使用量は、全クライアントの動画ファイルサイズの合計（DBに記録された video_size の合計値）から算出しています。動画が削除済み（r2_key が null）のレコードは含みません。実際の R2 ストレージ使用量とは、孤立ファイル等により若干異なる場合があります（孤立ファイルはアプリ起動時に自動クリーンアップされます）。
                                            </p>
                                            <p className="text-muted-foreground">
                                                使用量はこのページを開いた時点（またはクライアント切り替え時）に取得されます。最新の値を確認するにはページを再読み込みしてください。
                                            </p>
                                        </PopoverContent>
                                    </Popover>
                                </div>
                                <div className="text-2xl font-bold">
                                    {(storageUsedBytes / 1024 / 1024 / 1024).toFixed(2)} GB
                                    <span className="text-base font-normal text-muted-foreground"> / 10 GB</span>
                                </div>
                                <Progress
                                    value={Math.min((storageUsedBytes / (10 * 1024 * 1024 * 1024)) * 100, 100)}
                                    className="h-3"
                                />
                            </div>

                            {/* 保持期間設定 */}
                            <div className="space-y-2">
                                <Label>動画保持期間</Label>
                                <div className="flex items-center gap-3">
                                    <Input
                                        type="number"
                                        min={7}
                                        max={365}
                                        value={videoRetentionDays}
                                        onChange={(e) => setVideoRetentionDays(Number(e.target.value))}
                                        className="w-24"
                                    />
                                    <span className="text-sm text-muted-foreground">日</span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    この期間を過ぎた動画ファイルは自動的にR2から削除されます。提出記録（日付、ステータス等）はそのまま保持されます。
                                </p>
                            </div>

                            <Button
                                onClick={handleUpdateCalendarSettings}
                                disabled={isUpdatingCalendarSettings}
                                className="w-full"
                            >
                                {isUpdatingCalendarSettings ? '保存中...' : '設定を保存'}
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                <div className="space-y-6 md:col-span-1 xl:col-span-2">
                    <Card className="border-primary/20 shadow-md">
                        <CardHeader className="bg-primary/5 border-b">
                            <CardTitle className="flex items-center gap-2 text-primary">
                                <Plus className="w-5 h-5" /> 投稿項目の設定
                            </CardTitle>
                            <CardDescription>
                                1日に複数の動画投稿を求める場合、ここで項目を追加します。（例：スクワット、ベンチプレスなど）<br />
                                項目がない場合は、通常の「1日1動画」として扱われます。
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            <div className="flex gap-4">
                                <Input
                                    placeholder="項目名 (例: トレーニング動画)"
                                    value={newItemName}
                                    onChange={e => setNewItemName(e.target.value)}
                                    className="max-w-md"
                                />
                                <Button onClick={handleAddItem} disabled={!newItemName.trim()}>
                                    追加
                                </Button>
                            </div>

                            <div className="space-y-2">
                                {submissionItems.length === 0 ? (
                                    <div className="text-sm text-muted-foreground italic p-4 border border-dashed rounded bg-muted/20 text-center">
                                        設定された項目はありません（デフォルト設定）
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                        {submissionItems.map(item => (
                                            <div key={item.id} className="flex flex-col gap-2 p-3 rounded-lg border bg-card shadow-sm">
                                                <span className="font-medium truncate">{item.name}</span>
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                        <span>適用開始:</span>
                                                        <Input
                                                            type="date"
                                                            className="h-7 w-36 text-xs"
                                                            value={format(parseISO(item.created_at), 'yyyy-MM-dd')}
                                                            onChange={(e) => handleUpdateItemCreatedAt(item.id, e.target.value)}
                                                        />
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                        onClick={() => handleDeleteItem(item.id)}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Deadline Card */}
                <div className="space-y-6">
                    <Card className="border-primary/20 shadow-md">
                        <CardHeader className="bg-primary/5 border-b">
                            <CardTitle className="flex items-center gap-2 text-primary">
                                <Clock className="w-5 h-5" /> 提出期限の設定
                            </CardTitle>
                            <CardDescription>
                                提出が必要な時間の目安を設定します
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>適用範囲</Label>
                                        <Select value={d_scope} onValueChange={(v: any) => setDScope(v)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="monthly">月間 (デフォルト)</SelectItem>
                                                <SelectItem value="weekly">曜日指定</SelectItem>
                                                <SelectItem value="daily">特定の日</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>期限時間</Label>
                                        <Input type="time" value={d_time} onChange={e => setDTime(e.target.value)} />
                                    </div>
                                </div>

                                {d_scope === 'weekly' && (
                                    <div className="space-y-2">
                                        <Label>曜日（複数選択可）</Label>
                                        <div className="flex flex-wrap gap-2">
                                            {DAYS_OF_WEEK.map(d => (
                                                <Button
                                                    key={d.value}
                                                    type="button"
                                                    variant={d_days.includes(d.value) ? "default" : "outline"}
                                                    size="sm"
                                                    className={cn(
                                                        "w-10 h-10 p-0 rounded-full transition-all duration-200 border-2",
                                                        d_days.includes(d.value)
                                                            ? "shadow-md scale-105 border-primary ring-2 ring-primary/20"
                                                            : "border-transparent bg-muted/20"
                                                    )}
                                                    onClick={() => toggleDay(d.value, 'deadline')}
                                                >
                                                    {d.label}
                                                </Button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {d_scope === 'daily' && (
                                    <div className="space-y-2">
                                        <Label>日付</Label>
                                        <Input type="date" value={d_date} onChange={e => setDDate(e.target.value)} />
                                    </div>
                                )}

                                <Button className="w-full" onClick={() => handleAddRule('deadline')}>
                                    <Plus className="w-4 h-4 mr-2" /> 期限ルールを追加
                                </Button>

                                {/* 期限の動作設定 */}
                                <div className="space-y-3 pt-4 border-t">
                                    <div>
                                        <Label className="font-semibold">期限の動作設定</Label>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            ※ 期限超過マーク表示を選択した場合、その日付の提出期限時刻を過ぎて投稿すると is_late が記録されます（過去日付の投稿でも適用されます）
                                        </p>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                                            <input
                                                type="radio"
                                                name="deadlineMode"
                                                value="none"
                                                checked={deadlineMode === 'none'}
                                                onChange={() => setDeadlineMode('none')}
                                                className="mt-1"
                                            />
                                            <div>
                                                <div className="font-medium">目安のみ（制限なし）</div>
                                                <p className="text-xs text-muted-foreground">
                                                    期限は表示されますが、過ぎても投稿可能です
                                                </p>
                                            </div>
                                        </label>
                                        <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                                            <input
                                                type="radio"
                                                name="deadlineMode"
                                                value="mark"
                                                checked={deadlineMode === 'mark'}
                                                onChange={() => setDeadlineMode('mark')}
                                                className="mt-1"
                                            />
                                            <div>
                                                <div className="font-medium">期限超過マーク表示</div>
                                                <p className="text-xs text-muted-foreground">
                                                    期限後も投稿可能ですが「期限超過」マークが付きます
                                                </p>
                                            </div>
                                        </label>
                                    </div>
                                    <Button
                                        className="w-full"
                                        onClick={handleUpdateCalendarSettings}
                                        disabled={isUpdatingCalendarSettings}
                                    >
                                        {isUpdatingCalendarSettings ? '保存中...' : '動作設定を保存'}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <RuleList
                        type="deadline"
                        rules={rules.filter(r => r.rule_type === 'deadline')}
                        onDelete={handleDeleteRule}
                        onUpdateCreatedAt={handleUpdateRuleCreatedAt}
                    />
                </div>

                {/* Target Day Card */}
                <div className="space-y-6">
                    <Card className="border-primary/20 shadow-md">
                        <CardHeader className="bg-primary/5 border-b">
                            <CardTitle className="flex items-center gap-2 text-primary">
                                <CalendarIcon className="w-5 h-5" /> 投稿対象日の設定
                            </CardTitle>
                            <CardDescription>
                                投稿を行う日か、休息日かを設定します
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6 pt-6">
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>適用範囲</Label>
                                        <Select value={t_scope} onValueChange={(v: any) => setTScope(v)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="weekly">曜日指定</SelectItem>
                                                <SelectItem value="daily">特定の日</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>設定内容</Label>
                                        <Select value={String(t_value)} onValueChange={v => setTValue(v === 'true')}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="false">対象外 (休息日)</SelectItem>
                                                <SelectItem value="true">投稿対象 (トレーニング日)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {t_scope === 'weekly' && (
                                    <div className="space-y-2">
                                        <Label>曜日（複数選択可）</Label>
                                        <div className="flex flex-wrap gap-2">
                                            {DAYS_OF_WEEK.map(d => (
                                                <Button
                                                    key={d.value}
                                                    type="button"
                                                    variant={t_days.includes(d.value) ? "default" : "outline"}
                                                    size="sm"
                                                    className={cn(
                                                        "w-10 h-10 p-0 rounded-full transition-all duration-200 border-2",
                                                        t_days.includes(d.value)
                                                            ? "shadow-md scale-105 border-primary ring-2 ring-primary/20"
                                                            : "border-transparent bg-muted/20"
                                                    )}
                                                    onClick={() => toggleDay(d.value, 'target_day')}
                                                >
                                                    {d.label}
                                                </Button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {t_scope === 'daily' && (
                                    <div className="space-y-2">
                                        <Label>日付</Label>
                                        <Input type="date" value={t_date} onChange={e => setTDate(e.target.value)} />
                                    </div>
                                )}

                                <Button className="w-full" onClick={() => handleAddRule('target_day')}>
                                    <Plus className="w-4 h-4 mr-2" /> 対象設定ルールを追加
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <RuleList
                        type="target_day"
                        rules={rules.filter(r => r.rule_type === 'target_day')}
                        onDelete={handleDeleteRule}
                        onUpdateCreatedAt={handleUpdateRuleCreatedAt}
                    />
                </div>
            </div>
        </div>
    )
}

function RuleList({ type, rules, onDelete, onUpdateCreatedAt }: {
    type: 'deadline' | 'target_day',
    rules: any[],
    onDelete: (id: number) => void,
    onUpdateCreatedAt: (id: number, newDate: string) => void
}) {
    if (rules.length === 0) {
        return <div className="text-center py-8 bg-muted/10 rounded-lg text-muted-foreground text-sm border-dashed border-2">
            設定されたルールはありません
        </div>
    }

    // Sort: Daily > Weekly > Monthly, then CreatedAt Desc, then ID Desc (tiebreaker)
    const sortedRules = [...rules].sort((a, b) => {
        const scopeOrder = { daily: 0, weekly: 1, monthly: 2 } as const
        const scopeDiff = (scopeOrder[a.scope as keyof typeof scopeOrder] ?? 99) -
                          (scopeOrder[b.scope as keyof typeof scopeOrder] ?? 99)
        if (scopeDiff !== 0) return scopeDiff
        const dateDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        if (dateDiff !== 0) return dateDiff
        return b.id - a.id
    })

    return (
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-muted">
            {sortedRules.map(rule => (
                <div key={rule.id} className="group flex flex-col gap-2 p-3 rounded-lg border bg-card hover:border-primary/30 transition-colors">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={cn(
                                "w-2 h-2 rounded-full",
                                rule.scope === 'daily' ? "bg-blue-500" :
                                    rule.scope === 'weekly' ? "bg-purple-500" : "bg-gray-400"
                            )} />
                            <div>
                                <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                                    {rule.scope === 'monthly' ? "Monthly" :
                                        rule.scope === 'weekly' ? "Weekly" : "Daily"}
                                </div>
                                <div className="text-sm font-medium">
                                    {rule.scope === 'monthly' && "全体設定"}
                                    {rule.scope === 'weekly' && `${DAYS_OF_WEEK.find(d => d.value === rule.day_of_week)?.label}曜`}
                                    {rule.scope === 'daily' && format(parseISO(rule.specific_date), 'MM/dd')}
                                    <span className="mx-2 text-muted-foreground opacity-50">→</span>
                                    <span className="font-bold">
                                        {type === 'deadline' ? rule.value : (rule.value === 'true' ? "対象" : "休息日")}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                            onClick={() => onDelete(rule.id)}
                        >
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-5">
                        <span>適用開始:</span>
                        <Input
                            type="date"
                            className="h-7 w-36 text-xs"
                            value={format(parseISO(rule.created_at), 'yyyy-MM-dd')}
                            onChange={(e) => onUpdateCreatedAt(rule.id, e.target.value)}
                        />
                    </div>
                </div>
            ))}
        </div>
    )
}
