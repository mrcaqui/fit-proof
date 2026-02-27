import { GamificationSettings, DEFAULT_GAMIFICATION_SETTINGS } from './gamification.types'

export interface PreconfigRule {
    temp_id: number
    rule_type: 'deadline' | 'target_day' | 'rest_day' | 'group'
    scope: 'monthly' | 'weekly' | 'daily'
    day_of_week: number | null
    specific_date: string | null
    value: string | null
    effective_from: string
    group_id: string | null
    group_required_count: number | null
    effective_to: string | null
}

export interface PreconfigItem {
    temp_id: number
    name: string
    effective_from: string
    effective_to: string | null
}

export interface PreconfigProfileSettings {
    past_submission_days: number
    future_submission_days: number
    deadline_mode: 'none' | 'mark'
    show_duplicate_to_user: boolean
    video_retention_days: number
    gamification_settings: GamificationSettings | null
}

export interface PreconfigData {
    profile_settings: PreconfigProfileSettings
    rules: PreconfigRule[]
    items: PreconfigItem[]
}

export const DEFAULT_PRECONFIG: PreconfigData = {
    profile_settings: {
        past_submission_days: 7,
        future_submission_days: 7,
        deadline_mode: 'none',
        show_duplicate_to_user: false,
        video_retention_days: 30,
        gamification_settings: DEFAULT_GAMIFICATION_SETTINGS,
    },
    rules: [],
    items: [],
}
