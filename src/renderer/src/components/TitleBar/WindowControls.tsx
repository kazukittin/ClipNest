import { useState, useEffect } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'

export default function WindowControls(): JSX.Element | null {
    const [isMaximized, setIsMaximized] = useState(false)
    const [platform, setPlatform] = useState<string>('')

    useEffect(() => {
        // Only show custom controls on non-macOS platforms if frame is hidden
        // In this app, main process sets frame: false for Windows/Linux
        const checkMaximized = async () => {
            const maximized = await window.electron.isWindowMaximized()
            setIsMaximized(maximized)
        }

        checkMaximized()

        // Sync with window events
        window.addEventListener('resize', checkMaximized)
        return () => window.removeEventListener('resize', checkMaximized)
    }, [])

    const handleMinimize = () => {
        window.electron.minimizeWindow()
    }

    const handleMaximize = () => {
        window.electron.maximizeWindow()
        // Small delay to let the window state update
        setTimeout(async () => {
            const maximized = await window.electron.isWindowMaximized()
            setIsMaximized(maximized)
        }, 100)
    }

    const handleClose = () => {
        window.electron.closeWindow()
    }

    return (
        <div className="window-controls flex items-center h-full no-drag">
            <button
                onClick={handleMinimize}
                className="flex items-center justify-center w-12 h-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                title="最小化"
            >
                <Minus className="w-4 h-4" />
            </button>
            <button
                onClick={handleMaximize}
                className="flex items-center justify-center w-12 h-full text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                title={isMaximized ? '元に戻す' : '最大化'}
            >
                {isMaximized ? (
                    <Copy className="w-3.5 h-3.5 rotate-180" />
                ) : (
                    <Square className="w-3.5 h-3.5" />
                )}
            </button>
            <button
                onClick={handleClose}
                className="flex items-center justify-center w-12 h-full text-white/60 hover:text-white hover:bg-cn-error transition-colors"
                title="閉じる"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    )
}
