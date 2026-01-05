import { Button } from "@/components/ui/button"
import { Database } from "@/types/database.types"
import { X, Check } from "lucide-react"

type SubmissionItem = Database['public']['Tables']['submission_items']['Row']

interface ItemSelectionModalProps {
    items: SubmissionItem[]
    completedItemIds: number[]
    onSelect: (item: SubmissionItem) => void
    onClose: () => void
}

export function ItemSelectionModal({ items, completedItemIds, onSelect, onClose }: ItemSelectionModalProps) {
    return (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <div className="bg-background rounded-lg max-w-sm w-full overflow-hidden shadow-xl">
                <div className="flex items-center justify-between p-4 border-b">
                    <h3 className="font-semibold">投稿する項目を選択</h3>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                <div className="p-4 space-y-3">
                    {items.map(item => {
                        const isCompleted = completedItemIds.includes(item.id)
                        return (
                            <button
                                key={item.id}
                                onClick={() => onSelect(item)}
                                className={`w-full text-left p-4 rounded-lg border transition-all flex items-center justify-between group
                                    ${isCompleted
                                        ? 'bg-muted/50 border-muted text-muted-foreground' // Completed style
                                        : 'bg-card hover:border-primary hover:shadow-md' // Active style
                                    }
                                `}
                            >
                                <span className="font-medium">{item.name}</span>
                                {isCompleted && (
                                    <span className="flex items-center text-xs text-green-600 font-bold px-2 py-1 bg-green-100 rounded-full">
                                        <Check className="w-3 h-3 mr-1" /> 完了
                                    </span>
                                )}
                            </button>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
