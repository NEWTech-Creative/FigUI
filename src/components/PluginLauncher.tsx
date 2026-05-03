import { useCallback, useEffect, useState } from 'react'
import { Puzzle, RefreshCw } from 'lucide-react'
import { discoverPlugins } from '../lib/plugins'
import { PluginFrame } from './PluginFrame'
import type { Plugin } from '../types'

export function PluginLauncher({ isTablet }: { isTablet?: boolean }) {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)
  const [activePlugin, setActivePlugin] = useState<Plugin | null>(null)

  const scan = useCallback(async () => {
    setLoading(true)
    setPlugins(await discoverPlugins())
    setLoading(false)
  }, [])

  useEffect(() => { scan() }, [scan])

  const pad = isTablet ? 'p-5' : 'p-4'

  return (
    <>
      <div className="flex flex-col h-full overflow-y-auto">
        <div className={`flex items-center justify-between ${pad} pb-3 border-b border-border shrink-0`}>
          <span className="text-sm text-text-muted uppercase tracking-wide font-medium">Installed Plugins</span>
          <button
            onClick={scan}
            disabled={loading}
            className="text-text-muted hover:text-accent transition-colors disabled:opacity-40"
            aria-label="Scan for plugins"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <RefreshCw size={22} className="text-text-muted animate-spin" />
          </div>
        ) : plugins.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6 py-10">
            <Puzzle size={36} className="text-text-dim" />
            <p className="text-text-muted text-sm font-medium">No plugins found</p>
            <p className="text-text-dim text-xs leading-relaxed">
              Place plugin folders in{' '}
              <code className="text-text-muted font-mono">/plugins/</code>{' '}
              on your FluidNC device, each containing a{' '}
              <code className="text-text-muted font-mono">plugin.json</code> manifest.
            </p>
          </div>
        ) : (
          <div className={`flex flex-col gap-3 ${pad}`}>
            {plugins.map(plugin => (
              <div key={plugin.id} className="panel flex items-start gap-3 p-3">
                <div className="shrink-0 w-10 h-10 rounded-lg bg-elevated flex items-center justify-center overflow-hidden">
                  {plugin.manifest.icon ? (
                    <img src={plugin.manifest.icon} alt="" className="w-7 h-7 object-contain" />
                  ) : (
                    <Puzzle size={20} className="text-accent" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-text-primary text-base truncate">
                      {plugin.manifest.name}
                    </span>
                    {plugin.manifest.version && (
                      <span className="text-xs text-text-dim font-mono shrink-0">
                        v{plugin.manifest.version}
                      </span>
                    )}
                  </div>
                  {plugin.manifest.description && (
                    <p className="text-xs text-text-muted mt-0.5 line-clamp-2">
                      {plugin.manifest.description}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setActivePlugin(plugin)}
                  className="btn btn-primary shrink-0 text-sm px-3 py-1.5"
                >
                  Launch
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {activePlugin && (
        <PluginFrame plugin={activePlugin} onClose={() => setActivePlugin(null)} />
      )}
    </>
  )
}
