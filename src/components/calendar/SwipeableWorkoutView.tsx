import { useState, useRef, useMemo, useCallback } from 'react'
import { format, addDays, subDays, isSameDay, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorkoutCard } from './WorkoutCard'
import { Database } from '@/types/database.types'
import { useSwipeable } from 'react-swipeable'

type Submission = Database['public']['Tables']['submissions']['Row']
type SubmissionItem = Database['public']['Tables']['submission_items']['Row']

interface SwipeableWorkoutViewProps {
  selectedDate: Date
  onDateChange: (date: Date) => void
  workouts: Submission[]
  onDelete?: (id: number, r2Key: string | null) => Promise<any>
  isAdmin?: boolean
  onPlay?: (key: string) => void
  submissionItems?: SubmissionItem[]
}

export function SwipeableWorkoutView({
  selectedDate,
  onDateChange,
  workouts,
  onDelete,
  isAdmin,
  onPlay,
  submissionItems = []
}: SwipeableWorkoutViewProps) {
  const CARD_WIDTH_PERCENT = 85
  const PEEK_WIDTH_PERCENT = (100 - CARD_WIDTH_PERCENT) / 2
  const BASE_TRANSLATE = -(CARD_WIDTH_PERCENT - PEEK_WIDTH_PERCENT)
  const PREV_TRANSLATE = PEEK_WIDTH_PERCENT
  const NEXT_TRANSLATE = -(CARD_WIDTH_PERCENT * 2 - PEEK_WIDTH_PERCENT)

  const [swipeOffset, setSwipeOffset] = useState(0)
  const [, setIsSwiping] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [visualTranslate, setVisualTranslate] = useState(BASE_TRANSLATE)

  // プロップスの日付が変わった時に瞬時に位置をリセットする
  const [prevPropDate, setPrevPropDate] = useState(selectedDate)
  if (selectedDate.getTime() !== prevPropDate.getTime()) {
    setPrevPropDate(selectedDate)
    setVisualTranslate(BASE_TRANSLATE)
    setIsAnimating(false)
    setSwipeOffset(0)
    setIsSwiping(false)
  }

  const containerRef = useRef<HTMLDivElement>(null)

  // 日付ごとのワークアウトを取得
  const getWorkoutsForDate = useCallback((date: Date) => {
    return workouts.filter(s => {
      if (!s.target_date) return false
      return isSameDay(parseISO(s.target_date), date)
    })
  }, [workouts])

  // 効果的な提出項目を取得
  const getEffectiveItems = useCallback((date: Date) => {
    const endOfDate = new Date(date)
    endOfDate.setHours(23, 59, 59, 999)
    return submissionItems.filter(item => {
      const created = parseISO(item.created_at)
      const deleted = item.deleted_at ? parseISO(item.deleted_at) : null
      return created <= endOfDate && (!deleted || deleted > endOfDate)
    })
  }, [submissionItems])

  // 前後の日付
  const prevDate = useMemo(() => subDays(selectedDate, 1), [selectedDate])
  const nextDate = useMemo(() => addDays(selectedDate, 1), [selectedDate])

  // 各日付のワークアウト
  const prevWorkouts = useMemo(() => getWorkoutsForDate(prevDate), [getWorkoutsForDate, prevDate])
  const currentWorkouts = useMemo(() => getWorkoutsForDate(selectedDate), [getWorkoutsForDate, selectedDate])
  const nextWorkouts = useMemo(() => getWorkoutsForDate(nextDate), [getWorkoutsForDate, nextDate])

  // 日付変更ハンドラー
  const goToPrev = useCallback(() => {
    if (isAnimating) return
    setIsAnimating(true)
    setVisualTranslate(PREV_TRANSLATE)
    setTimeout(() => {
      onDateChange(prevDate)
    }, 310)
  }, [isAnimating, onDateChange, prevDate, PREV_TRANSLATE])

  const goToNext = useCallback(() => {
    if (isAnimating) return
    setIsAnimating(true)
    setVisualTranslate(NEXT_TRANSLATE)
    setTimeout(() => {
      onDateChange(nextDate)
    }, 310)
  }, [isAnimating, onDateChange, nextDate, NEXT_TRANSLATE])

  // スワイプハンドラー
  const swipeHandlers = useSwipeable({
    onSwiping: (event) => {
      if (isAnimating) return
      setIsSwiping(true)
      setSwipeOffset(event.deltaX)
    },
    onSwipedLeft: () => {
      if (isAnimating) return
      setIsSwiping(false)
      if (swipeOffset < -50) goToNext()
      else setSwipeOffset(0)
    },
    onSwipedRight: () => {
      if (isAnimating) return
      setIsSwiping(false)
      if (swipeOffset > 50) goToPrev()
      else setSwipeOffset(0)
    },
    onSwiped: () => {
      setIsSwiping(false)
      setSwipeOffset(0)
    },
    preventScrollOnSwipe: true,
    trackMouse: true,
    delta: 10,
  })

  const renderDateCard = (date: Date, submissions: Submission[], position: 'prev' | 'current' | 'next') => {
    const formattedDate = format(date, 'yyyy/MM/dd(eee)', { locale: ja })
    const effectiveItems = getEffectiveItems(date)

    let isMain = false
    if (!isAnimating) {
      isMain = position === 'current'
    } else {
      if (visualTranslate === PREV_TRANSLATE) isMain = position === 'prev'
      if (visualTranslate === NEXT_TRANSLATE) isMain = position === 'next'
      else isMain = position === 'current'
    }

    return (
      <div className={`space-y-3 px-2 h-full transition-opacity duration-300 ${isMain ? 'opacity-100' : 'opacity-40'}`}>
        <div className="flex items-center justify-between pt-2">
          <h3 className="text-[13px] font-bold tracking-wider text-[#1e293b] dark:text-slate-200">
            WORKOUTS: {formattedDate}
          </h3>
        </div>

        {submissions.length > 0 ? (
          <div className="flex flex-col gap-3">
            {submissions.map((s) => {
              const item = effectiveItems.find(i => i.id === s.submission_item_id)
              return (
                <WorkoutCard
                  key={s.id}
                  submission={s}
                  onDelete={isMain ? onDelete : undefined}
                  isAdmin={isAdmin}
                  onPlay={isMain ? onPlay : undefined}
                  itemName={item?.name}
                />
              )
            })}
          </div>
        ) : (
          <div className="py-12 text-center rounded-lg border border-dashed border-muted-foreground/20">
            <p className="text-sm text-muted-foreground">
              この日のワークアウトはありません
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative pb-12" ref={containerRef}>
      <div className="hidden sm:block">
        <Button
          variant="outline"
          size="icon"
          className="absolute -left-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full shadow-lg bg-background/80 backdrop-blur-sm"
          onClick={goToPrev}
          disabled={isAnimating}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="absolute -right-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full shadow-lg bg-background/80 backdrop-blur-sm"
          onClick={goToNext}
          disabled={isAnimating}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      <div className="overflow-hidden" {...swipeHandlers}>
        <div
          className="flex items-start cursor-grab active:cursor-grabbing"
          style={{
            width: '100%',
            transform: `translateX(calc(${visualTranslate}% + ${swipeOffset}px))`,
            // アニメーション中のみ transition を有効にし、リセット時は無効にする
            transition: isAnimating ? 'transform 310ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
          }}
        >
          <div className="flex-shrink-0" style={{ width: `${CARD_WIDTH_PERCENT}%` }}>
            {renderDateCard(prevDate, prevWorkouts, 'prev')}
          </div>
          <div className="flex-shrink-0" style={{ width: `${CARD_WIDTH_PERCENT}%` }}>
            {renderDateCard(selectedDate, currentWorkouts, 'current')}
          </div>
          <div className="flex-shrink-0" style={{ width: `${CARD_WIDTH_PERCENT}%` }}>
            {renderDateCard(nextDate, nextWorkouts, 'next')}
          </div>
        </div>
      </div>

      <div className="flex justify-center gap-2 pt-4 sm:hidden">
        <div className={`w-2 h-2 rounded-full transition-colors ${visualTranslate === PREV_TRANSLATE ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
        <div className={`w-3 h-2 rounded-full transition-colors ${visualTranslate === BASE_TRANSLATE ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
        <div className={`w-2 h-2 rounded-full transition-colors ${visualTranslate === NEXT_TRANSLATE ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
      </div>
    </div>
  )
}
