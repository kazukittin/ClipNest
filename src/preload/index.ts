import { contextBridge, ipcRenderer } from 'electron'

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

// Video metadata interface
export interface VideoMetadata {
    isFavorite: boolean
    tags: string[]
    lastPlayedTime?: number
}

// Product data retrieved from online
export interface ProductData {
    title: string
    tags: string[]
    maker?: string
    actress?: string[]
    thumbnailUrl?: string
}

// Watched folder interface
export interface WatchedFolder {
    path: string
    name: string
    videoCount: number
}

// Electron API interface
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
    updateProductCode: (filePath: string, productCode: string) => Promise<string>
    getMetadata: (filePath: string) => Promise<VideoMetadata>
    // Watched folders operations
    getWatchedFolders: () => Promise<WatchedFolder[]>
    saveWatchedFolder: (folder: WatchedFolder) => Promise<void>
    removeWatchedFolder: (folderPath: string) => Promise<void>
    getVideoSubfolders: (parentPath: string) => Promise<{ path: string, name: string }[]>
    // Video cache operations
    getCachedVideos: () => Promise<VideoFile[]>
    saveVideoCache: (videos: VideoFile[]) => Promise<void>
    clearVideoCache: () => Promise<void>
    fetchVideoProductData: (productCode: string) => Promise<ProductData | null>
    // File operations
    renameVideo: (oldPath: string, newName: string) => Promise<{ success: boolean, newPath: string | null, error?: string }>
    deleteVideo: (filePath: string) => Promise<{ success: boolean, error?: string }>
    batchRenameVideos: (videoPaths: string[]) => Promise<{ success: boolean, results: { oldPath: string, newPath: string }[], errors: string[], skipped: number, startNumber: number }>
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
    onDownloadError: (callback: (data: { id: string, error: string, details?: string }) => void) => () => void
    onDownloadWarning: (callback: (data: { id: string, warning: string, fullLog: string }) => void) => () => void
    // Video conversion operations
    convertToMp4: (filePath: string, deleteOriginal?: boolean) => Promise<{ success: boolean, newPath?: string, error?: string }>
    cancelConversion: (filePath: string) => Promise<{ success: boolean }>
    onConversionProgress: (callback: (data: { filePath: string, progress: number, status: string, newPath?: string, error?: string }) => void) => () => void
    onVideoRemoved: (callback: (data: { path: string }) => void) => () => void
}

// Create the API object
const electronAPI: ElectronAPI = {
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    scanFolder: (folderPath: string) => ipcRenderer.invoke('scan-folder', folderPath),
    scanFolderProgressive: (folderPath: string) => ipcRenderer.invoke('scan-folder-progressive', folderPath),
    getVideoInfo: (videoPath: string) => ipcRenderer.invoke('get-video-info', videoPath),
    getThumbnailsDir: () => ipcRenderer.invoke('get-thumbnails-dir'),
    getThumbnailData: (thumbnailPath: string) => ipcRenderer.invoke('get-thumbnail-data', thumbnailPath),
    // Metadata operations
    toggleFavorite: (filePath: string) => ipcRenderer.invoke('toggle-favorite', filePath),
    updateTags: (filePath: string, tags: string[]) => ipcRenderer.invoke('update-tags', filePath, tags),
    updatePlaybackTime: (filePath: string, time: number) => ipcRenderer.invoke('update-playback-time', filePath, time),
    updateProductCode: (filePath: string, productCode: string) => ipcRenderer.invoke('update-product-code', filePath, productCode),
    getMetadata: (filePath: string) => ipcRenderer.invoke('get-metadata', filePath),
    // Watched folders operations
    getWatchedFolders: () => ipcRenderer.invoke('get-watched-folders'),
    saveWatchedFolder: (folder: WatchedFolder) => ipcRenderer.invoke('save-watched-folder', folder),
    removeWatchedFolder: (folderPath: string) => ipcRenderer.invoke('remove-watched-folder', folderPath),
    getVideoSubfolders: (parentPath: string) => ipcRenderer.invoke('get-video-subfolders', parentPath),
    // Video cache operations
    getCachedVideos: () => ipcRenderer.invoke('get-cached-videos'),
    saveVideoCache: (videos: VideoFile[]) => ipcRenderer.invoke('save-video-cache', videos),
    clearVideoCache: () => ipcRenderer.invoke('clear-video-cache'),
    fetchVideoProductData: (productCode: string) => ipcRenderer.invoke('fetch-video-product-data', productCode),
    // File operations
    renameVideo: (oldPath: string, newName: string) => ipcRenderer.invoke('rename-video', oldPath, newName),
    deleteVideo: (filePath: string) => ipcRenderer.invoke('delete-video', filePath),
    batchRenameVideos: (videoPaths: string[]) =>
        ipcRenderer.invoke('batch-rename-videos', videoPaths),
    // StreamVault operations
    downloadVideo: (url: string, id: string) => ipcRenderer.invoke('download-video', { url, id }),
    cancelDownload: (id: string) => ipcRenderer.invoke('cancel-download', id),
    getDownloadPath: () => ipcRenderer.invoke('get-download-path'),
    setDownloadPath: (path: string) => ipcRenderer.invoke('set-download-path', path),
    selectDownloadFolder: () => ipcRenderer.invoke('select-download-folder'),
    onDownloadProgress: (callback) => {
        const handler = (_event: any, data: any) => callback(data)
        ipcRenderer.on('download-progress', handler)
        return () => ipcRenderer.removeListener('download-progress', handler)
    },
    onDownloadError: (callback) => {
        const handler = (_event: any, data: any) => callback(data)
        ipcRenderer.on('download-error', handler)
        return () => ipcRenderer.removeListener('download-error', handler)
    },
    onDownloadWarning: (callback) => {
        const handler = (_event: any, data: any) => callback(data)
        ipcRenderer.on('download-warning', handler)
        return () => ipcRenderer.removeListener('download-warning', handler)
    },
    // Video conversion operations
    convertToMp4: (filePath: string, deleteOriginal?: boolean) => ipcRenderer.invoke('convert-to-mp4', filePath, deleteOriginal),
    cancelConversion: (filePath: string) => ipcRenderer.invoke('cancel-conversion', filePath),
    onConversionProgress: (callback) => {
        const handler = (_event: any, data: any) => callback(data)
        ipcRenderer.on('conversion-progress', handler)
        return () => ipcRenderer.removeListener('conversion-progress', handler)
    },
    onVideoRemoved: (callback) => {
        const handler = (_event: any, data: any) => callback(data)
        ipcRenderer.on('video-removed', handler)
        return () => ipcRenderer.removeListener('video-removed', handler)
    },
    // Window control operations
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),
    isWindowMaximized: () => ipcRenderer.invoke('is-window-maximized'),
    // Event listeners for progressive loading
    onVideoFileReady: (callback: (video: VideoFile) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, video: VideoFile) => callback(video)
        ipcRenderer.on('video-file-ready', handler)
        // Return cleanup function
        return () => ipcRenderer.removeListener('video-file-ready', handler)
    },
    onScanFolderComplete: (callback: (folderPath: string) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, folderPath: string) => callback(folderPath)
        ipcRenderer.on('scan-folder-complete', handler)
        // Return cleanup function
        return () => ipcRenderer.removeListener('scan-folder-complete', handler)
    }
}

// Expose in the main world
if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('electron', electronAPI)
    } catch (error) {
        console.error('Failed to expose electron API:', error)
    }
} else {
    // @ts-ignore - Fallback for non-isolated contexts
    window.electron = electronAPI
}
