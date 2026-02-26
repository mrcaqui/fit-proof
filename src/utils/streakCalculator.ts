/**
 * ゲーミフィケーション用ストリーク計算ユーティリティ
 * オンデマンドで承認済み履歴と定休日設定から各種実績を算出
 */

import { format, eachDayOfInterval, subDays, addDays, isBefore, startOfDay, startOfWeek } from 'date-fns'

/**
 * 投稿データの最小型
 */
export interface SubmissionForStreak {
    target_date: string | null
    status: 'success' | 'fail' | 'excused' | null
    is_revival: boolean
    type: 'video' | 'comment' | 'shield'
}

/**
 * ストリーク計算結果
 */
export interface StreakResult {
    currentStreak: number
    shieldDays: string[]        // type='shield' の submissions から取得した日付（YYYY-MM-DD形式）
    revivalDays: string[]       // リバイバルで復活した日（YYYY-MM-DD形式）
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
    effectiveTo: string | null  // 適用終了日（null = 現在有効）。[effectiveFrom, effectiveTo) で判定
}

/**
 * 承認済み投稿のある日付セットを生成（shield は除外）
 */
function getApprovedDates(submissions: SubmissionForStreak[]): Set<string> {
    const approvedDates = new Set<string>()
    for (const s of submissions) {
        if (s.target_date && s.status === 'success' && s.type !== 'shield') {
            approvedDates.add(s.target_date)
        }
    }
    return approvedDates
}

/**
 * リバイバル日の日付セットを生成（shield は除外）
 */
function getRevivalDates(submissions: SubmissionForStreak[]): Set<string> {
    const revivalDates = new Set<string>()
    for (const s of submissions) {
        if (s.target_date && s.status === 'success' && s.is_revival && s.type !== 'shield') {
            revivalDates.add(s.target_date)
        }
    }
    return revivalDates
}

/**
 * シールド適用日の日付セットを生成
 */
function getShieldDates(submissions: SubmissionForStreak[]): Set<string> {
    const shieldDates = new Set<string>()
    for (const s of submissions) {
        if (s.target_date && s.type === 'shield') {
            shieldDates.add(s.target_date)
        }
    }
    return shieldDates
}

/**
 * 現在のストリークを計算（オンデマンド）
 * シールドは手動適用のみ（DB上の type='shield' レコードで判定）
 *
 * @param submissions - 全投稿データ
 * @param isRestDay - 定休日判定関数
 * @param effectiveFrom - 適用開始日
 * @param getGroupConfigs - 日付ベースのグループ設定取得関数
 * @returns ストリーク計算結果
 */
export function calculateStreak(
    submissions: SubmissionForStreak[],
    isRestDay: IsRestDayFn,
    effectiveFrom?: Date,
    getGroupConfigs?: (date: Date) => GroupConfig[]
): StreakResult {
    const approvedDates = getApprovedDates(submissions)
    const revivalDates = getRevivalDates(submissions)
    const shieldDates = getShieldDates(submissions)

    const today = startOfDay(new Date())
    let consecutiveDays = 0

    // 過去90日間を走査（十分な期間）
    const startDate = subDays(today, 90)
    const days = eachDayOfInterval({ start: startDate, end: today })

    // フェーズA: グループ事前計算（正順）
    // weekKey: 月曜始まりの週開始日（yyyy-MM-dd）。土日を同一週に含めるため weekStartsOn: 1 を使用。
    // キー: "${weekKey}-${group.groupId}"、値: その週のグループ内承認+シールド日数
    const groupApprovalCountMap = new Map<string, number>()

    for (const day of days) {
        // effectiveFrom カットオフ
        if (effectiveFrom && isBefore(startOfDay(day), startOfDay(effectiveFrom))) continue

        const dateStr = format(day, 'yyyy-MM-dd')
        const dayOfWeek = day.getDay()
        const weekKey = format(startOfWeek(day, { weekStartsOn: 1 }), 'yyyy-MM-dd')
        const activeGroupConfigs = getGroupConfigs ? getGroupConfigs(day) : []
        for (const group of activeGroupConfigs) {
            if (!group.daysOfWeek.includes(dayOfWeek)) continue
            if (approvedDates.has(dateStr) || shieldDates.has(dateStr)) {
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

        // グループスキップ判定: この日が未承認・未シールドかつ、グループ義務が充足済みなら余剰日としてスキップ
        const activeDayGroupConfigs = getGroupConfigs ? getGroupConfigs(day) : []
        let isGroupSkipDay = false
        for (const group of activeDayGroupConfigs) {
            if (!group.daysOfWeek.includes(dayOfWeek)) continue
            const mapKey = `${weekKey}-${group.groupId}`
            const totalFulfilled = groupApprovalCountMap.get(mapKey) ?? 0
            if (!approvedDates.has(dateStr) && !shieldDates.has(dateStr) && totalFulfilled >= group.requiredCount) {
                isGroupSkipDay = true
                break
            }
        }
        if (isGroupSkipDay) continue

        const hasApproval = approvedDates.has(dateStr)

        if (hasApproval) {
            consecutiveDays++
        } else if (shieldDates.has(dateStr)) {
            // シールド適用日: ストリークを途切れさせないがカウントは増やさない（休息日と同じ扱い）
            continue
        } else {
            break // ストリーク終了
        }
    }

    return {
        currentStreak: consecutiveDays,
        shieldDays: Array.from(shieldDates),
        revivalDays: Array.from(revivalDates),
    }
}

/**
 * ストレート達成回数を週（月〜日）単位で計算
 *
 * @param submissions - 全投稿データ（type='shield' を含む）
 * @param isRestDay - 定休日判定関数
 * @param getWeeklyTarget - 日付から目標日数を返す関数
 * @param getGroupConfigs - 日付からグループ設定を返す関数
 * @param allowRevival - リバイバル日を達成カウントするか
 * @param allowShield - シールド日を達成カウントするか
 * @param confirmedBeforeDate - この日付より前の週のみ判定（undefined時は全週）
 */
export function calculatePerfectWeeks(
    submissions: SubmissionForStreak[],
    isRestDay: IsRestDayFn,
    getWeeklyTarget: (date: Date) => number,
    getGroupConfigs: (date: Date) => GroupConfig[],
    allowRevival: boolean,
    allowShield: boolean,
    confirmedBeforeDate?: Date
): number {
    const approvedDates = getApprovedDates(submissions)
    const revivalDates = getRevivalDates(submissions)
    const shieldDates = getShieldDates(submissions)

    // 全 submissions の target_date から最古日を特定
    const allTargetDates = submissions
        .filter(s => s.target_date)
        .map(s => s.target_date!)
        .sort()

    if (allTargetDates.length === 0) return 0

    const oldestDate = startOfDay(new Date(allTargetDates[0]))
    const today = startOfDay(new Date())
    const allDays = eachDayOfInterval({ start: oldestDate, end: today })

    // 日付を週（月曜始まり）ごとにグループ化
    const weekMap = new Map<string, Date[]>()
    for (const day of allDays) {
        const weekKey = format(startOfWeek(day, { weekStartsOn: 1 }), 'yyyy-MM-dd')
        if (!weekMap.has(weekKey)) {
            weekMap.set(weekKey, [])
        }
        weekMap.get(weekKey)!.push(day)
    }

    let perfectWeekCount = 0

    for (const [weekKey, weekDays] of weekMap) {
        // 確定週チェック: 週の最終日（日曜）が confirmedBeforeDate より前でなければスキップ
        const weekStart = new Date(weekKey)
        const weekEnd = addDays(weekStart, 6)
        if (confirmedBeforeDate && !isBefore(weekEnd, confirmedBeforeDate)) {
            continue
        }

        let achieved = 0
        const processedGroups = new Set<string>()

        for (const day of weekDays) {
            if (isRestDay(day)) continue

            const dateStr = format(day, 'yyyy-MM-dd')
            const dayOfWeek = day.getDay()
            const activeGroupConfigs = getGroupConfigs(day)

            // グループ日の処理
            let isGroupDay = false
            for (const group of activeGroupConfigs) {
                if (!group.daysOfWeek.includes(dayOfWeek)) continue
                isGroupDay = true

                // 既に処理済みのグループはスキップ
                const groupWeekKey = `${weekKey}-${group.groupId}`
                if (processedGroups.has(groupWeekKey)) break

                processedGroups.add(groupWeekKey)

                // グループに属する全曜日について、この週の対応日付を列挙
                let groupAchieved = 0
                for (const dow of group.daysOfWeek) {
                    // 週開始（月曜=1）から dow に対応する日付を計算
                    const offset = ((dow - 1) + 7) % 7
                    const groupDate = addDays(weekStart, offset)
                    const groupDateStr = format(groupDate, 'yyyy-MM-dd')

                    // effectiveFrom / effectiveTo の有効期間チェック（日単位）
                    if (groupDateStr < group.effectiveFrom) continue
                    if (group.effectiveTo && groupDateStr >= group.effectiveTo) continue

                    if (isEffectiveDay(groupDateStr, approvedDates, revivalDates, shieldDates, allowRevival, allowShield)) {
                        groupAchieved++
                    }
                }
                achieved += Math.min(groupAchieved, group.requiredCount)
                break
            }

            if (isGroupDay) continue

            // 非グループ日の処理
            if (isEffectiveDay(dateStr, approvedDates, revivalDates, shieldDates, allowRevival, allowShield)) {
                achieved++
            }
        }

        // 目標日数と比較（週内の任意の日から取得）
        const target = getWeeklyTarget(weekDays[0])
        if (achieved >= target) {
            perfectWeekCount++
        }
    }

    return perfectWeekCount
}

/**
 * 日付が「有効な達成日」かどうかを判定するヘルパー
 */
function isEffectiveDay(
    dateStr: string,
    approvedDates: Set<string>,
    revivalDates: Set<string>,
    shieldDates: Set<string>,
    allowRevival: boolean,
    allowShield: boolean
): boolean {
    if (approvedDates.has(dateStr)) {
        if (revivalDates.has(dateStr)) {
            return allowRevival
        }
        return true
    }
    if (shieldDates.has(dateStr)) {
        return allowShield
    }
    return false
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
