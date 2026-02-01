/**
 * ゲーミフィケーション設定の型定義
 */

// ストレート達成設定
export interface GamificationStraightSettings {
    enabled: boolean        // UI表示するか
    weekly_target: number   // 週◯日達成でストレート（1-7）
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

// ゲーミフィケーション設定全体
export interface GamificationSettings {
    straight: GamificationStraightSettings
    shield: GamificationShieldSettings
    revival: GamificationRevivalSettings
    streak: GamificationStreakSettings
}

// デフォルト設定
export const DEFAULT_GAMIFICATION_SETTINGS: GamificationSettings = {
    straight: {
        enabled: true,
        weekly_target: 7    // デフォルト: 週7日
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
    }
}
