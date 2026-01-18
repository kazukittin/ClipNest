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
import { existsSync, createReadStream, unlinkSync } from 'fs'
import { randomUUID, createHash } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import ffmpeg from 'fluent-ffmpeg'
const ffmpegStatic = require('ffmpeg-static')
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
    productCode?: string
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
    productCode?: string
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
    // Free memory after saving cache
    if (typeof global.gc === 'function') {
        global.gc()
    }
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
                // Try to free memory after thumbnail generation
                if (typeof global.gc === 'function') {
                    global.gc()
                }
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
        let processedCount = 0

        // Process each video file and send to renderer as it completes
        for (const file of videoFileNames) {
            const filePath = join(folderPath, file)
            const extension = extname(file).toLowerCase()

            try {
                const fileStat = await stat(filePath)
                const videoId = randomUUID()
                const videoName = basename(file, extension)

                // Check if thumbnail already exists (using SHA256 hash for caching)
                const pathHash = createHash('sha256').update(filePath).digest('hex').slice(0, 32)
                const cachedThumbnailPath = join(thumbnailsDir, `${pathHash}_v3.jpg`)

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
                    lastPlayedTime: metadata.lastPlayedTime,
                    productCode: metadata.productCode
                }

                // Send the video file to renderer (check if window is still alive)
                if (!event.sender.isDestroyed()) {
                    event.sender.send('video-file-ready', videoFile)
                } else {
                    // Window is gone, stop processing
                    return { totalFiles }
                }

                processedCount++

                // Every 20 files, try to free memory
                if (processedCount % 20 === 0) {
                    if (typeof global.gc === 'function') {
                        global.gc()
                    }
                }

            } catch (err) {
                console.error(`Error processing file ${filePath}:`, err)
            }
        }

        // Signal that scanning is complete (check if window is still alive)
        if (!event.sender.isDestroyed()) {
            event.sender.send('scan-folder-complete', folderPath)
        }

        // Free memory after scan complete
        if (typeof global.gc === 'function') {
            global.gc()
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

                // Check if thumbnail already exists (using SHA256 hash for caching)
                const pathHash = createHash('sha256').update(filePath).digest('hex').slice(0, 32)
                const cachedThumbnailPath = join(thumbnailsDir, `${pathHash}_v3.jpg`)

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

// Handler: Update product code for a video
ipcMain.handle('update-product-code', async (_event, filePath: string, productCode: string): Promise<string> => {
    const metadata = getVideoMetadata(filePath)
    metadata.productCode = productCode
    saveVideoMetadata(filePath, metadata)
    console.log(`Product code updated for ${filePath}: ${productCode}`)
    return productCode
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
    videoPaths: string[]
): Promise<{ success: boolean, results: BatchRenameItem[], errors: string[], skipped: number, startNumber?: number }> => {
    const results: BatchRenameItem[] = []
    const errors: string[] = []
    let skipped = 0
    const MAX_ERRORS = 5
    const padLength = 3

    if (videoPaths.length === 0) {
        return { success: false, results: [], errors: ['ファイルが選択されていません'], skipped: 0, startNumber: 1 }
    }

    // Get the directory of the first file (assuming all files are in the same directory)
    const targetDir = join(videoPaths[0], '..')

    // Find ALL existing numbered files in the directory that are NOT in our batch
    const takenNumbers = new Set<number>()
    try {
        const files = await readdir(targetDir)
        const numberPattern = /^(\d{3,})\.(mp4|mov|avi|mkv|wmv|flv|webm|m4v)$/i

        for (const file of files) {
            const match = file.match(numberPattern)
            if (match) {
                const filePath = join(targetDir, file)
                // Check case-insensitively if this file is in our batch
                const isInBatch = videoPaths.some(p => p.toLowerCase() === filePath.toLowerCase())
                if (!isInBatch) {
                    const num = parseInt(match[1], 10)
                    takenNumbers.add(num)
                }
            }
        }
    } catch (err) {
        console.error('Error reading directory:', err)
    }

    console.log(`Batch rename: ${takenNumbers.size} numbers already taken (not in batch)`)

    // Generate available numbers (skipping taken ones)
    const availableNumbers: number[] = []
    let nextNum = 1
    while (availableNumbers.length < videoPaths.length) {
        if (!takenNumbers.has(nextNum)) {
            availableNumbers.push(nextNum)
        }
        nextNum++
    }

    const startNumber = availableNumbers.length > 0 ? availableNumbers[0] : 1
    const endNumber = availableNumbers.length > 0 ? availableNumbers[availableNumbers.length - 1] : videoPaths.length
    console.log(`Batch rename: will use numbers from ${startNumber} to ${endNumber}`)

    // First, validate all new paths don't conflict
    const newPaths: Map<string, string> = new Map()
    const usedNewPaths = new Set<string>()
    for (let i = 0; i < videoPaths.length; i++) {
        const oldPath = videoPaths[i]
        const dir = join(oldPath, '..')
        const extension = extname(oldPath)
        const num = availableNumbers[i].toString().padStart(padLength, '0')
        const newName = num
        const newPath = join(dir, `${newName}${extension}`)

        // Skip if name is unchanged (already matches pattern)
        if (newPath.toLowerCase() === oldPath.toLowerCase()) {
            results.push({ oldPath, newPath })
            skipped++
            continue
        }

        // Check if current file already has the target name pattern
        const currentBaseName = basename(oldPath, extension)
        if (currentBaseName === num) {
            // Already has the correct name
            results.push({ oldPath, newPath: oldPath })
            skipped++
            continue
        }

        // Check for conflicts with existing files (case-insensitive, not in our batch)
        if (existsSync(newPath)) {
            const isInBatch = videoPaths.some(p => p.toLowerCase() === newPath.toLowerCase())
            if (!isInBatch) {
                if (errors.length < MAX_ERRORS) {
                    errors.push(`${newName}${extension} は既に存在します`)
                }
                continue
            }
        }

        // Check for conflicts within our batch
        if (usedNewPaths.has(newPath.toLowerCase())) {
            if (errors.length < MAX_ERRORS) {
                errors.push(`重複: ${newName}${extension}`)
            }
            continue
        }

        usedNewPaths.add(newPath.toLowerCase())
        newPaths.set(oldPath, newPath)
    }

    if (errors.length > 0) {
        const totalErrors = errors.length
        if (totalErrors >= MAX_ERRORS) {
            errors.push(`... 他にもエラーがあります`)
        }
        return { success: false, results: [], errors, skipped, startNumber }
    }

    // Perform the renames
    // We rename to temp names first to avoid conflicts during rename
    const tempRenames: Map<string, string> = new Map()
    const tempSuffix = `_temp_${Date.now()}`

    try {
        // Step 1: Rename all to temp names
        for (const [oldPath, _newPath] of Array.from(newPaths.entries())) {
            const dir = join(oldPath, '..')
            const extension = extname(oldPath)
            const baseName = basename(oldPath, extension)
            const tempPath = join(dir, `${baseName}${tempSuffix}${extension}`)

            await rename(oldPath, tempPath)
            tempRenames.set(tempPath, oldPath)
        }

        // Step 2: Rename from temp to final names
        for (const [oldPath, newPath] of Array.from(newPaths.entries())) {
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

        return { success: true, results, errors: [], skipped, startNumber }
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

        return { success: false, results: [], errors: ['一括リネームに失敗しました'], skipped: 0, startNumber: 1 }
    } finally {
        // Free memory after batch rename
        if (typeof global.gc === 'function') {
            global.gc()
        }
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
            const oldPathHash = Buffer.from(filePath).toString('base64').replace(/[/+=]/g, '_').slice(0, 32)
            const newPathHash = createHash('sha256').update(filePath).digest('hex').slice(0, 32)

            // Try to delete all versions of thumbnails (v1, v2 base64 hash, v3 SHA256 hash)
            const thumbnailPaths = [
                join(thumbnailsDir, `${oldPathHash}.jpg`),
                join(thumbnailsDir, `${oldPathHash}_v2.jpg`),
                join(thumbnailsDir, `${newPathHash}_v3.jpg`)
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

// Handler: Convert video to MP4
const activeConversions = new Map<string, any>()

ipcMain.handle('convert-to-mp4', async (event, filePath: string, deleteOriginal: boolean = false): Promise<{ success: boolean, newPath?: string, error?: string }> => {
    const ext = extname(filePath).toLowerCase()

    // Skip if already mp4
    if (ext === '.mp4') {
        return { success: true, newPath: filePath }
    }

    // Check supported formats
    const supportedFormats = ['.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.mts']
    if (!supportedFormats.includes(ext)) {
        return { success: false, error: `サポートされていない形式です: ${ext}` }
    }

    const dir = join(filePath, '..')
    const baseName = basename(filePath, ext)
    const outputPath = join(dir, `${baseName}.mp4`)

    // Check if output already exists
    if (existsSync(outputPath)) {
        return { success: false, error: '同名のMP4ファイルが既に存在します' }
    }

    console.log(`Starting conversion: ${filePath} -> ${outputPath}`)

    return new Promise((resolve) => {
        const command = ffmpeg(filePath)
            .outputOptions([
                '-c:v', 'libx264',     // H.264 video codec
                '-preset', 'medium',    // Encoding speed/quality balance
                '-crf', '23',           // Quality (lower = better, 18-28 recommended)
                '-c:a', 'aac',          // AAC audio codec
                '-b:a', '192k',         // Audio bitrate
                '-movflags', '+faststart' // Enable fast start for web playback
            ])
            .output(outputPath)
            .on('start', (commandLine) => {
                console.log(`FFmpeg command: ${commandLine}`)
            })
            .on('progress', (progress) => {
                if (progress.percent && !event.sender.isDestroyed()) {
                    event.sender.send('conversion-progress', {
                        filePath,
                        progress: Math.round(progress.percent),
                        status: 'converting'
                    })
                }
            })
            .on('end', async () => {
                console.log(`Conversion completed: ${outputPath}`)

                // Migrate metadata to new path
                const metadata = getVideoMetadata(filePath)
                if (metadata.isFavorite || metadata.tags.length > 0 || metadata.lastPlayedTime) {
                    saveVideoMetadata(outputPath, metadata)
                    const allMetadata = store.get('videoMetadata', {})
                    delete allMetadata[filePath]
                    store.set('videoMetadata', allMetadata)
                }

                // Delete original if requested
                if (deleteOriginal) {
                    try {
                        await shell.trashItem(filePath)
                        console.log(`Original file moved to trash: ${filePath}`)

                        // Remove original file from video cache
                        removeFromVideoCache([filePath])

                        // Notify UI to remove the old video
                        if (!event.sender.isDestroyed()) {
                            event.sender.send('video-removed', { path: filePath })
                        }
                    } catch (err) {
                        console.error('Failed to delete original file:', err)
                    }
                }

                activeConversions.delete(filePath)

                // Try to free memory after conversion
                if (typeof global.gc === 'function') {
                    global.gc()
                }

                if (!event.sender.isDestroyed()) {
                    event.sender.send('conversion-progress', {
                        filePath,
                        progress: 100,
                        status: 'completed',
                        newPath: outputPath
                    })
                }

                resolve({ success: true, newPath: outputPath })
            })
            .on('error', (err) => {
                console.error(`Conversion failed: ${err.message}`)
                activeConversions.delete(filePath)

                // Clean up partial output file
                if (existsSync(outputPath)) {
                    try {
                        unlinkSync(outputPath)
                    } catch (e) {
                        console.error('Failed to delete partial output:', e)
                    }
                }

                if (!event.sender.isDestroyed()) {
                    event.sender.send('conversion-progress', {
                        filePath,
                        progress: 0,
                        status: 'error',
                        error: err.message
                    })
                }

                resolve({ success: false, error: err.message })
            })

        activeConversions.set(filePath, command)
        command.run()
    })
})

// Handler: Cancel video conversion
ipcMain.handle('cancel-conversion', async (_event, filePath: string): Promise<{ success: boolean }> => {
    const command = activeConversions.get(filePath)
    if (command) {
        command.kill('SIGKILL')
        activeConversions.delete(filePath)
        console.log(`Conversion cancelled: ${filePath}`)
        return { success: true }
    }
    return { success: false }
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
            $('.genre-list a').each((_: any, el: any) => {
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
            $('.tag-tag').each((_: any, el: any) => {
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
    let result = null
    if (code.toUpperCase().includes('FC2') || /^\d{6,}$/.test(code)) {
        result = await fetchFC2(code)
    }

    if (!result) {
        // Default to DMM for others (most AV codes)
        result = await fetchDMM(code)
    }

    // Free memory after fetching product data
    if (typeof global.gc === 'function') {
        global.gc()
    }

    return result
})

function setupProcessListeners(process: any, id: string, event: Electron.IpcMainInvokeEvent) {
    let stderrBuffer: string[] = []
    let lastProgress = 0
    let hasReceivedData = false
    let totalDurationSeconds = 0  // Store total duration for ffmpeg progress calculation

    process.stdout.on('data', (data: Buffer) => {
        const line = data.toString()
        hasReceivedData = true
        console.log(`[DL ${id}] ${line}`)

        const progressMatch = line.match(/(\d+\.?\d*)%/)
        if (progressMatch) {
            const progress = parseFloat(progressMatch[1])
            lastProgress = progress
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
        const line = data.toString()
        hasReceivedData = true

        // ffmpeg progress output to stderr is normal, not an error
        // These lines contain progress info like "frame=", "fps=", "size=", "time=", etc.
        const isFfmpegProgress = line.includes('frame=') && line.includes('fps=')
        const isHlsInfo = line.includes('[hls @') && line.includes("Opening '")
        const isInfoMessage = line.includes('[info]') || line.includes('[download]')
        const isDurationInfo = line.includes('Duration:')
        const isStreamMapping = line.includes('Stream mapping:') || line.includes('Stream #') || line.includes('Output #') || line.includes('Input #')

        // Extract total duration from ffmpeg output (e.g., "Duration: 00:07:26.30")
        if (isDurationInfo) {
            const durationMatch = line.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d+)/)
            if (durationMatch) {
                const hours = parseInt(durationMatch[1])
                const minutes = parseInt(durationMatch[2])
                const seconds = parseInt(durationMatch[3])
                totalDurationSeconds = hours * 3600 + minutes * 60 + seconds
                console.log(`[DL ${id}] Total duration: ${totalDurationSeconds} seconds`)
            }
        }

        // Parse ffmpeg progress from time= field and calculate percentage
        if (isFfmpegProgress && totalDurationSeconds > 0) {
            const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d+)/)
            if (timeMatch) {
                const hours = parseInt(timeMatch[1])
                const minutes = parseInt(timeMatch[2])
                const seconds = parseInt(timeMatch[3])
                const currentSeconds = hours * 3600 + minutes * 60 + seconds
                const progress = Math.min(99, Math.round((currentSeconds / totalDurationSeconds) * 100))

                if (progress > lastProgress) {
                    lastProgress = progress
                    if (!event.sender.isDestroyed()) {
                        event.sender.send('download-progress', { id, progress, status: 'downloading' })
                    }
                }
            }
        }

        // Only log actual errors, not ffmpeg progress
        if (!isFfmpegProgress && !isHlsInfo && !isStreamMapping && !isDurationInfo) {
            console.error(`[DL ERR ${id}] ${line}`)
        }

        // Only store and send actual warnings/errors, not progress info
        if (!isFfmpegProgress && !isHlsInfo && !isInfoMessage && !isStreamMapping && !isDurationInfo) {
            stderrBuffer.push(line)

            // Send stderr updates to renderer for debugging (accumulate up to 10 lines)
            if (stderrBuffer.length > 10) {
                stderrBuffer.shift()
            }

            // Only send warning if it's an actual warning/error message
            const isWarning = line.toLowerCase().includes('warning') ||
                line.toLowerCase().includes('error') ||
                line.includes('ERROR:') ||
                line.includes('WARNING:')

            if (isWarning && !event.sender.isDestroyed()) {
                event.sender.send('download-warning', {
                    id,
                    warning: line.trim(),
                    fullLog: stderrBuffer.join('\n')
                })
            }
        }
    })

    process.on('error', (err: Error) => {
        console.error(`[DL SPAWN ERR ${id}] Failed to start process:`, err.message)
        if (!event.sender.isDestroyed()) {
            event.sender.send('download-error', {
                id,
                error: `プロセス起動失敗: ${err.message}`,
                details: 'yt-dlpがインストールされているか確認してください。\nインストール: pip install yt-dlp または https://github.com/yt-dlp/yt-dlp/releases'
            })
        }
        activeDownloads.delete(id)
    })

    process.on('close', (code: number) => {
        console.log(`Download process ${id} exited with code ${code}`)
        activeDownloads.delete(id)

        if (code !== 0 && code !== null) {
            const errorDetails = stderrBuffer.length > 0
                ? stderrBuffer.join('\n')
                : 'エラー詳細なし'

            if (!event.sender.isDestroyed()) {
                event.sender.send('download-error', {
                    id,
                    error: `終了コード: ${code}`,
                    details: errorDetails
                })
            }
        } else if (!hasReceivedData && lastProgress === 0) {
            // Process completed but never received any data
            if (!event.sender.isDestroyed()) {
                event.sender.send('download-error', {
                    id,
                    error: 'ダウンロードデータを受信できませんでした',
                    details: stderrBuffer.length > 0 ? stderrBuffer.join('\n') : 'yt-dlpの出力がありませんでした'
                })
            }
        }

        // Clear buffer and try to free memory
        stderrBuffer.length = 0
        if (typeof global.gc === 'function') {
            global.gc()
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
