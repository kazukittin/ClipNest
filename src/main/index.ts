import { app, BrowserWindow, shell, ipcMain, dialog, protocol } from 'electron'
import { join, basename, extname } from 'path'
import { readdir, stat, mkdir, access, readFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import Store from 'electron-store'

// ========================================
// FFmpeg Setup
// ========================================

// Set ffmpeg path based on environment
function getFFmpegPath(): string {
    if (app.isPackaged) {
        // Production: ffmpeg-static binary is in resources
        return ffmpegStatic!.replace('app.asar', 'app.asar.unpacked')
    }
    // Development: use ffmpeg-static directly
    return ffmpegStatic!
}

// Set ffprobe path based on environment
function getFFprobePath(): string {
    if (app.isPackaged) {
        // Production: ffprobe-static binary is in resources
        return ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked')
    }
    // Development: use ffprobe-static directly
    return ffprobeStatic.path
}

// Initialize ffmpeg and ffprobe paths
ffmpeg.setFfmpegPath(getFFmpegPath())
ffmpeg.setFfprobePath(getFFprobePath())

// ========================================
// Constants
// ========================================

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.mov', '.webm', '.avi', '.wmv', '.flv', '.m4v']
const THUMBNAIL_SIZE = '320x?' // Scale to width 320, preserve aspect ratio

// ========================================
// Types
// ========================================

interface VideoMetadata {
    isFavorite: boolean
    tags: string[]
    lastPlayedTime?: number
}

interface VideoFile {
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

interface WatchedFolder {
    path: string
    name: string
    videoCount: number
}

interface StoreSchema {
    videoMetadata: Record<string, VideoMetadata>
    watchedFolders: WatchedFolder[]
}

// ========================================
// Metadata Store
// ========================================

const store = new Store<StoreSchema>({
    name: 'clipnest-data',
    defaults: {
        videoMetadata: {},
        watchedFolders: []
    }
})

// Get metadata for a video
function getVideoMetadata(filePath: string): VideoMetadata {
    const allMetadata = store.get('videoMetadata', {})
    return allMetadata[filePath] || { isFavorite: false, tags: [] }
}

// Save metadata for a video
function saveVideoMetadata(filePath: string, metadata: VideoMetadata): void {
    const allMetadata = store.get('videoMetadata', {})
    allMetadata[filePath] = metadata
    store.set('videoMetadata', allMetadata)
}

// ========================================
// Watched Folders Functions
// ========================================

// Get watched folders
function getWatchedFolders(): WatchedFolder[] {
    return store.get('watchedFolders', [])
}

// Save watched folders
function saveWatchedFolders(folders: WatchedFolder[]): void {
    store.set('watchedFolders', folders)
}

// Add a watched folder
function addWatchedFolder(folder: WatchedFolder): void {
    const folders = getWatchedFolders()
    const existingIndex = folders.findIndex(f => f.path === folder.path)
    if (existingIndex >= 0) {
        folders[existingIndex] = folder
    } else {
        folders.push(folder)
    }
    saveWatchedFolders(folders)
}

// Remove a watched folder
function removeWatchedFolder(folderPath: string): void {
    const folders = getWatchedFolders().filter(f => f.path !== folderPath)
    saveWatchedFolders(folders)
}

// ========================================
// Helper Functions
// ========================================

// Get thumbnails directory
async function getThumbnailsDir(): Promise<string> {
    const thumbnailsDir = join(app.getPath('userData'), 'thumbnails')

    try {
        await access(thumbnailsDir)
    } catch {
        await mkdir(thumbnailsDir, { recursive: true })
    }

    return thumbnailsDir
}

// Get video duration using ffprobe
function getVideoDuration(videoPath: string): Promise<number | null> {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(videoPath, (err, metadata) => {
            if (err) {
                console.error(`Error getting duration for ${videoPath}:`, err.message)
                resolve(null)
                return
            }

            const duration = metadata.format.duration
            resolve(duration ? Math.floor(duration) : null)
        })
    })
}

// Generate thumbnail for a video
async function generateThumbnail(
    videoPath: string,
    videoId: string,
    thumbnailsDir: string
): Promise<string | null> {
    return new Promise((resolve) => {
        const thumbnailFilename = `${videoId}_v2.jpg`
        const thumbnailPath = join(thumbnailsDir, thumbnailFilename)

        ffmpeg(videoPath)
            .screenshots({
                count: 1,
                folder: thumbnailsDir,
                filename: thumbnailFilename,
                size: THUMBNAIL_SIZE,
                timemarks: ['20%'] // Capture at 20% of the video duration
            })
            .on('end', () => {
                console.log(`Thumbnail generated: ${thumbnailPath}`)
                resolve(thumbnailPath)
            })
            .on('error', (err) => {
                console.error(`Error generating thumbnail for ${videoPath}:`, err.message)
                resolve(null)
            })
    })
}

// Check if thumbnail already exists
async function thumbnailExists(thumbnailPath: string): Promise<boolean> {
    try {
        await access(thumbnailPath)
        return true
    } catch {
        return false
    }
}

// ========================================
// Window Creation
// ========================================

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#0d0d0d',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
        frame: process.platform === 'darwin',
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false,
            // Disable webSecurity in dev to allow local file access for video playback
            webSecurity: !is.dev
        }
    })

    mainWindow.on('ready-to-show', () => {
        mainWindow?.show()
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
        shell.openExternal(details.url)
        return { action: 'deny' }
    })

    // HMR for renderer
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

// Handler: Scan folder for video files (PROGRESSIVE - sends events for each video)
ipcMain.handle('scan-folder-progressive', async (event, folderPath: string): Promise<{ totalFiles: number }> => {
    try {
        const files = await readdir(folderPath)
        const thumbnailsDir = await getThumbnailsDir()

        // Filter video files first
        const videoFileNames: string[] = []
        for (const file of files) {
            const extension = extname(file).toLowerCase()
            if (VIDEO_EXTENSIONS.includes(extension)) {
                const filePath = join(folderPath, file)
                try {
                    const fileStat = await stat(filePath)
                    if (!fileStat.isDirectory()) {
                        videoFileNames.push(file)
                    }
                } catch {
                    // Skip files we can't stat
                }
            }
        }

        const totalFiles = videoFileNames.length

        // Process each video file and send to renderer as it completes
        for (const file of videoFileNames) {
            const filePath = join(folderPath, file)
            const extension = extname(file).toLowerCase()

            try {
                const fileStat = await stat(filePath)
                const videoId = randomUUID()
                const videoName = basename(file, extension)

                // Check if thumbnail already exists (using path hash for caching)
                const pathHash = Buffer.from(filePath).toString('base64').replace(/[/+=]/g, '_').slice(0, 32)
                const cachedThumbnailPath = join(thumbnailsDir, `${pathHash}_v2.jpg`)

                let thumbnailPath: string | null = null

                if (await thumbnailExists(cachedThumbnailPath)) {
                    thumbnailPath = cachedThumbnailPath
                } else {
                    // Generate new thumbnail
                    thumbnailPath = await generateThumbnail(filePath, pathHash, thumbnailsDir)
                }

                // Get video duration
                const duration = await getVideoDuration(filePath)

                // Get saved metadata
                const metadata = getVideoMetadata(filePath)

                const videoFile: VideoFile = {
                    id: videoId,
                    name: videoName,
                    path: filePath,
                    size: fileStat.size,
                    createdAt: fileStat.birthtime.toISOString(),
                    extension: extension,
                    thumbnailPath: thumbnailPath,
                    duration: duration,
                    isFavorite: metadata.isFavorite,
                    tags: metadata.tags,
                    lastPlayedTime: metadata.lastPlayedTime
                }

                // Send the video file to renderer (check if window is still alive)
                if (!event.sender.isDestroyed()) {
                    event.sender.send('video-file-ready', videoFile)
                } else {
                    // Window is gone, stop processing
                    return { totalFiles }
                }

            } catch (err) {
                console.error(`Error processing file ${filePath}:`, err)
            }
        }

        // Signal that scanning is complete (check if window is still alive)
        if (!event.sender.isDestroyed()) {
            event.sender.send('scan-folder-complete', folderPath)
        }

        return { totalFiles }
    } catch (err) {
        console.error(`Error scanning folder ${folderPath}:`, err)
        event.sender.send('scan-folder-complete', folderPath)
        return { totalFiles: 0 }
    }
})

// Legacy Handler: Scan folder for video files with thumbnail generation (returns all at once)
ipcMain.handle('scan-folder', async (_event, folderPath: string): Promise<VideoFile[]> => {
    try {
        const files = await readdir(folderPath)
        const thumbnailsDir = await getThumbnailsDir()
        const videoFiles: VideoFile[] = []

        for (const file of files) {
            const filePath = join(folderPath, file)
            const extension = extname(file).toLowerCase()

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

                // Generate unique ID using crypto
                const videoId = randomUUID()
                const videoName = basename(file, extension)

                // Check if thumbnail already exists (using path hash for caching)
                const pathHash = Buffer.from(filePath).toString('base64').replace(/[/+=]/g, '_').slice(0, 32)
                const cachedThumbnailPath = join(thumbnailsDir, `${pathHash}.jpg`)

                let thumbnailPath: string | null = null

                if (await thumbnailExists(cachedThumbnailPath)) {
                    thumbnailPath = cachedThumbnailPath
                } else {
                    // Generate new thumbnail
                    thumbnailPath = await generateThumbnail(filePath, pathHash, thumbnailsDir)
                }

                // Get video duration
                const duration = await getVideoDuration(filePath)

                // Get saved metadata
                const metadata = getVideoMetadata(filePath)

                videoFiles.push({
                    id: videoId,
                    name: videoName,
                    path: filePath,
                    size: fileStat.size,
                    createdAt: fileStat.birthtime.toISOString(),
                    extension: extension,
                    thumbnailPath: thumbnailPath,
                    duration: duration,
                    isFavorite: metadata.isFavorite,
                    tags: metadata.tags,
                    lastPlayedTime: metadata.lastPlayedTime
                })
            } catch (err) {
                console.error(`Error processing file ${filePath}:`, err)
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

// Handler: Get video file info with thumbnail
ipcMain.handle('get-video-info', async (_event, videoPath: string): Promise<VideoFile | null> => {
    try {
        const fileStat = await stat(videoPath)
        const fileName = basename(videoPath)
        const extension = extname(fileName).toLowerCase()
        const videoName = basename(fileName, extension)
        const thumbnailsDir = await getThumbnailsDir()

        const videoId = randomUUID()

        // Generate thumbnail
        const pathHash = Buffer.from(videoPath).toString('base64').replace(/[/+=]/g, '_').slice(0, 32)
        const cachedThumbnailPath = join(thumbnailsDir, `${pathHash}.jpg`)

        let thumbnailPath: string | null = null

        if (await thumbnailExists(cachedThumbnailPath)) {
            thumbnailPath = cachedThumbnailPath
        } else {
            thumbnailPath = await generateThumbnail(videoPath, pathHash, thumbnailsDir)
        }

        // Get duration
        const duration = await getVideoDuration(videoPath)

        // Get saved metadata
        const metadata = getVideoMetadata(videoPath)

        return {
            id: videoId,
            name: videoName,
            path: videoPath,
            size: fileStat.size,
            createdAt: fileStat.birthtime.toISOString(),
            extension: extension,
            thumbnailPath: thumbnailPath,
            duration: duration,
            isFavorite: metadata.isFavorite,
            tags: metadata.tags,
            lastPlayedTime: metadata.lastPlayedTime
        }
    } catch (err) {
        console.error(`Error getting video info for ${videoPath}:`, err)
        return null
    }
})

// Handler: Get thumbnails directory path
ipcMain.handle('get-thumbnails-dir', async (): Promise<string> => {
    return await getThumbnailsDir()
})

// Handler: Get thumbnail as base64 data URL
ipcMain.handle('get-thumbnail-data', async (_event, thumbnailPath: string): Promise<string | null> => {
    try {
        if (!existsSync(thumbnailPath)) {
            console.error('Thumbnail not found:', thumbnailPath)
            return null
        }

        const data = await readFile(thumbnailPath)
        const ext = extname(thumbnailPath).toLowerCase()
        const mimeType = ext === '.png' ? 'image/png' :
            ext === '.gif' ? 'image/gif' :
                ext === '.webp' ? 'image/webp' :
                    'image/jpeg'

        return `data:${mimeType};base64,${data.toString('base64')}`
    } catch (error) {
        console.error('Error reading thumbnail:', error)
        return null
    }
})

// ========================================
// Metadata IPC Handlers
// ========================================

// Handler: Toggle favorite status
ipcMain.handle('toggle-favorite', async (_event, filePath: string): Promise<boolean> => {
    const metadata = getVideoMetadata(filePath)
    metadata.isFavorite = !metadata.isFavorite
    saveVideoMetadata(filePath, metadata)
    console.log(`Favorite toggled for ${filePath}: ${metadata.isFavorite}`)
    return metadata.isFavorite
})

// Handler: Update tags for a video
ipcMain.handle('update-tags', async (_event, filePath: string, tags: string[]): Promise<string[]> => {
    const metadata = getVideoMetadata(filePath)
    metadata.tags = tags
    saveVideoMetadata(filePath, metadata)
    console.log(`Tags updated for ${filePath}:`, tags)
    return metadata.tags
})

// Handler: Update playback time for a video
ipcMain.handle('update-playback-time', async (_event, filePath: string, time: number): Promise<void> => {
    const metadata = getVideoMetadata(filePath)
    metadata.lastPlayedTime = time
    saveVideoMetadata(filePath, metadata)
})

// Handler: Get metadata for a specific video
ipcMain.handle('get-metadata', async (_event, filePath: string): Promise<VideoMetadata> => {
    return getVideoMetadata(filePath)
})

// ========================================
// Watched Folders IPC Handlers
// ========================================

// Handler: Get all watched folders
ipcMain.handle('get-watched-folders', async (): Promise<WatchedFolder[]> => {
    return getWatchedFolders()
})

// Handler: Save a watched folder
ipcMain.handle('save-watched-folder', async (_event, folder: WatchedFolder): Promise<void> => {
    addWatchedFolder(folder)
    console.log(`Saved watched folder: ${folder.path}`)
})

// Handler: Remove a watched folder
ipcMain.handle('remove-watched-folder', async (_event, folderPath: string): Promise<void> => {
    removeWatchedFolder(folderPath)
    console.log(`Removed watched folder: ${folderPath}`)
})

// ========================================
// File Operations IPC Handlers
// ========================================

// Handler: Rename a video file
ipcMain.handle('rename-video', async (_event, oldPath: string, newName: string): Promise<{ success: boolean, newPath: string | null, error?: string }> => {
    try {
        const { rename } = await import('fs/promises')
        const dir = join(oldPath, '..')
        const extension = extname(oldPath)
        const newPath = join(dir, `${newName}${extension}`)

        // Check if new path already exists
        if (existsSync(newPath) && newPath !== oldPath) {
            return { success: false, newPath: null, error: '同じ名前のファイルが既に存在します' }
        }

        await rename(oldPath, newPath)

        // Migrate metadata to new path
        const metadata = getVideoMetadata(oldPath)
        if (metadata.isFavorite || metadata.tags.length > 0) {
            saveVideoMetadata(newPath, metadata)
            // Remove old metadata
            const allMetadata = store.get('videoMetadata', {})
            delete allMetadata[oldPath]
            store.set('videoMetadata', allMetadata)
        }

        console.log(`Renamed video: ${oldPath} -> ${newPath}`)
        return { success: true, newPath }
    } catch (error) {
        console.error('Error renaming video:', error)
        return { success: false, newPath: null, error: 'ファイル名の変更に失敗しました' }
    }
})

// Handler: Delete a video file (move to trash)
ipcMain.handle('delete-video', async (_event, filePath: string): Promise<{ success: boolean, error?: string }> => {
    try {
        // Use shell.trashItem to move to trash/recycle bin
        await shell.trashItem(filePath)

        // Remove thumbnails
        try {
            const thumbnailsDir = await getThumbnailsDir()
            const pathHash = Buffer.from(filePath).toString('base64').replace(/[/+=]/g, '_').slice(0, 32)

            // Try to delete both v1 and v2 thumbnails
            const thumbnailPaths = [
                join(thumbnailsDir, `${pathHash}.jpg`),
                join(thumbnailsDir, `${pathHash}_v2.jpg`)
            ]

            for (const tPath of thumbnailPaths) {
                if (existsSync(tPath)) {
                    await unlink(tPath)
                }
            }
        } catch (thumbError) {
            console.error('Error deleting thumbnails:', thumbError)
            // Continue even if thumbnail deletion fails
        }

        // Remove metadata
        const allMetadata = store.get('videoMetadata', {})
        delete allMetadata[filePath]
        store.set('videoMetadata', allMetadata)

        console.log(`Deleted video (moved to trash) and its thumbnails: ${filePath}`)
        return { success: true }
    } catch (error) {
        console.error('Error deleting video:', error)
        return { success: false, error: 'ファイルの削除に失敗しました' }
    }
})

// ========================================
// Window Control IPC Handlers
// ========================================

ipcMain.on('window-minimize', () => {
    mainWindow?.minimize()
})

ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize()
    } else {
        mainWindow?.maximize()
    }
})

ipcMain.on('window-close', () => {
    mainWindow?.close()
})

ipcMain.handle('is-window-maximized', async () => {
    return mainWindow?.isMaximized() || false
})

// ========================================
// App Lifecycle
// ========================================

// Register custom protocol for local file access
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'local-file',
        privileges: {
            secure: true,
            standard: true,
            supportFetchAPI: true,
            bypassCSP: true
        }
    }
])

app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.clipnest')

    // Register protocol handler for local-file://
    protocol.handle('local-file', async (request) => {
        try {
            const url = new URL(request.url)
            let filePath = decodeURIComponent(url.pathname)

            // On Windows, if we have a hostname like 'c', it might be the drive letter
            // URLs like local-file://c/Users/... result in hostname='c' and pathname='/Users/...'
            if (url.hostname && url.hostname.length === 1 && /^[a-zA-Z]$/.test(url.hostname)) {
                filePath = `${url.hostname}:${filePath}`
            }

            // If the path starts with /C:/..., remove the leading slash
            if (filePath.startsWith('/') && /^\/[a-zA-Z]:/.test(filePath)) {
                filePath = filePath.substring(1)
            }

            console.log('Loading local file:', filePath)

            // Check if file exists
            if (!existsSync(filePath)) {
                // Try fallback: if it doesn't start with a drive letter, maybe it needs the leading slash removed anyway
                if (filePath.startsWith('/')) {
                    const fallbackPath = filePath.substring(1)
                    if (existsSync(fallbackPath)) {
                        filePath = fallbackPath
                    }
                }
            }

            if (!existsSync(filePath)) {
                console.error('File not found:', filePath)
                return new Response('File not found', { status: 404 })
            }

            // Get file stats for size
            const fileStat = await stat(filePath)
            const fileSize = fileStat.size

            // Determine content type based on extension
            const ext = extname(filePath).toLowerCase()
            const mimeTypes: Record<string, string> = {
                // Images
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                // Videos
                '.mp4': 'video/mp4',
                '.webm': 'video/webm',
                '.mkv': 'video/x-matroska',
                '.mov': 'video/quicktime',
                '.avi': 'video/x-msvideo',
                '.wmv': 'video/x-ms-wmv',
                '.flv': 'video/x-flv',
                '.m4v': 'video/x-m4v',
            }
            const contentType = mimeTypes[ext] || 'application/octet-stream'

            // Check for Range header (for video streaming)
            const rangeHeader = request.headers.get('range')

            if (rangeHeader) {
                // Parse range header
                const match = rangeHeader.match(/bytes=(\d*)-(\d*)/)
                if (match) {
                    const start = match[1] ? parseInt(match[1], 10) : 0
                    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1
                    const chunkSize = end - start + 1

                    // Read the specific range
                    const { createReadStream } = await import('fs')
                    const stream = createReadStream(filePath, { start, end })
                    const chunks: Buffer[] = []

                    for await (const chunk of stream) {
                        chunks.push(chunk as Buffer)
                    }
                    const data = Buffer.concat(chunks)

                    return new Response(data, {
                        status: 206,
                        headers: {
                            'Content-Type': contentType,
                            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                            'Accept-Ranges': 'bytes',
                            'Content-Length': chunkSize.toString()
                        }
                    })
                }
            }

            // Read the entire file for non-range requests
            const data = await readFile(filePath)

            return new Response(data, {
                status: 200,
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': fileSize.toString(),
                    'Accept-Ranges': 'bytes'
                }
            })
        } catch (error) {
            console.error('Error loading file:', error)
            return new Response('Error loading file', { status: 500 })
        }
    })

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
