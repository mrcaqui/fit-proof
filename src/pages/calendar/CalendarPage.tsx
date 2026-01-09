import { useMemo, useState, useEffect } from 'react'
import { Calendar } from "@/components/ui/calendar"
import { useWorkoutHistory } from '@/hooks/useWorkoutHistory'
import { format, isSameDay, parseISO, differenceInDays, startOfDay, addMonths, subMonths, isSameMonth, lastDayOfMonth } from 'date-fns'
import { ja } from 'date-fns/locale'
import { UploadModal } from '@/components/upload/UploadModal'
import { SwipeableWorkoutView } from '@/components/calendar/SwipeableWorkoutView'
import { Plus, Clock, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
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
    const [clients, setClients] = useState<{ id: string; display_name: string | null }[]>([])
    const [selectedVideo, setSelectedVideo] = useState<string | null>(null)

    // Determine whose rules to fetch: selected user for admin, or self for client
    const targetUserId = isAdmin ? (selectedClientId || user?.id) : user?.id
    const { getRuleForDate, loading: _rulesLoading } = useSubmissionRules(targetUserId)
    const { items: submissionItems } = useSubmissionItems(targetUserId)

    const { workouts, loading, refetch, deleteWorkout, updateWorkoutStatus } = useWorkoutHistory(selectedClientId)
    const [selectedDate, setSelectedDate] = useState<Date>(new Date())
    const [currentMonth, setCurrentMonth] = useState<Date>(new Date())
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
    const [isDatePickerOpen, setIsDatePickerOpen] = useState(false)

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
                    .select('id, display_name')
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

    // Filter workouts for the selected date
    const selectedDateSubmissions = useMemo(() => {
        return workouts.filter(s => {
            if (!s.target_date) return false
            return isSameDay(parseISO(s.target_date), selectedDate)
        })
    }, [workouts, selectedDate])

    // Generate mapping of dates to their status indicators
    const dayStatusMap = useMemo(() => {
        const map: Record<string, {
            hasSubmission: boolean;
            hasSuccess: boolean;
            hasFail: boolean;
            hasComment: boolean;
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
                    hasComment: false,
                    submittedCount: 0,
                    submittedItemIds: new Set()
                }
            }

            map[key].hasSubmission = true
            map[key].hasSuccess ||= s.status === "success"
            map[key].hasFail ||= s.status === "fail"
            map[key].hasComment ||= false // TODO

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

    const handlePlusClick = (date: Date) => {
        setSelectedDate(date)
        setIsUploadModalOpen(true)
    }

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

                                // Show Plus if:
                                // 1. NOT complete (can still submit)
                                // 2. NOT viewing another client's calendar (admin mode)
                                // 3. IS a target day
                                // 4. Within allowed date range based on profile settings
                                const today = startOfDay(new Date())
                                const dateStart = startOfDay(date)
                                const daysDiff = differenceInDays(dateStart, today) // positive = future, negative = past

                                const pastAllowed = profile?.past_submission_days ?? 0
                                const futureAllowed = profile?.future_submission_days ?? 0

                                const isWithinAllowedRange =
                                    daysDiff === 0 || // Today is always allowed
                                    (daysDiff > 0 && daysDiff <= futureAllowed) || // Future days
                                    (daysDiff < 0 && Math.abs(daysDiff) <= pastAllowed) // Past days

                                const showPlus = isWithinAllowedRange && (!isComplete) && !selectedClientId && isTargetDay

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

                                        <div className="flex flex-col items-center justify-center w-full min-h-[28px] relative">
                                            {/* Status Indicators (Green/Yellow only - Red is replaced by rejection stamp) */}
                                            {!showPlus && st?.hasSubmission && !st.hasFail && (
                                                <div className="flex flex-wrap justify-center gap-0.5 mb-1">
                                                    {isComplete && <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-sm" />}
                                                    {!isComplete && <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 shadow-sm" />}
                                                </div>
                                            )}

                                            {/* Stamp Overlay (Absoluted over everything) */}
                                            {st?.hasSubmission && (
                                                <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
                                                    {st.hasFail ? (
                                                        <img
                                                            src="/assets/stamps/yousyuusei-120.png"
                                                            alt="Rejected"
                                                            className="w-10 h-10 object-contain drop-shadow-md opacity-85 translate-y-2"
                                                        />
                                                    ) : isAllApproved ? (
                                                        <img
                                                            src="/assets/stamps/azasu-120.png"
                                                            alt="Approved"
                                                            className="w-9 h-9 object-contain drop-shadow-md opacity-85 rotate-[-5deg] translate-y-2"
                                                        />
                                                    ) : null}
                                                </div>
                                            )}
                                        </div>

                                        {/* Plus Button */}
                                        {showPlus && (
                                            <button
                                                type="button"
                                                className="w-7 h-7 rounded-full bg-muted/90 text-muted-foreground flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-all border border-background shadow-xs hover:scale-110 active:scale-95"
                                                onClick={(e) => {
                                                    e.preventDefault()
                                                    e.stopPropagation()
                                                    handlePlusClick(date)
                                                }}
                                            >
                                                <Plus className="w-4 h-4" />
                                            </button>
                                        )}

                                        {/* Bottom Content: Progress & Deadline (Pushed to bottom only if space permits, otherwise flows) */}
                                        <div className="mt-auto w-full px-0.5 flex flex-col gap-0.5 items-center justify-end">
                                            {/* Progress Indicator */}
                                            {effectiveItems.length > 0 && isTargetDay && (
                                                <div className={`text-[9px] font-bold flex items-center justify-center gap-0.5 leading-none ${isComplete ? 'text-green-600' : 'text-orange-500'}`}>
                                                    <span>{submittedCount}/{totalItems}</span>
                                                </div>
                                            )}

                                            {/* Deadline */}
                                            {deadlineRule && isTargetDay && (
                                                <div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5 opacity-80 whitespace-nowrap leading-none pb-0.5">
                                                    <Clock className="w-2.5 h-2.5 shrink-0" />
                                                    <span>~{deadlineRule}</span>
                                                </div>
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
                onPlay={(key: string) => setSelectedVideo(getR2PublicUrl(key))}
                submissionItems={submissionItems}
            />

            {
                !selectedClientId && (
                    <Button
                        onClick={() => handlePlusClick(new Date())}
                        className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-2xl bg-primary hover:bg-primary/90 text-primary-foreground z-[100] p-0 flex items-center justify-center border-2 border-background"
                    >
                        <Plus className="w-8 h-8" />
                    </Button>
                )
            }

            {
                isUploadModalOpen && (
                    <UploadModal
                        onClose={() => {
                            setIsUploadModalOpen(false)
                        }}
                        onSuccess={() => refetch(true)}
                        targetDate={selectedDate}
                        items={getEffectiveSubmissionItems(selectedDate)}
                        completedSubmissions={selectedDateSubmissions.map(s => ({
                            id: s.id,
                            item_id: s.submission_item_id,
                            file_name: (s as any).file_name || null // Cast as any because type might not be updated in IDE yet
                        }))}
                    />
                )
            }

            <VideoPlayerModal
                videoUrl={selectedVideo}
                onClose={() => setSelectedVideo(null)}
            />
        </div >
    )
}
