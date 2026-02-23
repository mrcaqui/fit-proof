import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { X, Play, Pause, Volume2, VolumeX } from 'lucide-react'

interface VideoPlayerModalProps {
    videoUrl: string | null
    onClose: () => void
}

export function VideoPlayerModal({ videoUrl, onClose }: VideoPlayerModalProps) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [playbackRate, setPlaybackRate] = useState(1)
    const [isMuted, setIsMuted] = useState(false)
    const [progress, setProgress] = useState(0)

    if (!videoUrl) return null

    const togglePlay = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause()
            } else {
                videoRef.current.play()
            }
            setIsPlaying(!isPlaying)
        }
    }

    const handleRateChange = (rate: number) => {
        setPlaybackRate(rate)
        if (videoRef.current) {
            videoRef.current.playbackRate = rate
        }
    }

    const toggleMute = () => {
        if (videoRef.current) {
            videoRef.current.muted = !isMuted
            setIsMuted(!isMuted)
        }
    }

    const handleTimeUpdate = () => {
        if (videoRef.current) {
            const percent = (videoRef.current.currentTime / videoRef.current.duration) * 100
            setProgress(percent)
        }
    }

    const handleSeek = (value: number[]) => {
        if (videoRef.current) {
            videoRef.current.currentTime = (value[0] / 100) * videoRef.current.duration
        }
    }

    const playbackRates = [1, 2, 3, 4, 5]

    return (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <div className="bg-background rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b">
                    <h3 className="font-semibold">動画プレイヤー</h3>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                {/* Video */}
                <div className="flex-1 bg-black">
                    <video
                        ref={videoRef}
                        src={videoUrl}
                        className="w-full h-full max-h-[60vh] object-contain"
                        onTimeUpdate={handleTimeUpdate}
                        onEnded={() => setIsPlaying(false)}
                        playsInline
                    />
                </div>

                {/* Controls */}
                <div className="p-4 space-y-4">
                    {/* Progress bar */}
                    <Slider
                        value={[progress]}
                        onValueChange={handleSeek}
                        max={100}
                        step={0.1}
                        className="w-full"
                    />

                    <div className="flex items-center justify-between">
                        {/* Play controls */}
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={togglePlay}
                            >
                                {isPlaying ? (
                                    <Pause className="h-4 w-4" />
                                ) : (
                                    <Play className="h-4 w-4" />
                                )}
                            </Button>

                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={toggleMute}
                            >
                                {isMuted ? (
                                    <VolumeX className="h-4 w-4" />
                                ) : (
                                    <Volume2 className="h-4 w-4" />
                                )}
                            </Button>
                        </div>

                        {/* Playback rate */}
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">再生速度:</span>
                            {playbackRates.map((rate) => (
                                <Button
                                    key={rate}
                                    variant={playbackRate === rate ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => handleRateChange(rate)}
                                >
                                    {rate}x
                                </Button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
