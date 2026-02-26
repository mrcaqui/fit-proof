/**
 * ゲーミフィケーション設定の型定義
 */

// ストレート達成設定
export interface GamificationStraightSettings {
    enabled: boolean        // UI表示するか
    use_target_days: boolean      // true: 目標日数設定から自動計算, false: custom_required_days を使用
    custom_required_days: number  // use_target_days=false 時に使う手動指定日数 (1-7)
    allow_revival: boolean        // ストレート判定でリバイバル日を許容するか
    allow_shield: boolean         // ストレート判定でシールド日を許容するか
}

// シールド設定
export interface GamificationShieldSettings {
    enabled: boolean                // UI表示するか
    condition_type: 'straight_count' | 'monthly_all'  // シールド獲得条件のタイプ
    straight_count: number          // ストレート達成◯回でシールド獲得
    // monthly_all選択時: 月の全対象日をストレート達成でシールド獲得
}

// リバイバル設定
export interface GamificationRevivalSettings {
    enabled: boolean        // UI表示するか
}

// 連続日数設定
export interface GamificationStreakSettings {
    enabled: boolean        // UI表示するか
}

// 累積回数(Total Reps)表示設定
export interface GamificationTotalRepsSettings {
    enabled: boolean    // UI表示するか
}

// ゲーミフィケーション設定全体
export interface GamificationSettings {
    straight: GamificationStraightSettings
    shield: GamificationShieldSettings
    revival: GamificationRevivalSettings
    streak: GamificationStreakSettings
    total_reps: GamificationTotalRepsSettings
    effective_from: string | null   // 全項目共通の適用開始日 (YYYY-MM-DD)
}

// デフォルト設定
export const DEFAULT_GAMIFICATION_SETTINGS: GamificationSettings = {
    straight: {
        enabled: true,
        use_target_days: true,
        custom_required_days: 7,
        allow_revival: false,
        allow_shield: false,
    },
    shield: {
        enabled: true,
        condition_type: 'straight_count',
        straight_count: 1   // デフォルト: 1回ストレート達成でシールド獲得
    },
    revival: {
        enabled: true
    },
    streak: {
        enabled: true
    },
    total_reps: {
        enabled: true
    },
    effective_from: null    // デフォルトはnull（全期間対象）
}
