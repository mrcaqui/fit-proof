import { useState, useRef, useMemo, useCallback } from 'react'
import { format, addDays, subDays, isSameDay, parseISO, differenceInDays, startOfDay } from 'date-fns'
import { ja } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorkoutCard } from './WorkoutCard'
import { PendingUploadCard } from './PendingUploadCard'
import { Database } from '@/types/database.types'
import { useSwipeable } from 'react-swipeable'
import { toast } from '@/hooks/use-toast'

type Submission = Database['public']['Tables']['submissions']['Row']
type SubmissionItem = Database['public']['Tables']['submission_items']['Row']

interface SwipeableWorkoutViewProps {
  selectedDate: Date
  onDateChange: (date: Date) => void
  workouts: Submission[]
  onDelete?: (id: number, r2Key: string | null) => Promise<any>
  isAdmin?: boolean
  onPlay?: (key: string) => void
  onUpdateStatus?: (id: number, status: 'success' | 'fail' | 'excused' | null) => Promise<any>
  onAddComment?: (submissionId: number, content: string) => Promise<any>
  onDeleteComment?: (commentId: string) => Promise<any>
  onMarkAsRead?: (commentId: string) => Promise<any>
  submissionItems?: SubmissionItem[]
  onUploadSuccess?: () => void
  isViewingOtherUser?: boolean
  shieldStock?: number
  isShieldDay?: (date: Date) => boolean
  onApplyShield?: (targetDate: string) => Promise<boolean>
  onRemoveShield?: (targetDate: string) => Promise<boolean>
  pastAllowed?: number
  futureAllowed?: number
  isRestDay?: (date: Date) => boolean
  isGroupFulfilledForDate?: (date: Date) => boolean
  isLate?: boolean
  deadlineMode?: 'none' | 'mark'
  showDuplicateToUser?: boolean
}

export function SwipeableWorkoutView({
  selectedDate,
  onDateChange,
  workouts,
  onDelete,
  isAdmin,
  onPlay,
  onUpdateStatus,
  onAddComment,
  onDeleteComment,
  onMarkAsRead,
  submissionItems = [],
  onUploadSuccess,
  isViewingOtherUser = false,
  shieldStock = 0,
  isShieldDay,
  onApplyShield,
  onRemoveShield,
  pastAllowed = 0,
  futureAllowed = 0,
  isRestDay = () => false,
  isGroupFulfilledForDate = () => false,
  isLate = false,
  deadlineMode = 'none',
  showDuplicateToUser = false
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

  // 効果的な提出項目を取得（[effective_from, effective_to) セマンティクス）
  const getEffectiveItems = useCallback((date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd')
    return submissionItems.filter(item => {
      const effectiveFrom = format(parseISO(item.effective_from), 'yyyy-MM-dd')
      if (effectiveFrom > dateStr) return false
      if (item.effective_to) {
        const effectiveTo = format(parseISO(item.effective_to), 'yyyy-MM-dd')
        if (effectiveTo <= dateStr) return false
      }
      return true
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

        {(() => {
          // shield 行を除外した実際の投稿
          const videoCommentSubmissions = submissions.filter(w => w.type !== 'shield')
          // 投稿済み項目のIDセット
          const submittedItemIds = new Set(videoCommentSubmissions.map(s => s.submission_item_id))

          // 投稿制限チェック
          const today = startOfDay(new Date())
          const dateStart = startOfDay(date)
          const daysDiff = differenceInDays(dateStart, today)
          const isWithinAllowedRange =
            daysDiff === 0 || // 今日は常にOK
            (daysDiff > 0 && daysDiff <= futureAllowed) || // 未来
            (daysDiff < 0 && Math.abs(daysDiff) <= pastAllowed) // 過去
          const isWithinPastDays = daysDiff <= 0 && Math.abs(daysDiff) <= pastAllowed

          // シールド判定
          const isShield = isShieldDay?.(date) ?? false
          const hasVideoComment = videoCommentSubmissions.length > 0

          // 未投稿項目（他人のカレンダー閲覧時 / 投稿制限範囲外 / 休息日 / グループ達成済み は表示しない）
          const isDateRestDay = isRestDay(date)
          const isDateGroupFulfilled = isGroupFulfilledForDate(date)
          const pendingItems = (!isWithinAllowedRange || isDateRestDay || isDateGroupFulfilled) ? [] : effectiveItems.filter(item => !submittedItemIds.has(item.id))

          // シールドボタン表示条件
          const showShieldApply = !hasVideoComment && !isShield && shieldStock > 0 && isWithinPastDays && daysDiff < 0 && !isDateRestDay && !isDateGroupFulfilled
          const showShieldRemove = isShield && isWithinPastDays

          const hasContent = videoCommentSubmissions.length > 0 || pendingItems.length > 0 || showShieldApply || showShieldRemove || isShield

          if (!hasContent) {
            return (
              <div className="py-12 text-center rounded-lg border border-dashed border-muted-foreground/20">
                <p className="text-sm text-muted-foreground">
                  {isDateRestDay ? (
                    <span className="flex flex-col items-center gap-2">
                      <span className="text-lg font-medium">🌙 本日は休息日です</span>
                      <span className="text-xs opacity-70">しっかり休んで次のトレーニングに備えましょう</span>
                    </span>
                  ) : isDateGroupFulfilled ? (
                    <span className="flex flex-col items-center gap-2">
                      <span className="text-lg font-medium">グループ達成済み</span>
                      <span className="text-xs opacity-70">この週のグループノルマは達成済みです。投稿は不要です。</span>
                    </span>
                  ) : (
                    'この日のワークアウトはありません'
                  )}
                </p>
              </div>
            )
          }

          return (
            <div className="flex flex-col gap-3">
              {/* シールド適用済み表示（取り消しボタンを右上に統合） */}
              {isShield && (
                <div className="relative flex items-center gap-2 p-3 rounded-lg border border-primary/20 bg-primary/5">
                  <img src="/assets/shield.png" alt="シールド" className="w-8 h-8" />
                  <div>
                    <p className="text-sm font-semibold">シールド適用中</p>
                    <p className="text-xs text-muted-foreground">この日はシールドでストリークが守られています</p>
                  </div>
                  {isMain && showShieldRemove && (
                    <button
                      className={`absolute top-1.5 right-1.5 text-[11px] transition-colors ${
                        isViewingOtherUser
                          ? 'text-muted-foreground/40 pointer-events-none'
                          : 'text-muted-foreground/70 hover:text-destructive'
                      }`}
                      disabled={isViewingOtherUser}
                      onClick={async () => {
                        const dateStr = format(date, 'yyyy-MM-dd')
                        const success = await onRemoveShield?.(dateStr)
                        if (success === false) {
                          toast({
                            title: "シールドの取り消しに失敗しました",
                            description: "しばらくしてから再度お試しください",
                            variant: "destructive",
                          })
                        }
                      }}
                    >
                      取り消す
                    </button>
                  )}
                </div>
              )}
              {/* シールド適用ボタン */}
              {isMain && showShieldApply && (
                <Button
                  variant="outline"
                  className="flex items-center gap-2 w-full justify-center"
                  disabled={isViewingOtherUser}
                  onClick={async () => {
                    const dateStr = format(date, 'yyyy-MM-dd')
                    const success = await onApplyShield?.(dateStr)
                    if (success === false) {
                      toast({
                        title: "シールドの適用に失敗しました",
                        description: "しばらくしてから再度お試しください",
                        variant: "destructive",
                      })
                    }
                  }}
                >
                  <img src="/assets/shield.png" alt="" className="w-5 h-5" />
                  シールドを適用
                </Button>
              )}
              {/* 投稿済み動画 */}
              {videoCommentSubmissions.map((s) => {
                const item = effectiveItems.find(i => i.id === s.submission_item_id)
                return (
                  <WorkoutCard
                    key={s.id}
                    submission={s}
                    onDelete={isMain ? onDelete : undefined}
                    isAdmin={isAdmin}
                    onPlay={isMain ? onPlay : undefined}
                    onUpdateStatus={isMain ? onUpdateStatus : undefined}
                    onAddComment={isMain ? onAddComment : undefined}
                    onDeleteComment={isMain ? onDeleteComment : undefined}
                    onMarkAsRead={isMain ? onMarkAsRead : undefined}
                    itemName={item?.name}
                    deadlineMode={deadlineMode}
                    {...(() => {
                      // 管理者またはshowDuplicateToUser=trueの場合のみ重複チェックを実行
                      if (!isAdmin && !showDuplicateToUser) {
                        return { duplicateType: null, duplicateInfo: null }
                      }

                      // 重複動画を探す
                      const allWorkouts = workouts || []

                      // Hash一致チェック（完全に同じ動画）
                      if (s.video_hash) {
                        const hashMatch = allWorkouts.find(w => w.id !== s.id && w.video_hash === s.video_hash)
                        if (hashMatch) {
                          return {
                            duplicateType: 'hash' as const,
                            duplicateInfo: {
                              targetDate: hashMatch.target_date || '日付不明',
                              fileName: (hashMatch as any).file_name || '不明'
                            }
                          }
                        }
                      }

                      // Duration一致チェック（Hashは違うが時間が同じ = リサイズされた可能性）
                      // null安全: 両方のハッシュが非nullで一致する場合のみスキップ
                      if (s.duration && s.duration > 0) {
                        const durationMatch = allWorkouts.find(w => w.id !== s.id && w.duration === s.duration && !(w.video_hash != null && s.video_hash != null && w.video_hash === s.video_hash))
                        if (durationMatch) {
                          return {
                            duplicateType: 'duration' as const,
                            duplicateInfo: {
                              targetDate: durationMatch.target_date || '日付不明',
                              fileName: (durationMatch as any).file_name || '不明'
                            }
                          }
                        }
                      }

                      return { duplicateType: null, duplicateInfo: null }
                    })()}
                  />
                )
              })}
              {/* 未投稿項目 */}
              {isMain && pendingItems.map((item) => (
                <PendingUploadCard
                  key={`pending-${item.id}-${format(date, 'yyyy-MM-dd')}`}
                  item={item}
                  targetDate={date}
                  onSuccess={onUploadSuccess}
                  isLate={isLate}
                  readOnly={isViewingOtherUser}
                />
              ))}
            </div>
          )
        })()}
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
