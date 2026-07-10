import { create } from 'zustand'
import { parseGCode, type GCodeModel } from '../lib/gcode'
import { useMachineStore } from '../store'
import { getBase } from '../lib/http'
import { sendRaw } from '../lib/ws'
import {
  buildStatic2DPathsAsync,
  buildStatic3DGeometryAsync,
  nextAnimationFrame,
  type Built2DPaths,
  type Built3DGeometry,
} from '../lib/gcodeBuild'

export interface Geometry3D extends Built3DGeometry {
  showRapids: boolean
}

interface GCodeStore {
  // Identity
  loadedPath: string | null
  fileName: string | null
  sourceText: string | null
  restartSource: {
    path: string
    fileName: string
    requestedLine: number
    resumeLine: number
  } | null

  // Built data (shared across all GCodeViewer instances — one parse, one build)
  model: GCodeModel | null
  paths2D: Built2DPaths | null
  geometry3D: Geometry3D | null

  // Setting (shared so 3D rebuild only happens once on toggle)
  showRapids: boolean

  // Loading state
  loading: boolean
  pendingPath: string | null
  downloadProgress: number | null
  isProcessing2D: boolean
  processing2DProgress: number
  isProcessing3D: boolean
  processing3DProgress: number
  is3DReady: boolean

  // Actions
  loadFile: (path: string) => Promise<void>
  loadFromText: (
    text: string,
    name: string,
    path?: string | null,
    restartSource?: GCodeStore['restartSource'],
  ) => Promise<void>
  cancelAndStartJob: (path: string) => void
  setShowRapids: (v: boolean) => void
  clear: () => void
}


let activeLoadPath: string | null = null
let loadRequestId = 0
let abortController: AbortController | null = null
let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null

function isLoadBlockedByMachineState() {
  const state = useMachineStore.getState().status.state
  return state === 'Run' || state === 'Hold'
}

function abortInFlight() {
  ++loadRequestId
  if (activeReader) {
    activeReader.cancel().catch(() => {})
    activeReader = null
  }
  if (abortController) {
    abortController.abort()
    abortController = null
  }
  activeLoadPath = null
}

export const useGCodeStore = create<GCodeStore>((set, get) => ({
  loadedPath: null,
  fileName: null,
  sourceText: null,
  restartSource: null,
  model: null,
  paths2D: null,
  geometry3D: null,
  showRapids: true,
  loading: false,
  pendingPath: null,
  downloadProgress: null,
  isProcessing2D: false,
  processing2DProgress: 0,
  isProcessing3D: false,
  processing3DProgress: 0,
  is3DReady: false,

  loadFile: async (path: string) => {
    if (isLoadBlockedByMachineState()) return
    if (activeLoadPath === path) return

    abortInFlight()
    activeLoadPath = path
    const requestId = ++loadRequestId

    set({
      loading: true,
      pendingPath: path,
      downloadProgress: 0,
      isProcessing2D: false,
      processing2DProgress: 0,
      isProcessing3D: false,
      processing3DProgress: 0,
      is3DReady: false,
      geometry3D: null,
      paths2D: null,
    })

    try {
      const url = `${getBase()}${path}`
      abortController = new AbortController()
      const res = await fetch(url, { signal: abortController.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const contentLength = Number(res.headers.get('content-length') ?? '0')
      let text = ''

      if (res.body) {
        const reader = res.body.getReader()
        activeReader = reader
        const decoder = new TextDecoder()
        const chunks: string[] = []
        let received = 0
        let lastProgress = -1

        while (true) {
          const { done, value } = await reader.read()
          if (requestId !== loadRequestId) { reader.cancel().catch(() => {}); return }
          if (done) break
          if (!value) continue

          received += value.byteLength
          chunks.push(decoder.decode(value, { stream: true }))

          if (contentLength > 0) {
            const progress = Math.min(100, Math.round((received / contentLength) * 100))
            if (progress !== lastProgress) {
              lastProgress = progress
              set({ downloadProgress: progress })
            }
          }
        }

        chunks.push(decoder.decode())
        text = chunks.join('')
        activeReader = null
      } else {
        text = await res.text()
      }

      if (requestId !== loadRequestId) return
      set({ downloadProgress: 100, isProcessing2D: true, processing2DProgress: 5 })
      await nextAnimationFrame()

      const parsed = parseGCode(text)
      if (requestId !== loadRequestId) return
      set({ processing2DProgress: 15 })

      const built2DPaths = await buildStatic2DPathsAsync(
        parsed.segments,
        progress => {
          if (requestId === loadRequestId) {
            set({ processing2DProgress: Math.max(15, progress) })
          }
        },
        () => requestId === loadRequestId,
      )
      if (requestId !== loadRequestId) return

      const fileName = path.split('/').pop() ?? path
      set({
        model: parsed,
        paths2D: built2DPaths,
        fileName,
        loadedPath: path,
        sourceText: text,
        restartSource: null,
        processing2DProgress: 100,
        isProcessing2D: false,
        loading: false,
        pendingPath: null,
        isProcessing3D: true,
        processing3DProgress: 0,
      })

      const showRapids = get().showRapids
      const built3DGeometry = await buildStatic3DGeometryAsync(
        parsed.segments,
        showRapids,
        progress => {
          if (requestId === loadRequestId) {
            set({ processing3DProgress: progress })
          }
        },
        () => requestId === loadRequestId,
      )
      if (requestId !== loadRequestId) return

      set({
        geometry3D: { ...built3DGeometry, showRapids },
        processing3DProgress: 100,
        isProcessing3D: false,
        is3DReady: true,
      })
    } catch (e) {
      if (requestId === loadRequestId && (!(e instanceof Error) || e.message !== 'stale-load')) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          console.error('Failed to load G-code:', e)
        }
      }
    } finally {
      if (requestId === loadRequestId) {
        activeLoadPath = null
        abortController = null
        activeReader = null
        set({
          loading: false,
          pendingPath: null,
          isProcessing2D: false,
          isProcessing3D: false,
          is3DReady: get().geometry3D !== null,
        })
      }
    }
  },

  loadFromText: async (text: string, name: string, path = null, restartSource = null) => {
    if (isLoadBlockedByMachineState()) return
    abortInFlight()
    const requestId = ++loadRequestId

    set({
      loading: true,
      pendingPath: null,
      downloadProgress: 100,
      isProcessing2D: true,
      processing2DProgress: 5,
      isProcessing3D: false,
      processing3DProgress: 0,
      is3DReady: false,
      geometry3D: null,
      paths2D: null,
    })

    try {
      await nextAnimationFrame()
      const parsed = parseGCode(text)
      if (requestId !== loadRequestId) return
      set({ processing2DProgress: 15 })

      const built2DPaths = await buildStatic2DPathsAsync(
        parsed.segments,
        progress => {
          if (requestId === loadRequestId) {
            set({ processing2DProgress: Math.max(15, progress) })
          }
        },
        () => requestId === loadRequestId,
      )
      if (requestId !== loadRequestId) return

      set({
        model: parsed,
        paths2D: built2DPaths,
        fileName: name,
        loadedPath: path,
        sourceText: text,
        restartSource,
        processing2DProgress: 100,
        isProcessing2D: false,
        loading: false,
        isProcessing3D: true,
        processing3DProgress: 0,
      })

      const showRapids = get().showRapids
      const built3DGeometry = await buildStatic3DGeometryAsync(
        parsed.segments,
        showRapids,
        progress => {
          if (requestId === loadRequestId) set({ processing3DProgress: progress })
        },
        () => requestId === loadRequestId,
      )
      if (requestId !== loadRequestId) return

      set({
        geometry3D: { ...built3DGeometry, showRapids },
        processing3DProgress: 100,
        isProcessing3D: false,
        is3DReady: true,
      })
    } catch (e) {
      if (requestId === loadRequestId && (!(e instanceof Error) || e.message !== 'stale-load')) {
        console.error('Failed to load G-code from text:', e)
      }
    } finally {
      if (requestId === loadRequestId) {
        set({
          loading: false,
          isProcessing2D: false,
          isProcessing3D: false,
          is3DReady: get().geometry3D !== null,
        })
      }
    }
  },

  cancelAndStartJob: (path: string) => {
    // Stop any in-flight download immediately. The ESP32 must not be serving a
    abortInFlight()
    set({
      loading: false,
      pendingPath: null,
      isProcessing2D: false,
      isProcessing3D: false,
      downloadProgress: null,
      // Mark this path as the loaded one so the SD-job-start auto-load doesn't
      // re-fetch it. The user explicitly chose to skip the preview.
      loadedPath: path,
      fileName: path.split('/').pop() ?? path,
      sourceText: null,
      restartSource: null,
      // Drop any partial built data — they're stale now.
      model: null,
      paths2D: null,
      geometry3D: null,
      is3DReady: false,
    })
    sendRaw(`$SD/Run=${path}`)
  },

  setShowRapids: (v: boolean) => {
    if (get().showRapids === v) return
    set({ showRapids: v })

    const model = get().model
    if (!model) return

    // 2D rendering filters at draw time, so only the 3D geometry needs rebuilding.
    set({ isProcessing3D: true, processing3DProgress: 0, is3DReady: false })
    const requestId = ++loadRequestId

    buildStatic3DGeometryAsync(
      model.segments,
      v,
      progress => {
        if (requestId === loadRequestId) set({ processing3DProgress: progress })
      },
      () => requestId === loadRequestId,
    ).then(geometry => {
      if (requestId !== loadRequestId) return
      set({
        geometry3D: { ...geometry, showRapids: v },
        processing3DProgress: 100,
        isProcessing3D: false,
        is3DReady: true,
      })
    }).catch(e => {
      if (requestId === loadRequestId && (!(e instanceof Error) || e.message !== 'stale-load')) {
        console.error('Failed to rebuild 3D geometry:', e)
      }
    })
  },

  clear: () => {
    abortInFlight()
    set({
      loadedPath: null,
      fileName: null,
      sourceText: null,
      restartSource: null,
      model: null,
      paths2D: null,
      geometry3D: null,
      loading: false,
      pendingPath: null,
      downloadProgress: null,
      isProcessing2D: false,
      processing2DProgress: 0,
      isProcessing3D: false,
      processing3DProgress: 0,
      is3DReady: false,
    })
  },
}))
