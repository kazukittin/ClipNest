import { useState, useRef, useEffect } from 'react'
import { X, Save, Trash2, Tag, FileText, AlertTriangle } from 'lucide-react'
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
    const nameInputRef = useRef<HTMLInputElement>(null)

    // Focus name input on mount
    useEffect(() => {
        nameInputRef.current?.focus()
        nameInputRef.current?.select()
    }, [])

    // Handle keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (showDeleteConfirm) {
                    setShowDeleteConfirm(false)
                } else {
                    onClose()
                }
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                handleSave()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [name, tagsInput, showDeleteConfirm, onClose])

    const handleSave = () => {
        const trimmedName = name.trim()
        if (!trimmedName) return

        // Parse tags from comma-separated input
        const newTags = tagsInput
            .split(',')
            .map(t => t.trim().toLowerCase())
            .filter(t => t.length > 0)

        onSave(trimmedName, newTags)
    }

    const handleDelete = async () => {
        setIsDeleting(true)
        onDelete()
    }

    const handleBackgroundClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose()
        }
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
                        className="flex items-center gap-2 px-3 py-2 text-cn-error hover:bg-cn-error/10 rounded-lg transition-colors"
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
                            disabled={!name.trim()}
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
