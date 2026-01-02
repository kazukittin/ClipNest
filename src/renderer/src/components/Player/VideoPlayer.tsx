import { useState, useRef, useEffect, useCallback } from 'react'
import {
    X,
    Play,
    Pause,
    Volume2,
    VolumeX,
    Maximize,
    Minimize,
    SkipBack,
    SkipForward,
    Heart
} from 'lucide-react'
import { Video } from '../../types/video'

interface VideoPlayerProps {
    video: Video
    onClose: () => void
    onToggleFavorite: () => void
}

export default function VideoPlayer({ video, onClose, onToggleFavorite }: VideoPlayerProps): JSX.Element {
    const videoRef = useRef<HTMLVideoElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [volume, setVolume] = useState(1)
    const [isMuted, setIsMuted] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [showControls, setShowControls] = useState(true)
    const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Format time to mm:ss or hh:mm:ss
    const formatTime = (seconds: number): string => {
        const hours = Math.floor(seconds / 3600)
        const minutes = Math.floor((seconds % 3600) / 60)
        const secs = Math.floor(seconds % 60)

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`
    }

    // Toggle play/pause
    const togglePlay = useCallback(() => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause()
            } else {
                videoRef.current.play()
            }
            setIsPlaying(!isPlaying)
        }
    }, [isPlaying])

    // Toggle mute
    const toggleMute = useCallback(() => {
        if (videoRef.current) {
            videoRef.current.muted = !isMuted
            setIsMuted(!isMuted)
        }
    }, [isMuted])

    // Skip forward/backward
    const skip = useCallback((seconds: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + seconds))
        }
    }, [duration])

    // Toggle fullscreen
    const toggleFullscreen = useCallback(async () => {
        if (!containerRef.current) return

        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen()
                setIsFullscreen(false)
            } else {
                await containerRef.current.requestFullscreen()
                setIsFullscreen(true)
            }
        } catch (err) {
            console.error('Fullscreen error:', err)
        }
    }, [])

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'Escape':
                    if (isFullscreen) {
                        document.exitFullscreen()
                    } else {
                        onClose()
                    }
                    break
                case ' ':
                    e.preventDefault()
                    togglePlay()
                    break
                case 'ArrowLeft':
                    skip(-10)
                    break
                case 'ArrowRight':
                    skip(10)
                    break
                case 'ArrowUp':
                    e.preventDefault()
                    if (videoRef.current) {
                        videoRef.current.volume = Math.min(1, volume + 0.1)
                        setVolume(videoRef.current.volume)
                    }
                    break
                case 'ArrowDown':
                    e.preventDefault()
                    if (videoRef.current) {
                        videoRef.current.volume = Math.max(0, volume - 0.1)
                        setVolume(videoRef.current.volume)
                    }
                    break
                case 'm':
                case 'M':
                    toggleMute()
                    break
                case 'f':
                case 'F':
                    toggleFullscreen()
                    break
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isPlaying, isFullscreen, volume, togglePlay, toggleMute, toggleFullscreen, skip, onClose])

    // Auto-hide controls
    useEffect(() => {
        const resetTimeout = () => {
            if (controlsTimeoutRef.current) {
                clearTimeout(controlsTimeoutRef.current)
            }
            setShowControls(true)
            if (isPlaying) {
                controlsTimeoutRef.current = setTimeout(() => {
                    setShowControls(false)
                }, 3000)
            }
        }

        resetTimeout()
        return () => {
            if (controlsTimeoutRef.current) {
                clearTimeout(controlsTimeoutRef.current)
            }
        }
    }, [isPlaying])

    // Handle fullscreen change
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement)
        }
        document.addEventListener('fullscreenchange', handleFullscreenChange)
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }, [])

    // Video event handlers
    const handleTimeUpdate = () => {
        if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime)
        }
    }

    const handleLoadedMetadata = () => {
        if (videoRef.current) {
            setDuration(videoRef.current.duration)
        }
    }

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = parseFloat(e.target.value)
        if (videoRef.current) {
            videoRef.current.currentTime = time
            setCurrentTime(time)
        }
    }

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const vol = parseFloat(e.target.value)
        if (videoRef.current) {
            videoRef.current.volume = vol
            setVolume(vol)
            setIsMuted(vol === 0)
        }
    }

    // Progress percentage
    const progress = duration > 0 ? (currentTime / duration) * 100 : 0

    return (
        <div
            ref={containerRef}
            className="fixed inset-0 z-50 bg-black flex items-center justify-center animate-fade-in"
            onMouseMove={() => setShowControls(true)}
            onClick={() => setShowControls(true)}
        >
            {/* Close button */}
            <button
                onClick={onClose}
                className={`absolute top-4 right-4 z-20 p-2 rounded-full bg-white/10 backdrop-blur-sm text-white 
          hover:bg-white/20 transition-all duration-200 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            >
                <X className="w-6 h-6" />
            </button>

            {/* Video title and info */}
            <div className={`absolute top-0 left-0 right-0 z-10 p-6 bg-gradient-to-b from-black/80 to-transparent
        transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
                <h2 className="text-xl font-semibold text-white">{video.name}</h2>
                <p className="text-sm text-white/60 mt-1">{video.extension.replace('.', '').toUpperCase()}</p>
            </div>

            {/* Video element */}
            <video
                ref={videoRef}
                src={`file://${video.path}`}
                className="max-w-full max-h-full cursor-pointer"
                onClick={(e) => {
                    e.stopPropagation()
                    togglePlay()
                }}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
            />

            {/* Center play button (when paused) */}
            <button
                onClick={togglePlay}
                className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 z-10 ${!isPlaying && showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
            >
                <div className="w-20 h-20 rounded-full bg-cn-accent/90 backdrop-blur-sm flex items-center justify-center
          shadow-2xl shadow-cn-accent/30 hover:scale-105 transition-transform">
                    <Play className="w-10 h-10 text-white ml-1" />
                </div>
            </button>

            {/* Bottom controls */}
            <div className={`absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/90 via-black/60 to-transparent 
        p-6 pt-16 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>

                {/* Progress bar */}
                <div className="mb-4 group/progress">
                    <div className="relative h-1 bg-white/20 rounded-full overflow-hidden cursor-pointer"
                        onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect()
                            const percent = (e.clientX - rect.left) / rect.width
                            if (videoRef.current) {
                                videoRef.current.currentTime = percent * duration
                            }
                        }}>
                        {/* Buffered indicator */}
                        <div className="absolute inset-0 bg-white/10" />
                        {/* Progress */}
                        <div
                            className="absolute top-0 left-0 h-full bg-cn-accent rounded-full transition-all"
                            style={{ width: `${progress}%` }}
                        />
                        {/* Hover thumb */}
                        <div
                            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-cn-accent rounded-full shadow-lg 
                opacity-0 group-hover/progress:opacity-100 transition-opacity"
                            style={{ left: `calc(${progress}% - 6px)` }}
                        />
                    </div>

                    {/* Time display */}
                    <div className="flex justify-between text-xs text-white/60 mt-2">
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                    </div>
                </div>

                {/* Control buttons */}
                <div className="flex items-center justify-between">
                    {/* Left controls */}
                    <div className="flex items-center gap-2">
                        {/* Skip back */}
                        <button
                            onClick={() => skip(-10)}
                            className="p-2 text-white/70 hover:text-white transition-colors rounded-full hover:bg-white/10"
                            title="10秒戻る (←)"
                        >
                            <SkipBack className="w-5 h-5" />
                        </button>

                        {/* Play/Pause */}
                        <button
                            onClick={togglePlay}
                            className="p-3 bg-cn-accent rounded-full text-white hover:bg-cn-accent-hover transition-all hover:scale-105"
                        >
                            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                        </button>

                        {/* Skip forward */}
                        <button
                            onClick={() => skip(10)}
                            className="p-2 text-white/70 hover:text-white transition-colors rounded-full hover:bg-white/10"
                            title="10秒進む (→)"
                        >
                            <SkipForward className="w-5 h-5" />
                        </button>

                        {/* Volume */}
                        <div className="flex items-center gap-1 ml-2 group/volume">
                            <button
                                onClick={toggleMute}
                                className="p-2 text-white/70 hover:text-white transition-colors rounded-full hover:bg-white/10"
                                title="ミュート (M)"
                            >
                                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                            </button>
                            <div className="w-0 group-hover/volume:w-20 overflow-hidden transition-all duration-200">
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={isMuted ? 0 : volume}
                                    onChange={handleVolumeChange}
                                    className="w-20 h-1 bg-white/20 rounded-full appearance-none cursor-pointer
                    [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
                    [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white 
                    [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Right controls */}
                    <div className="flex items-center gap-1">
                        {/* Favorite */}
                        <button
                            onClick={onToggleFavorite}
                            className={`p-2 rounded-full transition-all hover:bg-white/10 ${video.isFavorite ? 'text-cn-error' : 'text-white/70 hover:text-white'
                                }`}
                            title="お気に入り"
                        >
                            <Heart className={`w-5 h-5 ${video.isFavorite ? 'fill-current' : ''}`} />
                        </button>

                        {/* Fullscreen */}
                        <button
                            onClick={toggleFullscreen}
                            className="p-2 text-white/70 hover:text-white transition-colors rounded-full hover:bg-white/10"
                            title="フルスクリーン (F)"
                        >
                            {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Keyboard shortcuts hint */}
            <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] text-white/40 
        transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
                Space: 再生/停止 | ←→: 10秒スキップ | ↑↓: 音量 | M: ミュート | F: フルスクリーン | Esc: 閉じる
            </div>
        </div>
    )
}
