import { useCallback, useEffect, useRef, useState } from 'react'
import { Puzzle, RefreshCw, Upload, Store, HardDrive, Server, Trash2, Download, AlertCircle, X, CheckCircle } from 'lucide-react'
import { discoverPlugins, uploadFolderPlugin, deletePlugin, fetchRegistry, installStorePlugin } from '../lib/plugins'
import { PluginFrame } from './PluginFrame'
import type { Plugin, StoreEntry, ActiveLayout } from '../types'
import { getEffectiveLayout } from '../types'

type Tab = 'installed' | 'store'
type FsDest = 'local' | 'sd'

interface ProgressState {
  current: number
  total: number
  filename: string
  label: string
}

function StoragePicker({ onPick, onClose }: { onPick: (fs: FsDest) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded shadow-xl w-64 p-4 animate-in space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-base font-semibold text-text-primary">Install to…</p>
        <div className="flex flex-col gap-2">
          {([
            ['local', 'Internal Storage', Server,  'Flash memory on the controller'],
            ['sd',    'SD Card',          HardDrive, 'Recommended for larger plugins'],
          ] as const).map(([fs, label, Icon, hint]) => (
            <button
              key={fs}
              onClick={() => onPick(fs)}
              className="flex items-center gap-3 p-3 rounded border border-border
                         hover:border-accent hover:bg-accent/5 transition-colors text-left"
            >
              <Icon size={18} className="text-text-muted shrink-0" />
              <div>
                <p className="text-base font-medium text-text-primary">{label}</p>
                <p className="text-sm text-text-dim">{hint}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function PluginIcon({ src, size = 22 }: { src?: string; size?: number }) {
  const [error, setError] = useState(false)
  if (!src || error) return <Puzzle size={size} className="text-accent" />
  return <img src={src} alt="" className="w-10 h-10 object-contain" onError={() => setError(true)} />
}

function FsBadge({ fs }: { fs: 'sd' | 'local' }) {
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-sm font-medium border ${
      fs === 'sd'
        ? 'bg-info/10 border-info/30 text-info'
        : 'bg-elevated border-border text-text-dim'
    }`}>
      {fs === 'sd' ? <HardDrive size={8} /> : <Server size={8} />}
      {fs === 'sd' ? 'SD' : 'Internal'}
    </span>
  )
}

export function PluginLauncher({ isTablet, onLaunchPanel, activeLayout }: { isTablet?: boolean; onLaunchPanel?: (plugin: Plugin) => void; activeLayout?: ActiveLayout }) {
  const [tab, setTab] = useState<Tab>('installed')
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [scanning, setScanning] = useState(true)
  const [activePlugin, setActivePlugin] = useState<Plugin | null>(null)

  const [destFs, setDestFs] = useState<FsDest>('local')
  const [showAddPicker, setShowAddPicker] = useState(false)
  const [pendingInstall, setPendingInstall] = useState<StoreEntry | null>(null)

  // Upload folder state
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [uploadDone, setUploadDone] = useState(false)

  // Confirm delete
  const [confirmDelete, setConfirmDelete] = useState<Plugin | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Store
  const [storeEntries, setStoreEntries] = useState<StoreEntry[] | null>(null)
  const [storeLoading, setStoreLoading] = useState(false)
  const [storeError, setStoreError] = useState<string | null>(null)
  const [installingId, setInstallingId] = useState<string | null>(null)
  const [justInstalled, setJustInstalled] = useState<string | null>(null)

  const scan = useCallback(async () => {
    setScanning(true)
    setPlugins(await discoverPlugins())
    setScanning(false)
  }, [])

  useEffect(() => { scan() }, [scan])

  const loadStore = useCallback(async () => {
    if (storeEntries !== null) return
    setStoreLoading(true)
    setStoreError(null)
    try {
      setStoreEntries(await fetchRegistry())
    } catch (e: any) {
      setStoreError(e.message ?? 'Failed to load store')
    } finally {
      setStoreLoading(false)
    }
  }, [storeEntries])

  useEffect(() => {
    if (tab === 'store') loadStore()
  }, [tab, loadStore])

  async function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploadDone(false)
    setProgress({ current: 0, total: files.length, filename: '', label: 'Preparing…' })
    try {
      await uploadFolderPlugin(files, destFs, (current, total, filename) => {
        setProgress({ current, total, filename, label: 'Uploading' })
      })
      setUploadDone(true)
      setProgress(null)
      await scan()
      setTab('installed')
    } catch (err: any) {
      alert(err.message ?? 'Upload failed')
      setProgress(null)
    } finally {
      e.target.value = ''
    }
  }

  async function handleDelete(plugin: Plugin) {
    setDeleting(true)
    try {
      await deletePlugin(plugin)
      await scan()
    } catch {}
    setDeleting(false)
    setConfirmDelete(null)
  }

  async function handleInstall(entry: StoreEntry, fs: FsDest = destFs) {
    setInstallingId(entry.id)
    try {
      await installStorePlugin(entry, fs, () => {})
      setJustInstalled(entry.id)
      await scan()
      setTimeout(() => setJustInstalled(null), 3000)
    } catch (err: any) {
      alert(err.message ?? 'Install failed')
    } finally {
      setInstallingId(null)
    }
  }

  const isInstalled = (entry: StoreEntry) =>
    plugins.some(p => p.id === entry.id)

  const pad = isTablet ? 'p-5' : 'p-4'

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">

        {/* Header */}
        <div className={`flex items-center gap-2 ${pad} pb-3 border-b border-border shrink-0`}>
          <span className="text-base text-text-muted uppercase tracking-wide font-medium flex-1">Plugins</span>
          <button
            onClick={() => setShowAddPicker(true)}
            className="btn btn-ghost text-base py-1 px-2 gap-1.5 shrink-0"
            title="Install from folder"
          >
            <Upload size={12} />
            Add
          </button>
          <button
            onClick={scan}
            disabled={scanning}
            className="text-text-muted hover:text-accent transition-colors disabled:opacity-40 shrink-0"
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          {(['installed', 'store'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold
                          uppercase tracking-wide transition-colors border-b-2 -mb-px ${
                tab === t
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-muted hover:text-text-primary'
              }`}
            >
              {t === 'installed' ? <Puzzle size={11} /> : <Store size={11} />}
              {t === 'installed' ? 'Installed' : 'Store'}
              {t === 'installed' && plugins.length > 0 && (
                <span className="ml-0.5 bg-elevated border border-border rounded-full text-sm px-1.5 py-px text-text-dim">
                  {plugins.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* Progress overlay */}
          {progress && (
            <div className="flex flex-col items-center justify-center gap-3 h-full text-center px-6">
              <RefreshCw size={22} className="text-accent animate-spin" />
              <p className="text-base font-medium text-text-primary">{progress.label}…</p>
              <p className="text-sm text-text-muted font-mono">{progress.filename}</p>
              <div className="w-48 h-1 bg-elevated rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-300"
                  style={{ width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '0%' }}
                />
              </div>
              <p className="text-sm text-text-dim">{progress.current} / {progress.total} files</p>
            </div>
          )}

          {/* Upload success flash */}
          {!progress && uploadDone && (
            <div className="m-4 p-3 rounded border border-ok/30 bg-ok/10 flex items-center gap-2">
              <CheckCircle size={14} className="text-ok shrink-0" />
              <p className="text-base text-ok flex-1">Plugin installed successfully</p>
              <button onClick={() => setUploadDone(false)} className="text-ok/60 hover:text-ok shrink-0">
                <X size={12} />
              </button>
            </div>
          )}

          {/* Installed tab */}
          {!progress && tab === 'installed' && (
            scanning ? (
              <div className="flex-1 flex items-center justify-center py-16">
                <RefreshCw size={22} className="text-text-muted animate-spin" />
              </div>
            ) : plugins.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 text-center px-6 py-12">
                <Puzzle size={32} className="text-text-dim" />
                <p className="text-base font-medium text-text-muted">No plugins installed</p>
                <p className="text-sm text-text-dim leading-relaxed">
                  Click <strong className="text-text-muted">Add</strong> to install from a folder, or visit the <strong className="text-text-muted">Store</strong> tab.
                </p>
              </div>
            ) : (
              <div className={`flex flex-col gap-3 ${pad}`}>
                {plugins.map(plugin => (
                  <div key={`${plugin.id}:${plugin.fs}`} className="panel flex flex-col gap-2 p-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => getEffectiveLayout(plugin.manifest, activeLayout ?? 'desktop') !== 'default' && onLaunchPanel ? onLaunchPanel(plugin) : setActivePlugin(plugin)}
                        className="shrink-0 w-12 h-12 flex items-center justify-center overflow-hidden
                                   hover:opacity-80 transition-opacity"
                        title={`Launch ${plugin.manifest.name}`}
                      >
                        <PluginIcon src={plugin.manifest.icon} />
                      </button>
                      <button
                        onClick={() => getEffectiveLayout(plugin.manifest, activeLayout ?? 'desktop') !== 'default' && onLaunchPanel ? onLaunchPanel(plugin) : setActivePlugin(plugin)}
                        className="flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
                      >
                        <p className="font-medium text-text-primary text-base truncate">
                          {plugin.manifest.name}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {plugin.manifest.version && (
                            <span className="text-sm text-text-dim font-mono shrink-0">
                              v{plugin.manifest.version}
                            </span>
                          )}
                          <FsBadge fs={plugin.fs} />
                        </div>
                      </button>
                      <button
                        onClick={() => setConfirmDelete(plugin)}
                        className="shrink-0 w-7 h-7 flex items-center justify-center rounded text-text-muted
                                   hover:text-danger hover:bg-danger/10 transition-colors border border-transparent
                                   hover:border-danger/30"
                        title="Uninstall plugin"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {plugin.manifest.description && (
                      <p className="text-sm text-text-muted">
                        {plugin.manifest.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {/* Store tab */}
          {!progress && tab === 'store' && (
            storeLoading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16">
                <RefreshCw size={22} className="text-text-muted animate-spin" />
                <p className="text-sm text-text-dim">Loading store…</p>
              </div>
            ) : storeError ? (
              <div className="flex flex-col items-center justify-center gap-3 text-center px-6 py-12">
                <AlertCircle size={28} className="text-danger" />
                <p className="text-base font-medium text-text-muted">Could not load store</p>
                <p className="text-sm text-text-dim break-words">{storeError}</p>
                <button
                  className="btn btn-ghost text-sm px-3 py-1.5 mt-1"
                  onClick={() => { setStoreEntries(null); setStoreError(null); loadStore() }}
                >
                  Retry
                </button>
              </div>
            ) : (storeEntries ?? []).length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 text-center px-6 py-12">
                <Store size={28} className="text-text-dim" />
                <p className="text-base text-text-muted">No plugins in the store yet</p>
              </div>
            ) : (
              <div className={`flex flex-col gap-3 ${pad}`}>
                {(storeEntries ?? []).map(entry => {
                  const installed = isInstalled(entry)
                  const installing = installingId === entry.id
                  const done = justInstalled === entry.id
                  return (
                    <div key={entry.id} className="panel flex flex-col gap-2 p-3">
                      <div className="flex items-center gap-3">
                        <div className="shrink-0 w-12 h-12 flex items-center justify-center overflow-hidden">
                          <PluginIcon src={entry.base + 'icon.png'} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-text-primary text-base truncate">
                            {entry.name}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {entry.version && (
                              <span className="text-sm text-text-dim font-mono shrink-0">
                                v{entry.version}
                              </span>
                            )}
                            {entry.author && (
                              <span className="text-sm text-text-dim shrink-0">by {entry.author}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      {entry.description && (
                        <p className="text-sm text-text-muted">{entry.description}</p>
                      )}
                      <div>
                        {done ? (
                          <span className="flex items-center gap-1 text-sm text-ok font-medium">
                            <CheckCircle size={12} /> Done
                          </span>
                        ) : installed ? (
                          <span className="inline-flex items-center gap-1 text-sm text-text-dim px-2 py-1.5 rounded border border-border">
                            <CheckCircle size={11} /> Installed
                          </span>
                        ) : (
                          <button
                            onClick={() => setPendingInstall(entry)}
                            disabled={!!installingId}
                            className="btn btn-ghost text-sm px-2.5 py-1.5 gap-1.5 disabled:opacity-40"
                          >
                            {installing
                              ? <><RefreshCw size={11} className="animate-spin" /> Installing…</>
                              : <><Download size={11} /> Install</>}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          )}
        </div>
      </div>

      {/* Storage picker — Add from folder */}
      {showAddPicker && (
        <StoragePicker
          onPick={fs => { setShowAddPicker(false); setDestFs(fs); folderInputRef.current?.click() }}
          onClose={() => setShowAddPicker(false)}
        />
      )}

      {/* Storage picker — Store install */}
      {pendingInstall && (
        <StoragePicker
          onPick={fs => { setDestFs(fs); const entry = pendingInstall; setPendingInstall(null); handleInstall(entry, fs) }}
          onClose={() => setPendingInstall(null)}
        />
      )}

      {/* Hidden folder input */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-ignore
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={handleFolderSelect}
      />

      {/* Delete confirm dialog */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmDelete(null)}>
          <div
            className="bg-surface border border-border rounded shadow-xl w-72 p-4 animate-in space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-base font-semibold text-text-primary">Uninstall plugin?</p>
            <p className="text-sm text-text-muted">
              This will delete <strong>{confirmDelete.manifest.name}</strong> from{' '}
              {confirmDelete.fs === 'sd' ? 'SD Card' : 'Internal'} storage.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn btn-ghost text-base py-1.5 px-3" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger text-base py-1.5 px-3"
                disabled={deleting}
                onClick={() => handleDelete(confirmDelete)}
              >
                {deleting ? <RefreshCw size={11} className="animate-spin" /> : <Trash2 size={11} />}
                Uninstall
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active plugin frame */}
      {activePlugin && (
        <PluginFrame plugin={activePlugin} onClose={() => setActivePlugin(null)} />
      )}
    </>
  )
}
