import { useMemo, useState, useEffect } from 'react'
import { Calendar } from "@/components/ui/calendar"
import { useWorkoutHistory } from '@/hooks/useWorkoutHistory'
import { format, isSameDay, parseISO, differenceInDays, startOfDay } from 'date-fns'
import { UploadModal } from '@/components/upload/UploadModal'
import { WorkoutList } from '@/components/calendar/WorkoutList'
import { Plus, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { VideoPlayerModal } from '@/components/admin/VideoPlayerModal'
import { getR2PublicUrl } from '@/lib/r2'
import { useSubmissionRules } from '@/hooks/useSubmissionRules'
import { useSubmissionItems } from '@/hooks/useSubmissionItems'
import { ItemSelectionModal } from '@/components/calendar/ItemSelectionModal'

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

    const { workouts, loading, refetch, deleteWorkout } = useWorkoutHistory(selectedClientId)
    const [selectedDate, setSelectedDate] = useState<Date>(new Date())
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false)
    const [isItemSelectionOpen, setIsItemSelectionOpen] = useState(false)
    const [selectedSubmissionItemId, setSelectedSubmissionItemId] = useState<number | null>(null)

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
        const map: Record<string, { hasSubmission: boolean; hasSuccess: boolean; hasFail: boolean; hasComment: boolean; submittedCount: number }> = {}

        workouts.forEach(s => {
            if (!s.target_date) return
            const d = parseISO(s.target_date)
            const key = format(d, "yyyy-MM-dd")
            if (!map[key]) map[key] = { hasSubmission: false, hasSuccess: false, hasFail: false, hasComment: false, submittedCount: 0 }

            map[key].hasSubmission = true
            map[key].hasSuccess ||= s.status === "success"
            map[key].hasFail ||= s.status === "fail"
            map[key].hasComment ||= false // TODO
            map[key].submittedCount += 1
        })

        return map
    }, [workouts])

    const handlePlusClick = (date: Date) => {
        setSelectedDate(date)
        if (submissionItems.length > 0) {
            setIsItemSelectionOpen(true)
        } else {
            setSelectedSubmissionItemId(null)
            setIsUploadModalOpen(true)
        }
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
            </div>

            <Card className="border shadow-sm overflow-hidden mx-1 sm:mx-0">
                <CardHeader className="py-2 border-b bg-muted/30">
                    <CardTitle className="text-sm font-medium opacity-70">Workout History</CardTitle>
                </CardHeader>
                <CardContent className="p-0 sm:p-2">
                    <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={(d) => d && setSelectedDate(d)}
                        month={selectedDate}
                        onMonthChange={(m) => setSelectedDate(m)}
                        className="w-full p-0 sm:p-3"
                        classNames={{
                            months: "w-full",
                            month: "w-full",
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
                                const isToday = isSameDay(date, new Date())

                                // Fetch rules for this specific day
                                const deadlineRule = getRuleForDate(date, 'deadline')
                                const targetDayRule = getRuleForDate(date, 'target_day')
                                const isTargetDay = targetDayRule === null || targetDayRule === 'true'

                                const submittedCount = st?.submittedCount || 0

                                // Calculate required items for this specific date (Logical Delete aware)
                                const endOfTargetDate = new Date(date)
                                endOfTargetDate.setHours(23, 59, 59, 999)

                                const effectiveItems = submissionItems.filter(item => {
                                    const created = parseISO(item.created_at)
                                    const deleted = item.deleted_at ? parseISO(item.deleted_at) : null

                                    const isCreated = created <= endOfTargetDate
                                    const isNotDeleted = !deleted || deleted > endOfTargetDate
                                    return isCreated && isNotDeleted
                                })

                                const totalItems = effectiveItems.length > 0 ? effectiveItems.length : 1
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
                                                : isToday ? 'bg-accent text-accent-foreground font-bold' : 'text-foreground font-medium'
                                                }`}
                                        >
                                            {date.getDate()}
                                        </div>

                                        {/* Middle Content: Status & Action (Packed closer to date) */}
                                        <div className="flex flex-row items-center justify-center gap-1 w-full z-20 min-h-[28px]">
                                            {/* Status Indicators - Hide if Plus button is visible to prevent clutter */}
                                            {!showPlus && (st?.hasFail || (isComplete && st?.hasSubmission) || (!st?.hasFail && !isComplete && st?.hasSubmission)) && (
                                                <div className="flex flex-wrap justify-center gap-0.5">
                                                    {st?.hasFail && <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-sm" />}
                                                    {!st?.hasFail && isComplete && st?.hasSubmission && <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-sm" />}
                                                    {!st?.hasFail && !isComplete && st?.hasSubmission && <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 shadow-sm" />}
                                                </div>
                                            )}

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
                                        </div>

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

            <WorkoutList
                date={selectedDate}
                submissions={selectedDateSubmissions}
                onDelete={deleteWorkout}
                isAdmin={isAdmin}
                onPlay={(key) => setSelectedVideo(getR2PublicUrl(key))}
                submissionItems={submissionItems.filter(item => {
                    // Only show items that were effective for the selected date
                    const endOfSelectedDate = new Date(selectedDate)
                    endOfSelectedDate.setHours(23, 59, 59, 999)
                    const created = parseISO(item.created_at)
                    const deleted = item.deleted_at ? parseISO(item.deleted_at) : null
                    return created <= endOfSelectedDate && (!deleted || deleted > endOfSelectedDate)
                })}
            />

            {!selectedClientId && (
                <Button
                    onClick={() => handlePlusClick(new Date())}
                    className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-2xl bg-primary hover:bg-primary/90 text-primary-foreground z-[100] p-0 flex items-center justify-center border-2 border-background"
                >
                    <Plus className="w-8 h-8" />
                </Button>
            )}

            {isUploadModalOpen && (
                <UploadModal
                    onClose={() => {
                        setIsUploadModalOpen(false)
                        setSelectedSubmissionItemId(null)
                    }}
                    onSuccess={() => refetch(true)}
                    targetDate={selectedDate}
                    submissionItemId={selectedSubmissionItemId}
                />
            )}

            {isItemSelectionOpen && (
                <ItemSelectionModal
                    items={submissionItems.filter(item => !item.deleted_at)}
                    completedItemIds={selectedDateSubmissions.map(s => s.submission_item_id).filter(Boolean) as number[]}
                    onClose={() => setIsItemSelectionOpen(false)}
                    onSelect={(item) => {
                        setSelectedSubmissionItemId(item.id)
                        setIsItemSelectionOpen(false)
                        setIsUploadModalOpen(true)
                    }}
                />
            )}

            <VideoPlayerModal
                videoUrl={selectedVideo}
                onClose={() => setSelectedVideo(null)}
            />
        </div>
    )
}
