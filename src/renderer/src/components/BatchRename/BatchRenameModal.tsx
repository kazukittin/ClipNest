import { useState, useMemo } from 'react'
import { X, FileText, ArrowRight, AlertCircle, CheckCircle, Loader2 } from 'lucide-react'
import { Video } from '../../types/video'

interface BatchRenameModalProps {
    videos: Video[]
    onClose: () => void
    onComplete: (renamedPaths: { oldPath: string, newPath: string }[]) => void
}

export default function BatchRenameModal({ videos, onClose, onComplete }: BatchRenameModalProps): JSX.Element {
    const [isProcessing, setIsProcessing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)
    const [successMessage, setSuccessMessage] = useState('')

    // Preview the new names (fixed: 001, 002, 003...)
    const previewNames = useMemo(() => {
        return videos.map((video, index) => {
            const num = (index + 1).toString().padStart(3, '0')
            const newName = `${num}${video.extension}`
            return {
                oldName: `${video.name}${video.extension}`,
                newName,
                video,
                isSame: video.name === num
            }
        })
    }, [videos])

    const handleRename = async () => {
        setIsProcessing(true)
        setError(null)

        try {
            const videoPaths = videos.map(v => v.path)
            const result = await window.electron.batchRenameVideos(videoPaths)

            if (result.success) {
                setSuccess(true)
                const renamedCount = result.results.length - result.skipped
                const endNumber = result.startNumber + videos.length - 1
                const startStr = result.startNumber.toString().padStart(3, '0')
                const endStr = endNumber.toString().padStart(3, '0')
                if (result.skipped > 0) {
                    setSuccessMessage(`${renamedCount}件をリネーム（${startStr}〜${endStr}、${result.skipped}件スキップ）`)
                } else {
                    setSuccessMessage(`${renamedCount}件をリネーム（${startStr}〜${endStr}）`)
                }
                setTimeout(() => {
                    onComplete(result.results)
                    onClose()
                }, 1500)
            } else {
                setError(result.errors.join('\n'))
            }
        } catch (err) {
            setError('一括リネームに失敗しました')
        } finally {
            setIsProcessing(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative w-full max-w-2xl max-h-[80vh] bg-cn-surface rounded-2xl shadow-2xl flex flex-col animate-fade-in">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-cn-border">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                            <FileText className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">一括連番リネーム</h2>
                            <p className="text-sm text-cn-text-muted">{videos.length}個のファイルを選択中 → 001〜{videos.length.toString().padStart(3, '0')}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-cn-surface-hover rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5 text-cn-text-muted" />
                    </button>
                </div>

                {/* Preview */}
                <div className="flex-1 overflow-auto p-6">
                    <h3 className="text-sm font-medium text-cn-text-muted mb-3">プレビュー（3桁0埋め連番）</h3>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                        {previewNames.map((item, index) => (
                            <div
                                key={item.video.id}
                                className={`flex items-center gap-3 p-3 rounded-lg text-sm ${item.isSame ? 'bg-cn-surface border border-cn-border opacity-60' : 'bg-cn-dark'}`}
                            >
                                <span className="text-cn-text-muted w-8">{index + 1}.</span>
                                <span className="text-cn-text truncate flex-1" title={item.oldName}>
                                    {item.oldName}
                                </span>
                                <ArrowRight className="w-4 h-4 text-cn-text-muted flex-shrink-0" />
                                <span className={`font-medium truncate flex-1 ${item.isSame ? 'text-cn-text-muted' : 'text-cn-accent'}`} title={item.newName}>
                                    {item.isSame ? '(変更なし)' : item.newName}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Error/Success Message */}
                {error && (
                    <div className="mx-6 mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3 max-h-32 overflow-y-auto">
                        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                        <span className="text-red-400 text-sm whitespace-pre-wrap">{error}</span>
                    </div>
                )}

                {success && (
                    <div className="mx-6 mb-4 p-4 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center gap-3">
                        <CheckCircle className="w-5 h-5 text-green-400" />
                        <span className="text-green-400 text-sm">{successMessage}</span>
                    </div>
                )}

                {/* Footer */}
                <div className="flex justify-end gap-3 p-6 border-t border-cn-border">
                    <button
                        onClick={onClose}
                        disabled={isProcessing}
                        className="px-5 py-2.5 rounded-lg text-cn-text-muted hover:bg-cn-surface-hover transition-colors"
                    >
                        キャンセル
                    </button>
                    <button
                        onClick={handleRename}
                        disabled={isProcessing || videos.length === 0}
                        className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                処理中...
                            </>
                        ) : (
                            <>
                                <FileText className="w-4 h-4" />
                                リネーム実行
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}
