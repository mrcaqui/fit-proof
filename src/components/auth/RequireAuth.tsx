import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "@/context/AuthContext"

export function RequireAuth({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth()
    const location = useLocation()

    if (loading) {
        return (
            <div className="flex h-screen w-screen items-center justify-center">
                <p className="text-muted-foreground animate-pulse">Loading...</p>
            </div>
        )
    }

    if (!user) {
        return <Navigate to="/login" state={{ from: location }} replace />
    }

    return <>{children}</>
}
