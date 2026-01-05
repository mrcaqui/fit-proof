import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useSubmissionRules } from '@/hooks/useSubmissionRules'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Plus, Trash2, Calendar as CalendarIcon, Clock } from 'lucide-react'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from '@/lib/utils'
import { format, parseISO } from 'date-fns'

const DAYS_OF_WEEK = [
    { label: '日', value: 0 },
    { label: '月', value: 1 },
    { label: '火', value: 2 },
    { label: '水', value: 3 },
    { label: '木', value: 4 },
    { label: '金', value: 5 },
    { label: '土', value: 6 },
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
    const [t_scope, setTScope] = useState<'monthly' | 'weekly' | 'daily'>('monthly')
    const [t_days, setTDays] = useState<number[]>([])
    const [t_date, setTDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'))
    const [t_value, setTValue] = useState(true)

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
                    client_id: selectedClientId,
                    rule_type: type,
                    scope: 'weekly',
                    day_of_week: day,
                    value: value
                })
            })
        } else {
            inserts.push({
                client_id: selectedClientId,
                rule_type: type,
                scope: scope,
                specific_date: scope === 'daily' ? specificDate : null,
                value: value
            })
        }

        const { error } = await supabase.from('submission_rules').insert(inserts as any)

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
            .from('submission_rules')
            .delete()
            .eq('id', id)

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
                            </div>
                        </CardContent>
                    </Card>

                    <RuleList
                        type="deadline"
                        rules={rules.filter(r => r.rule_type === 'deadline')}
                        onDelete={handleDeleteRule}
                    />
                </div>

                {/* Target Day Card */}
                <div className="space-y-6">
                    <Card className="border-secondary/20 shadow-md">
                        <CardHeader className="bg-secondary/5 border-b">
                            <CardTitle className="flex items-center gap-2 text-secondary-foreground">
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
                                                <SelectItem value="monthly">月間 (デフォルト)</SelectItem>
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
                                                <SelectItem value="true">投稿対象 (トレーニング日)</SelectItem>
                                                <SelectItem value="false">対象外 (休息日)</SelectItem>
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
                                                    variant={t_days.includes(d.value) ? "secondary" : "outline"}
                                                    size="sm"
                                                    className={cn(
                                                        "w-10 h-10 p-0 rounded-full transition-all duration-200 border-2",
                                                        t_days.includes(d.value)
                                                            ? "bg-secondary text-secondary-foreground shadow-md scale-105 border-secondary ring-2 ring-secondary/20"
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

                                <Button variant="secondary" className="w-full" onClick={() => handleAddRule('target_day')}>
                                    <Plus className="w-4 h-4 mr-2" /> 対象設定ルールを追加
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    <RuleList
                        type="target_day"
                        rules={rules.filter(r => r.rule_type === 'target_day')}
                        onDelete={handleDeleteRule}
                    />
                </div>
            </div>
        </div>
    )
}

function RuleList({ type, rules, onDelete }: { type: 'deadline' | 'target_day', rules: any[], onDelete: (id: number) => void }) {
    if (rules.length === 0) {
        return <div className="text-center py-8 bg-muted/10 rounded-lg text-muted-foreground text-sm border-dashed border-2">
            設定されたルールはありません
        </div>
    }

    // Sort: Daily > Weekly > Monthly, then CreatedAt Desc
    const sortedRules = [...rules].sort((a, b) => {
        const priority = { daily: 0, weekly: 1, monthly: 2 }
        if (a.scope !== b.scope) {
            return priority[a.scope as keyof typeof priority] - priority[b.scope as keyof typeof priority]
        }
        return b.id - a.id // Newest ID first for same scope
    })

    return (
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-muted">
            {sortedRules.map(rule => (
                <div key={rule.id} className="group flex items-center justify-between p-3 rounded-lg border bg-card hover:border-primary/30 transition-colors">
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
                        className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => onDelete(rule.id)}
                    >
                        <Trash2 className="w-4 h-4" />
                    </Button>
                </div>
            ))}
        </div>
    )
}
