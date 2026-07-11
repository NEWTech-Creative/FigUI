import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { GCodeViewer } from './GCodeViewer'
import { FileManager } from './FileManager'
import { Macros } from './Macros'
import { Terminal } from './Terminal'
import { ProgramExecutionPanel } from './ProgramExecutionPanel'
import { OverridesPanel, SpindlePanel } from './JogPad'
import { PluginLauncher } from './PluginLauncher'
import type { Plugin } from '../types'
import { useMachineStore } from '../store'

interface TabletAccordionProps {
  tabletTab: string
  setTabletTab: (s: any) => void
  onLaunchPanel?: (plugin: Plugin) => void
}

export function TabletAccordion({ tabletTab, setTabletTab, onLaunchPanel }: TabletAccordionProps) {
  const [expanded, setExpanded] = useState<'visualizer' | 'program' | 'controls'>('visualizer')
  const [portraitTab, setPortraitTab] = useState<string>('viewer')
  const spindleMax = useMachineStore(s => s.controllerSettings.spindleMax)
  const hasSpindle = Boolean(spindleMax)
  const status = useMachineStore(s => s.status)
  const isProgramRunning = (status.state === 'Run' || status.state === 'Hold')
    && (!!status.sdFilename || status.plannerLineNumber != null)

  useEffect(() => {
    if (isProgramRunning) return
    if (expanded === 'program') setExpanded('visualizer')
  }, [isProgramRunning, expanded])

  const TABS = [
    { id: 'viewer',  label: 'Viewer'  },
    { id: 'files',   label: 'Files'   },
    { id: 'macros',  label: 'Macros'  },
    { id: 'terminal', label: 'Terminal' },
    { id: 'plugins', label: 'Plugins' },
  ]

  const PORTRAIT_TABS = [
    { id: 'viewer',    label: 'Viewer'    },
    { id: 'files',     label: 'Files'     },
    { id: 'macros',    label: 'Macros'    },
    { id: 'terminal',  label: 'Terminal'  },
    ...(hasSpindle ? [{ id: 'spindle', label: 'Spindle' }] : []),
    { id: 'overrides', label: 'Overrides' },
    { id: 'plugins',   label: 'Plugins'   },
  ]

  return (
    <div className="portrait:shrink-0 landscape:flex-1 landscape:basis-1/2 landscape:min-h-0 landscape:overflow-hidden flex flex-col">

      {/* ═══ PORTRAIT LAYOUT: tabbed panel → Viewer at bottom ═══ */}
      <div className="portrait:flex landscape:hidden flex-col gap-3">

        {isProgramRunning && <ProgramExecutionPanel isTablet />}

        {/* All-in-one tab panel */}
        <div className="panel flex flex-col">
          <div className="flex border-b border-border shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {PORTRAIT_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setPortraitTab(tab.id)}
                className={`px-5 py-3 text-xl font-medium uppercase tracking-wide whitespace-nowrap transition-colors border-b-2 -mb-px ${
                  portraitTab === tab.id
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-muted hover:text-text-primary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="min-h-[420px] overflow-hidden">
            {portraitTab === 'viewer'    && (
              <div className="flex flex-col gap-3 p-3">
                <GCodeViewer className="min-h-[55vh]" isTablet />
              </div>
            )}
            {portraitTab === 'files'     && <FileManager isTablet />}
            {portraitTab === 'macros'    && <Macros isTablet />}
            {portraitTab === 'terminal'  && <Terminal />}
            {portraitTab === 'spindle' && hasSpindle && (
              <div className="p-5">
                <SpindlePanel className="border-none shadow-none p-0" isTablet />
              </div>
            )}
            {portraitTab === 'overrides' && (
              <div className="p-5">
                <OverridesPanel className="border-none shadow-none p-0" isTablet />
              </div>
            )}
            {portraitTab === 'plugins'   && <PluginLauncher isTablet onLaunchPanel={onLaunchPanel} activeLayout="tablet" />}
          </div>
        </div>

      </div>

      {/* ═══ LANDSCAPE LAYOUT: accordion unchanged ═══ */}
      <div className="landscape:flex portrait:hidden flex-col gap-3 flex-1 min-h-0 overflow-hidden">

        {/* Visualizer / tabs panel */}
        <div className={`panel flex flex-col transition-all duration-300 ${expanded === 'visualizer' ? 'flex-1 min-h-0' : 'shrink-0'}`}>
          {expanded !== 'visualizer' && (
            <button
              className="panel-header text-left font-bold cursor-pointer flex justify-between items-center text-xl py-4"
              onClick={() => setExpanded('visualizer')}
            >
              <span>{TABS.find(t => t.id === tabletTab)?.label}</span>
              <ChevronRight size={22} />
            </button>
          )}
          {expanded === 'visualizer' && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="flex border-b border-border shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                {TABS.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setTabletTab(tab.id)}
                    className={`px-5 py-3 text-xl font-medium uppercase tracking-wide whitespace-nowrap transition-colors border-b-2 -mb-px ${
                      tabletTab === tab.id
                        ? 'border-accent text-accent'
                        : 'border-transparent text-text-muted hover:text-text-primary'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
                <div className="flex-1" />
                <button onClick={() => setExpanded('controls')} className="px-4 hover:text-text-primary text-text-muted">
                  <ChevronDown size={22} />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <div className={`h-full flex flex-col gap-3 p-3 overflow-y-auto ${tabletTab !== 'viewer' ? 'hidden' : ''}`}>
                  <GCodeViewer className="flex-1 min-h-[300px]" isTablet fitToViewSignal={expanded === 'visualizer'} />
                </div>
                {tabletTab === 'files'    && <FileManager isTablet />}
                {tabletTab === 'macros'   && <Macros isTablet />}
                {tabletTab === 'terminal' && <Terminal />}
                {tabletTab === 'plugins'  && <PluginLauncher isTablet onLaunchPanel={onLaunchPanel} activeLayout="tablet" />}
              </div>
            </div>
          )}
        </div>

        {isProgramRunning && (
          <div className={`panel flex flex-col transition-all duration-300 ${expanded === 'program' ? 'flex-1 min-h-0' : 'shrink-0'}`}>
            {expanded !== 'program' ? (
              <button
                className="panel-header text-left font-bold cursor-pointer flex justify-between items-center text-xl py-4"
                onClick={() => setExpanded('program')}
              >
                <span className="uppercase tracking-wide">Program execution</span>
                <ChevronRight size={22} />
              </button>
            ) : (
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                <button
                  className="panel-header flex justify-between items-center border-b border-border cursor-pointer hover:text-text-primary shrink-0 text-xl py-3"
                  onClick={() => setExpanded('visualizer')}
                >
                  <span className="uppercase tracking-wide">Program execution</span>
                  <ChevronDown size={22} />
                </button>
                <ProgramExecutionPanel isTablet accordionManaged />
              </div>
            )}
          </div>
        )}

        {/* Controls (Spindle & Overrides) panel */}
        <div className={`panel flex flex-col transition-all duration-300 ${expanded === 'controls' ? 'flex-1 min-h-0 overflow-y-auto' : 'shrink-0'}`}>
          {expanded !== 'controls' && (
            <button
              className="panel-header text-left font-bold cursor-pointer flex justify-between items-center text-xl py-4"
              onClick={() => setExpanded('controls')}
            >
              <span className="uppercase tracking-wide">{hasSpindle ? 'Spindle & Overrides' : 'Overrides'}</span>
              <ChevronRight size={22} />
            </button>
          )}
          {expanded === 'controls' && (
            <div className="flex flex-col flex-1 min-h-0">
              <button
                className="panel-header flex justify-between items-center border-b border-border cursor-pointer hover:text-text-primary shrink-0 text-xl py-3"
                onClick={() => setExpanded('visualizer')}
              >
                <span className="uppercase tracking-wide">{hasSpindle ? 'Spindle & Overrides' : 'Overrides'}</span>
                <ChevronDown size={22} />
              </button>
              <div className="flex-1 overflow-y-auto flex flex-col gap-0 p-0">
                {hasSpindle && <>
                  <SpindlePanel className="border-none shadow-none p-0" isTablet />
                  <div className="h-px bg-border w-full my-1" />
                </>}
                <OverridesPanel className="border-none shadow-none p-0" isTablet />
              </div>
            </div>
          )}
        </div>

      </div>

    </div>
  )
}
