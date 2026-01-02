import { app, BrowserWindow, shell, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { readdir, stat } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

// Supported video extensions
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.mov', '.webm', '.avi', '.wmv', '.flv']

interface VideoFile {
    id: string
    name: string
    path: string
    size: number
    createdAt: string
    extension: string
}

function createWindow(): void {
    const mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#0d0d0d',
        titleBarStyle: 'hiddenInset',
        frame: process.platform === 'darwin',
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow.show()
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    // HMR for renderer base on electron-vite cli.
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
        mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
}

// ========================================
// IPC Handlers
// ========================================

// Handler: Select folder using native dialog
ipcMain.handle('select-folder', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Select Video Folder'
    })

    if (result.canceled || result.filePaths.length === 0) {
        return null
    }

    return result.filePaths[0]
})

// Handler: Scan folder for video files
ipcMain.handle('scan-folder', async (_event, folderPath: string): Promise<VideoFile[]> => {
    try {
        const files = await readdir(folderPath)
        const videoFiles: VideoFile[] = []

        for (const file of files) {
            const filePath = join(folderPath, file)
            const extension = file.substring(file.lastIndexOf('.')).toLowerCase()

            // Check if it's a video file
            if (!VIDEO_EXTENSIONS.includes(extension)) {
                continue
            }

            try {
                const fileStat = await stat(filePath)

                // Skip directories
                if (fileStat.isDirectory()) {
                    continue
                }

                videoFiles.push({
                    id: `${folderPath}-${file}`.replace(/[\\/:]/g, '_'),
                    name: file.substring(0, file.lastIndexOf('.')),
                    path: filePath,
                    size: fileStat.size,
                    createdAt: fileStat.birthtime.toISOString(),
                    extension: extension
                })
            } catch (err) {
                console.error(`Error reading file stats for ${filePath}:`, err)
            }
        }

        // Sort by name
        videoFiles.sort((a, b) => a.name.localeCompare(b.name))

        return videoFiles
    } catch (err) {
        console.error(`Error scanning folder ${folderPath}:`, err)
        return []
    }
})

// Handler: Get video file info
ipcMain.handle('get-video-info', async (_event, videoPath: string): Promise<VideoFile | null> => {
    try {
        const fileStat = await stat(videoPath)
        const fileName = videoPath.substring(videoPath.lastIndexOf('\\') + 1)
        const extension = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()

        return {
            id: videoPath.replace(/[\\/:]/g, '_'),
            name: fileName.substring(0, fileName.lastIndexOf('.')),
            path: videoPath,
            size: fileStat.size,
            createdAt: fileStat.birthtime.toISOString(),
            extension: extension
        }
    } catch (err) {
        console.error(`Error getting video info for ${videoPath}:`, err)
        return null
    }
})

// ========================================
// App Lifecycle
// ========================================

app.whenReady().then(() => {
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.clipnest')

    // Default open or close DevTools by F12 in development
    app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
    })

    createWindow()

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
