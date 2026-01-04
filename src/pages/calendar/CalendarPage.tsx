import { useRef, useMemo, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import { useDeadlines } from '@/hooks/useDeadlines'
import { useSubmissions } from '@/hooks/useSubmissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { format, startOfDay, addDays } from 'date-fns'
import { UploadModal } from '@/components/upload/UploadModal'

export default function CalendarPage() {
    const calendarRef = useRef<FullCalendar>(null)
    const { deadlines, loading: loadingDeadlines } = useDeadlines()
    const { submissions, loading: loadingSubmissions, refetch } = useSubmissions()
    const [selectedDate, setSelectedDate] = useState<Date | null>(null)

    const events = useMemo(() => {
        const evs: any[] = []

        // Map deadlines to calendar events
        // For daily deadlines, we need to generate them for a range
        // For simplicity, let's generate for the current month +/- 1 month
        const startRange = addDays(startOfDay(new Date()), -30)
        const endRange = addDays(startOfDay(new Date()), 60)

        deadlines.forEach((deadline) => {
            let current = new Date(startRange)
            while (current <= endRange) {
                let shouldCreate = false
                if (deadline.frequency === 'daily') {
                    shouldCreate = true
                } else if (deadline.frequency === 'weekly') {
                    // Assume weekly means once a week (e.g. Sunday)
                    // For now, let's just do daily as proof of concept if frequency is daily
                    shouldCreate = current.getDay() === 0 // Sunday
                }

                if (shouldCreate) {
                    const deadlineDate = new Date(current)
                    const [hours, minutes] = deadline.target_time.split(':').map(Number)
                    deadlineDate.setHours(hours, minutes, 0, 0)

                    // Check if there is a submission for this date
                    const submission = submissions.find((s: any) =>
                        s.target_date === format(deadlineDate, 'yyyy-MM-dd')
                    )

                    let statusColor = '#94a3b8' // Slate-400 (Default/Not submitted)
                    let title = `Deadline: ${deadline.title}`

                    if (submission) {
                        if (submission.status === 'success') {
                            statusColor = '#22c55e' // Green-500
                            title = `✅ ${deadline.title}`
                        } else if (submission.status === 'fail') {
                            statusColor = '#ef4444' // Red-500
                            title = `❌ ${deadline.title}`
                        } else if (submission.status === 'excused') {
                            statusColor = '#f59e0b' // Amber-500
                            title = `⚠️ ${deadline.title}`
                        }
                    }

                    evs.push({
                        id: `${deadline.id}-${format(deadlineDate, 'yyyyMMdd')}`,
                        title: title,
                        start: deadlineDate,
                        backgroundColor: statusColor,
                        borderColor: statusColor,
                        allDay: false,
                        extendedProps: {
                            submission,
                            deadline
                        }
                    })
                }
                current = addDays(current, 1)
            }
        })

        return evs
    }, [deadlines, submissions])

    if (loadingDeadlines || loadingSubmissions) {
        return <div className="p-8 text-center text-muted-foreground animate-pulse">カレンダーを読み込み中...</div>
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight">Calendar</h2>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Workout Schedule</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="calendar-container overflow-hidden rounded-md border bg-background p-4 shadow">
                        <FullCalendar
                            ref={calendarRef}
                            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin]}
                            initialView="dayGridMonth"
                            headerToolbar={{
                                left: 'prev,next today',
                                center: 'title',
                                right: 'dayGridMonth,timeGridWeek,listMonth'
                            }}
                            events={events}
                            height="auto"
                            locale="ja"
                            buttonText={{
                                today: '今日',
                                month: '月',
                                week: '週',
                                day: '日',
                                list: 'リスト'
                            }}
                            dateClick={(info) => {
                                setSelectedDate(info.date)
                            }}
                            eventClick={(info) => {
                                console.log('Event clicked:', info.event.extendedProps)
                            }}
                        />
                    </div>
                </CardContent>
            </Card>

            {selectedDate && (
                <UploadModal
                    targetDate={selectedDate}
                    onClose={() => setSelectedDate(null)}
                    onSuccess={() => {
                        refetch()
                        setSelectedDate(null)
                    }}
                />
            )}

            <style>{`
        .fc {
          --fc-border-color: hsl(var(--border));
          --fc-button-bg-color: hsl(var(--secondary));
          --fc-button-border-color: hsl(var(--border));
          --fc-button-hover-bg-color: hsl(var(--accent));
          --fc-button-active-bg-color: hsl(var(--accent));
          --fc-event-bg-color: hsl(var(--primary));
          --fc-event-border-color: hsl(var(--primary));
          --fc-page-bg-color: hsl(var(--background));
        }
        .fc .fc-button-primary:not(:disabled).fc-button-active, 
        .fc .fc-button-primary:not(:disabled):active {
          background-color: hsl(var(--accent));
          border-color: hsl(var(--border));
        }
        .fc .fc-button-primary {
          color: hsl(var(--foreground));
        }
      `}</style>
        </div>
    )
}
