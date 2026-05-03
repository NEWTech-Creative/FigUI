import { listFiles, fetchFileContent, getBase, createDir, deleteFile, deleteDir, uploadFile } from './http'
import type { Plugin, PluginManifest, StoreEntry } from '../types'

const PLUGINS_PATH = '/plugins'

export const STORE_REGISTRY_URL =
  'https://raw.githubusercontent.com/figamore/FluidUI/main/plugins/registry.json'

async function scanFs(fs: 'sd' | 'local'): Promise<Plugin[]> {
  const result = await listFiles(PLUGINS_PATH, fs)
  const dirs = result.files.filter(f => f.isDir)
  const plugins: Plugin[] = []
  for (const dir of dirs) {
    try {
      const manifestPath = fs === 'sd'
        ? `/sd${PLUGINS_PATH}/${dir.name}/plugin.json`
        : `${PLUGINS_PATH}/${dir.name}/plugin.json`
      const text = await fetchFileContent(manifestPath, fs)
      const manifest: PluginManifest = JSON.parse(text)
      if (!manifest.name) continue
      const entry = manifest.entry ?? 'index.html'
      const entryUrl = fs === 'sd'
        ? `${getBase()}/sd${PLUGINS_PATH}/${dir.name}/${entry}`
        : `${getBase()}${PLUGINS_PATH}/${dir.name}/${entry}`
      plugins.push({ id: dir.name, manifest, entryUrl, fs })
    } catch {}
  }
  return plugins
}

export async function discoverPlugins(): Promise<Plugin[]> {
  const [local, sd] = await Promise.allSettled([
    scanFs('local'),
    scanFs('sd'),
  ])
  return [
    ...(local.status === 'fulfilled' ? local.value : []),
    ...(sd.status === 'fulfilled' ? sd.value : []),
  ]
}

export async function uploadFolderPlugin(
  files: FileList,
  fs: 'sd' | 'local',
  onProgress: (current: number, total: number, filename: string) => void,
): Promise<string> {
  const all = Array.from(files)

  console.log('[plugins] uploadFolderPlugin: received', all.length, 'files')
  all.forEach(f => console.log('[plugins]  file:', JSON.stringify({ name: f.name, webkitRelativePath: f.webkitRelativePath, size: f.size })))

  const manifestFile = all.find(f => f.name === 'plugin.json')
  console.log('[plugins] manifestFile:', manifestFile ? `found (path="${manifestFile.webkitRelativePath}")` : 'NOT FOUND')
  if (!manifestFile) throw new Error('No plugin.json found in folder root')

  let manifest: PluginManifest
  try {
    manifest = JSON.parse(await manifestFile.text())
  } catch {
    throw new Error('plugin.json is not valid JSON')
  }
  if (!manifest.name) throw new Error('plugin.json must have a "name" field')

  const firstPath = all[0]?.webkitRelativePath ?? ''
  const folderName = firstPath.includes('/')
    ? firstPath.split('/')[0]
    : manifest.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  const rootFiles = all.filter(f => f.webkitRelativePath.split('/').length <= 2)

  try { await createDir('/', 'plugins', fs) } catch {}
  try { await createDir(PLUGINS_PATH, folderName, fs) } catch {}

  const targetDir = `${PLUGINS_PATH}/${folderName}`

  for (let i = 0; i < rootFiles.length; i++) {
    const file = rootFiles[i]
    const filename = file.webkitRelativePath.split('/')[1]
    onProgress(i + 1, rootFiles.length, filename)
    await uploadFile(targetDir, new File([file], filename, { type: file.type }), fs)
  }

  return folderName
}

export async function installStorePlugin(
  entry: StoreEntry,
  fs: 'sd' | 'local',
  onProgress: (current: number, total: number, filename: string) => void,
): Promise<void> {
  try { await createDir('/', 'plugins', fs) } catch {}
  try { await createDir(PLUGINS_PATH, entry.id, fs) } catch {}

  const targetDir = `${PLUGINS_PATH}/${entry.id}`

  for (let i = 0; i < entry.files.length; i++) {
    const filename = entry.files[i]
    onProgress(i + 1, entry.files.length, filename)
    const res = await fetch(entry.base + filename)
    if (!res.ok) throw new Error(`Failed to fetch ${filename}: HTTP ${res.status}`)
    const blob = await res.blob()
    await uploadFile(targetDir, new File([blob], filename), fs)
  }
}

export async function deletePlugin(plugin: Plugin): Promise<void> {
  try {
    const result = await listFiles(`${PLUGINS_PATH}/${plugin.id}`, plugin.fs)
    for (const file of result.files.filter(f => !f.isDir)) {
      await deleteFile(`${PLUGINS_PATH}/${plugin.id}`, file.name, plugin.fs)
    }
  } catch {}
  await deleteDir(PLUGINS_PATH, plugin.id, plugin.fs)
}

export async function fetchRegistry(): Promise<StoreEntry[]> {
  const res = await fetch(STORE_REGISTRY_URL)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data?.plugins)) throw new Error('Invalid registry format')
  return data.plugins as StoreEntry[]
}
