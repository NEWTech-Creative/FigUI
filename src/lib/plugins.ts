import { listFiles, fetchFileContent, getBase } from './http'
import type { Plugin, PluginManifest } from '../types'

const PLUGINS_PATH = '/plugins'

export async function discoverPlugins(): Promise<Plugin[]> {
  try {
    const result = await listFiles(PLUGINS_PATH, 'local')
    const dirs = result.files.filter(f => f.isDir)
    const plugins: Plugin[] = []
    for (const dir of dirs) {
      try {
        const text = await fetchFileContent(`${PLUGINS_PATH}/${dir.name}/plugin.json`, 'local')
        const manifest: PluginManifest = JSON.parse(text)
        if (!manifest.name) continue
        plugins.push({
          id: dir.name,
          manifest,
          entryUrl: `${getBase()}${PLUGINS_PATH}/${dir.name}/${manifest.entry ?? 'index.html'}`,
        })
      } catch {
        // skip plugins with missing/invalid manifests
      }
    }
    return plugins
  } catch {
    return []
  }
}
