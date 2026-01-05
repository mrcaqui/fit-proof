import { useMemo, useState } from 'react'
import { Calendar } from "@/components/ui/calendar"
import { useSubmissions } from '@/hooks/useSubmissions'
import { format, isSameDay, parseISO } from 'date-fns'
import { UploadModal } from '@/components/upload/UploadModal'
import { WorkoutList } from '@/components/calendar/WorkoutList'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function CalendarPage() {
    const { submissions, loading, refetch } = useSubmissions()
    const [selectedDate, setSelectedDate] = useState<Date>(new Date())
    const [isUploadOpen, setIsUploadOpen] = useState(false)


    // Filter submissions for the selected date
    const selectedSubmissions = useMemo(() => {
        return submissions.filter(s => {
            if (!s.target_date) return false
            return isSameDay(parseISO(s.target_date), selectedDate)
        })
    }, [submissions, selectedDate])

    // Generate mapping of dates to their status indicators
    const dayStatusMap = useMemo(() => {
        const map: Record<string, { hasSubmission: boolean; hasSuccess: boolean; hasFail: boolean; hasComment: boolean }> = {}


        submissions.forEach(s => {
            if (!s.target_date) return
            const d = parseISO(s.target_date)
            // Even if it's outside the interval, we map it if it exists in data
            const key = format(d, "yyyy-MM-dd")
            if (!map[key]) map[key] = { hasSubmission: false, hasSuccess: false, hasFail: false, hasComment: false }

            map[key].hasSubmission = true
            map[key].hasSuccess ||= s.status === "success"
            map[key].hasFail ||= s.status === "fail"
            // TODO: Implementation for hasComment when metadata is available
            map[key].hasComment ||= false
        })

        return map
    }, [submissions, selectedDate])

    if (loading) {
        return <div className="p-8 text-center text-muted-foreground animate-pulse">カレンダーを読み込み中...</div>
    }

    return (
        <div className="space-y-6 container mx-auto max-w-4xl pb-20 pt-4 px-2">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
            </div>

            <Card className="border shadow-sm overflow-hidden">
                <CardHeader className="py-2 border-b bg-muted/30">
                    <CardTitle className="text-sm font-medium opacity-70">Workout History</CardTitle>
                </CardHeader>
                <CardContent className="p-2">
                    <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={(d) => d && setSelectedDate(d)}
                        month={selectedDate}
                        onMonthChange={(m) => setSelectedDate(m)}
                        className="w-full"
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
                                const showPlus = !st?.hasSubmission

                                return (
                                    <div className="relative flex flex-col items-center justify-start w-full min-h-[60px] pt-1">
                                        {/* Date Text */}
                                        <div
                                            className={`
                                                w-8 h-8 flex items-center justify-center rounded-full text-base transition-all duration-200
                                                ${isSelected
                                                    ? 'bg-primary text-primary-foreground font-bold shadow-md'
                                                    : isToday ? 'bg-accent text-accent-foreground font-bold' : 'text-foreground font-medium'
                                                }
                                            `}
                                        >
                                            {date.getDate()}
                                        </div>

                                        {/* Indicators */}
                                        <div className="flex flex-wrap justify-center gap-1 mt-1 min-h-[10px] w-full px-0.5">
                                            {st?.hasSuccess && <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-sm" />}
                                            {st?.hasFail && <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-sm" />}
                                            {st?.hasComment && <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-sm" />}
                                        </div>

                                        {/* Plus Button for missing submissions */}
                                        {showPlus && (
                                            <button
                                                type="button"
                                                className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-colors border border-background shadow-xs z-20"
                                                onClick={(e) => {
                                                    e.preventDefault()
                                                    e.stopPropagation()
                                                    setSelectedDate(date)
                                                    setIsUploadOpen(true)
                                                }}
                                            >
                                                <Plus className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                )
                            },
                        }}
                    />
                </CardContent>
            </Card>

            <WorkoutList date={selectedDate} submissions={selectedSubmissions} />

            <Button
                onClick={() => setIsUploadOpen(true)}
                className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-2xl bg-primary hover:bg-primary/90 text-primary-foreground z-[100] p-0 flex items-center justify-center border-2 border-background"
            >
                <Plus className="w-8 h-8" />
            </Button>

            {isUploadOpen && (
                <UploadModal
                    targetDate={selectedDate}
                    onClose={() => setIsUploadOpen(false)}
                    onSuccess={() => {
                        refetch()
                        setIsUploadOpen(false)
                    }}
                />
            )}
        </div>
    )
}
