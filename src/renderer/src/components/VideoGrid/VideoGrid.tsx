import { useMemo, useState, useEffect } from 'react'
import { Film, Heart, Clock, HardDrive, Loader2, Play, ArrowUpDown } from 'lucide-react'
import { FixedSizeGrid as Grid } from 'react-window'
import AutoSizer from 'react-virtualized-auto-sizer'
import { Video } from '../../types/video'

interface VideoGridProps {
    videos: Video[]
    selectedFolder: string | null
    selectedTag: string | null
    showFavorites: boolean
    searchQuery: string
    isLoading: boolean
    loadingMessage?: string
    onVideoPlay: (video: Video) => void
    onToggleFavorite: (videoPath: string) => void
    onVideoEdit: (video: Video) => void
}

type SortField = 'name' | 'date' | 'size' | 'duration'
type SortOrder = 'asc' | 'desc'

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
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')} `
    }
    return `${minutes}:${secs.toString().padStart(2, '0')} `
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
    isLoading,
    loadingMessage,
    onVideoPlay,
    onToggleFavorite,
    onVideoEdit
}: VideoGridProps): JSX.Element {
    // Sort state
    const [sortField, setSortField] = useState<SortField>('name')
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

    // Filter videos based on current selection
    const filteredVideos = useMemo(() => {
        let filtered = [...videos]

        // Filter by folder
        if (selectedFolder) {
            filtered = filtered.filter(v => v.path.startsWith(selectedFolder))
        }

        // Filter by favorites
        if (showFavorites) {
            filtered = filtered.filter(v => v.isFavorite)
        }

        // Filter by tag
        if (selectedTag) {
            filtered = filtered.filter(v => v.tags.includes(selectedTag))
        }

        // Filter by search query
        if (searchQuery) {
            const query = searchQuery.toLowerCase()
            filtered = filtered.filter(v =>
                v.name.toLowerCase().includes(query) ||
                v.tags.some(tag => tag.toLowerCase().includes(query))
            )
        }

        // Apply Sorting
        filtered.sort((a, b) => {
            let comparison = 0
            switch (sortField) {
                case 'name':
                    comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
                    break
                case 'date':
                    comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                    break
                case 'size':
                    comparison = a.size - b.size
                    break
                case 'duration':
                    comparison = (a.duration || 0) - (b.duration || 0)
                    break
            }
            return sortOrder === 'asc' ? comparison : -comparison
        })

        return filtered
    }, [videos, selectedFolder, selectedTag, showFavorites, searchQuery, sortField, sortOrder])

    // Get header title
    const getTitle = () => {
        if (showFavorites) return 'お気に入り'
        if (selectedTag) return `タグ: ${selectedTag} `
        if (selectedFolder) return selectedFolder.split(/[\\/]/).pop() || 'フォルダ'
        return 'すべての動画'
    }

    // Cast components to any to avoid type complexity with certain versions
    // and handle potential CJS/ESM interop issues in Vite
    const VirtualGrid = Grid as any
    const ProxyAutoSizer = AutoSizer as any

    // Cell renderer for react-window
    const Cell = ({ columnIndex, rowIndex, style, data }: any) => {
        const { videos, columnCount } = data
        const index = rowIndex * columnCount + columnIndex

        if (index >= videos.length) return null

        const video = videos[index]

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
                    onPlay={() => onVideoPlay(video)}
                    onToggleFavorite={() => onToggleFavorite(video.path)}
                    onEdit={() => onVideoEdit(video)}
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
                        {filteredVideos.length} 件の動画
                        {isLoading && (
                            <span className="ml-2 inline-flex items-center gap-1.5 text-cn-accent">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                <span>{loadingMessage || '読み込み中...'}</span>
                            </span>
                        )}
                    </p>
                </div>

                {/* Sort Control */}
                <div className="flex items-center gap-2">
                    <ArrowUpDown className="w-4 h-4 text-cn-text-muted" />
                    <select
                        value={`${sortField} -${sortOrder} `}
                        onChange={(e) => {
                            const [field, order] = e.target.value.split('-') as [SortField, SortOrder]
                            setSortField(field)
                            setSortOrder(order)
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
            </header>

            {/* Grid Container - Important: needs relative and min-size for AutoSizer */}
            <div className="flex-1 w-full h-full p-2 relative min-h-0 min-w-0">
                {filteredVideos.length === 0 && !isLoading ? (
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
                                const rowCount = Math.ceil(filteredVideos.length / columnCount)

                                return (
                                    <VirtualGrid
                                        columnCount={columnCount}
                                        columnWidth={columnWidth}
                                        height={height}
                                        rowCount={rowCount}
                                        rowHeight={CARD_HEIGHT + GAP}
                                        width={width}
                                        itemData={{ videos: filteredVideos, columnCount }}
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
}

function VideoCard({ video, index, onPlay, onToggleFavorite, onEdit }: VideoCardProps): JSX.Element {
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

    return (
        <div
            className="video-card group animate-fade-in"
            style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
            onClick={onPlay}
            onContextMenu={handleContextMenu}
        >
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
