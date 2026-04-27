import { useEffect } from 'react'
import { X } from 'lucide-react'
import fluidncLogo from '../assets/fluidnc-logo.svg'
import { useMachineStore } from '../store'

interface Props {
  onClose: () => void
}

interface Tip {
  title: string
  body: React.ReactNode
}

const TIPS: Tip[] = [
  {
    title: 'Keyboard jogging',
    body: (
      <>
        In the Jog panel, switch to <em>Continuous</em> mode and click the keyboard
        icon to enable. Use <kbd className="kbd">←</kbd><kbd className="kbd">→</kbd>
        <kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> for X/Y and{' '}
        <kbd className="kbd">+</kbd><kbd className="kbd">−</kbd> for Z. Hold to jog,
        release to stop.
      </>
    ),
  },
  {
    title: 'Cancel a jog',
    body: (
      <>
        While the machine is jogging, the center of the jog rose turns into a stop
        button — click it (or release the held key) to cancel.
      </>
    ),
  },
  {
    title: 'Units (mm ↔ in)',
    body: (
      <>
        Open <em>Settings</em> and use the <em>WebUI units</em> toggle near the top.
        Display only — controller communication always stays in mm.
      </>
    ),
  },
  {
    title: 'Clear an alarm',
    body: (
      <>
        When the status pill in the header shows <em>Alarm</em>, click it to send{' '}
        <code className="font-mono text-text-primary">$X</code> and unlock.
      </>
    ),
  },
  {
    title: 'Soft reset',
    body: (
      <>
        The <em>RST</em> button in the header sends Ctrl+X — equivalent to a soft
        reset of FluidNC.
      </>
    ),
  },
  {
    title: 'Per-axis zero / home',
    body: (
      <>
        In the DRO, click an axis label to zero just that axis, or use the small
        icons next to it to go to its zero or home it individually.
      </>
    ),
  },
  {
    title: 'Large files',
    body: (
      <>
        On jobs over 100,000 segments, the toolpath completion overlay (green
        "done" trail) is automatically disabled while running. This avoids
        flooding FluidNC with position queries — the toolhead marker still
        tracks position normally.
      </>
    ),
  },
]

export function AboutModal({ onClose }: Props) {
  const theme = useMachineStore(s => s.theme)
  const espInfo = useMachineStore(s => s.espInfo)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative w-full sm:max-w-lg
                      max-h-[92dvh] sm:max-h-[85vh]
                      bg-surface border-t sm:border border-border
                      rounded-t-2xl sm:rounded-lg
                      shadow-2xl flex flex-col overflow-hidden animate-in">

        <div className="panel-header shrink-0">
          <span>About</span>
          <button
            className="btn-ghost px-2 py-1 ml-auto"
            onClick={onClose}
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Brand */}
          <div className="flex flex-col items-center gap-2 px-5 pt-6 pb-5 border-b border-border">
            <img
              src={fluidncLogo}
              alt="FluidNC"
              className="h-10 w-auto"
              style={theme !== 'light' ? { filter: 'invert(1) hue-rotate(180deg)' } : undefined}
            />
            <div className="text-[11px] uppercase tracking-[0.18em] text-text-muted font-semibold">
              WebUI V4
            </div>
            {espInfo?.version && (
              <div className="text-[10px] text-text-dim font-mono">
                {espInfo.version}
              </div>
            )}
          </div>

          {/* Tips */}
          <div className="px-5 py-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted mb-3">
              Basic Usage
            </h3>
            <dl className="space-y-3">
              {TIPS.map(tip => (
                <div key={tip.title}>
                  <dt className="text-[13px] font-semibold text-accent">
                    {tip.title}
                  </dt>
                  <dd className="text-[13px] text-text-primary leading-relaxed mt-0.5">
                    {tip.body}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-border text-center text-[11px] text-text-dim">
            © 2026 Figamore &amp; FluidNC Contributors
          </div>
        </div>
      </div>
    </div>
  )
}
