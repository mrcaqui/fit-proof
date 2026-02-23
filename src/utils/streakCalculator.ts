/**
 * ゲーミフィケーション用ストリーク計算ユーティリティ
 * オンデマンドで承認済み履歴と定休日設定から各種実績を算出
 */

import { format, eachDayOfInterval, subDays, isBefore, startOfDay } from 'date-fns'

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
 * @returns ストリーク計算結果
 */
export function calculateStreak(
    submissions: SubmissionForStreak[],
    isRestDay: IsRestDayFn,
    currentShieldStock: number,
    effectiveFrom?: Date
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

    // 最新の連続記録を逆順で計算
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
            // 承認がない日
            if (shieldsRemaining > 0) {
                // シールドで守る
                shieldDays.push(dateStr)
                shieldsRemaining--
                consecutiveDays++
                currentPerfectStreak = 0 // シールド使用でストレートはリセット
            } else {
                // ストリーク終了
                break
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
