import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useDeadlines } from '@/hooks/useDeadlines'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Plus, Trash2 } from 'lucide-react'

export default function DeadlineManagement() {
    const { deadlines, loading } = useDeadlines()
    const [newTitle, setNewTitle] = useState('')
    const [newTime, setNewTime] = useState('23:59')
    const [newFrequency, setNewFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily')

    const handleAddDeadline = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newTitle || !newTime) return

        const { error } = await supabase
            .from('deadlines')
            .insert({
                title: newTitle,
                target_time: newTime,
                frequency: newFrequency
            } as any)

        if (error) {
            alert('Error adding deadline: ' + error.message)
        } else {
            setNewTitle('')
            // Ideally refresh the list (useDeadlines should handle this or we can manual refresh)
            window.location.reload()
        }
    }

    const handleDelete = async (id: number) => {
        if (!confirm('Are you sure?')) return

        const { error } = await supabase
            .from('deadlines')
            .delete()
            .eq('id', id)

        if (error) {
            alert('Error deleting deadline: ' + error.message)
        } else {
            window.location.reload()
        }
    }

    if (loading) return <div>Loading...</div>

    return (
        <div className="space-y-6">
            <h2 className="text-3xl font-bold tracking-tight">Deadline Management</h2>

            <Card>
                <CardHeader>
                    <CardTitle>Add New Deadline</CardTitle>
                    <CardDescription>Set workout targets for your clients.</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleAddDeadline} className="grid gap-4 md:grid-cols-4 items-end">
                        <div className="grid gap-2">
                            <Label htmlFor="title">Title</Label>
                            <Input
                                id="title"
                                value={newTitle}
                                onChange={(e) => setNewTitle(e.target.value)}
                                placeholder="Morning Exercise"
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="time">Target Time</Label>
                            <Input
                                id="time"
                                type="time"
                                value={newTime}
                                onChange={(e) => setNewTime(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="frequency">Frequency</Label>
                            <select
                                id="frequency"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                value={newFrequency}
                                onChange={(e) => setNewFrequency(e.target.value as any)}
                            >
                                <option value="daily">Daily</option>
                                <option value="weekly">Weekly</option>
                                <option value="monthly">Monthly</option>
                            </select>
                        </div>
                        <Button type="submit">
                            <Plus className="mr-2 h-4 w-4" /> Add
                        </Button>
                    </form>
                </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {deadlines.map((deadline) => (
                    <Card key={deadline.id}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">
                                {deadline.title}
                            </CardTitle>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(deadline.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{deadline.target_time}</div>
                            <p className="text-xs text-muted-foreground capitalize">
                                {deadline.frequency}
                            </p>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    )
}
