import { useState, useRef, useEffect, useCallback } from 'react'
import {
    X,
    Play,
    Pause,
    Volume2,
    Volume1,
    VolumeX,
    Maximize,
    Minimize,
    SkipBack,
    SkipForward,
    Heart,
    AlertCircle,
    Tag,
    Plus,
    Settings,
    Loader2,
    Repeat,
    FastForward
} from 'lucide-react'
import { Video } from '../../types/video'

interface VideoPlayerProps {
    video: Video
    onClose: () => void
    onToggleFavorite: () => void
    onUpdateTags: (tags: string[]) => void
}

// Convert local path to file:// URL for video playback
function toVideoUrl(path: string): string {
    const normalizedPath = path.replace(/\\/g, '/')
    return `file:///${normalizedPath.replace(/^\//, '')}`
}

export default function VideoPlayer({ video, onClose, onToggleFavorite, onUpdateTags }: VideoPlayerProps): JSX.Element {
    const videoRef = useRef<HTMLVideoElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const tagInputRef = useRef<HTMLInputElement>(null)
    const progressBarRef = useRef<HTMLDivElement>(null)

    // Playback State
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [volume, setVolume] = useState(1)
    const [isMuted, setIsMuted] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [playbackRate, setPlaybackRate] = useState(1)
    const [isLoading, setIsLoading] = useState(true)
    const [isLooping, setIsLooping] = useState(false)

    // UI State
    const [showControls, setShowControls] = useState(true)
    const [videoError, setVideoError] = useState<string | null>(null)
    const [newTagInput, setNewTagInput] = useState('')
    const [showTagEditor, setShowTagEditor] = useState(false)
    const [showSettings, setShowSettings] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    const [hoverTime, setHoverTime] = useState<number | null>(null)
    const [hoverPosition, setHoverPosition] = useState<number | null>(null)

    // Feedback Overlay State
    const [feedback, setFeedback] = useState<{ icon: React.ReactNode, text?: string } | null>(null)

    const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Helper: Show feedback overlay
    const showFeedback = useCallback((icon: React.ReactNode, text?: string) => {
        setFeedback({ icon, text })
        if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current)
        feedbackTimeoutRef.current = setTimeout(() => setFeedback(null), 800)
    }, [])

    // Format time to mm:ss or hh:mm:ss
    const formatTime = (seconds: number): string => {
        if (!isFinite(seconds) || isNaN(seconds)) return '0:00'
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
        if (videoRef.current && !videoError) {
            if (isPlaying) {
                videoRef.current.pause()
                showFeedback(<Pause className="w-8 h-8" />)
            } else {
                videoRef.current.play().catch(err => {
                    console.error('Playback error:', err)
                    setVideoError('再生できませんでした')
                })
                showFeedback(<Play className="w-8 h-8" />)
            }
        }
    }, [isPlaying, videoError, showFeedback])

    // Toggle mute
    const toggleMute = useCallback(() => {
        if (videoRef.current) {
            const nextMuted = !isMuted
            videoRef.current.muted = nextMuted
            setIsMuted(nextMuted)
            showFeedback(nextMuted ? <VolumeX className="w-8 h-8" /> : <Volume2 className="w-8 h-8" />)
        }
    }, [isMuted, showFeedback])

    // Change Volume
    const changeVolume = useCallback((newVolume: number) => {
        if (videoRef.current) {
            const clamped = Math.max(0, Math.min(1, newVolume))
            videoRef.current.volume = clamped
            setVolume(clamped)
            setIsMuted(clamped === 0)

            // Icon selection
            let Icon = Volume2
            if (clamped === 0) Icon = VolumeX
            else if (clamped < 0.5) Icon = Volume1

            showFeedback(<Icon className="w-8 h-8" />, `${Math.round(clamped * 100)}%`)
        }
    }, [showFeedback])

    // Skip forward/backward
    const skip = useCallback((seconds: number) => {
        if (videoRef.current) {
            const newTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + seconds))
            videoRef.current.currentTime = newTime
            setCurrentTime(newTime)

            const Icon = seconds > 0 ? SkipForward : SkipBack
            showFeedback(<Icon className="w-8 h-8" />, `${seconds > 0 ? '+' : ''}${seconds}秒`)
        }
    }, [duration, showFeedback])

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

    // Change Playback Speed
    const changePlaybackRate = useCallback((rate: number) => {
        if (videoRef.current) {
            videoRef.current.playbackRate = rate
            setPlaybackRate(rate)
            setShowSettings(false)
            showFeedback(<FastForward className="w-8 h-8" />, `${rate}倍速`)
        }
    }, [showFeedback])

    // Handle background click to close
    const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            // Check if we are dragging, if so don't close
            if (!isDragging) {
                onClose()
            }
        }
    }, [onClose, isDragging])

    // Handle Double Click
    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
        const width = containerRef.current?.clientWidth || 0
        const clickX = e.clientX

        // Left 25% -> -10s, Right 25% -> +10s, Center -> Toggle Fullscreen
        if (clickX < width * 0.25) {
            skip(-10)
        } else if (clickX > width * 0.75) {
            skip(10)
        } else {
            toggleFullscreen()
        }
    }, [skip, toggleFullscreen])

    // Handle Wheel (Volume)
    const handleWheel = useCallback((e: React.WheelEvent) => {
        const delta = e.deltaY * -0.001 // Adjust sensitivity
        changeVolume(volume + delta)
    }, [volume, changeVolume])

    // Tag Management
    const handleAddTag = useCallback(() => {
        const tag = newTagInput.trim().toLowerCase()
        if (tag && !video.tags.includes(tag)) {
            onUpdateTags([...video.tags, tag])
        }
        setNewTagInput('')
    }, [newTagInput, video.tags, onUpdateTags])

    const handleRemoveTag = useCallback((tagToRemove: string) => {
        onUpdateTags(video.tags.filter(tag => tag !== tagToRemove))
    }, [video.tags, onUpdateTags])

    const handleTagInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            handleAddTag()
        } else if (e.key === 'Escape') {
            e.stopPropagation()
            setShowTagEditor(false)
        }
    }

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't handle shortcuts when typing in inputs
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '')) return

            switch (e.key) {
                case 'Escape':
                    if (isFullscreen) document.exitFullscreen()
                    else onClose()
                    break
                case ' ':
                case 'k':
                    e.preventDefault()
                    togglePlay()
                    break
                case 'ArrowLeft':
                    skip(-5)
                    break
                case 'ArrowRight':
                    skip(5)
                    break
                case 'ArrowUp':
                    e.preventDefault()
                    changeVolume(volume + 0.1)
                    break
                case 'ArrowDown':
                    e.preventDefault()
                    changeVolume(volume - 0.1)
                    break
                case 'm':
                case 'M':
                    toggleMute()
                    break
                case 'f':
                case 'F':
                    toggleFullscreen()
                    break
                case 'l':
                case 'L':
                    skip(10)
                    break
                case 'j':
                case 'J':
                    skip(-10)
                    break
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isPlaying, isFullscreen, volume, togglePlay, toggleMute, toggleFullscreen, skip, changeVolume, onClose])

    // Auto-hide controls
    useEffect(() => {
        const resetTimeout = () => {
            if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current)
            setShowControls(true)
            if (isPlaying && !showSettings && !showTagEditor && !isDragging) {
                controlsTimeoutRef.current = setTimeout(() => {
                    setShowControls(false)
                }, 3000)
            }
        }

        const handleMouseMove = () => resetTimeout()
        window.addEventListener('mousemove', handleMouseMove)
        resetTimeout()

        return () => {
            if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current)
            window.removeEventListener('mousemove', handleMouseMove)
        }
    }, [isPlaying, showSettings, showTagEditor, isDragging])

    // Fullscreen change listener
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement)
        }
        document.addEventListener('fullscreenchange', handleFullscreenChange)
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }, [])

    // Seek function
    const seek = useCallback((clientX: number) => {
        if (!progressBarRef.current || !videoRef.current) return

        const rect = progressBarRef.current.getBoundingClientRect()
        const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
        const time = percent * duration

        videoRef.current.currentTime = time
        setCurrentTime(time)
    }, [duration])

    // Progress Bar Interaction
    const handleProgressMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true)
        seek(e.clientX)
    }

    const handleProgressMove = useCallback((e: React.MouseEvent | MouseEvent) => {
        if (isDragging) {
            seek(e.clientX)
        }
    }, [isDragging, seek])

    const handleProgressMouseUp = useCallback(() => {
        setIsDragging(false)
    }, [])

    const handleProgressHover = useCallback((e: React.MouseEvent) => {
        if (!progressBarRef.current) return
        const rect = progressBarRef.current.getBoundingClientRect()
        const p = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        setHoverPosition(p * 100)
        setHoverTime(p * duration)
    }, [duration])

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleProgressMove)
            window.addEventListener('mouseup', handleProgressMouseUp)
        }
        return () => {
            window.removeEventListener('mousemove', handleProgressMove)
            window.removeEventListener('mouseup', handleProgressMouseUp)
        }
    }, [isDragging, handleProgressMove, handleProgressMouseUp])


    // Video event handlers
    const handleTimeUpdate = () => {
        if (videoRef.current && !isDragging) {
            setCurrentTime(videoRef.current.currentTime)
        }
    }

    const handleLoadedMetadata = () => {
        if (videoRef.current) {
            setDuration(videoRef.current.duration)
            setVideoError(null)
            setIsLoading(false)
        }
    }

    // Video URL calculation
    const videoUrl = toVideoUrl(video.path)
    const progress = duration > 0 ? (currentTime / duration) * 100 : 0

    return (
        <div
            ref={containerRef}
            className="fixed inset-0 z-50 bg-black flex items-center justify-center font-sans select-none group/container"
            onClick={handleBackgroundClick}
            onDoubleClick={handleDoubleClick}
            onWheel={handleWheel}
        >
            {/* Background Gradient for Contrast */}
            <div className={`absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/60 pointer-events-none transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`} />

            {/* Video Element */}
            <video
                ref={videoRef}
                src={videoUrl}
                className="max-w-full max-h-full outline-none shadow-2xl"
                onClick={(e) => {
                    e.stopPropagation()
                    togglePlay()
                }}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onWaiting={() => setIsLoading(true)}
                onCanPlay={() => setIsLoading(false)}
                onPlaying={() => setIsLoading(false)}
                onEnded={() => {
                    if (isLooping) {
                        videoRef.current?.play()
                    } else {
                        setIsPlaying(false)
                    }
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onVolumeChange={(e) => {
                    setVolume(e.currentTarget.volume)
                    setIsMuted(e.currentTarget.muted)
                }}
                onError={(e) => {
                    setVideoError('動画の読み込みに失敗しました')
                    console.error('Video Error:', e)
                    setIsLoading(false)
                }}
                autoPlay
            />

            {/* Loading Spinner */}
            {isLoading && !videoError && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-black/50 p-4 rounded-full backdrop-blur-md">
                        <Loader2 className="w-12 h-12 text-white animate-spin" />
                    </div>
                </div>
            )}

            {/* Central Feedback Overlay (Volume, Seek, Play/Pause) */}
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 
                flex flex-col items-center justify-center p-6 rounded-2xl bg-black/60 backdrop-blur-md text-white transition-all duration-300 pointer-events-none
                ${feedback ? 'opacity-100 scale-100 blur-none' : 'opacity-0 scale-95 blur-sm'}`}>
                {feedback?.icon}
                {feedback?.text && (
                    <span className="mt-2 text-lg font-medium tracking-wide">{feedback.text}</span>
                )}
            </div>

            {/* Error State */}
            {videoError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white bg-black/90 z-50">
                    <AlertCircle className="w-16 h-16 text-cn-error mb-4" />
                    <p className="text-xl font-bold mb-2">{videoError}</p>
                    <p className="text-white/60 mb-6 max-w-lg text-center truncate px-4">{video.path}</p>
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-cn-accent rounded-lg hover:bg-cn-accent-hover transition-colors font-medium"
                    >
                        閉じる
                    </button>
                </div>
            )}

            {/* Top Bar (Title & Close) */}
            <div className={`absolute top-0 left-0 right-0 p-6 flex items-start justify-between z-40 transition-all duration-300 ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
                <div className="flex flex-col gap-1 max-w-[70%]">
                    <h2 className="text-xl font-bold text-white drop-shadow-md truncate">{video.name}</h2>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-white/20 text-white/90">
                            {video.extension.replace('.', '').toUpperCase()}
                        </span>
                        {video.tags.map(tag => (
                            <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-cn-accent/30 text-cn-accent border border-cn-accent/20">
                                #{tag}
                            </span>
                        ))}
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 rounded-full bg-black/20 text-white hover:bg-white/20 backdrop-blur-sm transition-colors"
                >
                    <X className="w-6 h-6" />
                </button>
            </div>

            {/* Tag Editor Popup */}
            {showTagEditor && (
                <div
                    className="absolute top-24 right-6 z-50 w-80 bg-cn-surface/95 backdrop-blur-xl border border-cn-border rounded-xl shadow-2xl p-4 animate-in fade-in zoom-in-95 duration-200"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                            <Tag className="w-4 h-4 text-cn-accent" />
                            タグの管理
                        </h3>
                        <button onClick={() => setShowTagEditor(false)} className="text-white/50 hover:text-white">
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-4 max-h-[120px] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/20">
                        {video.tags.length === 0 && <p className="text-xs text-white/40 italic">タグがありません</p>}
                        {video.tags.map(tag => (
                            <div key={tag} className="flex items-center gap-1 pl-2 pr-1 py-1 rounded bg-cn-accent/10 border border-cn-accent/20 text-xs text-cn-accent group">
                                {tag}
                                <button onClick={() => handleRemoveTag(tag)} className="p-0.5 rounded-full hover:bg-cn-accent/20 text-cn-accent/60 hover:text-cn-accent transition-colors">
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="flex gap-2">
                        <input
                            ref={tagInputRef}
                            type="text"
                            value={newTagInput}
                            onChange={(e) => setNewTagInput(e.target.value)}
                            onKeyDown={handleTagInputKeyDown}
                            placeholder="新しいタグを入力..."
                            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-cn-accent/50"
                        />
                        <button
                            onClick={handleAddTag}
                            disabled={!newTagInput.trim()}
                            className="bg-cn-accent text-white p-1.5 rounded-lg hover:bg-cn-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <Plus className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            )}

            {/* Settings Popup */}
            {showSettings && (
                <div
                    className="absolute bottom-24 right-6 z-50 w-64 bg-cn-surface/95 backdrop-blur-xl border border-cn-border rounded-xl shadow-2xl p-2 animate-in fade-in slide-in-from-bottom-5 duration-200"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex flex-col gap-1">
                        <div className="px-3 py-2 text-xs font-semibold text-white/50 uppercase tracking-wider">再生速度</div>
                        {[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => (
                            <button
                                key={rate}
                                onClick={() => changePlaybackRate(rate)}
                                className={`flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors ${playbackRate === rate ? 'bg-cn-accent/20 text-cn-accent' : 'text-white hover:bg-white/5'}`}
                            >
                                <span>{rate}x</span>
                                {playbackRate === rate && <div className="w-2 h-2 rounded-full bg-cn-accent" />}
                            </button>
                        ))}
                        <div className="h-px bg-white/10 my-1" />
                        <button
                            onClick={() => { setIsLooping(!isLooping); setShowSettings(false); showFeedback(<Repeat className={`w-8 h-8 ${!isLooping ? 'text-cn-accent' : 'text-white/50'}`} />, !isLooping ? 'ループ: オン' : 'ループ: オフ'); }}
                            className={`flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors ${isLooping ? 'bg-cn-accent/20 text-cn-accent' : 'text-white hover:bg-white/5'}`}
                        >
                            <span>ループ再生</span>
                            <Repeat className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            {/* Bottom Controls */}
            <div
                className={`absolute bottom-0 left-0 right-0 p-6 pt-24 bg-gradient-to-t from-black/90 via-black/60 to-transparent transition-all duration-300 z-30
                ${showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}
                onClick={(e) => e.stopPropagation()}
                onMouseEnter={() => setShowControls(true)}
            >
                {/* Progress Bar Container */}
                <div
                    className="relative group/progress h-5 mb-4 flex items-center cursor-pointer select-none"
                    ref={progressBarRef}
                    onMouseDown={handleProgressMouseDown}
                    onMouseMove={handleProgressHover}
                    onMouseLeave={() => { setHoverTime(null); setHoverPosition(null); }}
                >
                    {/* Hover Time Tooltip */}
                    {hoverPosition !== null && hoverTime !== null && (
                        <div
                            className="absolute bottom-8 -translate-x-1/2 bg-white/10 backdrop-blur-md px-2 py-1 rounded text-xs text-white font-mono pointer-events-none border border-white/10"
                            style={{ left: `${hoverPosition}%` }}
                        >
                            {formatTime(hoverTime)}
                        </div>
                    )}

                    {/* Track */}
                    <div className="w-full h-1 bg-white/20 rounded-full overflow-visible relative group-hover/progress:h-1.5 transition-all">
                        {/* Buffer/Load progress could go here */}

                        {/* Playback Progress */}
                        <div
                            className="absolute left-0 top-0 h-full bg-cn-accent rounded-full transition-none"
                            style={{ width: `${progress}%` }}
                        />

                        {/* Thumb */}
                        <div
                            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)] scale-0 group-hover/progress:scale-100 transition-transform"
                            style={{ left: `${progress}%` }}
                        />
                    </div>
                </div>

                {/* Control Rows */}
                <div className="flex items-center justify-between">

                    {/* Left Controls */}
                    <div className="flex items-center gap-4">
                        <button onClick={togglePlay} className="text-white hover:text-cn-accent transition-colors hover:scale-110 active:scale-95">
                            {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current" />}
                        </button>

                        <div className="flex items-center gap-2 text-white/80 group/volume">
                            <button onClick={toggleMute} className="hover:text-white transition-colors">
                                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : volume < 0.5 ? <Volume1 className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                            </button>
                            <div className="w-0 overflow-hidden group-hover/volume:w-24 transition-all duration-300 flex items-center">
                                <input
                                    type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume} onChange={(e) => changeVolume(parseFloat(e.target.value))}
                                    className="w-20 h-1 accent-cn-accent bg-white/20 rounded-full cursor-pointer ml-2"
                                />
                            </div>
                        </div>

                        <div className="text-xs text-white/50 font-mono flex items-center gap-1 select-none">
                            <span className="text-white/90">{formatTime(currentTime)}</span>
                            <span>/</span>
                            <span>{formatTime(duration)}</span>
                        </div>
                    </div>

                    {/* Right Controls */}
                    <div className="flex items-center gap-3 text-white/80">
                        <button onClick={() => setShowTagEditor(!showTagEditor)} className={`p-2 rounded-full hover:bg-white/10 transition-colors ${showTagEditor ? 'text-cn-accent bg-white/10' : ''}`} title="タグ (T)">
                            <Tag className="w-5 h-5" />
                        </button>

                        <button onClick={onToggleFavorite} className={`p-2 rounded-full hover:bg-white/10 transition-colors ${video.isFavorite ? 'text-cn-error' : ''}`} title="お気に入り">
                            <Heart className={`w-5 h-5 ${video.isFavorite ? 'fill-current' : ''}`} />
                        </button>

                        <div className="w-px h-4 bg-white/20 mx-1" />

                        <button onClick={() => setShowSettings(!showSettings)} className={`p-2 rounded-full hover:bg-white/10 transition-colors ${showSettings ? 'text-cn-accent bg-white/10' : ''} ${isLooping || playbackRate !== 1 ? 'text-cn-accent' : ''}`} title="設定">
                            <Settings className="w-5 h-5" />
                        </button>

                        <button onClick={toggleFullscreen} className="p-2 rounded-full hover:bg-white/10 transition-colors" title="フルスクリーン (F)">
                            {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
