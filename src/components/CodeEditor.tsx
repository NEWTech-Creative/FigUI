import { useState, useEffect, useRef, useCallback } from 'react'
import { CodeJar } from 'codejar'
import { X, Save, Download, Search, ChevronUp, ChevronDown, RotateCcw } from 'lucide-react'
import { sendCommand } from '../lib/http'
import { useMachineStore } from '../store'


function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlightGcode(editor: HTMLElement) {
  const code = editor.textContent ?? ''
  const TOKEN = /(;.*)|(\(.*?\))|\b(N\d+)|\b(G\d+(?:\.\d+)?)|\b(M\d+(?:\.\d+)?)|\b([XYZABCIJKR])(-?\.?\d+\.?\d*)|\b([FS])(\d+\.?\d*)|^(\$\S+)/i
  editor.innerHTML = code
    .split('\n')
    .map(line => {
      let result = ''
      let last = 0
      const re = new RegExp(TOKEN.source, 'gi')
      let m: RegExpExecArray | null
      while ((m = re.exec(line)) !== null) {
        result += escapeHtml(line.slice(last, m.index))
        if      (m[1])  result += `<span class="hl-comment">${escapeHtml(m[1])}</span>`
        else if (m[2])  result += `<span class="hl-comment">${escapeHtml(m[2])}</span>`
        else if (m[3])  result += `<span class="hl-line-num">${escapeHtml(m[3])}</span>`
        else if (m[4])  result += `<span class="hl-gcode">${escapeHtml(m[4])}</span>`
        else if (m[5])  result += `<span class="hl-mcode">${escapeHtml(m[5])}</span>`
        else if (m[6])  result += `<span class="hl-coord">${escapeHtml(m[6])}</span><span class="hl-number">${escapeHtml(m[7])}</span>`
        else if (m[8])  result += `<span class="hl-feed">${escapeHtml(m[8])}</span><span class="hl-number">${escapeHtml(m[9])}</span>`
        else if (m[10]) result += `<span class="hl-gcode">${escapeHtml(m[10])}</span>`
        else            result += escapeHtml(m[0])
        last = m.index + m[0].length
      }
      result += escapeHtml(line.slice(last))
      return result
    })
    .join('\n')
}

function highlightYaml(editor: HTMLElement) {
  const code = editor.textContent ?? ''
  const TOKEN = /("[^"]*"|'[^']*')|(#.*)$|([&*]\w+)|\b(true|false|yes|no|on|off)\b|^(\s*)([\w][^\s:]*?)(:)|((?<=:\s)-?\d+\.?\d*\b)/gm
  editor.innerHTML = code
    .split('\n')
    .map(line => {
      let result = ''
      let last = 0
      const re = new RegExp(TOKEN.source, 'gm')
      let m: RegExpExecArray | null
      while ((m = re.exec(line)) !== null) {
        result += escapeHtml(line.slice(last, m.index))
        if (m[1])      result += `<span class="hl-string">${escapeHtml(m[1])}</span>`
        else if (m[2]) result += `<span class="hl-comment">${escapeHtml(m[2])}</span>`
        else if (m[3]) result += `<span class="hl-anchor">${escapeHtml(m[3])}</span>`
        else if (m[4]) result += `<span class="hl-bool">${escapeHtml(m[4])}</span>`
        else if (m[6]) {
          result += escapeHtml(m[5])
          result += `<span class="hl-key">${escapeHtml(m[6])}</span><span class="hl-punct">${escapeHtml(m[7])}</span>`
        }
        else if (m[8]) result += `<span class="hl-number">${escapeHtml(m[8])}</span>`
        else           result += escapeHtml(m[0])
        last = m.index + m[0].length
      }
      result += escapeHtml(line.slice(last))
      return result
    })
    .join('\n')
}


type FileKind = 'gcode' | 'yaml' | 'text'

const GCODE_EXT = new Set(['.g', '.gco', '.gcode', '.nc', '.ncc'])
const YAML_EXT  = new Set(['.yaml', '.yml'])

function detectKind(filename: string): FileKind {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  if (GCODE_EXT.has(ext)) return 'gcode'
  if (YAML_EXT.has(ext))  return 'yaml'
  return 'text'
}

function getHighlighter(kind: FileKind) {
  if (kind === 'gcode') return highlightGcode
  if (kind === 'yaml')  return highlightYaml
  return (el: HTMLElement) => { el.innerHTML = escapeHtml(el.textContent ?? '') }
}


function applySearchMarks(editor: HTMLElement, term: string, activeIndex: number): number {
  if (!term) return 0
  const needle = term.toLowerCase()
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text)

  let matchIdx = 0
  for (const node of textNodes) {
    const text = node.textContent ?? ''
    const lower = text.toLowerCase()
    let searchStart = 0
    let idx = lower.indexOf(needle, searchStart)
    if (idx === -1) continue

    const frag = document.createDocumentFragment()
    let last = 0
    while (idx !== -1) {
      if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)))
      const mark = document.createElement('mark')
      mark.className = matchIdx === activeIndex ? 'hl-search-active' : 'hl-search'
      mark.textContent = text.slice(idx, idx + needle.length)
      frag.appendChild(mark)
      matchIdx++
      last = idx + needle.length
      idx = lower.indexOf(needle, last)
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
    node.parentNode!.replaceChild(frag, node)
  }
  return matchIdx
}

/** Count matches in plain text */
function countMatches(text: string, term: string): number {
  if (!term) return 0
  const lower = text.toLowerCase()
  const needle = term.toLowerCase()
  let count = 0
  let idx = 0
  while ((idx = lower.indexOf(needle, idx)) !== -1) { count++; idx += 1 }
  return count
}


const CLOSE_CHARS = new Set([')', ']', '}', '"', "'"])

/** If the char being typed is already the next char (auto-inserted), skip over it instead of doubling */
function handleOvertype(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (!CLOSE_CHARS.has(e.key)) return
  const sel = window.getSelection()
  if (!sel || !sel.isCollapsed || !sel.focusNode) return
  const node = sel.focusNode
  const off  = sel.focusOffset
  // Get the character right after the cursor
  const text = node.nodeType === Node.TEXT_NODE ? node.textContent ?? '' : ''
  if (node.nodeType === Node.TEXT_NODE && off < text.length && text[off] === e.key) {
    e.preventDefault()
    // Move cursor forward by one character
    const range = document.createRange()
    range.setStart(node, off + 1)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }
}


interface CodeEditorProps {
  filename: string
  content: string
  onSave: (content: string) => Promise<void>
  onClose: () => void
}

export function CodeEditor({ filename, content, onSave, onClose }: CodeEditorProps) {
  const editorRef  = useRef<HTMLDivElement>(null)
  const gutterRef  = useRef<HTMLDivElement>(null)
  const scrollRef  = useRef<HTMLDivElement>(null)
  const jarRef     = useRef<ReturnType<typeof CodeJar> | null>(null)
  const searchRef  = useRef<HTMLInputElement>(null)
  const [saving, setSaving]       = useState(false)
  const [dirty, setDirty]         = useState(false)
  const [savedOnce, setSavedOnce] = useState(false)
  const isConfig = filename === 'config.yaml'
  const [confirmClose, setConfirmClose] = useState(false)
  const [lineCount, setLineCount] = useState(1)
  const [showSearch, setShowSearch] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const [matchCount, setMatchCount] = useState(0)
  const kind = detectKind(filename)

  const currentContent = useRef(content)
  const searchTermRef  = useRef('')
  const matchIndexRef  = useRef(0)

  function updateLineCount(code: string) {
    // contentEditable often appends a trailing newline — don't count it as an extra line
    let count = code.split('\n').length
    if (code.endsWith('\n')) count--
    setLineCount(Math.max(1, count))
  }

  // Wrap the syntax highlighter to also apply search marks
  const makeHighlighter = useCallback((kind: FileKind) => {
    const base = getHighlighter(kind)
    return (editor: HTMLElement) => {
      base(editor)
      if (searchTermRef.current) {
        applySearchMarks(editor, searchTermRef.current, matchIndexRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const jar = CodeJar(el, makeHighlighter(kind), { tab: '  ' })
    jar.updateCode(content)
    updateLineCount(content)
    jar.onUpdate(code => {
      currentContent.current = code
      setDirty(code !== content)
      updateLineCount(code)
      // Update match count as content changes
      if (searchTermRef.current) {
        const c = countMatches(code, searchTermRef.current)
        setMatchCount(c)
        if (matchIndexRef.current >= c) {
          matchIndexRef.current = Math.max(0, c - 1)
          setMatchIndex(matchIndexRef.current)
        }
      }
    })
    // Overtype handler must fire before CodeJar's keydown (capture phase)
    el.addEventListener('keydown', handleOvertype, true)
    jarRef.current = jar
    return () => { el.removeEventListener('keydown', handleOvertype, true); jar.destroy() }
  }, [content, kind, makeHighlighter])

  // Keep gutter horizontal position pinned when scrolling horizontally
  useEffect(() => {
    const scrollEl = scrollRef.current
    if (!scrollEl) return
    const onScroll = () => {
      if (gutterRef.current) {
        gutterRef.current.style.transform = `translateX(${scrollEl.scrollLeft}px)`
      }
    }
    scrollEl.addEventListener('scroll', onScroll)
    return () => scrollEl.removeEventListener('scroll', onScroll)
  }, [])

  // Re-apply search highlights when term or active index changes, and scroll active into view
  useEffect(() => {
    if (!editorRef.current) return
    const editor = editorRef.current
    // Re-run the full highlighter (syntax + search marks)
    makeHighlighter(kind)(editor)
    // Scroll the active match into view
    requestAnimationFrame(() => {
      const active = editor.querySelector('.hl-search-active')
      if (active && scrollRef.current) {
        const scrollRect = scrollRef.current.getBoundingClientRect()
        const markRect = active.getBoundingClientRect()
        if (markRect.top < scrollRect.top || markRect.bottom > scrollRect.bottom) {
          active.scrollIntoView({ block: 'center' })
        }
      }
    })
  }, [searchTerm, matchIndex, kind, makeHighlighter])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await onSave(currentContent.current)
      setDirty(false)
      if (isConfig) setSavedOnce(true)
    } finally {
      setSaving(false)
    }
  }, [onSave, isConfig])

  const handleRestart = useCallback(async () => {
    if (!confirm('Restart the controller now? The config will take effect after reboot.')) return
    useMachineStore.getState().setRestarting(true)
    onClose()
    sendCommand('[ESP444]RESTART').catch(() => {})
  }, [])

  /** Attempt to close — if dirty, show confirmation; otherwise close immediately */
  function tryClose() {
    if (dirty) {
      setConfirmClose(true)
    } else {
      onClose()
    }
  }

  async function confirmSaveAndClose() {
    await handleSave()
    setConfirmClose(false)
    onClose()
  }

  function confirmDiscardAndClose() {
    setConfirmClose(false)
    onClose()
  }

  function handleDownload() {
    const blob = new Blob([currentContent.current], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function doSearch(term: string) {
    searchTermRef.current = term
    matchIndexRef.current = 0
    setSearchTerm(term)
    setMatchIndex(0)
    setMatchCount(countMatches(currentContent.current, term))
  }

  function nextMatch() {
    if (!matchCount) return
    const next = (matchIndex + 1) % matchCount
    matchIndexRef.current = next
    setMatchIndex(next)
  }

  function prevMatch() {
    if (!matchCount) return
    const prev = (matchIndex - 1 + matchCount) % matchCount
    matchIndexRef.current = prev
    setMatchIndex(prev)
  }

  function closeSearch() {
    searchTermRef.current = ''
    matchIndexRef.current = 0
    setShowSearch(false)
    setSearchTerm('')
    setMatchCount(0)
    setMatchIndex(0)
  }

  function toggleSearch() {
    if (showSearch) {
      closeSearch()
    } else {
      setShowSearch(true)
      setTimeout(() => searchRef.current?.focus(), 0)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault()
      toggleSearch()
    }
    if (e.key === 'Escape' && !showSearch) {
      e.preventDefault()
      tryClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={tryClose}>
      <div
        className="bg-surface border border-border rounded-sm shadow-xl flex flex-col
                    w-[90vw] h-[85vh] max-w-[1000px] animate-in"
        onKeyDown={handleKeyDown}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="panel-header justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate max-w-[120px] sm:max-w-[300px]">{filename}</span>
            <span className="text-sm font-mono px-1.5 py-0.5 rounded bg-elevated text-text-dim uppercase shrink-0">
              {kind}
            </span>
            {dirty && <span className="text-sm text-warn font-semibold shrink-0">modified</span>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              className="btn btn-ghost text-sm py-1 px-2"
              onClick={toggleSearch}
              title="Search (Ctrl+F)"
            >
              <Search size={12} /><span className="hidden sm:inline"> Find</span>
            </button>
            <button
              className="btn btn-ghost text-sm py-1 px-2"
              onClick={handleDownload}
              title="Download"
            >
              <Download size={12} /><span className="hidden sm:inline"> Download</span>
            </button>
            <button
              className="btn btn-primary text-sm py-1 px-2"
              onClick={handleSave}
              disabled={saving || !dirty}
              title="Save (Ctrl+S)"
            >
              <Save size={12} /><span className="hidden sm:inline"> {saving ? 'Saving…' : 'Save'}</span>
            </button>
            {isConfig && savedOnce && !dirty && (
              <button
                className="btn btn-warn text-sm py-1 px-2"
                onClick={handleRestart}
                title="Restart controller to apply config"
              >
                <RotateCcw size={12} /><span className="hidden sm:inline"> Restart</span>
              </button>
            )}
            <button
              className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-elevated transition-colors ml-1"
              onClick={tryClose}
              title="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Search bar */}
        {showSearch && (
          <div className="flex items-center gap-2 px-3 py-2 bg-elevated border-b border-border shrink-0">
            <Search size={13} className="text-text-dim shrink-0" />
            <input
              ref={searchRef}
              className="input-field flex-1 py-1 text-sm"
              placeholder="Search…"
              value={searchTerm}
              onChange={e => doSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && e.shiftKey) prevMatch()
                else if (e.key === 'Enter') nextMatch()
                else if (e.key === 'Escape') closeSearch()
              }}
              autoFocus
            />
            {searchTerm && (
              <span className="text-sm text-text-muted font-mono shrink-0">
                {matchCount > 0 ? `${matchIndex + 1}/${matchCount}` : 'No results'}
              </span>
            )}
            <button
              className="p-1 rounded hover:bg-surface text-text-muted hover:text-text-primary transition-colors"
              onClick={prevMatch}
              title="Previous (Shift+Enter)"
            >
              <ChevronUp size={14} />
            </button>
            <button
              className="p-1 rounded hover:bg-surface text-text-muted hover:text-text-primary transition-colors"
              onClick={nextMatch}
              title="Next (Enter)"
            >
              <ChevronDown size={14} />
            </button>
            <button
              className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
              onClick={closeSearch}
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* Editor with line numbers */}
        <div ref={scrollRef} className="flex-1 overflow-auto min-h-0 bg-elevated/50">
          <div className="flex min-h-full">
            {/* Gutter */}
            <div
              ref={gutterRef}
              className="code-gutter shrink-0 select-none z-10"
              aria-hidden="true"
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i} className="code-gutter-line">{i + 1}</div>
              ))}
            </div>
            {/* Code area */}
            <div className="flex-1 min-w-0">
              <div
                ref={editorRef}
                className="code-editor"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Unsaved changes confirmation */}
      {confirmClose && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
          onClick={() => setConfirmClose(false)}
        >
          <div
            className="bg-surface border border-border rounded-sm shadow-xl p-5 max-w-sm w-full animate-in"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-base text-text-primary mb-1 font-semibold">Unsaved changes</p>
            <p className="text-sm text-text-muted mb-4">
              Do you want to save your changes to <span className="font-mono">{filename}</span> before closing?
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="btn btn-ghost text-sm py-1.5 px-3"
                onClick={() => setConfirmClose(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-ghost text-sm py-1.5 px-3 text-warn"
                onClick={confirmDiscardAndClose}
              >
                Don&apos;t Save
              </button>
              <button
                className="btn btn-primary text-sm py-1.5 px-3"
                onClick={confirmSaveAndClose}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export const EDITABLE_EXT = new Set([
  ...GCODE_EXT, ...YAML_EXT, '.txt', '.cfg', '.ini', '.conf',
])

export function isEditable(name: string): boolean {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return EDITABLE_EXT.has(ext)
}
