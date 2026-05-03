# FigUI Plugin Developer Guide

Plugins are self-contained HTML files that run inside FigUI and can communicate with your FluidNC machine. They live in sandboxed iframes, inherit the UI theme automatically, and can be installed on internal storage or SD card.

---

## Table of contents

- [Plugin structure](#plugin-structure)
- [plugin.json](#pluginjson)
- [Theme](#theme)
  - [Available variables](#available-variables)
- [API](#api)
  - [getStatus](#getstatus)
  - [sendCommand](#sendcommand)
  - [sendQuery](#sendquery)
  - [subscribe / unsubscribe](#subscribe--unsubscribe)
- [Minimal example](#minimal-example)
- [Installing a plugin](#installing-a-plugin)
- [Publishing to the store](#publishing-to-the-store)
- [Tips](#tips)

---

## Plugin structure

A plugin is a folder with two required files:

```
my-plugin/
├── plugin.json   ← manifest (required)
└── index.html    ← entry point (required)
```

Additional assets (images, JS files) can be placed in the same folder. Subdirectories are not supported — keep everything flat.

---

## plugin.json

```json
{
  "name": "My Plugin",
  "description": "What it does, in one sentence.",
  "version": "1.0.0",
  "entry": "index.html",
  "icon": "icon.png"
}
```

| Field | Required | Description |
|---|---|---|
| `name` | ✅ | Display name shown in the plugin list |
| `description` | No | Short description shown below the name |
| `version` | No | Shown as a small badge (e.g. `v1.0.0`) |
| `entry` | No | Entry HTML file. Defaults to `index.html` |
| `icon` | No | Icon image filename. Recommended size: **48×48 px** |

---

## Theme

FigUI injects its CSS custom properties into your plugin's `:root` automatically. Use them directly — no setup needed.

```css
body {
  background: var(--bg);
  color: var(--text-primary);
  font-family: ui-sans-serif, system-ui, sans-serif;
}
```

### Available variables

| Variable | Use |
|---|---|
| `--bg` | Page background |
| `--surface` | Card / panel background |
| `--elevated` | Slightly lighter surface |
| `--border` | Default border |
| `--border-strong` | Emphasized border |
| `--accent` | Primary accent (orange) |
| `--accent-hover` | Accent hover state |
| `--text-primary` | Main text |
| `--text-muted` | Secondary text |
| `--text-dim` | Hint / placeholder text |
| `--ok` | Green — success |
| `--warn` | Yellow — warning |
| `--danger` | Red — error / destructive |
| `--info` | Blue — informational |
| `--purple` | Purple |
| `--teal` | Teal |

Theme changes (light/dark switch) are pushed to your plugin automatically via `postMessage` — no action needed on your end.

---

## API

Plugins communicate with FigUI via `postMessage`. A simple request/response helper:

```js
let msgId = 0
const pending = {}

function call(method, params) {
  return new Promise((resolve, reject) => {
    const id = String(++msgId)
    pending[id] = { resolve, reject }
    window.parent.postMessage(
      { type: 'fluid-request', id, method, params: params ?? {} }, '*'
    )
  })
}

window.addEventListener('message', e => {
  if (e.data?.type === 'fluid-response') {
    const p = pending[e.data.id]
    if (p) {
      delete pending[e.data.id]
      e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result)
    }
  }
})
```

### Methods

#### `getStatus`
Returns the current machine status snapshot.

```js
const status = await call('getStatus')
// status.state    → 'Idle' | 'Run' | 'Hold' | 'Alarm' | ...
// status.wpos     → { x, y, z, a?, b?, c? }
// status.mpos     → { x, y, z, a?, b?, c? }
// status.feed     → number (mm/min)
// status.spindle  → number (rpm)
// status.feedOverride    → number (%)
// status.rapidOverride   → number (%)
// status.spindleOverride → number (%)
```

#### `sendCommand`
Sends a G-code command via WebSocket. Fire-and-forget — no response data.

```js
await call('sendCommand', { command: 'G0 X0 Y0' })
await call('sendCommand', { command: 'G10 L20 P0 X0 Y0 Z0' })
```

Use this for all motion commands and G-code execution.

#### `sendQuery`
Sends a command via HTTP and returns the response text. Use for commands that return data.

```js
const result = await call('sendQuery', { command: '$$' })   // settings dump
const offsets = await call('sendQuery', { command: '$#' })  // coordinate offsets
const modes   = await call('sendQuery', { command: '$G' })  // parser state
```

#### `subscribe` / `unsubscribe`
Subscribe to live machine status events. Your plugin receives a `fluid-event` message whenever the status changes.

```js
await call('subscribe', { event: 'status' })

window.addEventListener('message', e => {
  if (e.data?.type === 'fluid-event' && e.data.event === 'status') {
    render(e.data.data)   // same shape as getStatus result
  }
})

// When done:
await call('unsubscribe', { event: 'status' })
```

---

## Minimal example

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { background: var(--bg, #0c1018); color: var(--text-primary, #e2e6f4);
         font-family: ui-sans-serif, system-ui, sans-serif; padding: 20px; }
  #state { font-size: 32px; font-weight: 700; color: var(--accent, #f0a030); }
</style>
</head>
<body>
  <div id="state">—</div>

  <script>
    let msgId = 0
    const pending = {}

    function call(method, params) {
      return new Promise((resolve, reject) => {
        const id = String(++msgId)
        pending[id] = { resolve, reject }
        window.parent.postMessage({ type: 'fluid-request', id, method, params: params ?? {} }, '*')
      })
    }

    window.addEventListener('message', e => {
      if (e.data?.type === 'fluid-response') {
        const p = pending[e.data.id]
        if (p) { delete pending[e.data.id]; e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result) }
      }
      if (e.data?.type === 'fluid-event' && e.data.event === 'status') {
        document.getElementById('state').textContent = e.data.data.state
      }
    })

    call('subscribe', { event: 'status' })
    call('getStatus').then(s => { document.getElementById('state').textContent = s.state })
  </script>
</body>
</html>
```

---

## Installing a plugin

### From folder
In FigUI → Plugins tab → **Add** → choose storage location → select your plugin folder. FigUI uploads all files automatically.

### On the device directly
Copy the plugin folder to `/plugins/` on internal storage or `/sd/plugins/` on SD card. Then hit the refresh button in the Plugins tab.

---

## Publishing to the store

1. Fork the FigUI repository
2. Add your plugin folder under `plugins/your-plugin-id/`
3. Add an entry to `plugins/registry.json`:

```json
{
  "id": "your-plugin-id",
  "name": "Your Plugin Name",
  "description": "What it does.",
  "version": "1.0.0",
  "author": "your-github-username",
  "base": "https://raw.githubusercontent.com/figamore/FigUI/main/plugins/your-plugin-id/"
}
```

4. Open a pull request

Once merged, your plugin appears in the store for all FigUI users.

---

## Tips

- **Use `sendCommand` for motion, `sendQuery` for data.** `sendCommand` goes through the WebSocket queue (same as the terminal), `sendQuery` uses HTTP and returns the response.
- **Check connection state.** If the machine is not connected, `sendCommand` and `sendQuery` will reject with `"Not connected"`.
