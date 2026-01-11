import { useMemo, useState, useEffect } from 'react'
import { Calendar } from "@/components/ui/calendar"
import { useWorkoutHistory } from '@/hooks/useWorkoutHistory'
import { format, isSameDay, parseISO, differenceInDays, startOfDay, addMonths, subMonths, isSameMonth, lastDayOfMonth } from 'date-fns'
import { ja } from 'date-fns/locale'
import { SwipeableWorkoutView } from '@/components/calendar/SwipeableWorkoutView'
import { Clock, CalendarDays, ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
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
import { VideoPlayerModal } from '@/components/admin/VideoPlayerModal'
import { getR2PublicUrl } from '@/lib/r2'
import { useSubmissionRules } from '@/hooks/useSubmissionRules'
import { useSubmissionItems } from '@/hooks/useSubmissionItems'
import { useSwipeable } from 'react-swipeable'
import { useGamification } from '@/hooks/useGamification'
import { GamificationNotifications } from '@/components/gamification/GamificationPopup'
// Popover is used instead of Tooltip for better mobile compatibility

export default function CalendarPage() {
    const { profile, user } = useAuth()
    const isAdmin = profile?.role === 'admin'
    const [selectedClientId, setSelectedClientId] = useState<string | undefined>(() => {
        // Initialize from localStorage for admins
        if (typeof window !== 'undefined') {
            return localStorage.getItem('lastSelectedClientId') || undefined
        }
        return undefined
    })
    const [clients, setClients] = useState<{ id: string; display_name: string | null; past_submission_days: number; future_submission_days: number; deadline_mode: 'none' | 'mark' | 'block' }[]>([])
    const [selectedVideo, setSelectedVideo] = useState<string | null>(null)

    // Determine whose rules to fetch: selected user for admin, or self for client
    const targetUserId = isAdmin ? (selectedClientId || user?.id) : user?.id
    const { getRuleForDate, isDeadlinePassed, loading: _rulesLoading } = useSubmissionRules(targetUserId)
    const { items: submissionItems } = useSubmissionItems(targetUserId)

    const { workouts, loading, refetch, deleteWorkout, updateWorkoutStatus, addAdminComment, markCommentAsRead } = useWorkoutHistory(selectedClientId)
    const [selectedDate, setSelectedDate] = useState<Date>(new Date())
    const [currentMonth, setCurrentMonth] = useState<Date>(new Date())
    const [isDatePickerOpen, setIsDatePickerOpen] = useState(false)

    // 定休日判定関数
    const isRestDay = (date: Date): boolean => {
        const targetDayRule = getRuleForDate(date, 'target_day')
        return targetDayRule !== null && targetDayRule !== 'true'
    }

    // ゲーミフィケーションフック
    const gamification = useGamification({
        targetUserId: isAdmin ? selectedClientId : user?.id,
        submissions: workouts,
        isRestDay
    })

    // クライアント側: localStorageから保留中のリバイバル通知を読み取り表示
    const [clientNotifications, setClientNotifications] = useState<Array<{
        type: 'revival_success';
        message: string;
        targetDate?: string;
    }>>([])

    useEffect(() => {
        // 管理者はスキップ
        if (isAdmin || !user?.id) return

        const notificationKey = `pending_revival_${user.id}`
        const stored = localStorage.getItem(notificationKey)

        if (stored) {
            try {
                const notifications = JSON.parse(stored)
                if (notifications.length > 0) {
                    setClientNotifications(notifications)
                    // 表示後にクリア
                    localStorage.removeItem(notificationKey)
                }
            } catch (e) {
                console.error('Failed to parse notifications:', e)
                localStorage.removeItem(notificationKey)
            }
        }
    }, [isAdmin, user?.id])

    // 月変更ハンドラー（日付の同期付き）
    const handleMonthChange = (newMonth: Date) => {
        setCurrentMonth(newMonth)

        // 現在選択されている「日」を取得
        const currentDay = selectedDate.getDate()
        // 新しい月の最後の日を取得
        const lastDayOfNewMonth = lastDayOfMonth(newMonth).getDate()

        // 31日を選択していて、遷移先が30日までしかない場合を考慮
        const nextDay = Math.min(currentDay, lastDayOfNewMonth)

        const nextDate = new Date(newMonth.getFullYear(), newMonth.getMonth(), nextDay)
        setSelectedDate(nextDate)
    }

    // 月スワイプ用ハンドラー
    const monthSwipeHandlers = useSwipeable({
        onSwipedLeft: () => handleMonthChange(addMonths(currentMonth, 1)),
        onSwipedRight: () => handleMonthChange(subMonths(currentMonth, 1)),
        preventScrollOnSwipe: true,
        trackMouse: false,
    })

    // 日付変更時に月も同期
    const handleDateChange = (date: Date) => {
        setSelectedDate(date)
        if (!isSameMonth(date, currentMonth)) {
            setCurrentMonth(date)
        }
    }

    // 今日ボタン
    const goToToday = () => {
        const today = new Date()
        setSelectedDate(today)
        setCurrentMonth(today)
    }

    const isToday = isSameDay(selectedDate, new Date())

    // Persist selection for admins
    useEffect(() => {
        if (isAdmin) {
            if (selectedClientId) {
                localStorage.setItem('lastSelectedClientId', selectedClientId)
            } else {
                localStorage.removeItem('lastSelectedClientId')
            }
        }
    }, [selectedClientId, isAdmin])

    // Fetch clients if admin
    useEffect(() => {
        if (isAdmin) {
            const fetchClients = async () => {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('id, display_name, past_submission_days, future_submission_days, deadline_mode')
                    .eq('role', 'client')
                if (!error && data) {
                    // Sort clients by display_name
                    const sortedClients = [...(data as any[])].sort((a, b) =>
                        (a.display_name || '').localeCompare(b.display_name || '', 'ja')
                    )
                    setClients(sortedClients)
                }
            }
            fetchClients()
        }
    }, [isAdmin])


    // Generate mapping of dates to their status indicators
    const dayStatusMap = useMemo(() => {
        const map: Record<string, {
            hasSubmission: boolean;
            hasSuccess: boolean;
            hasFail: boolean;
            hasAdminComment: boolean;
            hasUnreadComment: boolean;
            submittedCount: number;
            submittedItemIds: Set<number | null>; // 重複カウント防止用
        }> = {}

        workouts.forEach(s => {
            if (!s.target_date) return
            const d = parseISO(s.target_date)
            const key = format(d, "yyyy-MM-dd")
            if (!map[key]) {
                map[key] = {
                    hasSubmission: false,
                    hasSuccess: false,
                    hasFail: false,
                    hasAdminComment: false,
                    hasUnreadComment: false,
                    submittedCount: 0,
                    submittedItemIds: new Set()
                }
            }

            map[key].hasSubmission = true
            map[key].hasSuccess ||= s.status === "success"
            map[key].hasFail ||= s.status === "fail"
            map[key].hasAdminComment ||= (s as any).admin_comments?.length > 0
            map[key].hasUnreadComment ||= (s as any).admin_comments?.some((c: any) => !c.read_at)

            // 却下がある場合は、他がどうあれその日は「却下あり」
            // 日付別の承認状態を管理するために、全項目が成功しているかも後で重要になる

            // 同じ項目ID（nullを含む）の投稿がまだカウントされていない場合のみカウント
            if (!map[key].submittedItemIds.has(s.submission_item_id)) {
                map[key].submittedCount += 1
                map[key].submittedItemIds.add(s.submission_item_id)
            }
        })

        return map
    }, [workouts])



    // 効果的な提出項目を取得するヘルパー関数
    const getEffectiveSubmissionItems = (date: Date) => {
        const endOfTargetDate = new Date(date)
        endOfTargetDate.setHours(23, 59, 59, 999)
        return submissionItems.filter(item => {
            const created = parseISO(item.created_at)
            const deleted = item.deleted_at ? parseISO(item.deleted_at) : null
            return created <= endOfTargetDate && (!deleted || deleted > endOfTargetDate)
        })
    }

    if (loading && workouts.length === 0) {
        return <div className="p-8 text-center text-muted-foreground animate-pulse">データを読み込み中...</div>
    }

    return (
        <div className="space-y-6 container mx-auto max-w-4xl pb-20 pt-4 px-0 sm:px-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-4 sm:px-0">
                <div className="flex items-center gap-4">
                    <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
                    {isAdmin && (
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-muted-foreground">Client:</span>
                            <Select
                                value={selectedClientId || "all"}
                                onValueChange={(value) => setSelectedClientId(value === "all" ? undefined : value)}
                            >
                                <SelectTrigger className="w-[180px] h-9">
                                    <SelectValue placeholder="自分を表示中" />
                                </SelectTrigger>
                                <SelectContent>
                                    {clients.map((client) => (
                                        <SelectItem key={client.id} value={client.id}>
                                            {client.display_name || "不明なユーザー"}
                                        </SelectItem>
                                    ))}
                                    <SelectItem value="all">自分を表示中</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </div>
                {/* 今日ボタン */}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={goToToday}
                    disabled={isToday}
                    className="gap-1"
                >
                    <CalendarDays className="w-4 h-4" />
                    今日
                </Button>
            </div>

            {/* ゲーミフィケーションダッシュボード（クライアント時または管理者がクライアント選択時） */}
            {(!isAdmin || selectedClientId) && gamification && (
                <>
                    <div className="mx-1 sm:mx-0 px-4 py-3 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 rounded-lg border space-y-2">
                        {/* 上段: ストリークと累積回数 - 均等配置 */}
                        <div className="flex items-center justify-between px-2">
                            {/* ストリーク */}
                            <Popover>
                                <PopoverTrigger asChild>
                                    <button className="flex items-center gap-2 font-bold text-lg hover:opacity-80 transition-opacity cursor-help">
                                        <span className="text-xl">🔥</span>
                                        <span>{gamification.state.currentStreak}日連続</span>
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 text-sm">
                                    <p className="font-semibold mb-1">🔥 連続日数</p>
                                    <p className="text-muted-foreground">投稿を続けた日数です。定休日はカウントされません。シールドやリバイバルで途切れを防げます！</p>
                                </PopoverContent>
                            </Popover>

                            {/* 累積回数 */}
                            <Popover>
                                <PopoverTrigger asChild>
                                    <button className="flex items-center gap-2 text-muted-foreground text-lg hover:opacity-80 transition-opacity cursor-help">
                                        <span className="font-bold">TOTAL:</span>
                                        <span className="font-semibold">{gamification.state.totalReps}回</span>
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 text-sm">
                                    <p className="font-semibold mb-1">💪 累積回数</p>
                                    <p className="text-muted-foreground">これまでに承認されたトレーニングの合計回数です。頑張りの積み重ねが一目でわかります！</p>
                                </PopoverContent>
                            </Popover>
                        </div>

                        {/* 下段: シールド・ストレート・復活（Popoverで説明表示） - 均等配置 */}
                        <div className="flex items-center justify-between px-2 text-sm text-muted-foreground">
                            {/* シールド */}
                            <Popover>
                                <PopoverTrigger asChild>
                                    <button className="flex items-center gap-1.5 cursor-help hover:opacity-80 transition-opacity">
                                        <img src="/assets/shield.png" alt="シールド" className="w-10 h-10" />
                                        <span className="font-semibold text-base">{gamification.state.shieldStock}</span>
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 text-sm">
                                    <p className="font-semibold mb-1">🛡️ シールド</p>
                                    <p className="text-muted-foreground">投稿を忘れた日に自動消費され、ストリークを守ります。7日連続達成でシールド+1獲得！</p>
                                </PopoverContent>
                            </Popover>

                            {/* ストレート達成（7日間シールドなし） */}
                            <Popover>
                                <PopoverTrigger asChild>
                                    <button className="flex items-center gap-1.5 cursor-help hover:opacity-80 transition-opacity">
                                        <img src="/assets/perfect_crown.png" alt="ストレート" className="w-10 h-10" />
                                        <span className="font-semibold text-base">{gamification.state.perfectWeekCount}</span>
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 text-sm">
                                    <p className="font-semibold mb-1">👑 ストレート達成</p>
                                    <p className="text-muted-foreground">7日連続をシールドやリバイバルなしで達成した回数。真の継続力の証！</p>
                                </PopoverContent>
                            </Popover>

                            {/* リバイバル */}
                            <Popover>
                                <PopoverTrigger asChild>
                                    <button className="flex items-center gap-1.5 cursor-help hover:opacity-80 transition-opacity">
                                        <img src="/assets/revival_badge.png" alt="復活" className="w-10 h-10" />
                                        <span className="font-semibold text-base">
                                            {(workouts || []).filter(w => w.status === 'success' && w.is_revival === true).length}
                                        </span>
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-64 text-sm">
                                    <p className="font-semibold mb-1">🔥 リバイバル</p>
                                    <p className="text-muted-foreground">過去の空白日を後から埋めてストリークを復活させた回数。諦めない心の証！</p>
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>
                </>
            )}

            <Card className="border shadow-sm overflow-hidden mx-1 sm:mx-0">
                <CardHeader className="py-2 border-b bg-muted/30">
                    <div className="flex items-center justify-between">
                        {/* 月移動ボタン（デスクトップ用・左） */}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleMonthChange(subMonths(currentMonth, 1))}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>

                        {/* ミニカレンダー日付選択 */}
                        <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                            <PopoverTrigger asChild>
                                <button className="text-sm font-medium hover:underline cursor-pointer px-2 py-1 rounded hover:bg-muted/50 transition-colors">
                                    {format(currentMonth, 'yyyy年 M月', { locale: ja })}
                                </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="center">
                                <Calendar
                                    mode="single"
                                    selected={selectedDate}
                                    onSelect={(date) => {
                                        if (date) {
                                            handleDateChange(date)
                                            setIsDatePickerOpen(false)
                                        }
                                    }}
                                    className="rounded-md border"
                                />
                            </PopoverContent>
                        </Popover>

                        {/* 月移動ボタン（デスクトップ用・右） */}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleMonthChange(addMonths(currentMonth, 1))}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="p-0 sm:p-2" {...monthSwipeHandlers}>
                    <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={(d) => d && handleDateChange(d)}
                        month={currentMonth}
                        onMonthChange={setCurrentMonth}
                        className="w-full p-0 sm:p-3"
                        classNames={{
                            months: "w-full",
                            month: "w-full",
                            caption: "hidden", // カスタムヘッダーを使用するため非表示
                            table: "w-full border-collapse",
                            head_row: "flex w-full mb-2",
                            head_cell: "text-muted-foreground w-[14.28%] font-normal text-[0.8rem]",
                            row: "flex w-full mt-0 border-b last:border-b-0",
                            cell: "h-auto w-[14.28%] text-center text-sm p-0 relative focus-within:relative focus-within:z-20 border-r last:border-r-0",
                            day: "h-auto w-full p-0 font-normal aria-selected:opacity-100",
                        }}
                        components={{
                            DayContent: ({ date }) => {
                                const key = format(date, "yyyy-MM-dd")
                                const st = dayStatusMap[key]
                                const isSelected = isSameDay(date, selectedDate)
                                const isTodayDate = isSameDay(date, new Date())

                                // Fetch rules for this specific day
                                const deadlineRule = getRuleForDate(date, 'deadline')
                                const targetDayRule = getRuleForDate(date, 'target_day')
                                const isTargetDay = targetDayRule === null || targetDayRule === 'true'

                                const submittedCount = st?.submittedCount || 0

                                // Calculate required items for this specific date (Logical Delete aware)
                                const effectiveItems = getEffectiveSubmissionItems(date)

                                const totalItems = effectiveItems.length > 0 ? effectiveItems.length : 1

                                // 全ての動画が承認済みかどうか
                                // submissions の中からこの日付かつ success のものを数える
                                const successCount = (workouts || []).filter(s =>
                                    s.target_date &&
                                    isSameDay(parseISO(s.target_date), date) &&
                                    s.status === 'success'
                                ).reduce((acc, cur) => {
                                    // 重複カウント防止（WorkoutCard側と同じロジックにする必要があるが、ここでは項目IDベースで数える）
                                    return acc.add(cur.submission_item_id), acc
                                }, new Set<number | null>()).size

                                const isAllApproved = successCount >= totalItems && !st?.hasFail
                                const isComplete = submittedCount >= totalItems

                                // リバイバル日かどうか（この日付にis_revival=trueの承認済み投稿があるか）
                                const isRevivalDay = (workouts || []).some(s =>
                                    s.target_date &&
                                    isSameDay(parseISO(s.target_date), date) &&
                                    s.status === 'success' &&
                                    s.is_revival === true
                                )

                                // 投稿可能範囲の計算
                                const today = startOfDay(new Date())
                                const dateStart = startOfDay(date)
                                const daysDiff = differenceInDays(dateStart, today)
                                // 管理者がクライアントを選択した場合は、そのクライアントの投稿制限を使用
                                const selectedClientProfile = selectedClientId ? clients.find(c => c.id === selectedClientId) : null
                                const pastAllowed = selectedClientProfile?.past_submission_days ?? profile?.past_submission_days ?? 0
                                const futureAllowed = selectedClientProfile?.future_submission_days ?? profile?.future_submission_days ?? 0
                                const isWithinAllowedRange =
                                    daysDiff === 0 ||
                                    (daysDiff > 0 && daysDiff <= futureAllowed) ||
                                    (daysDiff < 0 && Math.abs(daysDiff) <= pastAllowed)

                                // カウント・期限・投稿UIの表示（統一）
                                const showInfo = isWithinAllowedRange && isTargetDay

                                return (
                                    <div className="relative flex flex-col items-center justify-start w-full min-h-[95px] sm:min-h-[105px] pt-1 pb-1 transition-colors hover:bg-muted/10 font-sans">
                                        {/* Date Number */}
                                        <div
                                            className={`w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center rounded-full text-sm sm:text-base transition-all duration-200 z-10 mb-1 ${isSelected
                                                ? 'bg-primary text-primary-foreground font-bold shadow-md'
                                                : isTodayDate ? 'bg-accent text-accent-foreground font-bold' : 'text-foreground font-medium'
                                                }`}
                                        >
                                            {date.getDate()}
                                        </div>

                                        {/* Admin Comment Indicator (Calendar Cell Corner) */}
                                        {st?.hasAdminComment && (
                                            <div className="absolute top-1 right-1 z-20">
                                                <MessageSquare className="w-2.5 h-2.5 text-orange-500 fill-orange-500/20" />
                                                {st.hasUnreadComment && (
                                                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
                                                )}
                                            </div>
                                        )}

                                        {/* Shield Day Indicator (Left Corner) */}
                                        {gamification.isShieldDay(date) && (
                                            <div className="absolute top-1 left-1 z-20">
                                                <img src="/assets/shield.png" alt="" className="w-3 h-3 opacity-80" />
                                            </div>
                                        )}

                                        <div className="flex flex-col items-center justify-center w-full min-h-[28px] relative">
                                        </div>

                                        {/* Stamp Overlay - セル全体に対してabsolute */}
                                        {st?.hasSubmission && (
                                            <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none overflow-visible">
                                                {st.hasFail ? (
                                                    <img
                                                        src="/assets/stamps/yousyuusei-120.png"
                                                        alt="Rejected"
                                                        className="w-16 h-16 sm:w-20 sm:h-20 object-contain drop-shadow-md opacity-85"
                                                    />
                                                ) : isAllApproved && isRevivalDay ? (
                                                    /* リバイバル: フェニックスアイコンをセル全体に大きく表示 */
                                                    <img
                                                        src="/assets/phoenix.png"
                                                        alt="Revival"
                                                        className="w-16 h-16 sm:w-20 sm:h-20 object-contain drop-shadow-lg"
                                                    />
                                                ) : isAllApproved ? (
                                                    <img
                                                        src="/assets/stamps/azasu-120.png"
                                                        alt="Approved"
                                                        className="w-16 h-16 sm:w-20 sm:h-20 object-contain drop-shadow-md opacity-85 rotate-[-5deg]"
                                                    />
                                                ) : null}
                                            </div>
                                        )}

                                        {/* 緑インジケーター - 最上位レイヤーでセル中央に表示 */}
                                        {st?.hasSubmission && !st.hasFail && (
                                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 flex items-center gap-0.5">
                                                {isComplete && <div className="w-2 h-2 rounded-full bg-green-500 shadow-md border border-white" />}
                                                {!isComplete && <div className="w-2 h-2 rounded-full bg-yellow-400 shadow-md border border-white" />}
                                            </div>
                                        )}



                                        {/* Bottom Content: Progress & Deadline (提出対象日に表示) or 休息日表示 */}
                                        <div className="mt-auto w-full px-0.5 flex flex-col gap-0.5 items-center justify-end">
                                            {!isTargetDay ? (
                                                /* 休息日表示 */
                                                <div className="text-[10px] font-bold text-muted-foreground/60 leading-none pb-0.5">
                                                    休
                                                </div>
                                            ) : (
                                                <>
                                                    {/* Progress Indicator */}
                                                    {effectiveItems.length > 0 && showInfo && (
                                                        <div className={`text-[9px] font-bold flex items-center justify-center gap-0.5 leading-none ${isComplete ? 'text-green-600' : 'text-orange-500'}`}>
                                                            <span>{submittedCount}/{totalItems}</span>
                                                        </div>
                                                    )}

                                                    {/* Deadline */}
                                                    {deadlineRule && showInfo && (
                                                        <div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5 opacity-80 whitespace-nowrap leading-none pb-0.5">
                                                            <Clock className="w-2.5 h-2.5 shrink-0" />
                                                            <span>~{deadlineRule}</span>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )
                            },
                        }}
                    />
                </CardContent>
            </Card>

            <SwipeableWorkoutView
                selectedDate={selectedDate}
                onDateChange={handleDateChange}
                workouts={workouts}
                onDelete={deleteWorkout}
                isAdmin={isAdmin}
                onUpdateStatus={updateWorkoutStatus}
                onAddComment={addAdminComment}
                onMarkAsRead={markCommentAsRead}
                onPlay={(key: string) => setSelectedVideo(getR2PublicUrl(key))}
                submissionItems={submissionItems}
                onUploadSuccess={() => refetch(true)}
                isViewingOtherUser={false}
                pastAllowed={(() => {
                    const clientProfile = selectedClientId ? clients.find(c => c.id === selectedClientId) : null
                    return clientProfile?.past_submission_days ?? profile?.past_submission_days ?? 0
                })()}
                futureAllowed={(() => {
                    const clientProfile = selectedClientId ? clients.find(c => c.id === selectedClientId) : null
                    return clientProfile?.future_submission_days ?? profile?.future_submission_days ?? 0
                })()}
                isRestDay={(() => {
                    const targetDayRule = getRuleForDate(selectedDate, 'target_day')
                    return targetDayRule !== null && targetDayRule !== 'true'
                })()}
                isLate={(() => {
                    // 期限超過チェックは当日のみ適用（過去・未来には適用しない）
                    const isToday = isSameDay(selectedDate, new Date())
                    return isToday && isDeadlinePassed(selectedDate)
                })()}
                deadlineMode={(() => {
                    const clientProfile = selectedClientId ? clients.find(c => c.id === selectedClientId) : null
                    return clientProfile?.deadline_mode ?? (profile as any)?.deadline_mode ?? 'none'
                })()}
            />

            <VideoPlayerModal
                videoUrl={selectedVideo}
                onClose={() => setSelectedVideo(null)}
            />

            {/* ゲーミフィケーション通知ポップアップ（クライアント向け - localStorageから） */}
            {!isAdmin && (
                <GamificationNotifications
                    notifications={clientNotifications}
                    onClear={(index) => setClientNotifications(prev => prev.filter((_, i) => i !== index))}
                />
            )}
        </div >
    )
}
