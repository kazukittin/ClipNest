// Video file from the main process
export interface VideoFile {
    id: string
    name: string
    path: string
    size: number
    createdAt: string
    extension: string
}

// Extended video with UI state
export interface Video extends VideoFile {
    thumbnail?: string
    duration?: number
    tags: string[]
    isFavorite: boolean
}

// Folder information
export interface WatchedFolder {
    path: string
    name: string
    videoCount: number
}

// Electron API interface (mirrors preload)
export interface ElectronAPI {
    selectFolder: () => Promise<string | null>
    scanFolder: (folderPath: string) => Promise<VideoFile[]>
    getVideoInfo: (videoPath: string) => Promise<VideoFile | null>
}

// Extend Window interface
declare global {
    interface Window {
        electron: ElectronAPI
    }
}
