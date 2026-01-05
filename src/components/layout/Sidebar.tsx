import { Link, useLocation } from "react-router-dom"
import { Calendar, LogOut, Shield, Users, Menu, ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { useState } from "react"
import { ModeToggle } from "../mode-toggle"
import { useAuth } from "@/context/AuthContext"

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
    isCollapsed: boolean
    setIsCollapsed: (value: boolean) => void
}

export function Sidebar({ className, isCollapsed, setIsCollapsed }: SidebarProps) {
    const location = useLocation()
    const { signOut, profile, user } = useAuth()

    const items = [
        {
            title: "Calendar",
            icon: Calendar,
            href: "/",
        },
    ]

    if (profile?.role === 'admin') {
        items.push({
            title: "提出設定",
            icon: Shield,
            href: "/admin/submission-settings",
        })
        items.push({
            title: "Users",
            icon: Users,
            href: "/admin/users",
        })
        items.push({
            title: "Submissions",
            icon: Shield,
            href: "/admin/submissions",
        })
    }

    return (
        <div className={cn("pb-12 flex flex-col h-full relative transition-all duration-300 w-full", className)}>
            <div className="space-y-4 py-4 flex-1 overflow-hidden">
                <div className="px-3 py-2">
                    <div className={cn("flex items-center mb-6 px-3 transition-all", isCollapsed ? "justify-center px-0" : "")}>
                        <img src="/pwa-192x192.png" alt="FitProof" className="w-8 h-8 rounded-md" />
                        {!isCollapsed && (
                            <h2 className="ml-3 text-lg font-bold tracking-tight">
                                FitProof
                            </h2>
                        )}
                    </div>
                    <div className="space-y-1">
                        {items.map((item) => (
                            <Button
                                key={item.href}
                                variant={location.pathname === item.href ? "secondary" : "ghost"}
                                className={cn("w-full transition-all", isCollapsed ? "justify-center p-0" : "justify-start px-4")}
                                asChild
                            >
                                <Link to={item.href}>
                                    <item.icon className={cn("h-4 w-4", isCollapsed ? "" : "mr-2")} />
                                    {!isCollapsed && <span>{item.title}</span>}
                                </Link>
                            </Button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Collapse/Expand Handle */}
            <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-40 h-6 w-6 rounded-full border bg-background flex items-center justify-center hover:bg-accent shadow-sm"
            >
                {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
            </button>

            <div className="px-3 py-2 mt-auto border-t overflow-hidden">
                <div className={cn("px-4 py-2 mb-2 transition-all", isCollapsed ? "px-1 text-center" : "")}>
                    {!isCollapsed ? (
                        <>
                            <p className="text-sm font-bold leading-none truncate">
                                {profile?.display_name || user?.email?.split('@')[0]}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1 truncate">{user?.email}</p>
                        </>
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-accent mx-auto flex items-center justify-center">
                            <span className="text-xs font-bold">
                                {(profile?.display_name || user?.email)?.[0].toUpperCase()}
                            </span>
                        </div>
                    )}
                </div>
                <div className="space-y-1">
                    <Button
                        variant="ghost"
                        className={cn("w-full text-destructive hover:text-destructive transition-all", isCollapsed ? "justify-center p-0" : "justify-start px-4")}
                        onClick={() => signOut()}
                    >
                        <LogOut className={cn("h-4 w-4", isCollapsed ? "" : "mr-2")} />
                        {!isCollapsed && <span>ログアウト</span>}
                    </Button>
                    {!isCollapsed && (
                        <div className="flex items-center justify-between px-4 py-2 border-t mt-2">
                            <span className="text-sm text-muted-foreground">Theme</span>
                            <ModeToggle />
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export function MobileNav() {
    const [open, setOpen] = useState(false)
    const location = useLocation()
    const { signOut, profile, user } = useAuth()

    const items = [
        {
            title: "Calendar",
            icon: Calendar,
            href: "/",
        },
    ]

    if (profile?.role === 'admin') {
        items.push({
            title: "提出設定",
            icon: Shield,
            href: "/admin/submission-settings",
        })
        items.push({
            title: "Users",
            icon: Users,
            href: "/admin/users",
        })
        items.push({
            title: "Submissions",
            icon: Shield,
            href: "/admin/submissions",
        })
    }

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button
                    variant="ghost"
                    className="mr-2 px-0 text-base hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 md:hidden"
                >
                    <Menu className="h-6 w-6" />
                    <span className="sr-only">Toggle Menu</span>
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="pr-0">
                <Link
                    to="/"
                    className="flex items-center gap-2"
                    onClick={() => setOpen(false)}
                >
                    <img src="/pwa-192x192.png" alt="Logo" className="w-8 h-8 rounded-md" />
                    <span className="font-bold">FitProof</span>
                </Link>
                <ScrollArea className="my-4 h-[calc(100vh-8rem)] pb-10 pl-6">
                    <div className="flex flex-col space-y-3">
                        {items.map((item) => (
                            <Link
                                key={item.href}
                                to={item.href}
                                onClick={() => setOpen(false)}
                                className={cn(
                                    "flex items-center text-foreground/70 transition-colors hover:text-foreground",
                                    location.pathname === item.href && "text-foreground font-bold"
                                )}
                            >
                                <item.icon className="mr-2 h-4 w-4" />
                                {item.title}
                            </Link>
                        ))}
                    </div>
                </ScrollArea>
                <div className="absolute bottom-4 left-4 right-4 space-y-2">
                    <div className="px-2 py-2 mb-2 border-b">
                        <p className="text-sm font-bold leading-none truncate">
                            {profile?.display_name || user?.email?.split('@')[0]}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1 truncate">{user?.email}</p>
                    </div>
                    <Button variant="ghost" className="w-full justify-start text-destructive hover:text-destructive" onClick={() => {
                        signOut()
                        setOpen(false)
                    }}>
                        <LogOut className="mr-2 h-4 w-4" />
                        ログアウト
                    </Button>
                    <div className="flex items-center justify-between px-2 pt-2 border-t">
                        <span className="text-sm text-muted-foreground">Theme</span>
                        <ModeToggle />
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    )
}
