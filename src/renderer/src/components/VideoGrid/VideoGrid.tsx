import { useMemo, useState, useEffect, useRef } from 'react'
import { Film, Heart, Clock, HardDrive, Loader2, Play, ArrowUpDown, CheckSquare, Square, FileText, RefreshCw } from 'lucide-react'
import { FixedSizeGrid as Grid } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'
import { Video, SortField, SortOrder } from '../../types/video'

interface VideoGridProps {
    videos: Video[] // Filtered and sorted videos
    selectedFolder: string | null
    selectedTag: string | null
    showFavorites: boolean
    searchQuery: string
    sortField: SortField
    sortOrder: SortOrder
    isLoading: boolean
    loadingMessage?: string
    onVideoPlay: (video: Video) => void
    onToggleFavorite: (videoPath: string) => void
    onVideoEdit: (video: Video) => void
    onBatchRename?: (videos: Video[]) => void
    onBatchConvert?: (videos: Video[]) => void
    onSortChange: (field: SortField, order: SortOrder) => void
}

// Constants for Grid Layout
const CARD_MIN_WIDTH = 250
const CARD_HEIGHT = 280
const GAP = 16

// Format file size to human readable
function formatSize(bytes: number): string {
    const gb = bytes / (1024 * 1024 * 1024)
    if (gb >= 1) {
        return `${gb.toFixed(1)} GB`
    }
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(1)} MB`
}

// Format duration to mm:ss or hh:mm:ss
function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    }
    return `${m}:${s.toString().padStart(2, '0')}`
}

// Get file extension display
function getExtensionBadge(extension: string): string {
    return extension.replace('.', '').toUpperCase()
}

export default function VideoGrid({
    videos,
    selectedFolder,
    selectedTag,
    showFavorites,
    searchQuery,
    sortField,
    sortOrder,
    isLoading,
    loadingMessage,
    onVideoPlay,
    onToggleFavorite,
    onVideoEdit,
    onBatchRename,
    onBatchConvert,
    onSortChange
}: VideoGridProps): JSX.Element {
    // Selection mode state
    const [selectionMode, setSelectionMode] = useState(false)
    const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set())
    // Batch conversion state
    const [isConverting, setIsConverting] = useState(false)
    const [conversionProgress, setConversionProgress] = useState({ current: 0, total: 0, currentFile: '' })
    const [fileProgress, setFileProgress] = useState(0)
    const [conversionCancelled, setConversionCancelled] = useState(false)
    const currentFilePathRef = useRef<string>('')
    const lastProgressRef = useRef<number>(0)

    // Clear selection when exiting selection mode
    const handleToggleSelectionMode = () => {
        if (selectionMode) {
            setSelectedVideoIds(new Set())
        }
        setSelectionMode(!selectionMode)
    }

    // Toggle video selection
    const handleToggleVideoSelection = (videoId: string) => {
        setSelectedVideoIds(prev => {
            const newSet = new Set(prev)
            if (newSet.has(videoId)) {
                newSet.delete(videoId)
            } else {
                newSet.add(videoId)
            }
            return newSet
        })
    }

    // Select all videos
    const handleSelectAll = () => {
        const allIds = new Set(videos.map(v => v.id))
        setSelectedVideoIds(allIds)
    }

    // Clear selection
    const handleClearSelection = () => {
        setSelectedVideoIds(new Set())
    }

    // Get selected videos (must be after filteredVideos)
    const selectedVideos = useMemo(() => {
        return videos.filter(v => selectedVideoIds.has(v.id))
    }, [videos, selectedVideoIds])

    // Get convertible videos (non-mp4)
    const convertibleVideos = useMemo(() => {
        const supportedFormats = ['.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.mts']
        return selectedVideos.filter(v => supportedFormats.includes(v.extension.toLowerCase()))
    }, [selectedVideos])

    // Handle batch conversion
    const handleBatchConvert = async () => {
        if (convertibleVideos.length === 0) {
            alert('変換可能な動画が選択されていません\n(MP4ファイルはスキップされます)')
            return
        }

        const skippedCount = selectedVideos.length - convertibleVideos.length
        const confirmMsg = skippedCount > 0
            ? `${convertibleVideos.length}件の動画をMP4に変換します\n(${skippedCount}件のMP4/非対応形式はスキップ)`
            : `${convertibleVideos.length}件の動画をMP4に変換します`

        if (!confirm(confirmMsg)) return

        setIsConverting(true)
        setConversionCancelled(false)
        setConversionProgress({ current: 0, total: convertibleVideos.length, currentFile: '' })
        setFileProgress(0)
        lastProgressRef.current = 0

        // Set up progress listener
        const removeProgressListener = window.electron.onConversionProgress(({ filePath, progress, status }) => {
            // Only update progress if it's for the current file and is an increase
            if (filePath === currentFilePathRef.current && progress >= lastProgressRef.current) {
                lastProgressRef.current = progress
                setFileProgress(progress)
            }
        })

        let cancelled = false

        for (let i = 0; i < convertibleVideos.length; i++) {
            if (cancelled) break

            const video = convertibleVideos[i]
            currentFilePathRef.current = video.path
            lastProgressRef.current = 0
            setConversionProgress({
                current: i + 1,
                total: convertibleVideos.length,
                currentFile: video.name
            })
            setFileProgress(0)

            try {
                const result = await window.electron.convertToMp4(video.path, true)
                if (!result.success) {
                    console.error(`Failed to convert ${video.name}: ${result.error}`)
                }
            } catch (error) {
                console.error(`Failed to convert ${video.name}:`, error)
            }

            // Check if cancelled during conversion
            if (conversionCancelled) {
                cancelled = true
            }

            // Every 5 files, pause briefly to allow memory to be freed
            if ((i + 1) % 5 === 0 && i < convertibleVideos.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000))
            }
        }

        removeProgressListener()
        setIsConverting(false)
        setConversionProgress({ current: 0, total: 0, currentFile: '' })
        setFileProgress(0)

        if (!cancelled) {
            alert('変換が完了しました')
        }
        handleClearSelection()
    }

    // Handle cancel conversion
    const handleCancelConversion = async () => {
        setConversionCancelled(true)
        // Cancel current file conversion
        if (conversionProgress.currentFile) {
            const currentVideo = convertibleVideos.find(v => v.name === conversionProgress.currentFile)
            if (currentVideo) {
                await window.electron.cancelConversion(currentVideo.path)
            }
        }
        setIsConverting(false)
        setConversionProgress({ current: 0, total: 0, currentFile: '' })
        setFileProgress(0)
        alert('変換を中止しました')
    }

    // Get header title
    const getTitle = () => {
        if (showFavorites) return 'お気に入り'
        if (selectedTag) return `タグ: ${selectedTag} `
        if (selectedFolder) return selectedFolder.split(/[\\/]/).pop() || 'フォルダ'
        return 'すべての動画'
    }

    // Cast components to any to avoid type complexity with certain versions
    // and handle potential CJS/ESM interop issues in Vite/Rollup during build
    // react-window and react-virtualized-auto-sizer can resolve differently in dev vs prod
    const VirtualGrid = (Grid as any).FixedSizeGrid || Grid
    const ProxyAutoSizer = (AutoSizer as any).AutoSizer || (AutoSizer as any).default || AutoSizer

    // Cell renderer for react-window
    const Cell = ({ columnIndex, rowIndex, style, data }: any) => {
        const { videos, columnCount, selectionMode, selectedVideoIds, onToggleSelection } = data
        const index = rowIndex * columnCount + columnIndex

        if (index >= videos.length) return null

        const video = videos[index]
        const isSelected = selectedVideoIds.has(video.id)

        // Ensure we handle the style correctly as it's passed by react-window
        const left = (typeof style.left === 'number' ? style.left : parseFloat(style.left)) + GAP
        const top = (typeof style.top === 'number' ? style.top : parseFloat(style.top)) + GAP
        const width = (typeof style.width === 'number' ? style.width : parseFloat(style.width)) - GAP
        const height = (typeof style.height === 'number' ? style.height : parseFloat(style.height)) - GAP

        return (
            <div style={{
                ...style,
                left,
                top,
                width,
                height
            }}>
                <VideoCard
                    video={video}
                    index={index}
                    onPlay={() => selectionMode ? onToggleSelection(video.id) : onVideoPlay(video)}
                    onToggleFavorite={() => onToggleFavorite(video.path)}
                    onEdit={() => onVideoEdit(video)}
                    selectionMode={selectionMode}
                    isSelected={isSelected}
                    onToggleSelection={() => onToggleSelection(video.id)}
                />
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <header className="flex items-center justify-between px-6 py-4 border-b border-cn-border bg-cn-surface/50 backdrop-blur-sm shrink-0">
                <div>
                    <h2 className="text-xl font-semibold text-cn-text">{getTitle()}</h2>
                    <p className="text-sm text-cn-text-muted mt-0.5">
                        {selectionMode ? (
                            <span className="text-cn-accent">
                                {selectedVideoIds.size} / {videos.length} 件選択中
                            </span>
                        ) : (
                            <>
                                {videos.length} 件の動画
                                {isLoading && (
                                    <span className="ml-2 inline-flex items-center gap-1.5 text-cn-accent">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        <span>{loadingMessage || '読み込み中...'}</span>
                                    </span>
                                )}
                            </>
                        )}
                    </p>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-3">
                    {/* Selection Mode Controls */}
                    {selectionMode && (
                        <div className="flex items-center gap-2 mr-2">
                            <button
                                onClick={handleSelectAll}
                                className="text-xs text-cn-text-muted hover:text-cn-accent transition-colors"
                            >
                                すべて選択
                            </button>
                            <span className="text-cn-border">|</span>
                            <button
                                onClick={handleClearSelection}
                                className="text-xs text-cn-text-muted hover:text-cn-accent transition-colors"
                            >
                                選択解除
                            </button>
                            {selectedVideoIds.size > 0 && onBatchRename && (
                                <>
                                    <span className="text-cn-border">|</span>
                                    <button
                                        onClick={() => onBatchRename(selectedVideos)}
                                        disabled={isConverting}
                                        className="flex items-center gap-1.5 text-xs bg-gradient-to-r from-purple-500 to-pink-500 text-white px-3 py-1.5 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                                    >
                                        <FileText className="w-3.5 h-3.5" />
                                        一括リネーム
                                    </button>
                                </>
                            )}
                            {selectedVideoIds.size > 0 && (
                                <>
                                    <span className="text-cn-border">|</span>
                                    {isConverting ? (
                                        <div className="flex items-center gap-2 text-xs text-white bg-blue-500/80 px-3 py-1.5 rounded-lg">
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            <span>変換中 {conversionProgress.current}/{conversionProgress.total}</span>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={handleBatchConvert}
                                            className="flex items-center gap-1.5 text-xs bg-gradient-to-r from-blue-500 to-cyan-500 text-white px-3 py-1.5 rounded-lg hover:opacity-90 transition-opacity"
                                            title={convertibleVideos.length < selectedVideos.length
                                                ? `${convertibleVideos.length}件変換 (${selectedVideos.length - convertibleVideos.length}件MP4/非対応スキップ)`
                                                : `${convertibleVideos.length}件変換`
                                            }
                                        >
                                            <RefreshCw className="w-3.5 h-3.5" />
                                            一括MP4変換
                                            {convertibleVideos.length < selectedVideos.length && (
                                                <span className="text-white/70">({convertibleVideos.length})</span>
                                            )}
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* Selection Mode Toggle */}
                    <button
                        onClick={handleToggleSelectionMode}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${selectionMode
                            ? 'bg-cn-accent text-white'
                            : 'bg-cn-surface hover:bg-cn-surface-hover border border-cn-border text-cn-text-muted'
                            }`}
                    >
                        {selectionMode ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                        <span>選択</span>
                    </button>

                    {/* Sort Control */}
                    <div className="flex items-center gap-2">
                        <ArrowUpDown className="w-4 h-4 text-cn-text-muted" />
                        <select
                            value={`${sortField}-${sortOrder}`}
                            onChange={(e) => {
                                const [field, order] = e.target.value.split('-') as [SortField, SortOrder]
                                onSortChange(field, order)
                            }}
                            className="bg-cn-surface hover:bg-cn-surface-hover border border-cn-border rounded-lg text-sm text-cn-text px-3 py-1.5 focus:outline-none focus:border-cn-accent transition-colors"
                        >
                            <option value="name-asc">名前 (A-Z)</option>
                            <option value="name-desc">名前 (Z-A)</option>
                            <option value="date-desc">日付 (新しい順)</option>
                            <option value="date-asc">日付 (古い順)</option>
                            <option value="size-desc">サイズ (大きい順)</option>
                            <option value="size-asc">サイズ (小さい順)</option>
                            <option value="duration-desc">時間 (長い順)</option>
                            <option value="duration-asc">時間 (短い順)</option>
                        </select>
                    </div>
                </div>
            </header>

            {/* Grid Container - Important: needs relative and min-size for AutoSizer */}
            <div className="flex-1 w-full h-full p-2 relative min-h-0 min-w-0">
                {videos.length === 0 && !isLoading ? (
                    <div className="flex flex-col items-center justify-center h-full text-cn-text-muted">
                        <div className="w-24 h-24 rounded-full bg-cn-surface flex items-center justify-center mb-4">
                            <Film className="w-12 h-12 opacity-30" />
                        </div>
                        <p className="text-lg font-medium">動画が見つかりません</p>
                        <p className="text-sm mt-1 text-center max-w-xs">
                            {searchQuery
                                ? '別の検索キーワードをお試しください'
                                : videos.length === 0
                                    ? 'サイドバーの「フォルダを追加」から動画を追加してください'
                                    : '現在のフィルタに一致する動画がありません'}
                        </p>
                    </div>
                ) : (
                    // ProxyAutoSizer and VirtualGrid should be valid at this point
                    VirtualGrid && ProxyAutoSizer ? (
                        <ProxyAutoSizer>
                            {({ height, width }: { height: number; width: number }) => {
                                // Prevent calculation errors if dimensions are 0
                                if (height === 0 || width === 0) {
                                    console.log('AutoSizer received 0 height or width, skipping render.')
                                    return null
                                }

                                // Calculate columns
                                const columnCount = Math.floor((width - GAP) / (CARD_MIN_WIDTH + GAP)) || 1
                                const columnWidth = (width - GAP) / columnCount
                                const rowCount = Math.ceil(videos.length / columnCount)

                                return (
                                    <VirtualGrid
                                        columnCount={columnCount}
                                        columnWidth={columnWidth}
                                        height={height}
                                        rowCount={rowCount}
                                        rowHeight={CARD_HEIGHT + GAP}
                                        width={width}
                                        itemData={{
                                            videos: videos,
                                            columnCount,
                                            selectionMode,
                                            selectedVideoIds,
                                            onToggleSelection: handleToggleVideoSelection
                                        }}
                                        className="scrollbar-thin scrollbar-thumb-cn-border scrollbar-track-transparent"
                                    >
                                        {Cell}
                                    </VirtualGrid>
                                )
                            }}
                        </ProxyAutoSizer>
                    ) : (
                        <div className="flex items-center justify-center h-full text-cn-error">
                            コンポーネントの読み込みに失敗しました
                        </div>
                    )
                )}
            </div>

            {/* Conversion Progress Modal */}
            {isConverting && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
                    <div className="w-full max-w-md bg-cn-surface border border-cn-border rounded-2xl shadow-2xl p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                                <RefreshCw className="w-6 h-6 text-white animate-spin" />
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-white">MP4に変換中</h3>
                                <p className="text-sm text-white/60">
                                    {conversionProgress.current} / {conversionProgress.total} ファイル
                                </p>
                            </div>
                        </div>

                        {/* Current file */}
                        <div className="mb-4">
                            <p className="text-sm text-white/80 mb-2 truncate" title={conversionProgress.currentFile}>
                                変換中: {conversionProgress.currentFile}
                            </p>
                        </div>

                        {/* File progress bar */}
                        <div className="mb-2">
                            <div className="flex justify-between text-xs text-white/60 mb-1">
                                <span>ファイル進捗</span>
                                <span>{fileProgress}%</span>
                            </div>
                            <div className="w-full h-3 bg-cn-dark rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all duration-300"
                                    style={{ width: `${fileProgress}%` }}
                                />
                            </div>
                        </div>

                        {/* Overall progress bar */}
                        <div className="mb-6">
                            <div className="flex justify-between text-xs text-white/60 mb-1">
                                <span>全体進捗</span>
                                <span>{Math.round((conversionProgress.current / conversionProgress.total) * 100)}%</span>
                            </div>
                            <div className="w-full h-3 bg-cn-dark rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                                    style={{ width: `${(conversionProgress.current / conversionProgress.total) * 100}%` }}
                                />
                            </div>
                        </div>

                        {/* Cancel button */}
                        <button
                            onClick={handleCancelConversion}
                            className="w-full py-3 bg-cn-error/20 text-cn-error border border-cn-error/30 rounded-lg hover:bg-cn-error/30 transition-colors font-medium"
                        >
                            変換を中止
                        </button>

                        <p className="text-xs text-white/40 text-center mt-4">
                            変換中は他の操作ができません
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}

// Individual video card component
interface VideoCardProps {
    video: Video
    index: number
    onPlay: () => void
    onToggleFavorite: () => void
    onEdit: () => void
    selectionMode?: boolean
    isSelected?: boolean
    onToggleSelection?: () => void
}

function VideoCard({ video, index, onPlay, onToggleFavorite, onEdit, selectionMode, isSelected, onToggleSelection }: VideoCardProps): JSX.Element {
    const [imageError, setImageError] = useState(false)
    const [imageLoaded, setImageLoaded] = useState(false)
    // 変更: IPC経由でのデータ取得を廃止し、local-fileプロトコルを使用
    const thumbnailUrl = useMemo(() => {
        if (!video.thumbnailPath) return null
        // Electronのカスタムプロトコル用にパスを正規化
        const normalizedPath = video.thumbnailPath.replace(/\\/g, '/')
        return `local-file:///${normalizedPath}`
    }, [video.thumbnailPath])

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault()
        onEdit()
    }

    const handleClick = () => {
        if (selectionMode && onToggleSelection) {
            onToggleSelection()
        } else {
            onPlay()
        }
    }

    return (
        <div
            className={`video-card group animate-fade-in ${selectionMode ? 'cursor-pointer' : ''} ${isSelected ? 'ring-2 ring-cn-accent ring-offset-2 ring-offset-cn-dark' : ''}`}
            style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
        >
            {/* Selection Checkbox */}
            {selectionMode && (
                <div className="absolute top-2 left-2 z-20">
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${isSelected
                        ? 'bg-cn-accent text-white'
                        : 'bg-black/50 text-white/70 border border-white/30'
                        }`}>
                        {isSelected ? (
                            <CheckSquare className="w-4 h-4" />
                        ) : (
                            <Square className="w-4 h-4" />
                        )}
                    </div>
                </div>
            )}

            {/* Thumbnail - 16:9 Aspect Ratio */}
            <div className="relative aspect-video bg-gradient-to-br from-cn-surface to-cn-dark overflow-hidden">
                {thumbnailUrl && !imageError ? (
                    <>
                        {/* Loading placeholder */}
                        {!imageLoaded && (
                            <div className="absolute inset-0 flex items-center justify-center bg-cn-surface">
                                <Loader2 className="w-6 h-6 text-cn-text-muted animate-spin" />
                            </div>
                        )}
                        <img
                            src={thumbnailUrl}
                            alt={video.name}
                            className={`w-full h-full object-cover object-center transition-all duration-300 group-hover:scale-105 ${imageLoaded ? 'opacity-100' : 'opacity-0'
                                }`}
                            onLoad={() => setImageLoaded(true)}
                            onError={() => setImageError(true)}
                            loading="lazy"
                        />
                    </>
                ) : (
                    // Fallback: Film icon placeholder
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="relative">
                            <Film className="w-12 h-12 text-cn-text-muted/30" />
                            <div className="absolute inset-0 bg-gradient-to-t from-cn-accent/20 to-transparent rounded-full blur-xl" />
                        </div>
                    </div>
                )}

                {/* Play button overlay on hover */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <div className="w-12 h-12 rounded-full bg-cn-accent/90 backdrop-blur-sm flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-transform duration-200">
                        <Play className="w-5 h-5 text-white ml-0.5" />
                    </div>
                </div>

                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                {/* Extension badge */}
                <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/60 backdrop-blur-sm rounded text-[10px] font-medium text-cn-text uppercase">
                    {getExtensionBadge(video.extension)}
                </div>

                {/* Duration badge */}
                {video.duration !== null && video.duration > 0 && (
                    <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/80 backdrop-blur-sm rounded text-xs text-white font-medium flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDuration(video.duration)}
                    </div>
                )}

                {/* Favorite button */}
                <button
                    onClick={(e) => {
                        e.stopPropagation()
                        onToggleFavorite()
                    }}
                    className={`absolute top-2 right-2 p-1.5 rounded-full transition-all duration-200 ${video.isFavorite
                        ? 'bg-cn-error/90 text-white scale-100'
                        : 'bg-black/50 text-white/70 hover:text-white opacity-0 group-hover:opacity-100 hover:scale-110'
                        }`}
                >
                    <Heart className={`w-4 h-4 ${video.isFavorite ? 'fill-current' : ''}`} />
                </button>

                {/* Hover info overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="flex items-center gap-3 text-[10px] text-white/80">
                        <div className="flex items-center gap-1">
                            <HardDrive className="w-3 h-3" />
                            <span>{formatSize(video.size)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Info */}
            <div className="p-3">
                <h3
                    className="text-sm font-medium text-cn-text truncate group-hover:text-cn-accent transition-colors"
                    title={video.name}
                >
                    {video.name}
                </h3>

                {video.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                        {video.tags.slice(0, 2).map(tag => (
                            <span key={tag} className="tag text-[10px]">
                                {tag}
                            </span>
                        ))}
                        {video.tags.length > 2 && (
                            <span className="text-[10px] text-cn-text-muted">
                                +{video.tags.length - 2}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
