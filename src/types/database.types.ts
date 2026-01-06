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
                    streak_count: number
                    updated_at: string | null
                }
                Insert: {
                    id: string
                    display_name?: string | null
                    role?: 'admin' | 'client'
                    streak_count?: number
                    updated_at?: string | null
                }
                Update: {
                    id?: string
                    display_name?: string | null
                    role?: 'admin' | 'client'
                    streak_count?: number
                    updated_at?: string | null
                }
            }
            submission_items: {
                Row: {
                    id: number
                    client_id: string
                    name: string
                    created_at: string
                    deleted_at: string | null
                }
                Insert: {
                    id?: number
                    client_id: string
                    name: string
                    created_at?: string
                    deleted_at?: string | null
                }
                Update: {
                    id?: number
                    client_id?: string
                    name?: string
                    created_at?: string
                    deleted_at?: string | null
                }
            }
            submissions: {
                Row: {
                    id: number
                    user_id: string
                    type: 'video' | 'comment'
                    r2_key: string | null
                    thumbnail_url: string | null
                    duration: number | null
                    comment_text: string | null
                    status: 'success' | 'fail' | 'excused'
                    target_date: string | null
                    submission_item_id: number | null
                    created_at: string
                }
                Insert: {
                    id?: number
                    user_id: string
                    type: 'video' | 'comment'
                    r2_key?: string | null
                    thumbnail_url?: string | null
                    duration?: number | null
                    comment_text?: string | null
                    status?: 'success' | 'fail' | 'excused'
                    target_date?: string | null
                    submission_item_id?: number | null
                    created_at?: string
                }
                Update: {
                    id?: number
                    user_id?: string
                    type?: 'video' | 'comment'
                    r2_key?: string | null
                    thumbnail_url?: string | null
                    duration?: number | null
                    comment_text?: string | null
                    status?: 'success' | 'fail' | 'excused'
                    target_date?: string | null
                    submission_item_id?: number | null
                    created_at?: string
                }
            }
            submission_rules: {
                Row: {
                    id: number
                    client_id: string
                    rule_type: 'deadline' | 'target_day'
                    scope: 'monthly' | 'weekly' | 'daily'
                    day_of_week: number | null
                    specific_date: string | null
                    value: string | null
                    created_at: string
                    deleted_at: string | null
                }
                Insert: {
                    id?: number
                    client_id: string
                    rule_type: 'deadline' | 'target_day'
                    scope: 'monthly' | 'weekly' | 'daily'
                    day_of_week?: number | null
                    specific_date?: string | null
                    value?: string | null
                    created_at?: string
                    deleted_at?: string | null
                }
                Update: {
                    id?: number
                    client_id?: string
                    rule_type?: 'deadline' | 'target_day'
                    scope?: 'monthly' | 'weekly' | 'daily'
                    day_of_week?: number | null
                    specific_date?: string | null
                    value?: string | null
                    created_at?: string
                    deleted_at?: string | null
                }
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
