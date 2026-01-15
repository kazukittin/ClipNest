import { useState, useCallback, useEffect, useRef } from 'react'
import Sidebar from './components/Sidebar/Sidebar'
import VideoGrid from './components/VideoGrid/VideoGrid'
import VideoPlayer from './components/Player/VideoPlayer'
import VideoEditModal from './components/VideoEdit/VideoEditModal'
import BatchRenameModal from './components/BatchRename/BatchRenameModal'
import TitleBar from './components/TitleBar/TitleBar'
import StreamVault from './components/StreamVault/StreamVault'
import { Video, WatchedFolder } from './types/video'
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

    // Set up event listeners for progressive loading
    useEffect(() => {
        // When a video file is ready, add it to the list
        const removeVideoFileReadyListener = window.electron.onVideoFileReady((video) => {
            setVideos(prev => {
                // Avoid duplicates
                const exists = prev.some(v => v.path === video.path)
                if (exists) {
                    return prev.map(v => v.path === video.path ? video : v)
                }
                // Add new video and sort by name
                const updated = [...prev, video]
                updated.sort((a, b) => a.name.localeCompare(b.name))
                return updated
            })
        })

        // When scanning is complete
        const removeScanCompleteListener = window.electron.onScanFolderComplete((folderPath) => {
            console.log(`Scan complete for: ${folderPath}`)
            scanningFoldersRef.current.delete(folderPath)

            // If no more folders are being scanned, hide loading
            if (scanningFoldersRef.current.size === 0) {
                setIsLoading(false)
                setLoadingMessage('')
            }
        })

        return () => {
            removeVideoFileReadyListener()
            removeScanCompleteListener()
        }
    }, [])

    // Load saved folders on app startup
    useEffect(() => {
        const loadSavedFolders = async () => {
            try {
                const savedFolders = await window.electron.getWatchedFolders()
                console.log('Loaded saved folders:', savedFolders)

                if (savedFolders.length > 0) {
                    setWatchedFolders(savedFolders)
                    setIsLoading(true)
                    setLoadingMessage('保存されたフォルダを読み込み中...')

                    // Scan each saved folder progressively
                    for (const folder of savedFolders) {
                        scanningFoldersRef.current.add(folder.path)
                        try {
                            const result = await window.electron.scanFolderProgressive(folder.path)
                            // Update folder video count
                            setWatchedFolders(prev =>
                                prev.map(f =>
                                    f.path === folder.path
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
                            scanningFoldersRef.current.delete(folder.path)
                        }
                    }
                }
            } catch (error) {
                console.error('Error loading saved folders:', error)
            } finally {
                setIsInitialized(true)
            }
        }

        loadSavedFolders()
    }, [])

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
                const exists = prev.some(f => f.path === folderPath)
                if (exists) {
                    return prev
                }
                return [...prev, newFolder]
            })

            // Track this folder as being scanned
            scanningFoldersRef.current.add(folderPath)

            // Start progressive scanning
            const result = await window.electron.scanFolderProgressive(folderPath)

            // Update folder video count
            const updatedFolder = { ...newFolder, videoCount: result.totalFiles }
            setWatchedFolders(prev =>
                prev.map(f =>
                    f.path === folderPath ? updatedFolder : f
                )
            )

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
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                />

                {/* Main Content */}
                <main className="flex-1 flex flex-col overflow-hidden">
                    {currentView === 'library' ? (
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
