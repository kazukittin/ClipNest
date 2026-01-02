// Video file interface
export interface VideoFile {
    id: string
    name: string
    path: string
    size: number
    createdAt: string
    extension: string
}

// Electron API interface exposed to renderer
export interface ElectronAPI {
    selectFolder: () => Promise<string | null>
    scanFolder: (folderPath: string) => Promise<VideoFile[]>
    getVideoInfo: (videoPath: string) => Promise<VideoFile | null>
}

// Extend the Window interface
declare global {
    interface Window {
        electron: ElectronAPI
    }
}
