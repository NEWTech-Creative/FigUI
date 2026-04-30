import { Sun, Moon, Wifi, WifiOff, Settings, Maximize, Minimize, HelpCircle } from 'lucide-react'
import fluidncLogo from '../assets/fluidnc-logo.svg'
import { useMachineStore, stateColor, stateBg } from '../store'
import { sendRealtime, sendRaw } from '../lib/ws'
import { useState, useEffect } from 'react'

interface Props {
  onSettingsClick: () => void
  onAboutClick: () => void
  isTablet?: boolean
}

export function Header({ onSettingsClick, onAboutClick, isTablet }: Props) {
  const connected = useMachineStore(s => s.connected)
  const status = useMachineStore(s => s.status)
  const theme = useMachineStore(s => s.theme)
  const toggleTheme = useMachineStore(s => s.toggleTheme)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }

  function handleSoftReset() {
    if (confirm('Send soft reset (Ctrl+X)?')) sendRealtime(0x18)
  }

  return (
    <header className="h-12 bg-surface border-b border-border flex items-center px-3 xl:px-4 gap-2 xl:gap-4 shrink-0 overflow-x-auto">
      <div className="flex items-center gap-2 shrink-0">
        <img src={fluidncLogo} alt="FluidNC" className="h-8 w-auto shrink-0" style={theme !== 'light' ? { filter: 'invert(1) hue-rotate(180deg)' } : undefined} />
      </div>

      <div className="h-5 w-px bg-border" />

      {status.state === 'Alarm' ? (
        <button
          className={`tag ${stateBg(status.state)} ${stateColor(status.state)} cursor-pointer hover:opacity-80 active:opacity-60 text-base`}
          onClick={() => sendRaw('$X')}
          title="Click to clear alarm ($X)"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current text-base" />
          {status.state}
        </button>
      ) : (
        <div className={`tag ${stateBg(status.state)} ${stateColor(status.state)} text-base`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            status.state === 'Run' || status.state === 'Jog' ? 'bg-current animate-pulse' : 'bg-current'
          }`} />
          {status.state}
        </div>
      )}

      {status.sdFilename && status.sdPercent !== undefined && (
        <div className="hidden lg:flex items-center gap-2 text-sm text-text-muted">
          <div className="w-24 h-1 bg-elevated rounded-full overflow-hidden">
            <div
              className="h-full bg-info transition-all"
              style={{ width: `${status.sdPercent}%` }}
            />
          </div>
          <span className="font-mono">{status.sdPercent}%</span>
          <span className="text-text-dim truncate max-w-32">{status.sdFilename}</span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-1">
        {connected ? (
          <div className={`flex items-center gap-1 text-base text-ok mr-2`}>
            <Wifi size={isTablet ? 18 : 14} />
            <span className="hidden sm:inline">Connected</span>
          </div>
        ) : (
          <div className={`flex items-center gap-1 ${isTablet ? 'text-base' : 'text-sm'} text-text-muted mr-2`}>
            <WifiOff size={isTablet ? 18 : 14} />
          </div>
        )}

        <button
          className={`btn-ghost ${isTablet ? 'px-3 py-2' : 'px-2 py-1.5'} text-base`}
          onClick={handleSoftReset}
          title="Soft Reset"
        >
          RST
        </button>

        <button
          className={`btn-ghost ${isTablet ? 'px-3 py-2' : 'px-2 py-1.5'}`}
          onClick={toggleTheme}
          title="Toggle theme"
        >
          {theme !== 'light' ? <Sun size={isTablet ? 18 : 14} /> : <Moon size={isTablet ? 18 : 14} />}
        </button>

        <button
          className={`hidden md:inline-flex btn-ghost ${isTablet ? 'px-3 py-2' : 'px-2 py-1.5'}`}
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>

        <button
          className={`btn-ghost ${isTablet ? 'px-3 py-2' : 'px-2 py-1.5'}`}
          onClick={onAboutClick}
          title="About"
        >
          <HelpCircle size={18} />
        </button>

        <button
          className={`btn-ghost ${isTablet ? 'px-3 py-2' : 'px-2 py-1.5'}`}
          onClick={onSettingsClick}
          title="Settings"
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  )
}
