import { Link, useLocation } from "react-router-dom"
import { Calendar, Home, Upload, User, LayoutDashboard, LogOut, Shield } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { useState } from "react"
import { ModeToggle } from "../mode-toggle"
import { useAuth } from "@/context/AuthContext"

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> { }

export function Sidebar({ className }: SidebarProps) {
    const location = useLocation()
    const { signOut, profile } = useAuth()

    const items = [
        {
            title: "Dashboard",
            icon: LayoutDashboard,
            href: "/",
        },
        {
            title: "Calendar",
            icon: Calendar,
            href: "/calendar",
        },
        {
            title: "Upload",
            icon: Upload,
            href: "/upload",
        },
        {
            title: "Profile",
            icon: User,
            href: "/profile",
        },
    ]

    // Only add admin item if user is admin
    if (profile?.role === 'admin') {
        items.push({
            title: "Admin",
            icon: Shield,
            href: "/admin/deadlines",
        })
    }

    return (
        <div className={cn("pb-12 flex flex-col h-full", className)}>
            <div className="space-y-4 py-4 flex-1">
                <div className="px-3 py-2">
                    <h2 className="mb-2 px-4 text-lg font-semibold tracking-tight">
                        FitProof
                    </h2>
                    <div className="space-y-1">
                        {items.map((item) => (
                            <Button
                                key={item.href}
                                variant={location.pathname === item.href ? "secondary" : "ghost"}
                                className="w-full justify-start"
                                asChild
                            >
                                <Link to={item.href}>
                                    <item.icon className="mr-2 h-4 w-4" />
                                    {item.title}
                                </Link>
                            </Button>
                        ))}
                    </div>
                </div>
            </div>
            <div className="px-3 py-2 mt-auto">
                <div className="space-y-1">
                    <Button variant="ghost" className="w-full justify-start text-destructive hover:text-destructive" onClick={() => signOut()}>
                        <LogOut className="mr-2 h-4 w-4" />
                        ログアウト
                    </Button>
                    <div className="flex items-center justify-between px-4 py-2 border-t mt-2">
                        <span className="text-sm text-muted-foreground">Theme</span>
                        <ModeToggle />
                    </div>
                </div>
            </div>
        </div>
    )
}

export function MobileNav() {
    const [open, setOpen] = useState(false)
    const location = useLocation()
    const { signOut, profile } = useAuth()

    const items = [
        {
            title: "Dashboard",
            icon: LayoutDashboard,
            href: "/",
        },
        {
            title: "Calendar",
            icon: Calendar,
            href: "/calendar",
        },
        {
            title: "Upload",
            icon: Upload,
            href: "/upload",
        },
        {
            title: "Profile",
            icon: User,
            href: "/profile",
        },
    ]

    if (profile?.role === 'admin') {
        items.push({
            title: "Admin",
            icon: Shield,
            href: "/admin/deadlines",
        })
    }

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button
                    variant="ghost"
                    className="mr-2 px-0 text-base hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 md:hidden"
                >
                    <Home className="h-6 w-6" />
                    <span className="sr-only">Toggle Menu</span>
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="pr-0">
                <Link
                    to="/"
                    className="flex items-center"
                    onClick={() => setOpen(false)}
                >
                    <span className="font-bold">FitProof</span>
                </Link>
                <ScrollArea className="my-4 h-[calc(100vh-8rem)] pb-10 pl-6">
                    <div className="flex flex-col space-y-3">
                        {items.map(
                            (item) =>
                            (
                                <Link
                                    key={item.href}
                                    to={item.href}
                                    onClick={() => setOpen(false)}
                                    className={cn(
                                        "text-foreground/70 transition-colors hover:text-foreground",
                                        location.pathname === item.href && "text-foreground font-bold"
                                    )}
                                >
                                    {item.title}
                                </Link>
                            )
                        )}
                    </div>
                </ScrollArea>
                <div className="absolute bottom-4 left-4 right-4 space-y-2">
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
