export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            profiles: {
                Row: {
                    id: string
                    display_name: string | null
                    role: 'admin' | 'client'
                    updated_at: string | null
                    past_submission_days: number
                    future_submission_days: number
                    deadline_mode: 'none' | 'mark'
                    show_duplicate_to_user: boolean
                    total_reps: number
                    shield_stock: number
                    perfect_week_count: number
                    revival_success_count: number
                    gamification_settings: Record<string, unknown> | null
                    video_retention_days: number | null
                }
                Insert: {
                    id: string
                    display_name?: string | null
                    role?: 'admin' | 'client'
                    updated_at?: string | null
                    past_submission_days?: number
                    future_submission_days?: number
                    deadline_mode?: 'none' | 'mark'
                    show_duplicate_to_user?: boolean
                    total_reps?: number
                    shield_stock?: number
                    perfect_week_count?: number
                    revival_success_count?: number
                    gamification_settings?: Record<string, unknown> | null
                    video_retention_days?: number | null
                }
                Update: {
                    id?: string
                    display_name?: string | null
                    role?: 'admin' | 'client'
                    updated_at?: string | null
                    past_submission_days?: number
                    future_submission_days?: number
                    deadline_mode?: 'none' | 'mark'
                    show_duplicate_to_user?: boolean
                    total_reps?: number
                    shield_stock?: number
                    perfect_week_count?: number
                    revival_success_count?: number
                    gamification_settings?: Record<string, unknown> | null
                    video_retention_days?: number | null
                }
                Relationships: []
            }
            submission_items: {
                Row: {
                    id: number
                    user_id: string
                    name: string
                    created_at: string
                    effective_from: string
                    effective_to: string | null
                }
                Insert: {
                    id?: number
                    user_id: string
                    name: string
                    created_at?: string
                    effective_from?: string
                    effective_to?: string | null
                }
                Update: {
                    id?: number
                    user_id?: string
                    name?: string
                    created_at?: string
                    effective_from?: string
                    effective_to?: string | null
                }
                Relationships: []
            }
            submissions: {
                Row: {
                    id: number
                    user_id: string
                    type: 'video' | 'comment' | 'shield'
                    r2_key: string | null
                    thumbnail_url: string | null
                    duration: number | null
                    comment_text: string | null
                    status: 'success' | 'fail' | 'excused' | null
                    target_date: string | null
                    submission_item_id: number | null
                    created_at: string
                    file_name: string | null
                    reviewed_at: string | null
                    is_late: boolean
                    reps: number | null
                    is_revival: boolean
                    video_size: number | null
                    video_hash: string | null
                }
                Insert: {
                    id?: number
                    user_id: string
                    type: 'video' | 'comment' | 'shield'
                    r2_key?: string | null
                    thumbnail_url?: string | null
                    duration?: number | null
                    comment_text?: string | null
                    status?: 'success' | 'fail' | 'excused' | null
                    target_date?: string | null
                    submission_item_id?: number | null
                    created_at?: string
                    reviewed_at?: string | null
                    is_late?: boolean
                    reps?: number | null
                    is_revival?: boolean
                    video_size?: number | null
                    video_hash?: string | null
                }
                Update: {
                    id?: number
                    user_id?: string
                    type?: 'video' | 'comment' | 'shield'
                    r2_key?: string | null
                    thumbnail_url?: string | null
                    duration?: number | null
                    comment_text?: string | null
                    status?: 'success' | 'fail' | 'excused' | null
                    target_date?: string | null
                    submission_item_id?: number | null
                    created_at?: string
                    reviewed_at?: string | null
                    is_late?: boolean
                    reps?: number | null
                    is_revival?: boolean
                    video_size?: number | null
                    video_hash?: string | null
                }
                Relationships: [
                    {
                        foreignKeyName: "submissions_user_id_fkey"
                        columns: ["user_id"]
                        isOneToOne: false
                        referencedRelation: "profiles"
                        referencedColumns: ["id"]
                    }
                ]
            }
            submission_rules: {
                Row: {
                    id: number
                    user_id: string
                    rule_type: 'deadline' | 'target_day' | 'rest_day' | 'group'
                    scope: 'monthly' | 'weekly' | 'daily'
                    day_of_week: number | null
                    specific_date: string | null
                    value: string | null
                    created_at: string
                    effective_from: string
                    group_id: string | null
                    group_required_count: number | null
                    effective_to: string | null
                }
                Insert: {
                    id?: number
                    user_id: string
                    rule_type: 'deadline' | 'target_day' | 'rest_day' | 'group'
                    scope: 'monthly' | 'weekly' | 'daily'
                    day_of_week?: number | null
                    specific_date?: string | null
                    value?: string | null
                    created_at?: string
                    effective_from?: string
                    group_id?: string | null
                    group_required_count?: number | null
                    effective_to?: string | null
                }
                Update: {
                    id?: number
                    user_id?: string
                    rule_type?: 'deadline' | 'target_day' | 'rest_day' | 'group'
                    scope?: 'monthly' | 'weekly' | 'daily'
                    day_of_week?: number | null
                    specific_date?: string | null
                    value?: string | null
                    created_at?: string
                    effective_from?: string
                    group_id?: string | null
                    group_required_count?: number | null
                    effective_to?: string | null
                }
                Relationships: []
            }
            admin_comments: {
                Row: {
                    id: string
                    submission_id: number
                    user_id: string
                    content: string
                    read_at: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    submission_id: number
                    user_id: string
                    content: string
                    read_at?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    submission_id?: number
                    user_id?: string
                    content?: string
                    read_at?: string | null
                    created_at?: string
                }
                Relationships: []
            }
        }
        Views: {
            [_ in never]: never
        }
        Functions: {
            [_ in never]: never
        }
        Enums: {
            [_ in never]: never
        }
        CompositeTypes: {
            [_ in never]: never
        }
    }
}
