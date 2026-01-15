import { app, BrowserWindow, shell, ipcMain, dialog, protocol } from 'electron'

// Polyfill File for undici/cheerio support in Electron Node environment
if (typeof global.File === 'undefined') {
    try {
        const { File } = require('node:buffer')
        if (File) {
            global.File = File
        }
    } catch (e) {
        console.warn('Failed to polyfill File:', e)
    }
}
import { join, basename, extname } from 'path'
import { readdir, stat, mkdir, access, readFile, unlink, rename } from 'fs/promises'
import { spawn } from 'child_process'
import { existsSync, createReadStream } from 'fs'
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
    downloadPath: string
    cachedVideos: VideoFile[]
}

// ========================================
// Metadata Store
// ========================================

const store = new Store<StoreSchema>({
    name: 'clipnest-data',
    defaults: {
        videoMetadata: {},
        watchedFolders: [],
        downloadPath: '',
        cachedVideos: []
    }
})

// ========================================
// Video Cache Functions
// ========================================

function getCachedVideos(): VideoFile[] {
    return store.get('cachedVideos', [])
}

function saveCachedVideos(videos: VideoFile[]): void {
    store.set('cachedVideos', videos)
    console.log(`Saved ${videos.length} videos to cache`)
}

function updateVideoCache(newVideos: VideoFile[]): void {
    const existing = getCachedVideos()
    const existingPaths = new Set(existing.map(v => v.path))
    const videosToAdd = newVideos.filter(v => !existingPaths.has(v.path))
    if (videosToAdd.length > 0) {
        saveCachedVideos([...existing, ...videosToAdd])
    }
}

function removeFromVideoCache(videoPaths: string[]): void {
    const pathsToRemove = new Set(videoPaths)
    const existing = getCachedVideos()
    const filtered = existing.filter(v => !pathsToRemove.has(v.path))
    if (filtered.length !== existing.length) {
        saveCachedVideos(filtered)
    }
}

// Get download path (returns default if not set)
function getDownloadPath(): string {
    const savedPath = store.get('downloadPath', '')
    if (savedPath && existsSync(savedPath)) {
        return savedPath
    }
    // Default to Downloads/StreamVault
    return join(app.getPath('downloads'), 'StreamVault')
}

// Set download path
function setDownloadPath(path: string): void {
    store.set('downloadPath', path)
}

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
// Video Cache IPC Handlers
// ========================================

// Handler: Get cached videos (for instant startup)
ipcMain.handle('get-cached-videos', async (): Promise<VideoFile[]> => {
    const cached = getCachedVideos()
    console.log(`Returning ${cached.length} cached videos`)
    return cached
})

// Handler: Save videos to cache
ipcMain.handle('save-video-cache', async (_event, videos: VideoFile[]): Promise<void> => {
    saveCachedVideos(videos)
})

// Handler: Clear video cache
ipcMain.handle('clear-video-cache', async (): Promise<void> => {
    // 1. Clear store
    saveCachedVideos([])

    // 2. Clear thumbnails
    try {
        const thumbDir = await getThumbnailsDir()
        if (existsSync(thumbDir)) {
            const files = await readdir(thumbDir)
            for (const file of files) {
                await unlink(join(thumbDir, file))
            }
        }
        console.log('Video cache and thumbnails cleared')
    } catch (error) {
        console.error('Error clearing thumbnails:', error)
    }
})

// ========================================
// File Operations IPC Handlers
// ========================================

// Handler: Rename a video file
ipcMain.handle('rename-video', async (_event, oldPath: string, newName: string): Promise<{ success: boolean, newPath: string | null, error?: string }> => {
    try {

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

// Handler: Batch rename videos with sequential numbers
interface BatchRenameItem {
    oldPath: string
    newPath: string
}

ipcMain.handle('batch-rename-videos', async (
    _event,
    videoPaths: string[],
    prefix: string,
    startNumber: number,
    padLength: number
): Promise<{ success: boolean, results: BatchRenameItem[], errors: string[] }> => {
    const results: BatchRenameItem[] = []
    const errors: string[] = []

    // First, validate all new paths don't conflict
    const newPaths: Map<string, string> = new Map()
    for (let i = 0; i < videoPaths.length; i++) {
        const oldPath = videoPaths[i]
        const dir = join(oldPath, '..')
        const extension = extname(oldPath)
        const num = (startNumber + i).toString().padStart(padLength, '0')
        const newName = `${prefix}${num}`
        const newPath = join(dir, `${newName}${extension}`)

        // Skip if name is unchanged
        if (newPath === oldPath) {
            results.push({ oldPath, newPath })
            continue
        }

        // Check for conflicts with existing files (not in our batch)
        if (existsSync(newPath) && !videoPaths.includes(newPath)) {
            errors.push(`${newName}${extension} は既に存在します`)
            continue
        }

        // Check for conflicts within our batch
        if (newPaths.has(newPath)) {
            errors.push(`重複: ${newName}${extension}`)
            continue
        }

        newPaths.set(oldPath, newPath)
    }

    if (errors.length > 0) {
        return { success: false, results: [], errors }
    }

    // Perform the renames
    // We rename to temp names first to avoid conflicts during rename
    const tempRenames: Map<string, string> = new Map()
    const tempSuffix = `_temp_${Date.now()}`

    try {
        // Step 1: Rename all to temp names
        for (const entry of Array.from(newPaths.entries())) {
            const oldPath = entry[0]
            const dir = join(oldPath, '..')
            const extension = extname(oldPath)
            const baseName = basename(oldPath, extension)
            const tempPath = join(dir, `${baseName}${tempSuffix}${extension}`)

            await rename(oldPath, tempPath)
            tempRenames.set(tempPath, oldPath)
        }

        // Step 2: Rename from temp to final names
        for (const entry of Array.from(newPaths.entries())) {
            const oldPath = entry[0]
            const newPath = entry[1]
            const dir = join(oldPath, '..')
            const extension = extname(oldPath)
            const baseName = basename(oldPath, extension)
            const tempPath = join(dir, `${baseName}${tempSuffix}${extension}`)

            await rename(tempPath, newPath)
            tempRenames.delete(tempPath)

            // Migrate metadata
            const metadata = getVideoMetadata(oldPath)
            if (metadata.isFavorite || metadata.tags.length > 0 || metadata.lastPlayedTime) {
                saveVideoMetadata(newPath, metadata)
                const allMetadata = store.get('videoMetadata', {})
                delete allMetadata[oldPath]
                store.set('videoMetadata', allMetadata)
            }

            results.push({ oldPath, newPath })
            console.log(`Batch renamed: ${oldPath} -> ${newPath}`)
        }

        return { success: true, results, errors: [] }
    } catch (error) {
        console.error('Error in batch rename:', error)

        // Attempt to rollback temp renames
        for (const entry of Array.from(tempRenames.entries())) {
            const tempPath = entry[0]
            const originalPath = entry[1]
            try {
                if (existsSync(tempPath)) {
                    await rename(tempPath, originalPath)
                }
            } catch (rollbackError) {
                console.error('Rollback failed:', rollbackError)
            }
        }

        return { success: false, results: [], errors: ['一括リネームに失敗しました'] }
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
// StreamVault (Downloader) Handlers
// ========================================

const activeDownloads = new Map<string, any>()

ipcMain.handle('download-video', async (event, { url, id }: { url: string; id: string }) => {
    const saveDir = getDownloadPath()

    if (!existsSync(saveDir)) {
        await mkdir(saveDir, { recursive: true })
    }

    console.log(`Starting download for ${url} (ID: ${id}) to ${saveDir}`)

    const args = [
        '-f', 'bestvideo+bestaudio/best',
        '--merge-output-format', 'mp4',
        '-o', join(saveDir, '%(title)s.%(ext)s'),
        '--newline',
        url
    ]

    let process = spawn('yt-dlp', args)

    process.on('error', (err) => {
        console.warn('Failed to start yt-dlp directly, trying python -m yt_dlp', err)
        process = spawn('python', ['-m', 'yt_dlp', ...args])
        setupProcessListeners(process, id, event)
    })

    setupProcessListeners(process, id, event)
    activeDownloads.set(id, process)

    return { success: true, message: 'Started' }
})

// Handler: Get download path
ipcMain.handle('get-download-path', async (): Promise<string> => {
    return getDownloadPath()
})

// Handler: Set download path
ipcMain.handle('set-download-path', async (_event, path: string): Promise<{ success: boolean, path: string }> => {
    if (!existsSync(path)) {
        try {
            await mkdir(path, { recursive: true })
        } catch (err) {
            console.error('Failed to create download directory:', err)
            return { success: false, path: getDownloadPath() }
        }
    }
    setDownloadPath(path)
    console.log(`Download path set to: ${path}`)
    return { success: true, path }
})

// Handler: Select download folder using native dialog
ipcMain.handle('select-download-folder', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'ダウンロードの保存先を選択',
        defaultPath: getDownloadPath()
    })

    if (result.canceled || result.filePaths.length === 0) {
        return null
    }

    const selectedPath = result.filePaths[0]
    setDownloadPath(selectedPath)
    console.log(`Download path selected: ${selectedPath}`)
    return selectedPath
})

ipcMain.handle('cancel-download', async (_event, id: string) => {
    const process = activeDownloads.get(id)
    if (process) {
        process.kill()
        activeDownloads.delete(id)
        return { success: true }
    }
    return { success: false }
})

// Fetch Product Data (Scraping)
ipcMain.handle('fetch-video-product-data', async (_, code: string) => {
    if (!code) return null

    // Dynamic require to prevent startup errors with undici/File
    const axios = require('axios')
    const cheerio = require('cheerio')

    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'

    // Helper: Fetch DMM/FANZA
    const fetchDMM = async (searchCode: string) => {
        try {
            // Search first
            const searchUrl = `https://www.dmm.co.jp/search/=/searchstr=${encodeURIComponent(searchCode)}/`
            const { data: searchData } = await axios.get(searchUrl, { headers: { 'User-Agent': userAgent } })
            const $search = cheerio.load(searchData)

            const detailLink = $search('#list li').first().find('p.tmb a').attr('href')
            if (!detailLink) return null

            // Fetch detail
            const { data: detailData } = await axios.get(detailLink, { headers: { 'User-Agent': userAgent } })
            const $ = cheerio.load(detailData)

            const title = $('#title').text().trim()
            const maker = $('.maker-name').text().trim()
            const tags: string[] = []
            $('.genre-list a').each((_, el) => {
                const t = $(el).text().trim()
                if (t) tags.push(t)
            })
            const act = $('#performer a').text().trim()

            // Thumbnail: try to find package image
            const thumb = $('#sample-video a').attr('href') || $('#package-src').attr('src')

            return {
                title,
                tags,
                maker,
                actress: act ? [act] : [],
                thumbnailUrl: thumb
            }
        } catch (e) {
            console.error('DMM Fetch Error:', e)
            return null
        }
    }

    // Helper: Fetch FC2
    const fetchFC2 = async (fc2Code: string) => {
        // Extract ID
        const match = fc2Code.match(/(\d{5,})/)
        if (!match) return null
        const id = match[1]

        try {
            const url = `https://adult.contents.fc2.com/article/${id}/`
            const { data } = await axios.get(url, {
                headers: { 'User-Agent': userAgent, 'Cookie': 'age_check=1' }
            })
            const $ = cheerio.load(data)

            const title = $('.items_article_headerInfo h3').text().trim()
            const tags: string[] = []
            $('.tag-tag').each((_, el) => {
                const t = $(el).text().trim()
                if (t) tags.push(t)
            })

            // FC2 specific selector for seller/maker
            const maker = $('.items_article_headerInfo .items_article_Seller p a').text().trim()

            return {
                title,
                tags,
                maker,
                thumbnailUrl: '' // Difficult to get without more logic sometimes
            }
        } catch (e) {
            console.error('FC2 Fetch Error:', e)
            return null
        }
    }

    // Determine handler
    // FC2 pattern: contains FC2, or just 6+ digits, or xxx-xxx-xxx (FC2-PPV-...)
    if (code.toUpperCase().includes('FC2') || /^\d{6,}$/.test(code)) {
        const res = await fetchFC2(code)
        if (res) return res
    }

    // Default to DMM for others (most AV codes)
    return await fetchDMM(code)
})

function setupProcessListeners(process: any, id: string, event: Electron.IpcMainInvokeEvent) {
    process.stdout.on('data', (data: Buffer) => {
        const line = data.toString()
        console.log(`[DL ${id}] ${line}`)

        const progressMatch = line.match(/(\d+\.?\d*)%/)
        if (progressMatch) {
            const progress = parseFloat(progressMatch[1])
            if (!event.sender.isDestroyed()) {
                event.sender.send('download-progress', { id, progress, status: 'downloading' })
            }
        }

        if (line.includes('[download] 100% of') || line.includes('has already been downloaded')) {
            if (!event.sender.isDestroyed()) {
                event.sender.send('download-progress', { id, progress: 100, status: 'completed' })
            }
        }
    })

    process.stderr.on('data', (data: Buffer) => {
        console.error(`[DL ERR ${id}] ${data.toString()}`)
    })

    process.on('close', (code: number) => {
        console.log(`Download process ${id} exited with code ${code}`)
        activeDownloads.delete(id)
        if (code !== 0 && code !== null) {
            if (!event.sender.isDestroyed()) {
                event.sender.send('download-error', { id, error: `Process exited with code ${code}` })
            }
        }
    })
}

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
