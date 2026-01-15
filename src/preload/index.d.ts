// Video file interface
export interface VideoFile {
    id: string
    name: string
    path: string
    size: number
    createdAt: string
    extension: string
    thumbnailPath: string | null
    duration: number | null
    isFavorite: boolean
    tags: string[]
    lastPlayedTime?: number
}

export interface VideoMetadata {
    isFavorite: boolean
    tags: string[]
    lastPlayedTime?: number
}

export interface WatchedFolder {
    path: string
    name: string
    videoCount: number
}

export interface ElectronAPI {
    // Folder operations
    selectFolder: () => Promise<string | null>
    scanFolder: (folderPath: string) => Promise<VideoFile[]>
    scanFolderProgressive: (folderPath: string) => Promise<{ totalFiles: number }>
    getVideoInfo: (videoPath: string) => Promise<VideoFile | null>
    getThumbnailsDir: () => Promise<string>
    getThumbnailData: (thumbnailPath: string) => Promise<string | null>
    // Metadata operations
    toggleFavorite: (filePath: string) => Promise<boolean>
    updateTags: (filePath: string, tags: string[]) => Promise<string[]>
    updatePlaybackTime: (filePath: string, time: number) => Promise<void>
    getMetadata: (filePath: string) => Promise<VideoMetadata>
    // Watched folders operations
    getWatchedFolders: () => Promise<WatchedFolder[]>
    saveWatchedFolder: (folder: WatchedFolder) => Promise<void>
    removeWatchedFolder: (folderPath: string) => Promise<void>
    // File operations
    renameVideo: (oldPath: string, newName: string) => Promise<{ success: boolean, newPath: string | null, error?: string }>
    deleteVideo: (filePath: string) => Promise<{ success: boolean, error?: string }>
    // Window control operations
    minimizeWindow: () => void
    maximizeWindow: () => void
    closeWindow: () => void
    isWindowMaximized: () => Promise<boolean>
    // Event listeners
    onVideoFileReady: (callback: (video: VideoFile) => void) => () => void
    onScanFolderComplete: (callback: (folderPath: string) => void) => () => void
    // StreamVault (Downloader) operations
    downloadVideo: (url: string, id: string) => Promise<{ success: boolean, message?: string }>
    cancelDownload: (id: string) => Promise<{ success: boolean }>
    getDownloadPath: () => Promise<string>
    setDownloadPath: (path: string) => Promise<{ success: boolean, path: string }>
    selectDownloadFolder: () => Promise<string | null>
    onDownloadProgress: (callback: (data: { id: string, progress: number, status: string }) => void) => () => void
    onDownloadError: (callback: (data: { id: string, error: string }) => void) => () => void
}

declare global {
    interface Window {
        electron: ElectronAPI
    }
}
