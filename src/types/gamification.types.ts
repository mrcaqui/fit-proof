/**
 * ゲーミフィケーション設定の型定義
 */

// ストレート達成設定（UI表示フラグのみ。計算ロジック用フィールドは VersionedSettings に移動）
export interface GamificationStraightSettings {
    enabled: boolean        // UI表示するか
}

// シールド設定（UI表示フラグのみ。condition_type, straight_count は VersionedSettings に移動）
export interface GamificationShieldSettings {
    enabled: boolean        // UI表示するか
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

// ゲーミフィケーション設定全体（JSONB に保存される UI フラグ + effective_from）
export interface GamificationSettings {
    straight: GamificationStraightSettings
    shield: GamificationShieldSettings
    revival: GamificationRevivalSettings
    streak: GamificationStreakSettings
    total_reps: GamificationTotalRepsSettings
    effective_from: string | null   // 全項目共通の適用開始日 (YYYY-MM-DD)
}

// preconfig JSONB 内の gamification_settings は UI フラグ + versioned_settings を含む
export interface PreconfigGamificationSettings extends GamificationSettings {
    versioned_settings?: VersionedSettings
}

// gamification_setting_versions テーブルの行型
export interface GamificationSettingVersion {
    id: number
    user_id: string
    condition_type: 'straight_count' | 'monthly_all'
    straight_count: number
    allow_shield: boolean
    allow_revival: boolean
    allow_late: boolean
    use_target_days: boolean
    custom_required_days: number
    effective_from: string
    effective_to: string | null
    created_at: string
}

// 計算に渡す簡易型（テーブル行から抽出）
export interface VersionedSettings {
    condition_type: 'straight_count' | 'monthly_all'
    straight_count: number
    allow_shield: boolean
    allow_revival: boolean
    allow_late: boolean
    use_target_days: boolean
    custom_required_days: number
}

// VersionedSettings のデフォルト値
export const DEFAULT_VERSIONED_SETTINGS: VersionedSettings = {
    condition_type: 'straight_count',
    straight_count: 1,
    allow_shield: false,
    allow_revival: false,
    allow_late: true,
    use_target_days: true,
    custom_required_days: 7,
}

// デフォルト設定（UI フラグ + effective_from のみ）
export const DEFAULT_GAMIFICATION_SETTINGS: GamificationSettings = {
    straight: {
        enabled: true,
    },
    shield: {
        enabled: true,
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
