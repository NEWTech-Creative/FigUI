import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Folder, File, Upload, Trash2, RefreshCw,
  ChevronRight, HardDrive, FolderPlus, X, Pencil,
  Check, Download, Server, FileCode, FilePlus,
} from 'lucide-react'
import { listFiles, deleteFile, deleteDir, uploadFile, createDir, renameFile, getBase, fetchFileContent, saveFileContent } from '../lib/http'
import { CodeEditor, isEditable } from './CodeEditor'
import { useMachineStore } from '../store'
import type { FileEntry, FileListResult } from '../types'

type Filesystem = 'sd' | 'local'

const GCODE_EXT = new Set(['.g', '.gco', '.gcode', '.nc', '.ncc', '.txt'])
const isGcode = (name: string) => GCODE_EXT.has(name.slice(name.lastIndexOf('.')).toLowerCase())

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${(bytes / 1073741824).toFixed(1)} GB`
}

interface FileRowProps {
  entry: FileEntry
  path: string
  fs: Filesystem
  canLoadGcode: boolean
  onNavigate: (path: string) => void
  onRefresh: () => void
  onEdit: (fullPath: string, filename: string) => void
  isTablet?: boolean
}

function FileRow({ entry, path, fs, canLoadGcode, onNavigate, onRefresh, onEdit, isTablet }: FileRowProps) {
  const [deleting, setDeleting] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName]   = useState(entry.name)
  const renameRef = useRef<HTMLInputElement>(null)

  const fullPath = path.endsWith('/') ? path : `${path}/`
  const fullName = `${fullPath}${entry.name}`

  function startRename() {
    setNewName(entry.name)
    setRenaming(true)
    setTimeout(() => renameRef.current?.select(), 0)
  }

  async function commitRename() {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === entry.name) { setRenaming(false); return }
    try {
      await renameFile(fullPath, entry.name, trimmed, fs)
      onRefresh()
    } catch {}
    setRenaming(false)
  }

  async function handleDelete() {
    if (!confirm(`Delete ${entry.name}?`)) return
    setDeleting(true)
    try {
      if (entry.isDir) await deleteDir(fullPath, entry.name, fs)
      else await deleteFile(fullPath, entry.name, fs)
      onRefresh()
    } finally {
      setDeleting(false)
    }
  }

  function handleDownload() {
    const url = `${getBase()}${fullName}`
    const a = document.createElement('a')
    a.href = url
    a.download = entry.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div className={`flex items-center gap-2 px-3 ${isTablet ? 'py-3' : 'py-2'} hover:bg-elevated group transition-colors`}>
      <div className="text-text-dim shrink-0">
        {entry.isDir
          ? <Folder size={isTablet ? 20 : 14} className="text-accent/70" />
          : <File size={isTablet ? 20 : 14} />}
      </div>

      {renaming ? (
        <input
          ref={renameRef}
          className={`flex-1 input-field py-0.5 text-lg`}
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') setRenaming(false)
          }}
          onBlur={commitRename}
          autoFocus
        />
      ) : entry.isDir ? (
        <button
          className={`flex-1 text-left ${isTablet ? 'text-2xl' : 'text-xl'} text-text-primary hover:text-accent truncate`}
          onClick={() => onNavigate(`${fullPath}${entry.name}`)}
        >
          {entry.name}
        </button>
      ) : isGcode(entry.name) ? (
        <button
          className={`flex-1 text-left ${isTablet ? 'text-2xl' : 'text-xl'} truncate ${canLoadGcode ? 'text-text-primary hover:text-accent' : 'text-text-dim cursor-not-allowed'}`}
          onClick={() => {
            if (!canLoadGcode) return
            window.dispatchEvent(new CustomEvent('gcode:load', { detail: fullName }))
          }}
          title={canLoadGcode ? 'Load in G-code viewer' : 'Cannot load another file while a job is running or held'}
        >
          {entry.name}
        </button>
      ) : (
        <span className={`flex-1 ${isTablet ? 'text-2xl' : 'text-xl'} text-text-primary truncate`}>{entry.name}</span>
      )}

      {!renaming && (
        <div className={`${isTablet ? 'w-36' : 'w-28'} shrink-0 flex items-center justify-end`}>
          {!entry.isDir && (
            <span className={`${isTablet ? 'text-sm' : 'text-base'} text-text-dim font-mono text-right group-hover:hidden`}>{fmtSize(entry.size)}</span>
          )}
          <div className="hidden group-hover:flex items-center gap-1">
            {!entry.isDir && isEditable(entry.name) && (
              <button
                className={`${isTablet ? 'p-2.5' : 'p-1.5'} rounded text-info hover:bg-info/10 transition-colors`}
                onClick={() => onEdit(fullPath, entry.name)}
                title="Edit file"
              >
                <FileCode size={isTablet ? 18 : 12} />
              </button>
            )}
            {!entry.isDir && (
              <button
                className={`${isTablet ? 'p-2.5' : 'p-1.5'} rounded text-info hover:bg-info/10 transition-colors`}
                onClick={handleDownload}
                title="Download"
              >
                <Download size={isTablet ? 18 : 12} />
              </button>
            )}
            <button
              className={`${isTablet ? 'p-2.5' : 'p-1.5'} rounded text-text-muted hover:text-text-primary hover:bg-elevated transition-colors`}
              onClick={startRename}
              title="Rename"
            >
              <Pencil size={isTablet ? 18 : 12} />
            </button>
            <button
              className={`${isTablet ? 'p-2.5' : 'p-1.5'} rounded text-danger hover:bg-danger/10 transition-colors`}
              onClick={handleDelete}
              disabled={deleting}
              title="Delete"
            >
              <Trash2 size={isTablet ? 18 : 12} />
            </button>
          </div>
        </div>
      )}

      {renaming && (
        <button
          className="p-1.5 rounded text-ok hover:bg-ok/10 transition-colors shrink-0"
          onClick={commitRename}
          title="Confirm rename"
        >
          <Check size={12} />
        </button>
      )}
    </div>
  )
}

export function FileManager({ isTablet }: { isTablet?: boolean }) {
  const espInfo = useMachineStore(s => s.espInfo)
  const machineState = useMachineStore(s => s.status.state)
  const primarySd   = espInfo?.primarySd   ?? '/sd/'
  const canLoadGcode = machineState !== 'Run' && machineState !== 'Hold'

  const [fs, setFs]             = useState<Filesystem>('sd')
  const [path, setPath]         = useState(primarySd)
  const [result, setResult]     = useState<FileListResult | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [uploading, setUploading]   = useState(false)
  const [uploadPct, setUploadPct]   = useState(0)
  const [newDirName, setNewDirName] = useState('')
  const [showNewDir, setShowNewDir] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [showNewFile, setShowNewFile] = useState(false)
  const [editing, setEditing]       = useState<{ path: string; filename: string; content: string } | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const sdRoot    = primarySd
  const localRoot = '/'

  const load = useCallback(async (p: string, filesystem: Filesystem) => {
    setLoading(true)
    setError('')
    try {
      const data = await listFiles(p, filesystem)
      setResult(data)
      setPath(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(sdRoot, 'sd') }, [load, sdRoot])

  function switchFs(newFs: Filesystem) {
    setFs(newFs)
    setResult(null)
    const root = newFs === 'sd' ? sdRoot : localRoot
    load(root, newFs)
  }

  function navigate(p: string) { load(p, fs) }

  function goUp() {
    const root = fs === 'sd' ? sdRoot : localRoot
    const trimmed = path.replace(/\/$/, '')
    const parts = trimmed.split('/')
    if (parts.length <= 2) {
      load(root, fs)
    } else {
      parts.pop()
      load(parts.join('/') + '/', fs)
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length) return
    setUploading(true)
    setUploadPct(0)
    try {
      for (const file of files) {
        await uploadFile(path, file, fs, p => setUploadPct(p))
      }
      load(path, fs)
    } finally {
      setUploading(false)
    }
  }

  async function handleCreateDir() {
    if (!newDirName.trim()) return
    await createDir(path, newDirName.trim(), fs)
    setNewDirName('')
    setShowNewDir(false)
    load(path, fs)
  }

  function createNewFile() {
    const name = newFileName.trim()
    if (!name) return
    setNewFileName('')
    setShowNewFile(false)
    if (isEditable(name)) {
      setEditing({ path: path.endsWith('/') ? path : `${path}/`, filename: name, content: '' })
    } else {
      // For non-editable extensions, create an empty file directly
      saveFileContent(path.endsWith('/') ? path : `${path}/`, name, '', fs).then(() => load(path, fs))
    }
  }

  async function openEditor(filePath: string, filename: string) {
    setEditLoading(true)
    try {
      const fullFilePath = `${filePath}${filename}`
      const content = await fetchFileContent(fullFilePath, fs)
      setEditing({ path: filePath, filename, content })
    } catch (e) {
      alert(`Failed to load file: ${e instanceof Error ? e.message : 'Unknown error'}`)
    } finally {
      setEditLoading(false)
    }
  }

  async function handleSaveFile(content: string) {
    if (!editing) return
    await saveFileContent(editing.path, editing.filename, content, fs)
    load(path, fs)
  }

  const root = fs === 'sd' ? sdRoot : localRoot
  const breadcrumbs = path.replace(/\/$/, '').split('/').filter(Boolean)

  return (
    <div className="flex flex-col h-full">

      <div className="flex border-b border-border shrink-0">
        {([['sd', 'SD Card', HardDrive], ['local', 'Internal', Server]] as const).map(
          ([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => switchFs(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 ${isTablet ? 'py-3 text-lg' : 'py-2 text-base'} font-medium
                          uppercase tracking-wide transition-colors border-b-2 -mb-px ${
                fs === id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-muted hover:text-text-primary'
              }`}
            >
              <Icon size={isTablet ? 18 : 11} />
              {label}
            </button>
          )
        )}
      </div>

      <div className="panel-header justify-between">
        <div className={`flex items-center gap-1.5 flex-wrap min-w-0 normal-case tracking-normal font-normal ${isTablet ? 'text-lg' : ''}`}>
          <button
            className={`hover:text-accent transition-colors ${isTablet ? 'p-2' : ''}`}
            onClick={() => load(root, fs)}
          >
            {fs === 'sd' ? <HardDrive size={isTablet ? 20 : 13} /> : <Server size={isTablet ? 20 : 13} />}
          </button>
          {breadcrumbs.map((seg, i) => (
            <div key={i} className="flex items-center gap-1">
              <ChevronRight size={isTablet ? 16 : 10} className="text-text-dim" />
              <button
                className={`hover:text-accent transition-colors max-w-[80px] truncate ${isTablet ? 'p-2' : ''}`}
                onClick={() => load('/' + breadcrumbs.slice(0, i + 1).join('/') + '/', fs)}
              >
                {seg}
              </button>
            </div>
          ))}
        </div>
        <div className={`flex items-center ${isTablet ? 'gap-2' : 'gap-1'} shrink-0`}>
          <button
            className={`rounded hover:bg-elevated text-text-muted hover:text-text-primary transition-colors ${isTablet ? 'p-3' : 'p-1'}`}
            onClick={() => { setShowNewFile(v => !v); setShowNewDir(false) }}
            title="New file"
          >
            <FilePlus size={isTablet ? 20 : 13} />
          </button>
          <button
            className={`rounded hover:bg-elevated text-text-muted hover:text-text-primary transition-colors ${isTablet ? 'p-3' : 'p-1'}`}
            onClick={() => { setShowNewDir(v => !v); setShowNewFile(false) }}
            title="New folder"
          >
            <FolderPlus size={isTablet ? 20 : 13} />
          </button>
          <button
            className={`rounded hover:bg-elevated text-text-muted hover:text-text-primary transition-colors ${isTablet ? 'p-3' : 'p-1'}`}
            onClick={() => fileInput.current?.click()}
            title="Upload file"
          >
            <Upload size={isTablet ? 20 : 13} />
          </button>
          <button
            className={`rounded hover:bg-elevated text-text-muted hover:text-accent transition-colors ${isTablet ? 'p-3' : 'p-1'}`}
            onClick={() => load(path, fs)}
            title="Refresh"
          >
            <RefreshCw size={isTablet ? 20 : 13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {showNewFile && (
        <div className="flex items-center gap-2 px-3 py-2 bg-elevated border-b border-border">
          <FilePlus size={13} className="text-text-dim shrink-0" />
          <input
            className="input-field flex-1 py-1 text-base"
            placeholder="Filename (e.g. job.nc, config.yaml)"
            value={newFileName}
            onChange={e => setNewFileName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') createNewFile()
              if (e.key === 'Escape') setShowNewFile(false)
            }}
            autoFocus
          />
          <button className="btn-primary text-base px-2 py-1" onClick={createNewFile}>Create</button>
          <button className="text-text-muted hover:text-text-primary" onClick={() => setShowNewFile(false)}>
            <X size={13} />
          </button>
        </div>
      )}

      {showNewDir && (
        <div className="flex items-center gap-2 px-3 py-2 bg-elevated border-b border-border">
          <FolderPlus size={13} className="text-text-dim shrink-0" />
          <input
            className="input-field flex-1 py-1 text-base"
            placeholder="Folder name"
            value={newDirName}
            onChange={e => setNewDirName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateDir()}
            autoFocus
          />
          <button className="btn-primary text-base px-2 py-1" onClick={handleCreateDir}>Create</button>
          <button className="text-text-muted hover:text-text-primary" onClick={() => setShowNewDir(false)}>
            <X size={13} />
          </button>
        </div>
      )}

      {uploading && (
        <div className="px-3 py-2 bg-info/5 border-b border-info/20">
          <div className="flex justify-between text-base text-info mb-1">
            <span>Uploading…</span>
            <span>{uploadPct}%</span>
          </div>
          <div className="w-full h-1 bg-elevated rounded-full overflow-hidden">
            <div className="h-full bg-info transition-all" style={{ width: `${uploadPct}%` }} />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        {error && (
          <div className="m-3 p-3 rounded-sm bg-danger/10 border border-danger/30 text-danger text-base">
            {error}
          </div>
        )}

        {loading && !result && (
          <div className="flex items-center justify-center h-24 text-text-muted text-base">
            <RefreshCw size={14} className="animate-spin mr-2" /> Loading…
          </div>
        )}

        {result && path !== root && (
          <button
            className="flex items-center gap-2 px-3 py-2 w-full text-left
                       hover:bg-elevated text-text-muted hover:text-text-primary transition-colors
                       border-b border-border"
            onClick={goUp}
          >
            <Folder size={14} className="text-accent/50" />
            <span className="text-sm">..</span>
          </button>
        )}

        {result?.files?.slice().sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
          return a.name.localeCompare(b.name)
        }).map(entry => (
          <div key={entry.name} className="border-b border-border last:border-b-0">
            <FileRow isTablet={isTablet}
              entry={entry}
              path={path}
              fs={fs}
              canLoadGcode={canLoadGcode}
              onNavigate={navigate}
              onRefresh={() => load(path, fs)}
              onEdit={openEditor}
            />
          </div>
        ))}

        {result && !result.files?.length && (
          <div className="flex items-center justify-center h-24 text-text-muted text-xl">
            Empty directory
          </div>
        )}
      </div>

      {result && (
        <div className="border-t border-border px-3 py-2 flex items-center gap-2 text-base text-text-muted">
          <HardDrive size={12} />
          <div className="flex-1">
            <div className="flex justify-between mb-1">
              <span>{fmtSize(result.total - result.used)} free</span>
              <span>{result.occupation}% used</span>
            </div>
            <div className="w-full h-1 bg-elevated rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  result.occupation > 90 ? 'bg-danger' :
                  result.occupation > 70 ? 'bg-warn'   : 'bg-ok'
                }`}
                style={{ width: `${result.occupation}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        className="hidden"
        multiple
        onChange={e => handleUpload(e.target.files)}
      />

      {editLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface border border-border rounded-sm p-6 text-sm text-text-muted">
            Loading file…
          </div>
        </div>
      )}

      {editing && (
        <CodeEditor
          filename={editing.filename}
          content={editing.content}
          onSave={handleSaveFile}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
