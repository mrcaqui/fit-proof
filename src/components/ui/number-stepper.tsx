import { Button } from "@/components/ui/button"
import { Minus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

interface NumberStepperProps {
    value: number
    onChange: (value: number) => void
    min?: number
    max?: number
    className?: string
}

export function NumberStepper({
    value,
    onChange,
    min = 0,
    max = Infinity,
    className,
}: NumberStepperProps) {
    return (
        <div className={cn("flex items-center gap-1", className)}>
            <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => onChange(Math.max(min, value - 1))}
                disabled={value <= min}
            >
                <Minus className="h-4 w-4" />
            </Button>
            <span className="w-8 text-center font-medium tabular-nums">
                {value}
            </span>
            <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => onChange(Math.min(max, value + 1))}
                disabled={value >= max}
            >
                <Plus className="h-4 w-4" />
            </Button>
        </div>
    )
}
