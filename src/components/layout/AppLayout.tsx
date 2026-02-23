import { Outlet } from "react-router-dom"
import { MobileNav, Sidebar } from "./Sidebar"
import { ThemeProvider } from "../theme-provider"
import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/context/AuthContext"
import { supabase } from "@/lib/supabase"

export default function AppLayout() {
    const [isCollapsed, setIsCollapsed] = useState(false)
    const { profile } = useAuth()

    // 管理者がアプリを開いたタイミングで cleanup-videos を自動実行する。
    // UI をブロックせずバックグラウンドで実行し、結果は console のみに記録する。
    useEffect(() => {
        if (profile?.role === 'admin') {
            supabase.functions.invoke('cleanup-videos').then(({ data, error }) => {
                if (error) console.error('Cleanup failed:', error)
                else console.log('Cleanup result:', data)
            })
        }
    }, [profile?.role])

    return (
        <ThemeProvider defaultTheme="system" storageKey="fit-proof-theme">
            <div className="flex min-h-screen flex-col">
                <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:hidden">
                    <div className="container flex h-14 items-center">
                        <MobileNav />
                    </div>
                </header>

                <div className={cn(
                    "flex-1 md:grid transition-all duration-300",
                    isCollapsed ? "md:grid-cols-[64px_1fr]" : "md:grid-cols-[256px_1fr]"
                )}>
                    <aside className="hidden border-r bg-muted/40 md:block min-h-screen relative">
                        <Sidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
                    </aside>

                    <main className="flex w-full flex-col overflow-hidden">
                        <div className="flex-1 space-y-4 p-8 pt-6">
                            <Outlet />
                        </div>
                    </main>
                </div>
            </div>
        </ThemeProvider>
    )
}
