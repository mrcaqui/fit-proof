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
            deadlines: {
                Row: {
                    id: number
                    title: string
                    target_time: string
                    frequency: 'daily' | 'weekly' | 'monthly'
                    created_at: string
                }
                Insert: {
                    id?: number
                    title: string
                    target_time: string
                    frequency: 'daily' | 'weekly' | 'monthly'
                    created_at?: string
                }
                Update: {
                    id?: number
                    title?: string
                    target_time?: string
                    frequency?: 'daily' | 'weekly' | 'monthly'
                    created_at?: string
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
                    created_at?: string
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
