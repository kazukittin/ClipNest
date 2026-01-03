import { useState, useCallback, useEffect } from 'react'
import Sidebar from './components/Sidebar/Sidebar'
import VideoGrid from './components/VideoGrid/VideoGrid'
import VideoPlayer from './components/Player/VideoPlayer'
import { Video, WatchedFolder } from './types/video'
import { FolderPlus } from 'lucide-react'

function App(): JSX.Element {
    // State for folders and videos
    const [watchedFolders, setWatchedFolders] = useState<WatchedFolder[]>([])
    const [videos, setVideos] = useState<Video[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [loadingMessage, setLoadingMessage] = useState('')

    // State for filters
    const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
    const [selectedTag, setSelectedTag] = useState<string | null>(null)
    const [showFavorites, setShowFavorites] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')

    // State for video player
    const [playingVideo, setPlayingVideo] = useState<Video | null>(null)

    // State for drag and drop
    const [isDragging, setIsDragging] = useState(false)
    const [dragCounter, setDragCounter] = useState(0)

    // Common function to import a folder by path
    const importFolderByPath = useCallback(async (folderPath: string) => {
        try {
            setIsLoading(true)
            setLoadingMessage('Scanning folder...')

            // Scan the folder for video files (this will generate thumbnails)
            const videoFiles = await window.electron.scanFolder(folderPath)

            // Extract folder name from path
            const folderName = folderPath.split(/[\\/]/).pop() || folderPath

            // Add to watched folders if not already present
            setWatchedFolders(prev => {
                const exists = prev.some(f => f.path === folderPath)
                if (exists) {
                    return prev.map(f =>
                        f.path === folderPath
                            ? { ...f, videoCount: videoFiles.length }
                            : f
                    )
                }
                return [...prev, {
                    path: folderPath,
                    name: folderName,
                    videoCount: videoFiles.length
                }]
            })

            // Add videos (avoid duplicates)
            setVideos(prev => {
                const existingPaths = new Set(prev.map(v => v.path))
                const newVideos = videoFiles.filter(f => !existingPaths.has(f.path))
                return [...prev, ...newVideos]
            })

            setLoadingMessage('')
            setIsLoading(false)
        } catch (error) {
            console.error('Error importing folder:', error)
            setLoadingMessage('')
            setIsLoading(false)
        }
    }, [])

    // Handle folder selection and import via dialog
    const handleImportFolder = useCallback(async () => {
        try {
            const folderPath = await window.electron.selectFolder()
            if (!folderPath) return
            await importFolderByPath(folderPath)
        } catch (error) {
            console.error('Error importing folder:', error)
        }
    }, [importFolderByPath])

    // Drag and drop handlers
    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDragCounter(prev => prev + 1)
        setIsDragging(true)
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDragCounter(prev => {
            const newCount = prev - 1
            if (newCount === 0) {
                setIsDragging(false)
            }
            return newCount
        })
    }, [])

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
    }, [])

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
        setDragCounter(0)

        const items = e.dataTransfer.items
        if (!items) return

        // Process all dropped items
        for (let i = 0; i < items.length; i++) {
            const item = items[i]
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry?.()
                if (entry?.isDirectory) {
                    // Get folder path from the file object
                    const file = item.getAsFile()
                    if (file) {
                        // For Electron, we can access the path property
                        const filePath = (file as any).path
                        if (filePath) {
                            await importFolderByPath(filePath)
                        }
                    }
                }
            }
        }
    }, [importFolderByPath])

    // Prevent default browser behavior for drag and drop on window
    useEffect(() => {
        const preventDefault = (e: DragEvent) => {
            e.preventDefault()
        }

        window.addEventListener('dragover', preventDefault)
        window.addEventListener('drop', preventDefault)

        return () => {
            window.removeEventListener('dragover', preventDefault)
            window.removeEventListener('drop', preventDefault)
        }
    }, [])

    // Handle folder selection in sidebar
    const handleFolderSelect = (folderPath: string | null) => {
        setSelectedFolder(folderPath)
        setSelectedTag(null)
        setShowFavorites(false)
    }

    // Handle tag selection
    const handleTagSelect = (tag: string | null) => {
        setSelectedTag(tag)
        setSelectedFolder(null)
        setShowFavorites(false)
    }

    // Handle favorites toggle
    const handleFavoritesToggle = () => {
        setShowFavorites(!showFavorites)
        setSelectedFolder(null)
        setSelectedTag(null)
    }

    // Handle favorite toggle for a video (with persistence)
    const handleToggleFavorite = useCallback(async (videoPath: string) => {
        try {
            const newFavoriteState = await window.electron.toggleFavorite(videoPath)

            setVideos(prev => prev.map(v =>
                v.path === videoPath ? { ...v, isFavorite: newFavoriteState } : v
            ))

            setPlayingVideo(prev => {
                if (prev && prev.path === videoPath) {
                    return { ...prev, isFavorite: newFavoriteState }
                }
                return prev
            })
        } catch (error) {
            console.error('Error toggling favorite:', error)
        }
    }, [])

    // Handle tags update for a video (with persistence)
    const handleUpdateTags = useCallback(async (videoPath: string, tags: string[]) => {
        try {
            const newTags = await window.electron.updateTags(videoPath, tags)

            setVideos(prev => prev.map(v =>
                v.path === videoPath ? { ...v, tags: newTags } : v
            ))

            setPlayingVideo(prev => {
                if (prev && prev.path === videoPath) {
                    return { ...prev, tags: newTags }
                }
                return prev
            })
        } catch (error) {
            console.error('Error updating tags:', error)
        }
    }, [])

    // Get all unique tags from videos
    const allTags = Array.from(new Set(videos.flatMap(v => v.tags)))

    return (
        <div
            className="flex h-screen w-screen overflow-hidden bg-cn-dark relative"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {/* Sidebar */}
            <Sidebar
                watchedFolders={watchedFolders}
                tags={allTags}
                selectedFolder={selectedFolder}
                selectedTag={selectedTag}
                showFavorites={showFavorites}
                onFolderSelect={handleFolderSelect}
                onTagSelect={handleTagSelect}
                onFavoritesToggle={handleFavoritesToggle}
                onImportFolder={handleImportFolder}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
            />

            {/* Main Content */}
            <main className="flex-1 flex flex-col overflow-hidden">
                <VideoGrid
                    videos={videos}
                    selectedFolder={selectedFolder}
                    selectedTag={selectedTag}
                    showFavorites={showFavorites}
                    searchQuery={searchQuery}
                    isLoading={isLoading}
                    loadingMessage={loadingMessage}
                    onVideoPlay={setPlayingVideo}
                    onToggleFavorite={handleToggleFavorite}
                />
            </main>

            {/* Video Player Modal */}
            {playingVideo && (
                <VideoPlayer
                    video={playingVideo}
                    onClose={() => setPlayingVideo(null)}
                    onToggleFavorite={() => handleToggleFavorite(playingVideo.path)}
                    onUpdateTags={(tags) => handleUpdateTags(playingVideo.path, tags)}
                />
            )}

            {/* Drag and Drop Overlay */}
            {isDragging && (
                <div className="fixed inset-0 z-50 bg-cn-dark/90 backdrop-blur-sm flex items-center justify-center animate-fade-in">
                    <div className="flex flex-col items-center gap-6 p-12 border-4 border-dashed border-cn-accent rounded-2xl bg-cn-accent/10">
                        <div className="w-24 h-24 rounded-full bg-cn-accent/20 flex items-center justify-center animate-pulse">
                            <FolderPlus className="w-12 h-12 text-cn-accent" />
                        </div>
                        <div className="text-center">
                            <h2 className="text-2xl font-bold text-white mb-2">
                                ここにフォルダをドロップ
                            </h2>
                            <p className="text-cn-text-muted">
                                動画フォルダをドロップしてインポート
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default App
