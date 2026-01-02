import { contextBridge, ipcRenderer } from 'electron'

// Video file interface
export interface VideoFile {
    id: string
    name: string
    path: string
    size: number
    createdAt: string
    extension: string
}

// Electron API interface
export interface ElectronAPI {
    // Folder operations
    selectFolder: () => Promise<string | null>
    scanFolder: (folderPath: string) => Promise<VideoFile[]>
    getVideoInfo: (videoPath: string) => Promise<VideoFile | null>
}

// Create the API object
const electronAPI: ElectronAPI = {
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    scanFolder: (folderPath: string) => ipcRenderer.invoke('scan-folder', folderPath),
    getVideoInfo: (videoPath: string) => ipcRenderer.invoke('get-video-info', videoPath)
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
