import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Database } from '@/types/database.types'
import { useAuth } from '@/context/AuthContext'

type Profile = Database['public']['Tables']['profiles']['Row']

export function useProfile() {
    const { user } = useAuth()
    const [profile, setProfile] = useState<Profile | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const userId = user?.id
        if (!userId) {
            setLoading(false)
            return
        }

        async function fetchProfile(uid: string) {
            try {
                setLoading(true)
                const { data, error } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('id', uid)
                    .single()

                if (error) {
                    // If profile doesn't exist yet (before trigger runs or if trigger failed)
                    if (error.code === 'PGRST116') {
                        setProfile(null)
                    } else {
                        throw error
                    }
                } else {
                    setProfile(data)
                }
            } catch (err: any) {
                setError(err.message)
            } finally {
                setLoading(false)
            }
        }

        fetchProfile(userId)
    }, [user])

    return { profile, loading, error, setProfile }
}
