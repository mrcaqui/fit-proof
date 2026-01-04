import { Outlet } from "react-router-dom"
import { MobileNav, Sidebar } from "./Sidebar"
import { ThemeProvider } from "../theme-provider"

export default function AppLayout() {
    return (
        <ThemeProvider defaultTheme="system" storageKey="fit-proof-theme">
            <div className="flex min-h-screen flex-col">
                <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:hidden">
                    <div className="container flex h-14 items-center">
                        <MobileNav />
                    </div>
                </header>

                <div className="flex-1 md:grid md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
                    <aside className="hidden border-r bg-muted/40 md:block min-h-screen relative">
                        <Sidebar />
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
