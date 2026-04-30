import { FakeWebSocket } from './wsSimulator'
import { installFetchInterceptor, installXhrInterceptor } from './httpSimulator'

export function installDemoMode(): void {
  if (!import.meta.env.VITE_DEMO_MODE) return

  // Replace browser WebSocket with in-browser simulator
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).WebSocket = FakeWebSocket

  // Intercept HTTP calls that would go to a real FluidNC device
  installFetchInterceptor()
  installXhrInterceptor()

  // Floating banner so users know they're in demo mode
  document.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('div')
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:50%', 'transform:translateX(-50%)',
      'background:#f59e0b', 'color:#000', 'padding:2px 14px',
      'font-size:11px', 'font-weight:700', 'letter-spacing:0.5px',
      'border-radius:0 0 6px 6px', 'z-index:9999', 'pointer-events:none',
      'font-family:sans-serif',
    ].join(';')
    banner.textContent = 'DEMO — Simulated machine, no hardware needed'
    document.body.appendChild(banner)
  })
}
