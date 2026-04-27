import { useState, useEffect, useRef, useCallback } from 'react'
import { Trash2, ChevronsDown, Clipboard, ClipboardCheck } from 'lucide-react'
import { onLine, sendRaw } from '../lib/ws'
import { classifyLine } from '../lib/parser'

interface LogLine {
  id: number
  text: string
  kind: ReturnType<typeof classifyLine>
}

let lineId = 0

const KIND_CLASS: Record<LogLine['kind'], string> = {
  error: 'text-danger',
  alarm: 'text-warn',
  info: 'text-info',
  ok: 'text-ok',
  status: 'text-text-dim',
  normal: 'text-text-primary',
}

export function Terminal() {
  const [lines, setLines] = useState<LogLine[]>([])
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const [autoScroll, setAutoScroll] = useState(true)
  const [verbose, setVerbose] = useState(false)
  const [copied, setCopied] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const addLine = useCallback((text: string) => {
    const kind = classifyLine(text)
    if (!verbose && (kind === 'status' || kind === 'ok')) return
    setLines(prev => {
      const next = [...prev, { id: lineId++, text, kind }]
      return next.length > 1000 ? next.slice(-1000) : next
    })
  }, [verbose])

  useEffect(() => onLine(addLine), [addLine])

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  function handleScroll() {
    const el = logRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30
    if (!atBottom && autoScroll) setAutoScroll(false)
  }

  function copyToClipboard() {
    const text = lines.map(l => l.text).join('\n')
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
    } else {
      fallbackCopy(text)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function fallbackCopy(text: string) {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }

  function scrollToBottom() {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    setAutoScroll(true)
  }

  function submit() {
    const cmd = input.trim()
    if (!cmd) return
    addLine(`> ${cmd}`)
    sendRaw(cmd)
    setHistory(h => [cmd, ...h.slice(0, 99)])
    setInput('')
    setHistIdx(-1)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { submit(); return }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.min(histIdx + 1, history.length - 1)
      setHistIdx(next)
      if (history[next] !== undefined) setInput(history[next])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.max(histIdx - 1, -1)
      setHistIdx(next)
      setInput(next < 0 ? '' : history[next] ?? '')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="panel-header justify-between">
        <span>Terminal</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={verbose}
              onChange={e => setVerbose(e.target.checked)}
              className="w-3 h-3 accent-[var(--accent)]"
            />
            <span className="normal-case tracking-normal font-normal text-text-muted">verbose</span>
          </label>
          <button
            className="p-1 rounded hover:bg-elevated text-text-muted hover:text-accent transition-colors"
            onClick={copyToClipboard}
            title="Copy to clipboard"
            disabled={lines.length === 0}
          >
            {copied ? <ClipboardCheck size={12} /> : <Clipboard size={12} />}
          </button>
          <button
            className="p-1 rounded hover:bg-elevated text-text-muted hover:text-danger transition-colors"
            onClick={() => setLines([])}
            title="Clear"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <div
        ref={logRef}
        className="flex-1 overflow-y-auto min-h-0 py-2 bg-[var(--bg)] relative"
        onScroll={handleScroll}
      >
        {lines.map(l => (
          <div key={l.id} className={`terminal-line ${KIND_CLASS[l.kind]}`}>
            {l.text}
          </div>
        ))}

        {!autoScroll && (
          <button
            className="sticky bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1
                       text-xs px-3 py-1 rounded-full bg-surface border border-border
                       text-text-muted hover:text-text-primary shadow-lg"
            onClick={scrollToBottom}
          >
            <ChevronsDown size={12} />
            Scroll to bottom
          </button>
        )}
      </div>

      <div className="border-t border-border p-2 flex gap-2">
        <span className="text-text-dim font-mono text-xs self-center shrink-0">{'>'}</span>
        <input
          className="flex-1 bg-transparent font-mono text-xs text-text-primary
                     placeholder:text-text-dim focus:outline-none"
          placeholder="Enter command…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
        <button
          className="btn-ghost px-3 py-1 text-xs"
          onClick={submit}
          disabled={!input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  )
}
