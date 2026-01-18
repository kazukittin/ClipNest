
import React, { useState, useEffect } from 'react'
import {
    Download,
    Plus,
    Trash2,
    Settings,
    Play,
    Pause,
    CheckCircle,
    XCircle,
    Clock,
    Link as LinkIcon,
    Folder,
    AlertTriangle,
    ChevronDown,
    ChevronUp
} from 'lucide-react'

// Types for our download tasks
interface DownloadTask {
    id: string
    url: string
    title?: string
    status: 'queued' | 'downloading' | 'completed' | 'error' | 'cancelled'
    progress: number
    speed?: string
    eta?: string
    error?: string
    errorDetails?: string
    warnings?: string[]
    path?: string
    timestamp: number
}

// Storage keys
const STORAGE_KEY_QUEUE = 'streamvault_queue'
const STORAGE_KEY_HISTORY = 'streamvault_history'

// Helper functions to load/save queue and history
const loadFromStorage = <T,>(key: string, defaultValue: T): T => {
    try {
        const saved = localStorage.getItem(key)
        if (saved) {
            return JSON.parse(saved) as T
        }
    } catch (e) {
        console.error(`Failed to load ${key} from localStorage:`, e)
    }
    return defaultValue
}

const saveToStorage = <T,>(key: string, value: T): void => {
    try {
        localStorage.setItem(key, JSON.stringify(value))
    } catch (e) {
        console.error(`Failed to save ${key} to localStorage:`, e)
    }
}

export default function StreamVault(): JSX.Element {
    const [url, setUrl] = useState('')
    // Initialize queue from localStorage, resetting any 'downloading' status to 'queued'
    const [queue, setQueue] = useState<DownloadTask[]>(() => {
        const saved = loadFromStorage<DownloadTask[]>(STORAGE_KEY_QUEUE, [])
        // Reset any downloading tasks to queued since we're reloading the page
        return saved.map(task => ({
            ...task,
            status: task.status === 'downloading' ? 'queued' : task.status
        }))
    })
    const [history, setHistory] = useState<DownloadTask[]>(() =>
        loadFromStorage<DownloadTask[]>(STORAGE_KEY_HISTORY, [])
    )
    const [activeTab, setActiveTab] = useState<'queue' | 'history'>('queue')
    const [isDownloading, setIsDownloading] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [downloadPath, setDownloadPath] = useState<string>('')
    const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())

    // Save queue to localStorage whenever it changes
    useEffect(() => {
        saveToStorage(STORAGE_KEY_QUEUE, queue)
    }, [queue])

    // Save history to localStorage whenever it changes
    useEffect(() => {
        saveToStorage(STORAGE_KEY_HISTORY, history)
    }, [history])

    // Load download path on mount
    useEffect(() => {
        window.electron.getDownloadPath().then(path => {
            setDownloadPath(path)
        })
    }, [])

    // Handle folder selection
    const handleSelectDownloadFolder = async () => {
        const selectedPath = await window.electron.selectDownloadFolder()
        if (selectedPath) {
            setDownloadPath(selectedPath)
        }
    }

    // Helper to generate IDs
    const generateId = () => Math.random().toString(36).substr(2, 9)

    // Add to queue
    const handleAddToQueue = () => {
        if (!url.trim()) return

        // Simple validation
        if (!url.startsWith('http')) {
            alert('有効なURLを入力してください')
            return
        }

        const newTask: DownloadTask = {
            id: generateId(),
            url: url.trim(),
            status: 'queued',
            progress: 0,
            timestamp: Date.now()
        }

        setQueue(prev => [...prev, newTask])
        setUrl('')
    }

    // Remove from queue
    const handleRemoveFromQueue = (taskId: string) => {
        setQueue(prev => prev.filter(t => t.id !== taskId))
    }

    // Clear history
    const handleClearHistory = () => {
        setHistory([])
    }

    // Start download for the next queued item
    const startNextDownload = async () => {
        // Find first queued task
        const taskToProcess = queue.find(t => t.status === 'queued')
        if (!taskToProcess) return

        setIsDownloading(true)
        const taskId = taskToProcess.id

        setQueue(prev => prev.map(t =>
            t.id === taskId ? { ...t, status: 'downloading' } : t
        ))

        try {
            await window.electron.downloadVideo(taskToProcess.url, taskId)
        } catch (error) {
            console.error('Download failed to start', error)
            setQueue(prev => prev.map(t =>
                t.id === taskId ? { ...t, status: 'error', error: '開始に失敗しました' } : t
            ))
            setIsDownloading(false)
        }
    }

    // Start download (Real implementation)
    const handleStartDownload = async () => {
        if (queue.length === 0) return
        if (isDownloading) return

        startNextDownload()
    }

    // Auto-start next download when queue has items and not currently downloading
    // This effect watches for queue changes and automatically starts the next download
    useEffect(() => {
        // Check if we have queued items and not currently downloading
        const hasQueuedItems = queue.some(t => t.status === 'queued')
        const hasDownloadingItem = queue.some(t => t.status === 'downloading')

        if (hasQueuedItems && !isDownloading && !hasDownloadingItem) {
            // Small delay to allow state to settle and for memory cleanup
            const timer = setTimeout(() => {
                startNextDownload()
            }, 1000)

            return () => clearTimeout(timer)
        }
    }, [queue, isDownloading])

    // Listen to download events
    useEffect(() => {
        const removeProgressListener = window.electron.onDownloadProgress(({ id, progress, status }) => {
            if (status === 'completed') {
                // Move from queue to history
                setQueue(prev => {
                    const task = prev.find(t => t.id === id)
                    if (task) {
                        setHistory(h => [{ ...task, status: 'completed', progress: 100, timestamp: Date.now() }, ...h])
                    }
                    return prev.filter(t => t.id !== id)
                })
                setIsDownloading(false)
                // Note: Next download will be triggered automatically by the useEffect watching queue/isDownloading
            } else {
                // Update progress
                setQueue(prev => prev.map(t =>
                    t.id === id ? { ...t, progress, status: 'downloading' as const } : t
                ))
            }
        })

        const removeErrorListener = window.electron.onDownloadError(({ id, error, details }) => {
            setQueue(prev => prev.map(t =>
                t.id === id ? { ...t, status: 'error', error, errorDetails: details } : t
            ))
            setIsDownloading(false)
            // Note: Next download will be triggered automatically by the useEffect watching queue/isDownloading
        })

        const removeWarningListener = window.electron.onDownloadWarning(({ id, warning }) => {
            setQueue(prev => prev.map(t => {
                if (t.id === id) {
                    const warnings = t.warnings || []
                    // Keep only last 5 warnings
                    const newWarnings = [...warnings, warning].slice(-5)
                    return { ...t, warnings: newWarnings }
                }
                return t
            }))
        })

        return () => {
            removeProgressListener()
            removeErrorListener()
            removeWarningListener()
        }
    }, [])


    return (
        <div className="flex flex-col h-full bg-cn-dark text-cn-text">
            {/* Header */}
            <div className="p-6 border-b border-cn-border">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                        <Download className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-white">StreamVault</h2>
                        <p className="text-cn-text-muted text-sm">動画ダウンローダー</p>
                    </div>
                </div>
            </div>

            {/* Input Area */}
            <div className="p-6 pb-2 space-y-4">
                <div className="flex gap-3">
                    <div className="relative flex-1">
                        <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cn-text-muted" />
                        <input
                            type="text"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddToQueue()}
                            placeholder="動画のURLを貼り付け..."
                            className="w-full bg-cn-surface border border-cn-border rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-cn-accent focus:ring-1 focus:ring-cn-accent transition-all placeholder:text-cn-text-muted/50"
                        />
                    </div>
                    <button
                        onClick={handleAddToQueue}
                        className="bg-cn-accent hover:bg-cn-accent-hover text-white px-5 py-2 rounded-xl flex items-center gap-2 font-medium transition-colors shadow-lg shadow-cn-accent/20"
                    >
                        <Plus className="w-5 h-5" />
                        <span>追加</span>
                    </button>
                    <button
                        onClick={handleStartDownload}
                        disabled={isDownloading || queue.length === 0}
                        className={`px-5 py-2 rounded-xl flex items-center gap-2 font-medium transition-colors ${isDownloading || queue.length === 0
                            ? 'bg-cn-surface text-cn-text-muted cursor-not-allowed'
                            : 'bg-cn-success text-white hover:bg-green-600 shadow-lg shadow-green-500/20'
                            }`}
                    >
                        {isDownloading ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                        <span>{isDownloading ? 'DL中...' : '開始'}</span>
                    </button>
                    <button
                        onClick={() => setSettingsOpen(!settingsOpen)}
                        className={`p-3 rounded-xl border border-cn-border transition-colors ${settingsOpen ? 'bg-cn-surface text-cn-accent border-cn-accent' : 'hover:bg-cn-surface text-cn-text-muted'
                            }`}
                    >
                        <Settings className="w-5 h-5" />
                    </button>
                </div>

                {/* Settings Panel */}
                {settingsOpen && (
                    <div className="bg-cn-surface rounded-xl p-4 border border-cn-border animate-slide-up">
                        <div className="flex items-center gap-4">
                            <span className="text-sm font-medium text-cn-text-muted">保存先:</span>
                            <div className="flex-1 flex gap-2">
                                <input
                                    type="text"
                                    readOnly
                                    value={downloadPath}
                                    title={downloadPath}
                                    className="flex-1 bg-cn-dark border border-cn-border rounded-lg px-3 py-1.5 text-xs text-cn-text-muted truncate"
                                />
                                <button
                                    onClick={handleSelectDownloadFolder}
                                    className="p-1.5 hover:bg-cn-surface-hover rounded-lg text-cn-text-muted transition-colors hover:text-cn-accent"
                                    title="保存先を変更"
                                >
                                    <Folder className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div className="px-6 mt-4">
                <div className="flex gap-6 border-b border-cn-border">
                    <button
                        onClick={() => setActiveTab('queue')}
                        className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === 'queue' ? 'text-cn-accent' : 'text-cn-text-muted hover:text-cn-text'
                            }`}
                    >
                        キュー ({queue.length})
                        {activeTab === 'queue' && (
                            <span className="absolute bottom-0 left-0 w-full h-0.5 bg-cn-accent rounded-t-full" />
                        )}
                    </button>
                    <button
                        onClick={() => setActiveTab('history')}
                        className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === 'history' ? 'text-cn-accent' : 'text-cn-text-muted hover:text-cn-text'
                            }`}
                    >
                        履歴 ({history.length})
                        {activeTab === 'history' && (
                            <span className="absolute bottom-0 left-0 w-full h-0.5 bg-cn-accent rounded-t-full" />
                        )}
                    </button>
                </div>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto p-6">
                {activeTab === 'queue' ? (
                    <div className="space-y-3">
                        {queue.length === 0 ? (
                            <div className="text-center py-20 text-cn-text-muted">
                                <Download className="w-12 h-12 mx-auto mb-3 opacity-20" />
                                <p>ダウンロードキューは空です</p>
                            </div>
                        ) : (
                            queue.map(task => {
                                const isExpanded = expandedTasks.has(task.id)
                                const toggleExpand = () => {
                                    setExpandedTasks(prev => {
                                        const next = new Set(prev)
                                        if (next.has(task.id)) {
                                            next.delete(task.id)
                                        } else {
                                            next.add(task.id)
                                        }
                                        return next
                                    })
                                }
                                const hasDetails = task.error || task.errorDetails || (task.warnings && task.warnings.length > 0)

                                return (
                                    <div key={task.id} className={`bg-cn-surface border rounded-xl p-4 flex flex-col gap-3 group transition-colors ${task.status === 'error' ? 'border-red-500/50' : 'border-cn-border hover:border-cn-border/80'
                                        }`}>
                                        <div className="flex justify-between items-start">
                                            <div className="flex-1 min-w-0">
                                                <h4 className="font-medium truncate pr-4" title={task.url}>
                                                    {task.title || task.url}
                                                </h4>
                                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                    <span className={`text-xs px-2 py-0.5 rounded-full ${task.status === 'downloading'
                                                        ? 'bg-blue-500/20 text-blue-400'
                                                        : task.status === 'error'
                                                            ? 'bg-red-500/20 text-red-400'
                                                            : 'bg-cn-border text-cn-text-muted'
                                                        }`}>
                                                        {task.status === 'downloading' ? 'ダウンロード中'
                                                            : task.status === 'error' ? 'エラー'
                                                                : '待機中'}
                                                    </span>
                                                    {task.speed && <span className="text-xs text-cn-text-muted">{task.speed}</span>}
                                                    {task.warnings && task.warnings.length > 0 && (
                                                        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center gap-1">
                                                            <AlertTriangle className="w-3 h-3" />
                                                            警告 {task.warnings.length}件
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {hasDetails && (
                                                    <button
                                                        onClick={toggleExpand}
                                                        className="text-cn-text-muted hover:text-cn-accent transition-colors p-1"
                                                        title="詳細を表示"
                                                    >
                                                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleRemoveFromQueue(task.id)}
                                                    className="text-cn-text-muted hover:text-cn-error transition-colors p-1 opacity-0 group-hover:opacity-100"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Error display */}
                                        {task.status === 'error' && task.error && (
                                            <div className="flex items-start gap-2 text-red-400 text-sm bg-red-500/10 rounded-lg p-2">
                                                <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                                <span>{task.error}</span>
                                            </div>
                                        )}

                                        {/* Expanded details */}
                                        {isExpanded && (
                                            <div className="space-y-2">
                                                {task.errorDetails && (
                                                    <div className="bg-cn-dark rounded-lg p-3">
                                                        <div className="text-xs text-cn-text-muted mb-1">エラー詳細:</div>
                                                        <pre className="text-xs text-red-300 whitespace-pre-wrap break-all font-mono max-h-40 overflow-y-auto">
                                                            {task.errorDetails}
                                                        </pre>
                                                    </div>
                                                )}
                                                {task.warnings && task.warnings.length > 0 && (
                                                    <div className="bg-cn-dark rounded-lg p-3">
                                                        <div className="text-xs text-cn-text-muted mb-1">警告ログ (最新5件):</div>
                                                        <pre className="text-xs text-yellow-300 whitespace-pre-wrap break-all font-mono max-h-32 overflow-y-auto">
                                                            {task.warnings.join('\n')}
                                                        </pre>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Progress Bar */}
                                        <div className={`w-full h-1.5 bg-cn-dark rounded-full overflow-hidden ${task.status === 'error' ? 'opacity-50' : ''}`}>
                                            <div
                                                className={`h-full transition-all duration-300 ease-out ${task.status === 'error'
                                                    ? 'bg-red-500'
                                                    : 'bg-gradient-to-r from-cn-accent to-purple-500'
                                                    }`}
                                                style={{ width: `${task.progress}%` }}
                                            />
                                        </div>
                                        <div className="flex justify-between text-xs text-cn-text-muted">
                                            <span>{Math.round(task.progress)}%</span>
                                            {task.eta && <span>残り {task.eta}</span>}
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {history.length > 0 && (
                            <div className="flex justify-end mb-2">
                                <button
                                    onClick={handleClearHistory}
                                    className="text-xs text-cn-text-muted hover:text-cn-error flex items-center gap-1 transition-colors"
                                >
                                    <Trash2 className="w-3 h-3" />
                                    履歴をクリア
                                </button>
                            </div>
                        )}
                        {history.length === 0 ? (
                            <div className="text-center py-20 text-cn-text-muted">
                                <Clock className="w-12 h-12 mx-auto mb-3 opacity-20" />
                                <p>履歴はありません</p>
                            </div>
                        ) : (
                            history.map(task => (
                                <div key={task.id} className="bg-cn-surface/50 border border-cn-border rounded-xl p-4 flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-lg bg-cn-success/10 flex items-center justify-center flex-shrink-0">
                                        <CheckCircle className="w-5 h-5 text-cn-success" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-medium truncate text-cn-text/80">
                                            {task.title || task.url}
                                        </h4>
                                        <p className="text-xs text-cn-text-muted mt-0.5">
                                            {new Date(task.timestamp).toLocaleString()}
                                        </p>
                                    </div>
                                    <button className="text-xs bg-cn-dark hover:bg-cn-border px-3 py-1.5 rounded-lg border border-cn-border transition-colors">
                                        開く
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
