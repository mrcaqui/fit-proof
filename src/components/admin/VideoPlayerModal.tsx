import { useState, useRef, useEffect, useCallback } from 'react'
import { Slider } from '@/components/ui/slider'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
    X, Play, Pause,
    Volume1, Volume2, VolumeX,
    Maximize2, Minimize2,
} from 'lucide-react'

const LS_SPEED = 'fit-proof-video-speed'
const LS_VOLUME = 'fit-proof-video-volume'
const LS_MUTED = 'fit-proof-video-muted'

function formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) return '0:00'
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
}

interface VideoPlayerModalProps {
    videoUrl: string | null
    onClose: () => void
}

export function VideoPlayerModal({ videoUrl, onClose }: VideoPlayerModalProps) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastTapTimeRef = useRef<{ time: number; side: 'left' | 'right' } | null>(null)

    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [controlsVisible, setControlsVisible] = useState(true)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [skipFeedback, setSkipFeedback] = useState<{ side: 'left' | 'right'; key: number } | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [hasError, setHasError] = useState(false)

    const [playbackRate, setPlaybackRate] = useState(() => {
        const stored = localStorage.getItem(LS_SPEED)
        const val = stored ? parseInt(stored, 10) : 1
        return val >= 1 && val <= 10 ? val : 1
    })
    const [volume, setVolume] = useState(() => {
        const stored = localStorage.getItem(LS_VOLUME)
        const val = stored ? parseFloat(stored) : 1.0
        return val >= 0 && val <= 1 ? val : 1.0
    })
    const [isMuted, setIsMuted] = useState(() => {
        return localStorage.getItem(LS_MUTED) === 'true'
    })

    // Refs for keyboard handler (avoid stale closures)
    const volumeRef = useRef(volume)
    volumeRef.current = volume
    const isMutedRef = useRef(isMuted)
    isMutedRef.current = isMuted

    // --- localStorage persistence ---
    useEffect(() => { localStorage.setItem(LS_SPEED, String(playbackRate)) }, [playbackRate])
    useEffect(() => { localStorage.setItem(LS_VOLUME, String(volume)) }, [volume])
    useEffect(() => { localStorage.setItem(LS_MUTED, String(isMuted)) }, [isMuted])

    // --- Sync settings to video element ---
    useEffect(() => {
        const video = videoRef.current
        if (video) video.playbackRate = playbackRate
    }, [playbackRate])

    useEffect(() => {
        const video = videoRef.current
        if (!video) return
        video.volume = volume
        video.muted = isMuted
    }, [volume, isMuted])

    // --- Initialize on new video ---
    useEffect(() => {
        if (!videoUrl) return
        setIsPlaying(false)
        setCurrentTime(0)
        setDuration(0)
        setIsLoading(true)
        setHasError(false)
        setControlsVisible(true)

        const video = videoRef.current
        if (video) {
            const applySettings = () => {
                video.playbackRate = playbackRate
                video.volume = volume
                video.muted = isMuted
            }
            video.addEventListener('loadedmetadata', applySettings, { once: true })
            return () => video.removeEventListener('loadedmetadata', applySettings)
        }
    }, [videoUrl]) // eslint-disable-line react-hooks/exhaustive-deps

    // --- Event handlers (defined before keyboard effect) ---
    const showControls = useCallback(() => {
        setControlsVisible(true)
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
        hideTimerRef.current = setTimeout(() => {
            if (videoRef.current && !videoRef.current.paused) {
                setControlsVisible(false)
            }
        }, 3000)
    }, [])

    const togglePlay = useCallback(() => {
        const video = videoRef.current
        if (!video || hasError) return
        if (video.paused) {
            video.play().catch(() => setIsPlaying(false))
        } else {
            video.pause()
        }
    }, [hasError])

    const changeVolume = useCallback((newVolume: number) => {
        const video = videoRef.current
        if (!video) return
        const clamped = Math.max(0, Math.min(1, newVolume))
        video.volume = clamped
        setVolume(clamped)
        if (clamped > 0 && isMutedRef.current) {
            video.muted = false
            setIsMuted(false)
        }
    }, [])

    const toggleMute = useCallback(() => {
        const video = videoRef.current
        if (!video) return
        const newMuted = !isMutedRef.current
        video.muted = newMuted
        setIsMuted(newMuted)
    }, [])

    const changePlaybackRate = useCallback((rate: number) => {
        const video = videoRef.current
        if (!video) return
        video.playbackRate = rate
        setPlaybackRate(rate)
    }, [])

    const toggleFullscreen = useCallback(() => {
        const container = containerRef.current
        if (!container) return
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {})
        } else {
            container.requestFullscreen().catch(() => {})
        }
    }, [])

    const handleClose = useCallback(() => {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {})
        }
        onClose()
    }, [onClose])

    const handleSkip = useCallback((side: 'left' | 'right') => {
        const video = videoRef.current
        if (!video || !Number.isFinite(video.duration)) return
        const delta = side === 'right' ? 10 : -10
        video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta))
        setSkipFeedback({ side, key: Date.now() })
        showControls()
    }, [showControls])

    const handleOverlayTap = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const side: 'left' | 'right' = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right'
        const now = Date.now()

        if (
            lastTapTimeRef.current &&
            now - lastTapTimeRef.current.time < 300 &&
            lastTapTimeRef.current.side === side
        ) {
            if (tapTimerRef.current) {
                clearTimeout(tapTimerRef.current)
                tapTimerRef.current = null
            }
            lastTapTimeRef.current = null
            handleSkip(side)
            return
        }

        lastTapTimeRef.current = { time: now, side }

        if (tapTimerRef.current) clearTimeout(tapTimerRef.current)
        tapTimerRef.current = setTimeout(() => {
            tapTimerRef.current = null
            lastTapTimeRef.current = null
            togglePlay()
        }, 300)
    }, [handleSkip, togglePlay])

    // --- Keyboard shortcuts ---
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const video = videoRef.current
            if (!video) return

            const target = e.target
            if (!(target instanceof Element)) return
            if (target.closest(
                'button, a, input, textarea, select, [contenteditable="true"], '
                + '[role="button"], [role="slider"], [role="menuitem"], [role="option"], '
                + '[role="menuitemradio"], [role="menuitemcheckbox"], '
                + '[role="menu"], [role="listbox"], [role="combobox"], [role="textbox"]'
            )) {
                return
            }

            switch (e.key) {
                case ' ':
                    e.preventDefault()
                    togglePlay()
                    break
                case 'ArrowLeft':
                    e.preventDefault()
                    if (!Number.isFinite(video.duration)) break
                    video.currentTime = Math.max(0, video.currentTime - 10)
                    showControls()
                    break
                case 'ArrowRight':
                    e.preventDefault()
                    if (!Number.isFinite(video.duration)) break
                    video.currentTime = Math.min(video.duration, video.currentTime + 10)
                    showControls()
                    break
                case 'ArrowUp':
                    e.preventDefault()
                    changeVolume(Math.min(1, volumeRef.current + 0.1))
                    showControls()
                    break
                case 'ArrowDown':
                    e.preventDefault()
                    changeVolume(Math.max(0, volumeRef.current - 0.1))
                    showControls()
                    break
                case 'm': case 'M':
                    toggleMute()
                    showControls()
                    break
                case 'f': case 'F':
                    toggleFullscreen()
                    break
                case 'Escape':
                    if (!document.fullscreenElement) handleClose()
                    break
            }
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [togglePlay, showControls, changeVolume, toggleMute, toggleFullscreen, handleClose])

    // --- Fullscreen state monitoring ---
    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement)
        document.addEventListener('fullscreenchange', handler)
        return () => document.removeEventListener('fullscreenchange', handler)
    }, [])

    // --- Body scroll lock ---
    useEffect(() => {
        if (videoUrl) {
            document.body.style.overflow = 'hidden'
            return () => { document.body.style.overflow = '' }
        }
    }, [videoUrl])

    // --- Focus container for keyboard events ---
    useEffect(() => {
        if (videoUrl && containerRef.current) containerRef.current.focus()
    }, [videoUrl])

    // --- Timer cleanup ---
    useEffect(() => {
        return () => {
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
            if (tapTimerRef.current) clearTimeout(tapTimerRef.current)
        }
    }, [])

    if (!videoUrl) return null

    return (
        <div
            ref={containerRef}
            className="fixed inset-0 z-50 bg-black"
            onMouseMove={showControls}
            onTouchStart={showControls}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Video player"
        >
            {/* Close button */}
            <button
                className="absolute top-4 right-4 z-20 rounded-full bg-black/50 p-2
                           text-white hover:bg-black/70 transition-colors"
                onClick={handleClose}
            >
                <X className="h-6 w-6" />
            </button>

            {/* Video element */}
            <video
                ref={videoRef}
                src={videoUrl}
                className="absolute inset-0 w-full h-full object-contain"
                onTimeUpdate={() => {
                    const v = videoRef.current
                    if (v) setCurrentTime(v.currentTime)
                }}
                onLoadedMetadata={() => {
                    const v = videoRef.current
                    if (v) setDuration(v.duration)
                }}
                onCanPlay={() => setIsLoading(false)}
                onWaiting={() => setIsLoading(true)}
                onPlaying={() => { setIsLoading(false); setIsPlaying(true) }}
                onPause={() => {
                    setIsPlaying(false)
                    setControlsVisible(true)
                    if (hideTimerRef.current) {
                        clearTimeout(hideTimerRef.current)
                        hideTimerRef.current = null
                    }
                }}
                onEnded={() => {
                    setIsPlaying(false)
                    setControlsVisible(true)
                    if (hideTimerRef.current) {
                        clearTimeout(hideTimerRef.current)
                        hideTimerRef.current = null
                    }
                }}
                onError={() => setHasError(true)}
                playsInline
            />

            {/* Loading spinner */}
            {isLoading && !hasError && (
                <div className="absolute inset-0 flex items-center justify-center z-10
                                pointer-events-none">
                    <div className="h-12 w-12 rounded-full border-4 border-white/30
                                    border-t-white animate-spin" />
                </div>
            )}

            {/* Error display */}
            {hasError && (
                <div className="absolute inset-0 flex items-center justify-center z-10
                                pointer-events-none">
                    <p className="text-white text-lg">Failed to load video</p>
                </div>
            )}

            {/* Tap overlay */}
            <div
                className="absolute inset-0 z-10"
                style={{ touchAction: 'manipulation' }}
                onPointerUp={handleOverlayTap}
            />

            {/* Skip feedback */}
            {skipFeedback && (
                <div
                    className={cn(
                        "absolute top-1/2 -translate-y-1/2 z-10 pointer-events-none",
                        skipFeedback.side === 'left' ? 'left-[25%] -translate-x-1/2'
                                                     : 'right-[25%] translate-x-1/2'
                    )}
                >
                    <div
                        key={skipFeedback.key}
                        className="text-white text-2xl font-bold animate-fade-out"
                        onAnimationEnd={() => setSkipFeedback(null)}
                    >
                        {skipFeedback.side === 'left' ? '\u25C0\u25C0 10s' : '10s \u25B6\u25B6'}
                    </div>
                </div>
            )}

            {/* Bottom control bar */}
            <div
                className={cn(
                    "absolute bottom-0 inset-x-0 z-20 px-4 pb-4 pt-16",
                    "bg-gradient-to-t from-black/80 via-black/40 to-transparent",
                    "transition-opacity duration-300",
                    controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Progress bar */}
                <Slider
                    value={[duration > 0 ? (currentTime / duration) * 100 : 0]}
                    onValueChange={(val) => {
                        const video = videoRef.current
                        if (video && duration > 0) {
                            video.currentTime = (val[0] / 100) * duration
                        }
                    }}
                    max={100}
                    step={0.1}
                    className="w-full mb-3"
                />

                {/* Control row */}
                <div className="flex items-center gap-3 text-white">
                    {/* Play/Pause */}
                    <button
                        className="hover:scale-110 transition-transform"
                        onClick={togglePlay}
                    >
                        {isPlaying
                            ? <Pause className="h-6 w-6 fill-white" />
                            : <Play className="h-6 w-6 fill-white" />}
                    </button>

                    {/* Volume */}
                    <div className="flex items-center gap-1 group">
                        <button onClick={toggleMute}>
                            {isMuted || volume === 0
                                ? <VolumeX className="h-5 w-5" />
                                : volume < 0.5
                                ? <Volume1 className="h-5 w-5" />
                                : <Volume2 className="h-5 w-5" />}
                        </button>
                        <div className="w-0 overflow-hidden group-hover:w-20
                                        transition-all duration-200">
                            <Slider
                                value={[isMuted ? 0 : volume * 100]}
                                onValueChange={(val) => changeVolume(val[0] / 100)}
                                max={100}
                                step={1}
                                className="w-20"
                            />
                        </div>
                    </div>

                    {/* Time display */}
                    <span className="text-sm tabular-nums select-none">
                        {formatTime(currentTime)} / {formatTime(duration)}
                    </span>

                    {/* Spacer */}
                    <div className="flex-1" />

                    {/* Playback rate dropdown */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="text-sm font-medium hover:bg-white/20
                                               rounded px-2 py-1 transition-colors">
                                {playbackRate}x
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="top" align="center" className="min-w-[4rem]">
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rate) => (
                                <DropdownMenuItem
                                    key={rate}
                                    onClick={() => changePlaybackRate(rate)}
                                    className={cn(playbackRate === rate && "bg-accent")}
                                >
                                    {rate}x
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Fullscreen toggle */}
                    <button
                        className="hover:scale-110 transition-transform"
                        onClick={toggleFullscreen}
                    >
                        {isFullscreen
                            ? <Minimize2 className="h-5 w-5" />
                            : <Maximize2 className="h-5 w-5" />}
                    </button>
                </div>
            </div>
        </div>
    )
}
