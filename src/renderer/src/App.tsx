import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import Sidebar from './components/Sidebar/Sidebar'
import VideoGrid from './components/VideoGrid/VideoGrid'
import VideoPlayer from './components/Player/VideoPlayer'
import VideoEditModal from './components/VideoEdit/VideoEditModal'
import BatchRenameModal from './components/BatchRename/BatchRenameModal'
import TitleBar from './components/TitleBar/TitleBar'
import StreamVault from './components/StreamVault/StreamVault'
import { Video, WatchedFolder, SortField, SortOrder } from './types/video'
import { FolderPlus } from 'lucide-react'

function App(): JSX.Element {
    // State for folders and videos
    const [watchedFolders, setWatchedFolders] = useState<WatchedFolder[]>([])
    const [videos, setVideos] = useState<Video[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [loadingMessage, setLoadingMessage] = useState('')
    const [isInitialized, setIsInitialized] = useState(false)

    // State for filters
    const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
    const [selectedTag, setSelectedTag] = useState<string | null>(null)
    const [showFavorites, setShowFavorites] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')

    // State for Sorting
    const [sortField, setSortField] = useState<SortField>('name')
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

    // State for video player
    const [playingVideo, setPlayingVideo] = useState<Video | null>(null)

    // State for video editing
    const [editingVideo, setEditingVideo] = useState<Video | null>(null)

    // State for batch rename
    const [batchRenameVideos, setBatchRenameVideos] = useState<Video[] | null>(null)

    // State for drag and drop
    const [isDragging, setIsDragging] = useState(false)
    const [dragCounter, setDragCounter] = useState(0)

    // View State
    const [currentView, setCurrentView] = useState<'library' | 'downloader'>('library')

    // Track folders being scanned
    const scanningFoldersRef = useRef<Set<string>>(new Set())

    // Batch video updates to reduce re-renders
    const pendingVideosRef = useRef<Video[]>([])
    const pendingPathsRef = useRef<Set<string>>(new Set())
    const flushTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const initializationStartedRef = useRef(false)

    // Flush pending videos to state
    const flushPendingVideos = useCallback(() => {
        if (pendingVideosRef.current.length === 0) return

        const videosToAdd = [...pendingVideosRef.current]
        pendingVideosRef.current = []
        pendingPathsRef.current.clear()

        setVideos(prev => {
            // Case-insensitive path comparison for Windows
            const existingPaths = new Set(prev.map(v => v.path.toLowerCase()))
            const newVideos = videosToAdd.filter(v => !existingPaths.has(v.path.toLowerCase()))
            if (newVideos.length === 0) return prev
            return [...prev, ...newVideos]
        })
    }, [])

    // Set up event listeners for progressive loading
    useEffect(() => {
        // When a video file is ready, batch it
        const removeVideoFileReadyListener = window.electron.onVideoFileReady((video) => {
            // Check for duplicates within pending batch (case-insensitive)
            const lowerPath = video.path.toLowerCase()
            if (pendingPathsRef.current.has(lowerPath)) {
                return
            }
            pendingPathsRef.current.add(lowerPath)
            pendingVideosRef.current.push(video)

            // Debounce flush - wait for more videos or flush after 300ms
            if (flushTimeoutRef.current) {
                clearTimeout(flushTimeoutRef.current)
            }
            flushTimeoutRef.current = setTimeout(() => {
                flushPendingVideos()
            }, 300)
        })

        // When scanning is complete
        const removeScanCompleteListener = window.electron.onScanFolderComplete((folderPath) => {
            console.log(`Scan complete for: ${folderPath}`)
            const lowerPath = folderPath.toLowerCase()
            scanningFoldersRef.current.delete(lowerPath)

            // Flush any remaining pending videos immediately
            if (flushTimeoutRef.current) {
                clearTimeout(flushTimeoutRef.current)
                flushTimeoutRef.current = null
            }
            flushPendingVideos()

            // If no more folders are being scanned, hide loading
            if (scanningFoldersRef.current.size === 0) {
                setIsLoading(false)
                setLoadingMessage('')
            }
        })

        // When a video is removed (e.g., after conversion)
        const removeVideoRemovedListener = window.electron.onVideoRemoved(({ path }) => {
            console.log(`Video removed: ${path}`)
            const lowerTarget = path.toLowerCase()
            setVideos(prev => prev.filter(v => v.path.toLowerCase() !== lowerTarget))
        })

        return () => {
            removeVideoFileReadyListener()
            removeScanCompleteListener()
            removeVideoRemovedListener()
            if (flushTimeoutRef.current) {
                clearTimeout(flushTimeoutRef.current)
            }
        }
    }, [flushPendingVideos])

    // Load saved folders and cached videos on app startup
    useEffect(() => {
        const loadInitialData = async () => {
            if (initializationStartedRef.current) return
            initializationStartedRef.current = true

            try {
                // 1. Load cached videos first for instant UI
                const cachedVideos = await window.electron.getCachedVideos()
                if (cachedVideos.length > 0) {
                    console.log(`Loaded ${cachedVideos.length} videos from cache`)
                    setVideos(cachedVideos)
                }

                // 2. Load watched folders
                const savedFolders = await window.electron.getWatchedFolders()
                console.log('Loaded saved folders:', savedFolders)

                if (savedFolders.length > 0) {
                    setWatchedFolders(savedFolders)
                    setIsLoading(true)
                    setLoadingMessage('保存されたフォルダを読み込み中...')

                    // Scan each saved folder progressively
                    for (const folder of savedFolders) {
                        const lowerPath = folder.path.toLowerCase()
                        scanningFoldersRef.current.add(lowerPath)
                        try {
                            const result = await window.electron.scanFolderProgressive(folder.path)
                            // Update folder video count
                            setWatchedFolders(prev =>
                                prev.map(f =>
                                    f.path.toLowerCase() === lowerPath
                                        ? { ...f, videoCount: result.totalFiles }
                                        : f
                                )
                            )
                            // Save updated count
                            await window.electron.saveWatchedFolder({
                                ...folder,
                                videoCount: result.totalFiles
                            })
                        } catch (error) {
                            console.error(`Error scanning saved folder ${folder.path}:`, error)
                        } finally {
                            scanningFoldersRef.current.delete(folder.path.toLowerCase())
                        }
                    }
                }
            } catch (error) {
                console.error('Error loading initial data:', error)
            } finally {
                setIsInitialized(true)
                if (scanningFoldersRef.current.size === 0) {
                    setIsLoading(false)
                    setLoadingMessage('')
                }
            }
        }

        loadInitialData()
    }, [])

    // Auto-save videos to cache when they change (debounced)
    useEffect(() => {
        if (!isInitialized || videos.length === 0) return

        const timer = setTimeout(() => {
            window.electron.saveVideoCache(videos)
                .catch(err => console.error('Failed to save video cache:', err))
        }, 2000) // Save after 2 seconds of inactivity

        return () => clearTimeout(timer)
    }, [videos, isInitialized])

    // Common function to import a folder by path (PROGRESSIVE)
    const importFolderByPath = useCallback(async (folderPath: string) => {
        try {
            setIsLoading(true)
            setLoadingMessage('フォルダをスキャン中...')

            // Extract folder name from path
            const folderName = folderPath.split(/[\\/]/).pop() || folderPath

            const newFolder: WatchedFolder = {
                path: folderPath,
                name: folderName,
                videoCount: 0
            }

            // Add to watched folders immediately
            setWatchedFolders(prev => {
                const lowerPath = folderPath.toLowerCase()
                const exists = prev.some(f => f.path.toLowerCase() === lowerPath)
                if (exists) {
                    return prev
                }
                return [...prev, newFolder]
            })

            // Track this folder as being scanned
            const lowerPath = folderPath.toLowerCase()
            scanningFoldersRef.current.add(lowerPath)

            // Start progressive scanning
            const result = await window.electron.scanFolderProgressive(folderPath)

            // Update folder video count
            const updatedFolder = { ...newFolder, videoCount: result.totalFiles }
            setWatchedFolders(prev =>
                prev.map(f =>
                    f.path.toLowerCase() === lowerPath ? updatedFolder : f
                )
            )

            scanningFoldersRef.current.delete(lowerPath)
            if (scanningFoldersRef.current.size === 0) {
                setIsLoading(false)
                setLoadingMessage('')
            }

            // Save to persistent storage
            await window.electron.saveWatchedFolder(updatedFolder)

        } catch (error) {
            console.error('Error importing folder:', error)
            scanningFoldersRef.current.delete(folderPath)
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

    // Handle view switching
    const handleViewChange = (view: 'library' | 'downloader') => {
        setCurrentView(view)
        if (view === 'downloader') {
            // Reset library filters when switching away
            setSelectedFolder(null)
            setSelectedTag(null)
            setShowFavorites(false)
        }
    }

    // Wrap existing handlers to ensure we switch back to library view
    const handleFolderSelectWrapper = (folder: string | null) => {
        handleViewChange('library')
        handleFolderSelect(folder)
    }

    const handleTagSelectWrapper = (tag: string | null) => {
        handleViewChange('library')
        handleTagSelect(tag)
    }

    const handleFavoritesToggleWrapper = () => {
        handleViewChange('library')
        handleFavoritesToggle()
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

            setEditingVideo(prev => {
                if (prev && prev.path === videoPath) {
                    return { ...prev, tags: newTags }
                }
                return prev
            })
        } catch (error) {
            console.error('Error updating tags:', error)
        }
    }, [])

    // Handle video rename
    const handleRenameVideo = useCallback(async (oldPath: string, newName: string) => {
        try {
            const result = await window.electron.renameVideo(oldPath, newName)
            if (result.success && result.newPath) {
                setVideos(prev => prev.map(v =>
                    v.path === oldPath ? { ...v, name: newName, path: result.newPath! } : v
                ))
                setEditingVideo(null)
            } else {
                alert(result.error || 'ファイル名の変更に失敗しました')
            }
        } catch (error) {
            console.error('Error renaming video:', error)
        }
    }, [])

    // Handle video delete
    const handleDeleteVideo = useCallback(async (videoPath: string) => {
        try {
            const result = await window.electron.deleteVideo(videoPath)
            if (result.success) {
                // Remove from videos list
                setVideos(prev => prev.filter(v => v.path !== videoPath))

                // Clear editing and playing state if it was this video
                setEditingVideo(null)
                setPlayingVideo(prev => prev?.path === videoPath ? null : prev)

                // Update folder video count
                const folder = watchedFolders.find(f => videoPath.startsWith(f.path))
                if (folder) {
                    const updatedFolder = { ...folder, videoCount: Math.max(0, folder.videoCount - 1) }
                    setWatchedFolders(prev => prev.map(f => f.path === folder.path ? updatedFolder : f))
                    // Save the updated count to persistence
                    await window.electron.saveWatchedFolder(updatedFolder)
                }
            } else {
                alert(result.error || 'ファイルの削除に失敗しました')
            }
        } catch (error) {
            console.error('Error deleting video:', error)
        }
    }, [watchedFolders])

    // Filter and Sort Videos
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

    // Handle Sort Change
    const handleSortChange = useCallback((field: SortField, order: SortOrder) => {
        setSortField(field)
        setSortOrder(order)
    }, [])

    // Handle Player Navigation
    const handleNextVideo = useCallback(() => {
        if (!playingVideo) return
        const currentIndex = filteredVideos.findIndex(v => v.path === playingVideo.path)
        if (currentIndex !== -1 && currentIndex < filteredVideos.length - 1) {
            setPlayingVideo(filteredVideos[currentIndex + 1])
        }
    }, [playingVideo, filteredVideos])

    const handlePrevVideo = useCallback(() => {
        if (!playingVideo) return
        const currentIndex = filteredVideos.findIndex(v => v.path === playingVideo.path)
        if (currentIndex > 0) {
            setPlayingVideo(filteredVideos[currentIndex - 1])
        }
    }, [playingVideo, filteredVideos])

    // Get all unique tags from videos
    const allTags = Array.from(new Set(videos.flatMap(v => v.tags)))

    // Handle batch rename
    const handleBatchRename = useCallback((videosToRename: Video[]) => {
        setBatchRenameVideos(videosToRename)
    }, [])

    // Handle batch rename completion
    const handleBatchRenameComplete = useCallback((results: { oldPath: string, newPath: string }[]) => {
        // Update videos with new paths and names
        setVideos(prev => prev.map(v => {
            const renamed = results.find(r => r.oldPath === v.path)
            if (renamed) {
                const newName = renamed.newPath.split(/[\\/]/).pop()?.replace(/\.[^/.]+$/, '') || v.name
                return { ...v, path: renamed.newPath, name: newName }
            }
            return v
        }))
    }, [])

    // Handle library refresh
    const handleRefreshLibrary = useCallback(async () => {
        if (isLoading) return

        try {
            setIsLoading(true)
            setLoadingMessage('ライブラリを更新中...')

            // Create a copy of current folders to work with
            let foldersToScan = [...watchedFolders]

            // 1. Scan for new immediate subfolders in each current watched folder
            for (const folder of watchedFolders) {
                try {
                    const subfolders = await window.electron.getVideoSubfolders(folder.path)
                    for (const sub of subfolders) {
                        const lowerSubPath = sub.path.toLowerCase()
                        const alreadyWatched = watchedFolders.some(f => f.path.toLowerCase() === lowerSubPath) ||
                            foldersToScan.some(f => f.path.toLowerCase() === lowerSubPath)

                        if (!alreadyWatched) {
                            const newFolder: WatchedFolder = {
                                path: sub.path,
                                name: sub.name,
                                videoCount: 0
                            }
                            foldersToScan.push(newFolder)
                            // Save to persistent storage and update state
                            await window.electron.saveWatchedFolder(newFolder)
                        }
                    }
                } catch (error) {
                    console.error(`Error checking subfolders for ${folder.path}:`, error)
                }
            }

            // Update state with all found folders including new ones
            setWatchedFolders(foldersToScan)

            // 2. Scan each folder progressively (including new ones)
            for (const folder of foldersToScan) {
                scanningFoldersRef.current.add(folder.path)
                setLoadingMessage(`スキャン中: ${folder.name}...`)
                try {
                    const result = await window.electron.scanFolderProgressive(folder.path)
                    // Update folder video count in state
                    setWatchedFolders(prev =>
                        prev.map(f =>
                            f.path.toLowerCase() === folder.path.toLowerCase()
                                ? { ...f, videoCount: result.totalFiles }
                                : f
                        )
                    )
                    // Save updated count to persistence
                    await window.electron.saveWatchedFolder({
                        ...folder,
                        videoCount: result.totalFiles
                    })
                } catch (error) {
                    console.error(`Error refreshing folder ${folder.path}:`, error)
                    scanningFoldersRef.current.delete(folder.path)
                }
            }
            // Done
            setIsLoading(false)
            setLoadingMessage('')
        } catch (error) {
            console.error('Error refreshing library:', error)
            setIsLoading(false)
            setLoadingMessage('')
        }
    }, [watchedFolders, isLoading])

    // Handle cache clear
    const handleClearCache = useCallback(async () => {
        if (!confirm('キャッシュを削除して再読み込みしますか？\n（動画ファイル自体は削除されません）')) {
            return
        }

        try {
            await window.electron.clearVideoCache()
            window.location.reload()
        } catch (error) {
            console.error('Error clearing cache:', error)
            alert('キャッシュの削除に失敗しました')
        }
    }, [])

    return (
        <div
            className="flex flex-col h-screen w-screen overflow-hidden bg-cn-dark relative"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {/* Custom Title Bar */}
            <TitleBar />

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <Sidebar
                    watchedFolders={watchedFolders}
                    tags={allTags}
                    selectedFolder={selectedFolder}
                    selectedTag={selectedTag}
                    showFavorites={showFavorites}
                    currentView={currentView}
                    onViewChange={handleViewChange}
                    onFolderSelect={handleFolderSelectWrapper}
                    onTagSelect={handleTagSelectWrapper}
                    onFavoritesToggle={handleFavoritesToggleWrapper}
                    onImportFolder={handleImportFolder}
                    onRefreshLibrary={handleRefreshLibrary}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onClearCache={handleClearCache}
                />

                {/* Main Content */}
                <main className="flex-1 flex flex-col overflow-hidden">
                    {currentView === 'library' ? (
                        <VideoGrid
                            videos={filteredVideos}
                            selectedFolder={selectedFolder}
                            selectedTag={selectedTag}
                            showFavorites={showFavorites}
                            searchQuery={searchQuery}
                            sortField={sortField}
                            sortOrder={sortOrder}
                            onSortChange={handleSortChange}
                            isLoading={isLoading}
                            loadingMessage={loadingMessage}
                            onVideoPlay={setPlayingVideo}
                            onToggleFavorite={handleToggleFavorite}
                            onVideoEdit={setEditingVideo}
                            onBatchRename={handleBatchRename}
                        />
                    ) : (
                        <StreamVault />
                    )}
                </main>
            </div>

            {/* Video Player Modal */}
            {playingVideo && (
                <VideoPlayer
                    video={playingVideo}
                    onClose={() => setPlayingVideo(null)}
                    onToggleFavorite={() => handleToggleFavorite(playingVideo.path)}
                    onUpdateTags={(tags) => handleUpdateTags(playingVideo.path, tags)}
                    onNext={handleNextVideo}
                    onPrev={handlePrevVideo}
                />
            )}

            {/* Video Edit Modal */}
            {editingVideo && (
                <VideoEditModal
                    video={editingVideo}
                    onClose={() => setEditingVideo(null)}
                    onSave={(newName, newTags) => {
                        handleUpdateTags(editingVideo.path, newTags)
                        if (newName !== editingVideo.name) {
                            handleRenameVideo(editingVideo.path, newName)
                        } else {
                            setEditingVideo(null)
                        }
                    }}
                    onDelete={() => handleDeleteVideo(editingVideo.path)}
                />
            )}

            {/* Batch Rename Modal */}
            {batchRenameVideos && batchRenameVideos.length > 0 && (
                <BatchRenameModal
                    videos={batchRenameVideos}
                    onClose={() => setBatchRenameVideos(null)}
                    onComplete={handleBatchRenameComplete}
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
