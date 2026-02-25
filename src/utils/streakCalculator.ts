/**
 * ゲーミフィケーション用ストリーク計算ユーティリティ
 * オンデマンドで承認済み履歴と定休日設定から各種実績を算出
 */

import { format, eachDayOfInterval, subDays, isBefore, startOfDay, startOfWeek } from 'date-fns'

/**
 * 投稿データの最小型
 */
export interface SubmissionForStreak {
    target_date: string | null
    status: 'success' | 'fail' | 'excused' | null
    is_revival: boolean
}

/**
 * ストリーク計算結果
 */
export interface StreakResult {
    currentStreak: number
    shieldDays: string[]        // シールドで守られた日（YYYY-MM-DD形式）
    revivalDays: string[]       // リバイバルで復活した日（YYYY-MM-DD形式）
    perfectWeekCount: number    // ストレート達成回数
    shieldsConsumed: number     // 今回消費されるシールド数
}

/**
 * 日付が定休日かどうかを判定する関数の型
 */
export type IsRestDayFn = (date: Date) => boolean

/**
 * グループ設定の型
 * 複数の曜日をまとめ「そのうち N 日投稿すればよい」と設定するルール
 */
export interface GroupConfig {
    groupId: string
    daysOfWeek: number[]   // 0=日〜6=土
    requiredCount: number  // このグループ内で必要な投稿日数
    effectiveFrom: string  // 適用開始日（常に 'yyyy-MM-dd' 形式）
}

/**
 * 承認済み投稿のある日付セットを生成
 */
function getApprovedDates(submissions: SubmissionForStreak[]): Set<string> {
    const approvedDates = new Set<string>()
    for (const s of submissions) {
        if (s.target_date && s.status === 'success') {
            approvedDates.add(s.target_date)
        }
    }
    return approvedDates
}

/**
 * リバイバル日の日付セットを生成
 */
function getRevivalDates(submissions: SubmissionForStreak[]): Set<string> {
    const revivalDates = new Set<string>()
    for (const s of submissions) {
        if (s.target_date && s.status === 'success' && s.is_revival) {
            revivalDates.add(s.target_date)
        }
    }
    return revivalDates
}

/**
 * 現在のストリークを計算（オンデマンド）
 *
 * @param submissions - 全投稿データ
 * @param isRestDay - 定休日判定関数
 * @param currentShieldStock - 現在のシールド残数
 * @param effectiveFrom - 適用開始日
 * @param getGroupConfigs - 日付ベースのグループ設定取得関数
 * @returns ストリーク計算結果
 */
export function calculateStreak(
    submissions: SubmissionForStreak[],
    isRestDay: IsRestDayFn,
    currentShieldStock: number,
    effectiveFrom?: Date,
    getGroupConfigs?: (date: Date) => GroupConfig[]
): StreakResult {
    const approvedDates = getApprovedDates(submissions)
    const revivalDates = getRevivalDates(submissions)

    const today = startOfDay(new Date())
    let currentStreak = 0
    const shieldDays: string[] = []
    let shieldsRemaining = currentShieldStock
    let consecutiveDays = 0
    let perfectWeekCount = 0
    let currentPerfectStreak = 0

    // 過去90日間を走査（十分な期間）
    const startDate = subDays(today, 90)
    const days = eachDayOfInterval({ start: startDate, end: today })

    // フェーズA: グループ事前計算（正順）
    // weekKey: 月曜始まりの週開始日（yyyy-MM-dd）。土日を同一週に含めるため weekStartsOn: 1 を使用。
    // キー: "${weekKey}-${group.groupId}"、値: その週のグループ内承認日数
    const groupApprovalCountMap = new Map<string, number>()
    // groupShieldConsumedMap: グループ/週ごとに消費済みシールド枚数を管理する
    const groupShieldConsumedMap = new Map<string, number>()

    for (const day of days) {
        // effectiveFrom カットオフ
        if (effectiveFrom && isBefore(startOfDay(day), startOfDay(effectiveFrom))) continue

        const dateStr = format(day, 'yyyy-MM-dd')
        const dayOfWeek = day.getDay()
        const weekKey = format(startOfWeek(day, { weekStartsOn: 1 }), 'yyyy-MM-dd')
        const activeGroupConfigs = getGroupConfigs ? getGroupConfigs(day) : []
        for (const group of activeGroupConfigs) {
            if (!group.daysOfWeek.includes(dayOfWeek)) continue
            if (approvedDates.has(dateStr)) {
                const mapKey = `${weekKey}-${group.groupId}`
                groupApprovalCountMap.set(mapKey, (groupApprovalCountMap.get(mapKey) ?? 0) + 1)
            }
        }
    }

    // フェーズB: 最新の連続記録を逆順で計算
    for (let i = days.length - 1; i >= 0; i--) {
        const day = days[i]
        const dateStr = format(day, 'yyyy-MM-dd')

        // 適用開始日より前ならストリーク終了
        if (effectiveFrom && isBefore(day, effectiveFrom)) {
            break
        }

        // 定休日はスキップ（カウントしない）
        if (isRestDay(day)) {
            continue
        }

        const dayOfWeek = day.getDay()
        const weekKey = format(startOfWeek(day, { weekStartsOn: 1 }), 'yyyy-MM-dd')

        // グループスキップ判定: この日が未承認かつ、グループ義務が実績またはシールドで充足済みなら余剰日としてスキップ
        const activeDayGroupConfigs = getGroupConfigs ? getGroupConfigs(day) : []
        let isGroupSkipDay = false
        for (const group of activeDayGroupConfigs) {
            if (!group.daysOfWeek.includes(dayOfWeek)) continue
            const mapKey = `${weekKey}-${group.groupId}`
            const totalApproved = groupApprovalCountMap.get(mapKey) ?? 0
            const deficit = group.requiredCount - totalApproved
            const consumed = groupShieldConsumedMap.get(mapKey) ?? 0
            if (!approvedDates.has(dateStr) && (totalApproved >= group.requiredCount || consumed >= deficit)) {
                isGroupSkipDay = true
                break
            }
        }
        if (isGroupSkipDay) continue

        const hasApproval = approvedDates.has(dateStr)
        const isRevival = revivalDates.has(dateStr)

        if (hasApproval) {
            consecutiveDays++

            // ストレート達成のカウント（シールドもリバイバルも不使用）
            if (!isRevival && !shieldDays.includes(dateStr)) {
                currentPerfectStreak++
                if (currentPerfectStreak >= 7 && currentPerfectStreak % 7 === 0) {
                    perfectWeekCount++
                }
            } else {
                // リバイバルやシールドを使った場合はストレート連続をリセット
                currentPerfectStreak = 0
            }
        } else {
            // 承認がない日のシールド処理（グループ対応）
            let groupHandled = false
            for (const group of activeDayGroupConfigs) {
                if (!group.daysOfWeek.includes(dayOfWeek)) continue
                const mapKey = `${weekKey}-${group.groupId}`
                const totalApproved = groupApprovalCountMap.get(mapKey) ?? 0
                if (totalApproved >= group.requiredCount) break // スキップ済みのはず
                // deficit > consumed であることが isGroupSkipDay により保証されている
                if (shieldsRemaining > 0) {
                    shieldsRemaining--
                    const consumed = groupShieldConsumedMap.get(mapKey) ?? 0
                    groupShieldConsumedMap.set(mapKey, consumed + 1)
                    shieldDays.push(dateStr)
                    consecutiveDays++
                    currentPerfectStreak = 0
                    groupHandled = true
                }
                break
            }
            if (!groupHandled) {
                if (shieldsRemaining > 0) {
                    shieldDays.push(dateStr)
                    shieldsRemaining--
                    consecutiveDays++
                    currentPerfectStreak = 0
                } else {
                    break // ストリーク終了
                }
            }
        }
    }

    currentStreak = consecutiveDays

    return {
        currentStreak,
        shieldDays,
        revivalDays: Array.from(revivalDates),
        perfectWeekCount,
        shieldsConsumed: currentShieldStock - shieldsRemaining
    }
}

/**
 * 過去投稿がリバイバル対象かを判定
 *
 * @param targetDate - 投稿対象日
 * @param submissions - 全投稿データ（この投稿を含まない）
 * @param isRestDay - 定休日判定関数
 * @returns リバイバル対象ならtrue
 */
export function isRevivalCandidate(
    targetDate: Date,
    submissions: SubmissionForStreak[],
    isRestDay: IsRestDayFn
): boolean {
    const today = startOfDay(new Date())
    const targetStart = startOfDay(targetDate)

    // 未来の日付はリバイバル対象外
    if (!isBefore(targetStart, today)) {
        return false
    }

    // 定休日はリバイバル対象外
    if (isRestDay(targetDate)) {
        return false
    }

    const dateStr = format(targetStart, 'yyyy-MM-dd')
    const approvedDates = getApprovedDates(submissions)

    // 既に承認済み投稿がある日はリバイバル対象外
    if (approvedDates.has(dateStr)) {
        return false
    }

    // 過去の空白日への投稿はリバイバル対象
    return true
}

/**
 * ストレート達成時にシールドを付与するかを判定
 * 7日連続（シールド/リバイバル不使用）達成でシールド+1（上限3）
 *
 * @param currentStreak - 現在のストリーク
 * @param shieldStock - 現在のシールド残数
 * @param usedShieldOrRevival - シールドまたはリバイバルを使用したか
 * @returns 付与するシールド数（0または1）
 */
export function calculateShieldReward(
    currentStreak: number,
    shieldStock: number,
    usedShieldOrRevival: boolean
): number {
    if (usedShieldOrRevival) {
        return 0
    }

    // 7日達成ごとにシールド付与（上限3）
    if (currentStreak > 0 && currentStreak % 7 === 0 && shieldStock < 3) {
        return 1
    }

    return 0
}
