import { useEffect, useMemo, useRef, useState } from 'react'
import type { ControllerSettings, MachineStatus } from '../types'
import type { GCodeModel, Segment } from './gcode'
import { getArcGeometry } from './gcodeBuild'

interface SegmentMotionProfile {
  lengthMm: number
  axisFractions: { x: number; y: number; z: number }

  entryDir: { x: number; y: number; z: number }
  exitDir: { x: number; y: number; z: number }
}

interface JobTimingEstimate {
  segmentSeconds: Float64Array
  totalSeconds: number
  totalRapidSeconds: number
  totalControlledSeconds: number
}

export interface JobRuntimeEstimate {
  source: 'estimated' | 'sd' | 'none'
  progressPercent: number | null
  elapsedSeconds: number | null
  remainingSeconds: number | null
  totalSeconds: number | null
}

const timingCache = new WeakMap<GCodeModel, Map<string, JobTimingEstimate>>()

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function getOverrideScale(percent: number | undefined) {
  if (percent == null || !Number.isFinite(percent) || percent <= 0) return 1
  return Math.max(percent / 100, 0.01)
}

function motionSettingsKey(settings: ControllerSettings) {
  return [
    settings.maxRateX ?? '',
    settings.maxRateY ?? '',
    settings.maxRateZ ?? '',
    settings.accelX ?? '',
    settings.accelY ?? '',
    settings.accelZ ?? '',
    settings.junctionDeviation ?? '',
  ].join('|')
}

function getSegmentMotionProfile(seg: Segment): SegmentMotionProfile | null {
  if (seg.i === undefined) {
    const dx = seg.x1 - seg.x0
    const dy = seg.y1 - seg.y0
    const dz = seg.z1 - seg.z0
    const lengthMm = Math.hypot(dx, dy, dz)
    if (lengthMm < 1e-9) return null
    const ux = dx / lengthMm
    const uy = dy / lengthMm
    const uz = dz / lengthMm
    const dir = { x: ux, y: uy, z: uz }
    return {
      lengthMm,
      axisFractions: {
        x: Math.abs(ux),
        y: Math.abs(uy),
        z: Math.abs(uz),
      },
      entryDir: dir,
      exitDir: dir,
    }
  }

  const arc = getArcGeometry(seg)
  const xyLength = arc.r * arc.sweep
  const dz = seg.z1 - seg.z0
  const lengthMm = Math.hypot(xyLength, dz)
  if (lengthMm < 1e-9) return null

  const dirSign = seg.cw ? -1 : 1
  const startAngle = arc.startAngle
  const endAngle = arc.startAngle + dirSign * arc.sweep
  const midAngle = arc.startAngle + dirSign * arc.sweep * 0.5

  const tangentAt = (angle: number) => ({
    x: seg.cw ? Math.sin(angle) : -Math.sin(angle),
    y: seg.cw ? -Math.cos(angle) : Math.cos(angle),
  })

  const xyScale = xyLength / lengthMm
  const zComponent = dz / lengthMm

  const buildDir = (angle: number) => {
    const t = tangentAt(angle)
    return { x: t.x * xyScale, y: t.y * xyScale, z: zComponent }
  }

  const midTangent = tangentAt(midAngle)

  return {
    lengthMm,
    axisFractions: {
      x: Math.abs(midTangent.x) * xyScale,
      y: Math.abs(midTangent.y) * xyScale,
      z: Math.abs(zComponent),
    },
    entryDir: buildDir(startAngle),
    exitDir: buildDir(endAngle),
  }
}

function getAxisLimitedValue(
  axisFractions: SegmentMotionProfile['axisFractions'],
  xLimit?: number,
  yLimit?: number,
  zLimit?: number,
) {
  let limit = Number.POSITIVE_INFINITY

  if (axisFractions.x > 1e-6 && xLimit != null && Number.isFinite(xLimit) && xLimit > 0) {
    limit = Math.min(limit, xLimit / axisFractions.x)
  }
  if (axisFractions.y > 1e-6 && yLimit != null && Number.isFinite(yLimit) && yLimit > 0) {
    limit = Math.min(limit, yLimit / axisFractions.y)
  }
  if (axisFractions.z > 1e-6 && zLimit != null && Number.isFinite(zLimit) && zLimit > 0) {
    limit = Math.min(limit, zLimit / axisFractions.z)
  }

  return limit
}


function segmentTimeWithEndpoints(
  lengthMm: number,
  vMax: number,
  accel: number,
  v0: number,
  v1: number,
): number {
  if (!Number.isFinite(lengthMm) || lengthMm <= 0) return 0
  if (!Number.isFinite(vMax) || vMax <= 0) return 0

  if (!Number.isFinite(accel) || accel <= 1e-6) {
    return lengthMm / vMax
  }

  const v0c = Math.max(0, Math.min(v0, vMax))
  const v1c = Math.max(0, Math.min(v1, vMax))

  const dAccel = Math.max(0, (vMax * vMax - v0c * v0c) / (2 * accel))
  const dDecel = Math.max(0, (vMax * vMax - v1c * v1c) / (2 * accel))

  if (dAccel + dDecel <= lengthMm) {
    // Full trapezoid.
    const cruiseDist = lengthMm - dAccel - dDecel
    const tAccel = (vMax - v0c) / accel
    const tDecel = (vMax - v1c) / accel
    const tCruise = cruiseDist / vMax
    return tAccel + tCruise + tDecel
  }

  const vpSquared = accel * lengthMm + (v0c * v0c + v1c * v1c) / 2
  if (vpSquared <= v0c * v0c) {
    const vAvg = (v0c + v1c) / 2
    return vAvg > 1e-9 ? lengthMm / vAvg : 0
  }
  const vp = Math.sqrt(vpSquared)
  const tAccel = (vp - v0c) / accel
  const tDecel = (vp - v1c) / accel
  return tAccel + tDecel
}

function computeJunctionSpeed(
  exitDirA: { x: number; y: number; z: number },
  entryDirB: { x: number; y: number; z: number },
  accel: number,
  junctionDeviationMm: number,
): number {
  if (!Number.isFinite(accel) || accel <= 1e-6) return Number.POSITIVE_INFINITY
  if (!Number.isFinite(junctionDeviationMm) || junctionDeviationMm <= 0) {
    return Number.POSITIVE_INFINITY
  }

  const cosTheta = Math.max(-1, Math.min(1,
    exitDirA.x * entryDirB.x + exitDirA.y * entryDirB.y + exitDirA.z * entryDirB.z,
  ))

  if (cosTheta >= 0.999999) return Number.POSITIVE_INFINITY // colinear
  if (cosTheta <= -0.999999) return 0 // reversal

  const sinHalf = Math.sqrt((1 - cosTheta) / 2)
  if (sinHalf >= 0.999999) return 0
  const vSquared = (accel * junctionDeviationMm * sinHalf) / (1 - sinHalf)
  return Math.sqrt(Math.max(0, vSquared)) * 60 // convert mm/s back to mm/min
}

interface PlannedSegment {
  profile: SegmentMotionProfile
  vMax: number
  accel: number
  isRapid: boolean
  vEntry: number
  vExit: number 
}

function buildJobTimingEstimate(model: GCodeModel, settings: ControllerSettings): JobTimingEstimate | null {
  const key = motionSettingsKey(settings)
  let byKey = timingCache.get(model)
  if (!byKey) {
    byKey = new Map()
    timingCache.set(model, byKey)
  }

  const cached = byKey.get(key)
  if (cached) return cached

  const junctionDeviation = Number.isFinite(settings.junctionDeviation) && (settings.junctionDeviation ?? 0) > 0
    ? (settings.junctionDeviation as number)
    : 0.01 // GRBL default ($11)

  const planned: (PlannedSegment | null)[] = new Array(model.segments.length)
  for (let i = 0; i < model.segments.length; i++) {
    const seg = model.segments[i]
    const profile = getSegmentMotionProfile(seg)
    if (!profile) {
      planned[i] = null
      continue
    }

    const maxSpeed = getAxisLimitedValue(
      profile.axisFractions,
      settings.maxRateX,
      settings.maxRateY,
      settings.maxRateZ,
    )
    const accel = getAxisLimitedValue(
      profile.axisFractions,
      settings.accelX,
      settings.accelY,
      settings.accelZ,
    )
    const isRapid = seg.moveType === 'rapid'
    const programmedSpeed = isRapid ? maxSpeed : (seg.feedMmPerMin ?? maxSpeed)
    const vMax = Math.min(programmedSpeed, maxSpeed)

    if (!Number.isFinite(vMax) || vMax <= 0) {
      planned[i] = null
      continue
    }

    planned[i] = {
      profile,
      vMax,
      accel: Number.isFinite(accel) && accel > 0 ? accel : 0,
      isRapid,
      vEntry: 0,
      vExit: 0,
    }
  }

  let nextEntrySpeed = 0
  let nextEntryDir: { x: number; y: number; z: number } | null = null
  for (let i = planned.length - 1; i >= 0; i--) {
    const cur = planned[i]
    if (!cur) continue

    let exitCap: number
    if (nextEntryDir === null) {
      exitCap = 0
    } else {
      const junctionLimit = computeJunctionSpeed(
        cur.profile.exitDir,
        nextEntryDir,
        cur.accel,
        junctionDeviation,
      )
      exitCap = Math.min(cur.vMax, junctionLimit, nextEntrySpeed)
    }
    cur.vExit = exitCap

    let vEntryMax = cur.vMax
    if (cur.accel > 0) {
      const vExitMmS = exitCap / 60
      const vEntryMaxMmS = Math.sqrt(vExitMmS * vExitMmS + 2 * cur.accel * cur.profile.lengthMm)
      vEntryMax = Math.min(cur.vMax, vEntryMaxMmS * 60)
    }
    cur.vEntry = vEntryMax

    nextEntrySpeed = vEntryMax
    nextEntryDir = cur.profile.entryDir
  }

  let prevExitSpeed = 0 // start from rest
  for (let i = 0; i < planned.length; i++) {
    const cur = planned[i]
    if (!cur) continue

    cur.vEntry = Math.min(cur.vEntry, prevExitSpeed)

    if (cur.accel > 0) {
      const vEntryMmS = cur.vEntry / 60
      const vExitFwdMmS = Math.sqrt(vEntryMmS * vEntryMmS + 2 * cur.accel * cur.profile.lengthMm)
      cur.vExit = Math.min(cur.vExit, vExitFwdMmS * 60, cur.vMax)
    } else {
      cur.vExit = Math.min(cur.vExit, cur.vMax)
    }

    prevExitSpeed = cur.vExit
  }

  const segmentSeconds = new Float64Array(model.segments.length)
  let totalSeconds = 0
  let totalRapidSeconds = 0
  let totalControlledSeconds = 0
  let hasEstimate = false

  for (let i = 0; i < planned.length; i++) {
    const cur = planned[i]
    if (!cur) {
      segmentSeconds[i] = 0
      continue
    }

    const vMaxMmS = cur.vMax / 60
    const vEntryMmS = cur.vEntry / 60
    const vExitMmS = cur.vExit / 60
    const seconds = segmentTimeWithEndpoints(
      cur.profile.lengthMm,
      vMaxMmS,
      cur.accel,
      vEntryMmS,
      vExitMmS,
    )
    segmentSeconds[i] = seconds
    totalSeconds += seconds
    if (cur.isRapid) totalRapidSeconds += seconds
    else totalControlledSeconds += seconds
    if (seconds > 0) hasEstimate = true
  }

  if (!hasEstimate || totalSeconds <= 0) return null

  const estimate = { segmentSeconds, totalSeconds, totalRapidSeconds, totalControlledSeconds }
  byKey.set(key, estimate)
  return estimate
}

function getBasename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

function fileMatchesJob(status: MachineStatus, loadedPath: string | null, fileName: string | null) {
  const jobFile = status.sdFilename
  if (!jobFile) return false

  const jobBaseName = getBasename(jobFile)

  if (loadedPath && (loadedPath === jobFile || loadedPath.replace(/\\/g, '/') === jobFile.replace(/\\/g, '/'))) {
    return true
  }

  if (fileName && fileName === jobBaseName) return true
  if (loadedPath && getBasename(loadedPath) === jobBaseName) return true

  return false
}

export function formatRuntime(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return '--:--'
  const rounded = Math.max(0, Math.round(seconds))
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const secs = rounded % 60
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function useJobRuntimeEstimate(
  status: MachineStatus,
  model: GCodeModel | null,
  controllerSettings: ControllerSettings,
  loadedPath: string | null,
  fileName: string | null,
): JobRuntimeEstimate {
  const isJobActive = status.state === 'Run' || status.state === 'Hold'
  const matchesJob = isJobActive && model && fileMatchesJob(status, loadedPath, fileName)
  const jobKey = matchesJob && status.sdFilename ? `${status.sdFilename}|${loadedPath ?? ''}|${fileName ?? ''}` : null

  // Wall-time tracking
  const activeRunStartedAtRef = useRef<number | null>(null)
  const accumulatedRunMsRef = useRef(0)
  const activeJobKeyRef = useRef<string | null>(null)

  const nominalCompletedSecRef = useRef(0)
  const lastSampleMsRef = useRef<number | null>(null)
  const lastSampleScaleRef = useRef(1)

  const [clockNowMs, setClockNowMs] = useState(() => Date.now())

  const timingEstimate = useMemo(
    () => (matchesJob && model ? buildJobTimingEstimate(model, controllerSettings) : null),
    [matchesJob, model, controllerSettings],
  )

  const overallScale = useMemo(() => {
    if (!timingEstimate || timingEstimate.totalSeconds <= 0) {
      return getOverrideScale(status.feedOverride)
    }
    const rapidScale = getOverrideScale(status.rapidOverride)
    const controlledScale = getOverrideScale(status.feedOverride)
    const rapidFrac = timingEstimate.totalRapidSeconds / timingEstimate.totalSeconds
    const controlledFrac = timingEstimate.totalControlledSeconds / timingEstimate.totalSeconds
    return rapidFrac * rapidScale + controlledFrac * controlledScale
  }, [timingEstimate, status.feedOverride, status.rapidOverride])

  const integrateUpTo = (nowMs: number, newScale: number) => {
    if (lastSampleMsRef.current === null) {
      lastSampleMsRef.current = nowMs
      lastSampleScaleRef.current = newScale
      return
    }
    const dtMs = nowMs - lastSampleMsRef.current
    if (dtMs > 0) {
      nominalCompletedSecRef.current += (dtMs / 1000) * lastSampleScaleRef.current
    }
    lastSampleMsRef.current = nowMs
    lastSampleScaleRef.current = newScale
  }

  useEffect(() => {
    if (!jobKey) {
      activeRunStartedAtRef.current = null
      accumulatedRunMsRef.current = 0
      activeJobKeyRef.current = null
      nominalCompletedSecRef.current = 0
      lastSampleMsRef.current = null
      lastSampleScaleRef.current = 1
      return
    }

    const now = Date.now()
    if (activeJobKeyRef.current !== jobKey) {
      activeJobKeyRef.current = jobKey
      accumulatedRunMsRef.current = 0
      nominalCompletedSecRef.current = 0
      activeRunStartedAtRef.current = status.state === 'Run' ? now : null
      lastSampleMsRef.current = status.state === 'Run' ? now : null
      lastSampleScaleRef.current = overallScale
      return
    }

    if (status.state === 'Run') {
      if (activeRunStartedAtRef.current === null) {
        activeRunStartedAtRef.current = now
        lastSampleMsRef.current = now
        lastSampleScaleRef.current = overallScale
      }
    } else if (activeRunStartedAtRef.current !== null) {

      accumulatedRunMsRef.current += now - activeRunStartedAtRef.current
      integrateUpTo(now, overallScale)
      activeRunStartedAtRef.current = null
      lastSampleMsRef.current = null
    }
  }, [jobKey, status.state, overallScale])

 
  useEffect(() => {
    if (!jobKey || status.state !== 'Run') return
    integrateUpTo(Date.now(), overallScale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overallScale])

  useEffect(() => {
    if (!jobKey || status.state !== 'Run') return

    const timer = window.setInterval(() => {
      const now = Date.now()
      integrateUpTo(now, overallScale)
      setClockNowMs(now)
    }, 250)

    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobKey, status.state, overallScale])

  if (!isJobActive) {
    return { source: 'none', progressPercent: null, elapsedSeconds: null, remainingSeconds: null, totalSeconds: null }
  }

  if (!timingEstimate) {
    return {
      source: 'sd',
      progressPercent: status.sdPercent ?? 0,
      elapsedSeconds: null,
      remainingSeconds: null,
      totalSeconds: null,
    }
  }

  const elapsedRunMs = accumulatedRunMsRef.current + (
    activeRunStartedAtRef.current !== null ? Math.max(0, clockNowMs - activeRunStartedAtRef.current) : 0
  )
  const elapsedSeconds = elapsedRunMs / 1000

  const sinceLastSampleMs = (lastSampleMsRef.current !== null && status.state === 'Run')
    ? Math.max(0, clockNowMs - lastSampleMsRef.current)
    : 0
  const nominalCompletedSec = nominalCompletedSecRef.current + (sinceLastSampleMs / 1000) * overallScale
  const remainingNominalSec = Math.max(0, timingEstimate.totalSeconds - nominalCompletedSec)

  const remainingSeconds = overallScale > 0 ? remainingNominalSec / overallScale : remainingNominalSec
  const totalSeconds = elapsedSeconds + remainingSeconds

  const progressPercent = timingEstimate.totalSeconds > 0
    ? clamp01(nominalCompletedSec / timingEstimate.totalSeconds) * 100
    : 0

  return {
    source: 'estimated',
    progressPercent,
    elapsedSeconds,
    remainingSeconds,
    totalSeconds,
  }
}