import { createContext, useContext, useEffect, useState } from "react"
import { Session, User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { Database } from "@/types/database.types"
import { toast } from "@/hooks/use-toast"

type Profile = Database['public']['Tables']['profiles']['Row']

type AuthContextType = {
    session: Session | null
    user: User | null
    profile: Profile | null
    loading: boolean
    signInWithGoogle: () => Promise<void>
    signOut: () => Promise<void>
    refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [session, setSession] = useState<Session | null>(null)
    const [profile, setProfile] = useState<Profile | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session)
            setUser(session?.user ?? null)
            if (session?.user) fetchProfile(session.user.id, session.user.email)
            else setLoading(false)
        })

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                setSession(session)
                setUser(session?.user ?? null)
                if (session?.user) fetchProfile(session.user.id, session.user.email, session.user.user_metadata)
                else {
                    setProfile(null)
                    setLoading(false)
                }
            }
        )

        return () => {
            subscription.unsubscribe()
        }
    }, [])

    const fetchProfile = async (userId: string, email?: string, metadata?: any) => {
        try {
            console.log("Fetching profile for:", email)

            if (!email) {
                setLoading(false)
                return
            }

            // Check authorized_users first
            const { data: authUserResult, error: authError } = await supabase
                .from('authorized_users' as any)
                .select('role')
                .eq('email', email)
                .single()

            const authUser = authUserResult as any

            if (authError || !authUser) {
                console.warn("User not authorized:", email)
                // If not authorized, sign out
                await signOut()
                toast({
                    title: "ログイン制限",
                    description: "このメールアドレスは許可されていません。管理者に登録を依頼してください。",
                    variant: "destructive",
                })
                return
            }

            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single()

            const targetRole = authUser?.role || 'client'
            const googleName = metadata?.full_name || metadata?.name

            if (error && error.code === 'PGRST116') {
                // Profile not found - create one in the database
                console.log("Profile not found, creating new profile...")
                const newProfile: Profile = {
                    id: userId,
                    display_name: googleName || email || null,
                    role: targetRole,
                    updated_at: null,
                    past_submission_days: 7,
                    future_submission_days: 7,
                    deadline_mode: 'none',
                    show_duplicate_to_user: false,
                    total_reps: 0,
                    shield_stock: 0,
                    perfect_week_count: 0,
                    revival_success_count: 0,
                    gamification_settings: null,
                    video_retention_days: null
                }

                const { error: insertError } = await supabase
                    .from('profiles' as any)
                    .insert(newProfile as any)

                if (insertError) {
                    console.error("Error creating profile:", insertError)
                }

                setProfile(newProfile)
            } else if (error) {
                console.error("Error fetching profile:", error)
                setProfile({
                    id: userId,
                    display_name: googleName || email || null,
                    role: targetRole,
                    updated_at: null,
                    past_submission_days: 7,
                    future_submission_days: 7,
                    deadline_mode: 'none',
                    show_duplicate_to_user: false,
                    total_reps: 0,
                    shield_stock: 0,
                    perfect_week_count: 0,
                    revival_success_count: 0,
                    gamification_settings: null,
                    video_retention_days: null
                })
            } else if (data) {
                const profileData = data as Profile
                let updatedData = { ...profileData }
                let needsUpdate = false

                // Update role if it's different from authorized_users
                if (profileData.role !== targetRole) {
                    updatedData.role = targetRole
                    needsUpdate = true
                }

                // Update display_name if it's currently null or email, and we have a Google name
                if (googleName && (!profileData.display_name || profileData.display_name === email)) {
                    updatedData.display_name = googleName
                    needsUpdate = true
                }

                if (needsUpdate) {
                    await (supabase.from('profiles') as any)
                        .update(updatedData)
                        .eq('id', userId)

                    setProfile(updatedData)
                } else {
                    setProfile(profileData)
                }
            } else {
                setProfile(null)
            }

            // authorized_users.user_id を紐付け（未設定の場合のみ）
            await (supabase as any)
                .from('authorized_users')
                .update({ user_id: userId })
                .eq('email', email)
                .is('user_id', null)
        } finally {
            setLoading(false)
        }
    }

    const refreshProfile = async () => {
        if (user) {
            await fetchProfile(user.id, user.email, user.user_metadata)
        }
    }

    const signInWithGoogle = async () => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo: window.location.origin,
            },
        })
        if (error) console.error("Error signing in with Google:", error.message)
    }

    const signOut = async () => {
        const { error } = await supabase.auth.signOut()
        if (error) console.error("Error signing out:", error.message)
    }

    const value = {
        session,
        user,
        profile,
        loading,
        signInWithGoogle,
        signOut,
        refreshProfile,
    }

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    )
}

export const useAuth = () => {
    const context = useContext(AuthContext)
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider")
    }
    return context
}
