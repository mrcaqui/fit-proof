import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { WorkoutCard } from './WorkoutCard'
import { Database } from '@/types/database.types'

type Submission = Database['public']['Tables']['submissions']['Row']

interface WorkoutListProps {
    date: Date
    submissions: Submission[]
    onDelete?: (id: number, r2Key: string | null) => Promise<any>
    isAdmin?: boolean
    onPlay?: (key: string) => void
}

export function WorkoutList({ date, submissions, onDelete, isAdmin, onPlay }: WorkoutListProps) {
    const formattedDate = format(date, 'yyyy/MM/dd(eee)', { locale: ja })

    return (
        <div className="space-y-4 px-1 pb-20">
            <div className="flex items-center justify-between pt-2">
                <h3 className="text-[13px] font-bold tracking-wider text-[#1e293b]">
                    WORKOUTS: {formattedDate}
                </h3>
            </div>

            {submissions.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                    {submissions.map((s) => (
                        <WorkoutCard
                            key={s.id}
                            submission={s}
                            onDelete={onDelete}
                            isAdmin={isAdmin}
                            onPlay={onPlay}
                        />
                    ))}
                </div>
            ) : (
                <div className="py-12 text-center">
                    <p className="text-sm text-muted-foreground">
                        この日のワークアウトはありません
                    </p>
                </div>
            )}
        </div>
    )
}
