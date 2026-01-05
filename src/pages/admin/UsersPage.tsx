import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { useAuth } from "@/context/AuthContext"
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface AuthUser {
    email: string
    role: 'admin' | 'client'
    created_at: string
}

export default function UsersPage() {
    const { user: currentUser } = useAuth()
    const { toast } = useToast()
    const [users, setUsers] = useState<AuthUser[]>([])
    const [loading, setLoading] = useState(true)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingUser, setEditingUser] = useState<AuthUser | null>(null)
    const [formData, setFormData] = useState({
        email: "",
        role: "client" as 'admin' | 'client'
    })
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        fetchUsers()
    }, [])

    const fetchUsers = async () => {
        setLoading(true)
        try {
            const { data, error } = await (supabase as any)
                .from('authorized_users')
                .select('*')
                .order('created_at', { ascending: false })

            if (error) throw error
            setUsers(data || [])
        } catch (error: any) {
            toast({
                title: "Error fetching users",
                description: error.message,
                variant: "destructive",
            })
        } finally {
            setLoading(false)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitting(true)
        try {
            if (editingUser) {
                const { error } = await (supabase as any)
                    .from('authorized_users')
                    .update({ role: formData.role })
                    .eq('email', editingUser.email)

                if (error) throw error
                toast({ title: "User updated successfully" })
            } else {
                const { error } = await (supabase as any)
                    .from('authorized_users')
                    .insert([{ email: formData.email, role: formData.role }])

                if (error) throw error
                toast({ title: "User added successfully" })
            }
            setIsDialogOpen(false)
            fetchUsers()
        } catch (error: any) {
            toast({
                title: "Error saving user",
                description: error.message,
                variant: "destructive",
            })
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async (email: string) => {
        if (!confirm(`Are you sure you want to remove ${email}?`)) return

        try {
            const { error } = await (supabase as any)
                .from('authorized_users')
                .delete()
                .eq('email', email)

            if (error) throw error
            toast({ title: "User removed successfully" })
            fetchUsers()
        } catch (error: any) {
            toast({
                title: "Error deleting user",
                description: error.message,
                variant: "destructive",
            })
        }
    }

    const openAddDialog = () => {
        setEditingUser(null)
        setFormData({ email: "", role: "client" })
        setIsDialogOpen(true)
    }

    const openEditDialog = (user: AuthUser) => {
        setEditingUser(user)
        setFormData({ email: user.email, role: user.role })
        setIsDialogOpen(true)
    }

    if (loading && users.length === 0) {
        return (
            <div className="flex h-[400px] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Users</h2>
                    <p className="text-muted-foreground">許可されたメールアドレスとロールを管理します。</p>
                </div>
                <Button onClick={openAddDialog}>
                    <Plus className="mr-2 h-4 w-4" /> Add User
                </Button>
            </div>

            <div className="rounded-md border">
                {/* Desktop View */}
                <div className="hidden sm:block">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Email</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Created At</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {users.map((user) => {
                                const isSelf = user.email === currentUser?.email
                                return (
                                    <TableRow key={user.email}>
                                        <TableCell className="font-medium">
                                            {user.email}
                                            {isSelf && (
                                                <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium">
                                                    You
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${user.role === 'admin'
                                                ? 'bg-red-50 text-red-700 ring-red-600/10'
                                                : 'bg-green-50 text-green-700 ring-green-600/10'
                                                }`}>
                                                {user.role}
                                            </span>
                                        </TableCell>
                                        <TableCell>{new Date(user.created_at).toLocaleDateString()}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    disabled={isSelf}
                                                    onClick={() => openEditDialog(user)}
                                                    title={isSelf ? "自身の情報は編集できません" : "編集"}
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    disabled={isSelf}
                                                    onClick={() => handleDelete(user.email)}
                                                    title={isSelf ? "自身の情報は削除できません" : "削除"}
                                                    className="text-destructive hover:text-destructive"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </div>

                {/* Mobile View */}
                <div className="block sm:hidden divide-y">
                    {users.map((user) => {
                        const isSelf = user.email === currentUser?.email
                        return (
                            <div key={user.email} className="p-4 flex flex-col gap-3">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <div className="font-medium text-sm break-all">
                                            {user.email}
                                            {isSelf && (
                                                <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium">
                                                    You
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            Registered: {new Date(user.created_at).toLocaleDateString()}
                                        </div>
                                    </div>
                                    <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${user.role === 'admin'
                                        ? 'bg-red-50 text-red-700 ring-red-600/10'
                                        : 'bg-green-50 text-green-700 ring-green-600/10'
                                        }`}>
                                        {user.role}
                                    </span>
                                </div>
                                {!isSelf && (
                                    <div className="flex justify-end gap-2 pt-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 text-xs"
                                            onClick={() => openEditDialog(user)}
                                        >
                                            <Pencil className="mr-2 h-3 w-3" />
                                            編集
                                        </Button>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/20"
                                            onClick={() => handleDelete(user.email)}
                                        >
                                            <Trash2 className="mr-2 h-3 w-3" />
                                            削除
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingUser ? "Edit User" : "Add Authorized User"}</DialogTitle>
                        <DialogDescription>
                            ログインを許可するメールアドレスと、そのユーザーの権限を選択してください。
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Email Address</label>
                            <Input
                                type="email"
                                required
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                placeholder="user@example.com"
                                disabled={!!editingUser}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Role</label>
                            <Select
                                value={formData.role}
                                onValueChange={(value: any) => setFormData({ ...formData, role: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a role" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="client">Client</SelectItem>
                                    <SelectItem value="admin">Admin</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={submitting}>
                                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {editingUser ? "Update" : "Add"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
