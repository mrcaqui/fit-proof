import { Navigate, Outlet } from "react-router-dom"
import { useAuth } from "@/context/AuthContext"

export function RequireAdmin() {
    const { profile, loading } = useAuth()

    if (loading) {
        return (
            <div className="flex h-full w-full items-center justify-center p-8">
                <p className="text-muted-foreground animate-pulse">Loading...</p>
            </div>
        )
    }

    if (profile?.role !== 'admin') {
        return <Navigate to="/" replace />
    }

    return <Outlet />
}
