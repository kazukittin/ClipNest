import { useState, useCallback } from 'react'
import Sidebar from './components/Sidebar/Sidebar'
import VideoGrid from './components/VideoGrid/VideoGrid'
import VideoPlayer from './components/Player/VideoPlayer'
import { Video, VideoFile, WatchedFolder } from './types/video'

function App(): JSX.Element {
    // State for folders and videos
    const [watchedFolders, setWatchedFolders] = useState<WatchedFolder[]>([])
    const [videos, setVideos] = useState<Video[]>([])
    const [isLoading, setIsLoading] = useState(false)

    // State for filters
    const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
    const [selectedTag, setSelectedTag] = useState<string | null>(null)
    const [showFavorites, setShowFavorites] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')

    // State for video player
    const [playingVideo, setPlayingVideo] = useState<Video | null>(null)

    // Convert VideoFile to Video with default UI state
    const videoFileToVideo = (file: VideoFile): Video => ({
        ...file,
        tags: [],
        isFavorite: false
    })

    // Handle folder selection and import
    const handleImportFolder = useCallback(async () => {
        try {
            const folderPath = await window.electron.selectFolder()
            if (!folderPath) return

            setIsLoading(true)

            // Scan the folder for video files
            const videoFiles = await window.electron.scanFolder(folderPath)

            // Extract folder name from path
            const folderName = folderPath.split(/[\\/]/).pop() || folderPath

            // Add to watched folders if not already present
            setWatchedFolders(prev => {
                const exists = prev.some(f => f.path === folderPath)
                if (exists) {
                    // Update video count
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
                const newVideos = videoFiles
                    .filter(f => !existingPaths.has(f.path))
                    .map(videoFileToVideo)
                return [...prev, ...newVideos]
            })

            setIsLoading(false)
        } catch (error) {
            console.error('Error importing folder:', error)
            setIsLoading(false)
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

    // Handle favorite toggle for a video
    const handleToggleFavorite = useCallback((videoId: string) => {
        setVideos(prev => prev.map(v =>
            v.id === videoId ? { ...v, isFavorite: !v.isFavorite } : v
        ))
    }, [])

    // Get all unique tags from videos
    const allTags = [...new Set(videos.flatMap(v => v.tags))]

    return (
        <div className="flex h-screen w-screen overflow-hidden bg-cn-dark">
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
                    onVideoPlay={setPlayingVideo}
                    onToggleFavorite={handleToggleFavorite}
                />
            </main>

            {/* Video Player Modal */}
            {playingVideo && (
                <VideoPlayer
                    video={playingVideo}
                    onClose={() => setPlayingVideo(null)}
                    onToggleFavorite={() => handleToggleFavorite(playingVideo.id)}
                />
            )}
        </div>
    )
}

export default App
