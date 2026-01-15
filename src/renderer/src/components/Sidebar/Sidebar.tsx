import { useState } from 'react'
import {
    FolderOpen,
    FolderPlus,
    Tag,
    Heart,
    Search,
    ChevronDown,
    ChevronRight,
    Home,
    Film,
    Download,
    Trash2
} from 'lucide-react'
import { WatchedFolder } from '../../types/video'

interface SidebarProps {
    watchedFolders: WatchedFolder[]
    tags: string[]
    selectedFolder: string | null
    selectedTag: string | null
    showFavorites: boolean
    currentView: 'library' | 'downloader'
    onViewChange: (view: 'library' | 'downloader') => void
    onFolderSelect: (folder: string | null) => void
    onTagSelect: (tag: string | null) => void
    onFavoritesToggle: () => void
    onImportFolder: () => void
    searchQuery: string
    onSearchChange: (query: string) => void
    onClearCache: () => void
}

export default function Sidebar({
    watchedFolders,
    tags,
    selectedFolder,
    selectedTag,
    showFavorites,
    currentView,
    onViewChange,
    onFolderSelect,
    onTagSelect,
    onFavoritesToggle,
    onImportFolder,
    searchQuery,
    onSearchChange,
    onClearCache
}: SidebarProps): JSX.Element {
    const [foldersExpanded, setFoldersExpanded] = useState(true)
    const [tagsExpanded, setTagsExpanded] = useState(true)

    return (
        <aside className="w-64 h-full bg-cn-surface border-r border-cn-border flex flex-col shrink-0">
            {/* Logo/Header */}
            <div className="p-4 border-b border-cn-border">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cn-accent to-purple-500 flex items-center justify-center">
                        <Film className="w-4 h-4 text-white" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-cn-text">ClipNest</h1>
                        <p className="text-[10px] text-cn-text-muted leading-none">動画マネージャー</p>
                    </div>
                </div>
            </div>

            {/* Search */}
            <div className="p-3 border-b border-cn-border">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cn-text-muted" />
                    <input
                        type="text"
                        placeholder="動画を検索..."
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="input pl-9 py-2 text-sm"
                    />
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
                {/* All Videos */}
                <button
                    onClick={() => {
                        onViewChange('library')
                        onFolderSelect(null)
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${currentView === 'library' && !selectedFolder && !selectedTag && !showFavorites
                        ? 'bg-cn-accent text-white shadow-lg shadow-cn-accent/20'
                        : 'hover:bg-cn-surface-hover text-cn-text'
                        }`}
                >
                    <Home className="w-4 h-4" />
                    <span className="text-sm font-medium">すべての動画</span>
                </button>

                {/* Favorites */}
                <button
                    onClick={onFavoritesToggle}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${showFavorites
                        ? 'bg-cn-accent text-white shadow-lg shadow-cn-accent/20'
                        : 'hover:bg-cn-surface-hover text-cn-text'
                        }`}
                >
                    <Heart className={`w-4 h-4 ${showFavorites ? 'fill-current' : ''}`} />
                    <span className="text-sm font-medium">お気に入り</span>
                </button>

                {/* StreamVault (Downloader) */}
                <button
                    onClick={() => onViewChange(currentView === 'downloader' ? 'library' : 'downloader')}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${currentView === 'downloader'
                        ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/20'
                        : 'hover:bg-cn-surface-hover text-cn-text'
                        }`}
                >
                    <Download className="w-4 h-4" />
                    <span className="text-sm font-medium">StreamVault</span>
                </button>

                {/* Folders Section */}
                <div className="pt-4">
                    <button
                        onClick={() => setFoldersExpanded(!foldersExpanded)}
                        className="w-full flex items-center justify-between px-3 py-2 text-cn-text-muted hover:text-cn-text transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            {foldersExpanded ? (
                                <ChevronDown className="w-4 h-4" />
                            ) : (
                                <ChevronRight className="w-4 h-4" />
                            )}
                            <FolderOpen className="w-4 h-4" />
                            <span className="text-xs font-semibold uppercase tracking-wider">フォルダ</span>
                        </div>
                        <span className="text-xs text-cn-text-muted">{watchedFolders.length}</span>
                    </button>

                    {foldersExpanded && (
                        <div className="mt-1 space-y-0.5 animate-fade-in">
                            {/* Import Folder Button */}
                            <button
                                onClick={onImportFolder}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-200
                  border border-dashed border-cn-border hover:border-cn-accent hover:bg-cn-accent/10 
                  text-cn-text-muted hover:text-cn-accent group"
                            >
                                <FolderPlus className="w-4 h-4 group-hover:scale-110 transition-transform" />
                                <span>フォルダを追加</span>
                            </button>

                            {/* Folder List */}
                            {watchedFolders.map((folder) => (
                                <button
                                    key={folder.path}
                                    onClick={() => onFolderSelect(folder.path)}
                                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all duration-200 ${selectedFolder === folder.path
                                        ? 'bg-cn-accent/20 text-cn-accent'
                                        : 'hover:bg-cn-surface-hover text-cn-text'
                                        }`}
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <FolderOpen className="w-4 h-4 flex-shrink-0" />
                                        <span className="truncate">{folder.name}</span>
                                    </div>
                                    <span className="text-xs text-cn-text-muted flex-shrink-0 ml-2">
                                        {folder.videoCount}
                                    </span>
                                </button>
                            ))}

                            {watchedFolders.length === 0 && (
                                <p className="px-3 py-2 text-xs text-cn-text-muted italic text-center">
                                    フォルダがありません
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* Tags Section */}
                <div className="pt-4">
                    <button
                        onClick={() => setTagsExpanded(!tagsExpanded)}
                        className="w-full flex items-center justify-between px-3 py-2 text-cn-text-muted hover:text-cn-text transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            {tagsExpanded ? (
                                <ChevronDown className="w-4 h-4" />
                            ) : (
                                <ChevronRight className="w-4 h-4" />
                            )}
                            <Tag className="w-4 h-4" />
                            <span className="text-xs font-semibold uppercase tracking-wider">タグ</span>
                        </div>
                        <span className="text-xs text-cn-text-muted">{tags.length}</span>
                    </button>

                    {tagsExpanded && (
                        <div className="mt-1 space-y-0.5 animate-fade-in">
                            {tags.length === 0 ? (
                                <p className="px-3 py-2 text-xs text-cn-text-muted italic text-center">
                                    タグがありません
                                </p>
                            ) : (
                                tags.map((tag) => (
                                    <button
                                        key={tag}
                                        onClick={() => onTagSelect(tag)}
                                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${selectedTag === tag
                                            ? 'bg-cn-accent/20 text-cn-accent'
                                            : 'hover:bg-cn-surface-hover text-cn-text'
                                            }`}
                                    >
                                        <span className="w-2 h-2 rounded-full bg-cn-accent flex-shrink-0" />
                                        <span className="truncate">{tag}</span>
                                    </button>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </nav>

            {/* Footer */}
            <div className="p-3 border-t border-cn-border space-y-2">
                <button
                    onClick={onClearCache}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs text-cn-text-muted hover:text-cn-error hover:bg-cn-error/10 transition-colors"
                    title="キャッシュをクリアして再読み込み"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>キャッシュを削除</span>
                </button>
                <p className="text-[10px] text-cn-text-muted text-center pt-1">
                    ClipNest v1.0.0
                </p>
            </div>
        </aside>
    )
}
