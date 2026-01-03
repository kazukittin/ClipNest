import WindowControls from './WindowControls'

export default function TitleBar(): JSX.Element {
    return (
        <div className="h-8 bg-cn-dark flex items-center justify-between drag select-none">
            {/* Left side space for macOS traffic lights if needed, or app title */}
            <div className="flex items-center px-4 gap-2">
                <span className="text-[10px] font-bold text-cn-accent/50 uppercase tracking-widest pt-0.5">
                    ClipNest
                </span>
            </div>

            {/* Right side window controls (Windows/Linux) */}
            <WindowControls />
        </div>
    )
}
