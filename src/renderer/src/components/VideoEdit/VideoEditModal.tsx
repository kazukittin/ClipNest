import { useState, useRef, useEffect } from 'react'
import { X, Save, Trash2, Tag, FileText, AlertTriangle, Search, Loader2, Globe, RefreshCw } from 'lucide-react'
import { Video } from '../../types/video'

interface VideoEditModalProps {
    video: Video
    onClose: () => void
    onSave: (newName: string, newTags: string[]) => void
    onDelete: () => void
}

export default function VideoEditModal({
    video,
    onClose,
    onSave,
    onDelete
}: VideoEditModalProps): JSX.Element {
    const [name, setName] = useState(video.name)
    const [tagsInput, setTagsInput] = useState(video.tags.join(', '))
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [productCode, setProductCode] = useState(video.productCode || '')
    const [isFetchingInfo, setIsFetchingInfo] = useState(false)
    const [isConverting, setIsConverting] = useState(false)
    const [conversionProgress, setConversionProgress] = useState(0)
    const [deleteAfterConvert, setDeleteAfterConvert] = useState(true)
    const nameInputRef = useRef<HTMLInputElement>(null)

    // Focus name input on mount
    useEffect(() => {
        nameInputRef.current?.focus()
        nameInputRef.current?.select()
    }, [])

    // Handle keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't handle shortcuts when typing in inputs (except for Escape)
            const isInputFocused = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '')

            if (e.key === 'Escape') {
                if (showDeleteConfirm) {
                    setShowDeleteConfirm(false)
                } else if (!isConverting) {
                    onClose()
                }
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !isInputFocused) {
                handleSave()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [name, tagsInput, showDeleteConfirm, onClose, isConverting])

    const handleSave = async () => {
        const trimmedName = name.trim()
        if (!trimmedName) return

        // Parse tags from comma-separated input
        const newTags = tagsInput
            .split(',')
            .map(t => t.trim().toLowerCase())
            .filter(t => t.length > 0)

        // Save product code if changed
        const trimmedProductCode = productCode.trim()
        if (trimmedProductCode !== (video.productCode || '')) {
            await window.electron.updateProductCode(video.path, trimmedProductCode)
        }

        onSave(trimmedName, newTags)
    }

    const handleDelete = async () => {
        setIsDeleting(true)
        onDelete()
    }

    const handleFetchInfo = async () => {
        if (!productCode.trim()) return

        setIsFetchingInfo(true)
        try {
            const data = await window.electron.fetchVideoProductData(productCode.trim())
            if (data) {
                // Update title if found
                if (data.title) setName(data.title)

                // Merge tags
                const existingTags = tagsInput.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
                const newTagsSet = new Set(existingTags)
                data.tags.forEach(t => newTagsSet.add(t.toLowerCase()))

                // Add maker/actress as tags too if available
                if (data.maker) newTagsSet.add(data.maker.toLowerCase())
                if (data.actress && data.actress.length > 0) {
                    data.actress.forEach(a => newTagsSet.add(a.toLowerCase()))
                }

                setTagsInput(Array.from(newTagsSet).join(', '))

                // Clear code input to indicate success? Or keep it? keeping it is fine.
            } else {
                alert('情報が見つかりませんでした')
            }
        } catch (error) {
            console.error('Fetch error:', error)
            alert('情報の取得中にエラーが発生しました')
        } finally {
            setIsFetchingInfo(false)
        }
    }

    const handleBackgroundClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget && !isConverting) {
            onClose()
        }
    }

    // Check if video can be converted (non-mp4)
    const canConvert = video.extension.toLowerCase() !== '.mp4'
    const supportedFormats = ['.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.mts']
    const isSupported = supportedFormats.includes(video.extension.toLowerCase())

    // Handle MP4 conversion
    const handleConvert = async () => {
        setIsConverting(true)
        setConversionProgress(0)

        // Listen for progress updates
        const removeListener = window.electron.onConversionProgress(({ filePath, progress, status, newPath, error }) => {
            if (filePath === video.path) {
                setConversionProgress(progress)
                if (status === 'completed') {
                    setIsConverting(false)
                    alert(`変換完了: ${newPath}`)
                    onClose()
                } else if (status === 'error') {
                    setIsConverting(false)
                    alert(`変換失敗: ${error}`)
                }
            }
        })

        try {
            const result = await window.electron.convertToMp4(video.path, deleteAfterConvert)
            if (!result.success && result.error) {
                alert(`変換失敗: ${result.error}`)
                setIsConverting(false)
            }
        } catch (error) {
            console.error('Conversion error:', error)
            alert('変換中にエラーが発生しました')
            setIsConverting(false)
        }

        return () => removeListener()
    }

    // Cancel conversion
    const handleCancelConversion = async () => {
        await window.electron.cancelConversion(video.path)
        setIsConverting(false)
        setConversionProgress(0)
    }

    return (
        <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={handleBackgroundClick}
        >
            <div
                className="w-full max-w-md bg-cn-surface border border-cn-border rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-cn-border">
                    <h2 className="text-lg font-semibold text-white">動画を編集</h2>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4">
                    {/* Product Code Input (Online Fetch) */}
                    <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-white/80 mb-2">
                            <Globe className="w-4 h-4" />
                            商品コードから自動入力
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={productCode}
                                onChange={(e) => setProductCode(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault()
                                        handleFetchInfo()
                                    }
                                }}
                                placeholder="FANZA, FC2などの品番 (例: abc-123)"
                                className="flex-1 px-4 py-2.5 bg-cn-dark border border-cn-border rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-cn-accent transition-colors"
                            />
                            <button
                                onClick={handleFetchInfo}
                                disabled={isFetchingInfo || !productCode.trim()}
                                className="px-3 bg-cn-accent/20 text-cn-accent border border-cn-accent/30 rounded-lg hover:bg-cn-accent/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isFetchingInfo ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                            </button>
                        </div>
                    </div>

                    <div className="h-px bg-white/10" />

                    {/* Name Input */}
                    <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-white/80 mb-2">
                            <FileText className="w-4 h-4" />
                            ファイル名
                        </label>
                        <input
                            ref={nameInputRef}
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            placeholder="動画の名前を入力..."
                            className="w-full px-4 py-2.5 bg-cn-dark border border-cn-border rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-cn-accent transition-colors"
                        />
                        <p className="text-[11px] text-white/40 mt-1.5">
                            拡張子: {video.extension}
                        </p>
                    </div>

                    {/* Tags Input */}
                    <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-white/80 mb-2">
                            <Tag className="w-4 h-4" />
                            タグ
                        </label>
                        <input
                            type="text"
                            value={tagsInput}
                            onChange={(e) => setTagsInput(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            placeholder="タグをカンマ区切りで入力..."
                            className="w-full px-4 py-2.5 bg-cn-dark border border-cn-border rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:border-cn-accent transition-colors"
                        />
                        <p className="text-[11px] text-white/40 mt-1.5">
                            例: アニメ, お気に入り, 2024
                        </p>
                    </div>

                    {/* Current Tags Preview */}
                    {tagsInput.trim() && (
                        <div className="flex flex-wrap gap-1.5">
                            {tagsInput.split(',').map((tag, i) => {
                                const trimmed = tag.trim()
                                if (!trimmed) return null
                                return (
                                    <span
                                        key={i}
                                        className="px-2 py-0.5 text-xs bg-cn-accent/20 text-cn-accent rounded-full border border-cn-accent/20"
                                    >
                                        {trimmed.toLowerCase()}
                                    </span>
                                )
                            })}
                        </div>
                    )}

                    {/* MP4 Conversion (only for non-mp4 files) */}
                    {canConvert && (
                        <>
                            <div className="h-px bg-white/10" />
                            <div>
                                <label className="flex items-center gap-2 text-sm font-medium text-white/80 mb-2">
                                    <RefreshCw className="w-4 h-4" />
                                    MP4に変換
                                </label>
                                {isSupported ? (
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                id="deleteAfterConvert"
                                                checked={deleteAfterConvert}
                                                onChange={(e) => setDeleteAfterConvert(e.target.checked)}
                                                className="w-4 h-4 rounded bg-cn-dark border-cn-border text-cn-accent focus:ring-cn-accent"
                                            />
                                            <label htmlFor="deleteAfterConvert" className="text-sm text-white/70">
                                                変換後に元ファイルを削除
                                            </label>
                                        </div>
                                        {isConverting ? (
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between text-sm">
                                                    <span className="text-white/70">変換中...</span>
                                                    <span className="text-cn-accent">{conversionProgress}%</span>
                                                </div>
                                                <div className="w-full h-2 bg-cn-dark rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-gradient-to-r from-cn-accent to-purple-500 transition-all duration-300"
                                                        style={{ width: `${conversionProgress}%` }}
                                                    />
                                                </div>
                                                <button
                                                    onClick={handleCancelConversion}
                                                    className="text-sm text-cn-error hover:underline"
                                                >
                                                    キャンセル
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={handleConvert}
                                                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
                                            >
                                                <RefreshCw className="w-4 h-4" />
                                                {video.extension.toUpperCase().slice(1)} → MP4 に変換
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-sm text-white/50">
                                        この形式 ({video.extension}) は変換に対応していません
                                    </p>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Delete Confirmation */}
                {showDeleteConfirm && (
                    <div className="mx-4 mb-4 p-4 bg-cn-error/10 border border-cn-error/30 rounded-lg">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-cn-error flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <p className="text-sm font-medium text-cn-error mb-1">
                                    本当に削除しますか？
                                </p>
                                <p className="text-xs text-white/60 mb-3">
                                    この操作は取り消せません。ファイルはゴミ箱に移動されます。
                                </p>
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleDelete}
                                        disabled={isDeleting}
                                        className="px-3 py-1.5 bg-cn-error text-white text-sm font-medium rounded-lg hover:bg-cn-error/80 disabled:opacity-50 transition-colors"
                                    >
                                        {isDeleting ? '削除中...' : '削除する'}
                                    </button>
                                    <button
                                        onClick={() => setShowDeleteConfirm(false)}
                                        className="px-3 py-1.5 bg-white/10 text-white text-sm rounded-lg hover:bg-white/20 transition-colors"
                                    >
                                        キャンセル
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between p-4 border-t border-cn-border bg-cn-dark/50">
                    {/* Delete Button */}
                    <button
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={isConverting}
                        className="flex items-center gap-2 px-3 py-2 text-cn-error hover:bg-cn-error/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Trash2 className="w-4 h-4" />
                        <span className="text-sm">削除</span>
                    </button>

                    {/* Save Button */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                        >
                            キャンセル
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!name.trim() || isConverting}
                            className="flex items-center gap-2 px-4 py-2 bg-cn-accent text-white text-sm font-medium rounded-lg hover:bg-cn-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <Save className="w-4 h-4" />
                            保存
                        </button>
                    </div>
                </div>

                {/* Keyboard shortcut hint */}
                <div className="px-4 pb-3 text-center">
                    <p className="text-[10px] text-white/30">
                        Ctrl+Enter で保存 | Esc で閉じる
                    </p>
                </div>
            </div>
        </div>
    )
}
