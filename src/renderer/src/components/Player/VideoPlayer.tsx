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
    Heart,
    AlertCircle,
    Tag,
    Plus
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
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [volume, setVolume] = useState(1)
    const [isMuted, setIsMuted] = useState(false)
    const [isFullscreen, setIsFullscreen] = useState(false)
    const [showControls, setShowControls] = useState(true)
    const [videoError, setVideoError] = useState<string | null>(null)
    const [newTagInput, setNewTagInput] = useState('')
    const [showTagEditor, setShowTagEditor] = useState(false)
    const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
            } else {
                videoRef.current.play().catch(err => {
                    console.error('Playback error:', err)
                    setVideoError('Failed to play video')
                })
            }
        }
    }, [isPlaying, videoError])

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

    // Handle background click to close
    const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose()
        }
    }, [onClose])

    // Add new tag
    const handleAddTag = useCallback(() => {
        const tag = newTagInput.trim().toLowerCase()
        if (tag && !video.tags.includes(tag)) {
            onUpdateTags([...video.tags, tag])
        }
        setNewTagInput('')
    }, [newTagInput, video.tags, onUpdateTags])

    // Remove tag
    const handleRemoveTag = useCallback((tagToRemove: string) => {
        onUpdateTags(video.tags.filter(tag => tag !== tagToRemove))
    }, [video.tags, onUpdateTags])

    // Handle tag input keydown
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
            // Don't handle shortcuts when typing in tag input
            if (tagInputRef.current === document.activeElement) return

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
                    skip(-5)
                    break
                case 'ArrowRight':
                    skip(5)
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
                case 't':
                case 'T':
                    setShowTagEditor(prev => !prev)
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

    const handleVideoError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
        const video = e.currentTarget
        const error = video.error
        let message = 'Failed to load video'

        if (error) {
            switch (error.code) {
                case MediaError.MEDIA_ERR_ABORTED:
                    message = 'Video playback was aborted'
                    break
                case MediaError.MEDIA_ERR_NETWORK:
                    message = 'Network error while loading video'
                    break
                case MediaError.MEDIA_ERR_DECODE:
                    message = 'Video decoding error'
                    break
                case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                    message = 'Video format not supported'
                    break
            }
        }

        setVideoError(message)
        console.error('Video error:', error)
    }

    // Progress percentage
    const progress = duration > 0 ? (currentTime / duration) * 100 : 0

    // Video source URL
    const videoUrl = toVideoUrl(video.path)
    console.log('Video URL:', videoUrl)

    return (
        <div
            ref={containerRef}
            className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center animate-fade-in"
            onMouseMove={() => setShowControls(true)}
            onClick={handleBackgroundClick}
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
            <div className={`absolute top-0 left-0 right-16 z-10 p-6 bg-gradient-to-b from-black/80 to-transparent
        transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
                <h2 className="text-xl font-semibold text-white truncate">{video.name}</h2>
                <div className="flex items-center gap-2 mt-1">
                    <p className="text-sm text-white/60">{video.extension.replace('.', '').toUpperCase()}</p>
                    {/* Tags display in header */}
                    {video.tags.length > 0 && (
                        <div className="flex items-center gap-1 ml-2">
                            {video.tags.map(tag => (
                                <span
                                    key={tag}
                                    className="px-2 py-0.5 text-xs bg-cn-accent/30 text-cn-accent rounded-full"
                                >
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Tag Editor Panel */}
            {showTagEditor && (
                <div
                    className="absolute top-20 right-4 z-30 w-72 bg-cn-surface/95 backdrop-blur-md rounded-lg border border-cn-border p-4 shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-white flex items-center gap-2">
                            <Tag className="w-4 h-4" />
                            タグを編集
                        </h3>
                        <button
                            onClick={() => setShowTagEditor(false)}
                            className="text-white/60 hover:text-white"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Existing tags */}
                    <div className="flex flex-wrap gap-1.5 mb-3 max-h-24 overflow-y-auto">
                        {video.tags.length === 0 ? (
                            <p className="text-xs text-white/40">タグがありません</p>
                        ) : (
                            video.tags.map(tag => (
                                <span
                                    key={tag}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-cn-accent/20 text-cn-accent rounded-full group"
                                >
                                    {tag}
                                    <button
                                        onClick={() => handleRemoveTag(tag)}
                                        className="w-3.5 h-3.5 rounded-full bg-white/10 hover:bg-white/30 flex items-center justify-center transition-colors"
                                    >
                                        <X className="w-2.5 h-2.5" />
                                    </button>
                                </span>
                            ))
                        )}
                    </div>

                    {/* Add new tag */}
                    <div className="flex items-center gap-2">
                        <input
                            ref={tagInputRef}
                            type="text"
                            value={newTagInput}
                            onChange={(e) => setNewTagInput(e.target.value)}
                            onKeyDown={handleTagInputKeyDown}
                            placeholder="新しいタグを入力..."
                            className="flex-1 px-3 py-2 text-sm bg-cn-dark border border-cn-border rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-cn-accent"
                        />
                        <button
                            onClick={handleAddTag}
                            disabled={!newTagInput.trim()}
                            className="p-2 bg-cn-accent rounded-lg text-white hover:bg-cn-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                    <p className="text-[10px] text-white/40 mt-2">Enterで追加 | Escで閉じる</p>
                </div>
            )}

            {/* Error state */}
            {videoError ? (
                <div className="flex flex-col items-center justify-center text-white">
                    <AlertCircle className="w-16 h-16 text-cn-error mb-4" />
                    <p className="text-lg font-medium">{videoError}</p>
                    <p className="text-sm text-white/60 mt-2 max-w-md text-center">
                        Path: {video.path}
                    </p>
                    <button
                        onClick={onClose}
                        className="mt-6 px-4 py-2 bg-cn-accent rounded-lg hover:bg-cn-accent-hover transition-colors"
                    >
                        Close
                    </button>
                </div>
            ) : (
                <>
                    {/* Video element */}
                    <video
                        ref={videoRef}
                        src={videoUrl}
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
                        onError={handleVideoError}
                        autoPlay
                    />

                    {/* Center play button (when paused) */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            togglePlay()
                        }}
                        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 z-10 ${!isPlaying && showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
                            }`}
                    >
                        <div className="w-20 h-20 rounded-full bg-cn-accent/90 backdrop-blur-sm flex items-center justify-center
              shadow-2xl shadow-cn-accent/30 hover:scale-105 transition-transform">
                            <Play className="w-10 h-10 text-white ml-1" />
                        </div>
                    </button>

                    {/* Bottom controls */}
                    <div
                        className={`absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/90 via-black/60 to-transparent 
              p-6 pt-16 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Progress bar */}
                        <div className="mb-4 group/progress">
                            <div
                                className="relative h-1.5 bg-white/20 rounded-full overflow-hidden cursor-pointer hover:h-2 transition-all"
                                onClick={(e) => {
                                    const rect = e.currentTarget.getBoundingClientRect()
                                    const percent = (e.clientX - rect.left) / rect.width
                                    if (videoRef.current) {
                                        videoRef.current.currentTime = percent * duration
                                    }
                                }}
                            >
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
                                {/* Tags button */}
                                <button
                                    onClick={() => setShowTagEditor(!showTagEditor)}
                                    className={`p-2 rounded-full transition-all hover:bg-white/10 ${showTagEditor ? 'text-cn-accent' : 'text-white/70 hover:text-white'
                                        }`}
                                    title="タグを編集 (T)"
                                >
                                    <Tag className="w-5 h-5" />
                                </button>

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
            transition-opacity duration-300 pointer-events-none ${showControls ? 'opacity-100' : 'opacity-0'}`}>
                        Space: 再生/停止 | ←→: 5秒スキップ | ↑↓: 音量 | M: ミュート | F: フルスクリーン | T: タグ編集 | Esc: 閉じる
                    </div>
                </>
            )}
        </div>
    )
}
