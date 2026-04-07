import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'

export function ReloadPrompt() {
    const {
        needRefresh: [needRefresh],
        updateServiceWorker,
    } = useRegisterSW()

    if (!needRefresh) return null

    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] animate-in slide-in-from-bottom-4 fade-in duration-300">
            <div className="flex items-center gap-3 bg-primary text-primary-foreground px-4 py-3 rounded-lg shadow-lg">
                <RefreshCw className="w-4 h-4 shrink-0" />
                <span className="text-sm font-medium">新しいバージョンがあります</span>
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => updateServiceWorker(true)}
                    className="h-7 text-xs font-bold"
                >
                    更新
                </Button>
            </div>
        </div>
    )
}
