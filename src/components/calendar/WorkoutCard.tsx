import { format, parseISO } from 'date-fns'
import { Play, CheckCircle2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Database } from '@/types/database.types'

type Submission = Database['public']['Tables']['submissions']['Row']

interface WorkoutCardProps {
    submission: Submission
}

export function WorkoutCard({ submission }: WorkoutCardProps) {
    const timeStr = submission.created_at
        ? format(parseISO(submission.created_at), 'HH:mm')
        : '--:--'

    return (
        <Card className="overflow-hidden border-none shadow-sm bg-card hover:bg-accent/50 transition-colors">
            <CardContent className="p-0">
                <div className="flex flex-col">
                    {/* Thumbnail Area */}
                    <div className="relative aspect-video bg-muted group cursor-pointer">
                        {submission.thumbnail_url ? (
                            <img
                                src={submission.thumbnail_url}
                                alt="Workout thumbnail"
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                <Play className="w-12 h-12 text-muted-foreground/50" />
                            </div>
                        )}

                        {/* Play button overlay */}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                <Play className="w-6 h-6 text-white fill-white" />
                            </div>
                        </div>

                        {/* Duration badge (placeholder) */}
                        <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-medium">
                            3:15
                        </div>
                    </div>

                    {/* Info Area */}
                    <div className="p-3 flex items-center justify-between">
                        <div className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                            {timeStr}
                        </div>

                        <div className="flex items-center gap-3">
                            {/* Dummy Status Icons to match UI image */}
                            <div className="flex items-center gap-1 text-muted-foreground">
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
