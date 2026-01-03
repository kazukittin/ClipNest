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
}

// Video metadata interface
export interface VideoMetadata {
    isFavorite: boolean
    tags: string[]
}

// Electron API interface
export interface ElectronAPI {
    // Folder operations
    selectFolder: () => Promise<string | null>
    scanFolder: (folderPath: string) => Promise<VideoFile[]>
    getVideoInfo: (videoPath: string) => Promise<VideoFile | null>
    getThumbnailsDir: () => Promise<string>
    getThumbnailData: (thumbnailPath: string) => Promise<string | null>
    // Metadata operations
    toggleFavorite: (filePath: string) => Promise<boolean>
    updateTags: (filePath: string, tags: string[]) => Promise<string[]>
    getMetadata: (filePath: string) => Promise<VideoMetadata>
}

// Create the API object
const electronAPI: ElectronAPI = {
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    scanFolder: (folderPath: string) => ipcRenderer.invoke('scan-folder', folderPath),
    getVideoInfo: (videoPath: string) => ipcRenderer.invoke('get-video-info', videoPath),
    getThumbnailsDir: () => ipcRenderer.invoke('get-thumbnails-dir'),
    getThumbnailData: (thumbnailPath: string) => ipcRenderer.invoke('get-thumbnail-data', thumbnailPath),
    // Metadata operations
    toggleFavorite: (filePath: string) => ipcRenderer.invoke('toggle-favorite', filePath),
    updateTags: (filePath: string, tags: string[]) => ipcRenderer.invoke('update-tags', filePath, tags),
    getMetadata: (filePath: string) => ipcRenderer.invoke('get-metadata', filePath)
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
