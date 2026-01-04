import { createContext, useContext, useEffect, useState } from "react"
import { Session, User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { Database } from "@/types/database.types"

type Profile = Database['public']['Tables']['profiles']['Row']

type AuthContextType = {
    session: Session | null
    user: User | null
    profile: Profile | null
    loading: boolean
    signInWithGoogle: () => Promise<void>
    signOut: () => Promise<void>
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
                if (session?.user) fetchProfile(session.user.id, session.user.email)
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

    const fetchProfile = async (userId: string, email?: string) => {
        try {
            console.log("Fetching profile for:", email)
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single()

            const isAdmin = email?.toLowerCase() === 'estacercadeaqui@gmail.com'
            console.log("isAdmin check:", isAdmin, "email:", email)

            if (error && error.code === 'PGRST116') {
                // Profile not found - create one in the database
                console.log("Profile not found, creating new profile...")
                const newProfile: Profile = {
                    id: userId,
                    display_name: email || null,
                    role: isAdmin ? 'admin' : 'client',
                    streak_count: 0,
                    updated_at: null
                }

                const { error: insertError } = await supabase
                    .from('profiles')
                    .insert(newProfile as any)

                if (insertError) {
                    console.error("Error creating profile:", insertError)
                    // Still set profile in memory for UI purposes
                }

                setProfile(newProfile)
            } else if (error) {
                console.error("Error fetching profile:", error)
                if (isAdmin) {
                    setProfile({
                        id: userId,
                        display_name: email || null,
                        role: 'admin',
                        streak_count: 0,
                        updated_at: null
                    })
                } else {
                    setProfile(null)
                }
            } else if (data) {
                const profileData = data as Profile
                const updatedProfile: Profile = {
                    ...profileData,
                    role: isAdmin ? 'admin' : profileData.role
                }
                setProfile(updatedProfile)
            } else {
                setProfile(null)
            }
        } finally {
            setLoading(false)
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
