/**
 * グループ達成状況のユーティリティ関数
 * カレンダーUIでグループの充足状態を判定・表示するために使用
 */

import { format, startOfWeek, addDays } from 'date-fns'
import { GroupConfig } from '@/utils/streakCalculator'

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export interface GroupDayInfo {
  groupLabel: string       // "土日", "月水金" など
  requiredCount: number    // グループの必要日数
  postedDaysCount: number  // この週でグループ内投稿済み日数
  isFulfilled: boolean     // 他の日の投稿でこの日が不要になったか
}

/**
 * 指定日のグループ情報を取得する
 *
 * @param date - 対象日
 * @param groupConfigs - 全グループ設定
 * @param workouts - 全投稿データ
 * @returns グループ日でなければ null、グループ日なら GroupDayInfo
 */
export function getGroupInfoForDate(
  date: Date,
  groupConfigs: GroupConfig[],
  workouts: Array<{ target_date: string | null; status: string | null }>
): GroupDayInfo | null {
  const dayOfWeek = date.getDay()
  const dateStr = format(date, 'yyyy-MM-dd')

  // この曜日を含み、日付に有効なグループを検索（[effectiveFrom, effectiveTo) セマンティクス）
  const group = groupConfigs.find(
    g => g.daysOfWeek.includes(dayOfWeek) &&
         g.effectiveFrom <= dateStr &&
         (g.effectiveTo === null || g.effectiveTo > dateStr)
  )

  if (!group) return null

  // 週キー（月曜始まり、streakCalculator.ts と同一）
  const weekStart = startOfWeek(date, { weekStartsOn: 1 })

  // 投稿済み日付セット（fail 以外）を事前構築
  const postedDateSet = new Set<string>()
  for (const w of workouts) {
    if (w.target_date && w.status !== 'fail') {
      postedDateSet.add(w.target_date)
    }
  }

  // この週のグループ曜日を列挙し、投稿済み日数をカウント
  let postedDaysCount = 0
  for (const dow of group.daysOfWeek) {
    // 月曜(1)からのオフセットを計算。日曜(0)は +6
    const offset = (dow === 0) ? 6 : dow - 1
    const dayDate = addDays(weekStart, offset)
    const dayDateStr = format(dayDate, 'yyyy-MM-dd')

    // effectiveFrom 以前の日は除外
    if (dayDateStr < group.effectiveFrom) continue
    // effectiveTo 以降の日は除外（[effectiveFrom, effectiveTo) セマンティクス）
    if (group.effectiveTo && dayDateStr >= group.effectiveTo) continue

    if (postedDateSet.has(dayDateStr)) {
      postedDaysCount++
    }
  }

  // この日自体に投稿がない かつ requiredCount を満たしている場合に fulfilled
  const thisDateHasPost = postedDateSet.has(dateStr)
  const isFulfilled = !thisDateHasPost && postedDaysCount >= group.requiredCount

  // 曜日ラベル生成（月曜始まり順でソートして連結: 月火水木金土日）
  const mondayFirst = (d: number) => d === 0 ? 7 : d
  const sortedDays = [...group.daysOfWeek].sort((a, b) => mondayFirst(a) - mondayFirst(b))
  const groupLabel = sortedDays.map(d => DAY_LABELS[d]).join('')

  return {
    groupLabel,
    requiredCount: group.requiredCount,
    postedDaysCount,
    isFulfilled
  }
}

/**
 * 指定日がグループ充足（他の日で達成済み）かどうかを返す便利関数
 */
export function isGroupFulfilledForDate(
  date: Date,
  groupConfigs: GroupConfig[],
  workouts: Array<{ target_date: string | null; status: string | null }>
): boolean {
  const info = getGroupInfoForDate(date, groupConfigs, workouts)
  return info?.isFulfilled ?? false
}
