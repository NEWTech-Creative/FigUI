#!/usr/bin/env python3

# Usage: python3 fluidnc-web-sim.py [FluidNC_IP]
# Then browse to http://localhost:8080
#
# proxy=False  Simulates a FluidNC machine locally. No hardware needed.
# proxy=True   Forwards HTTP to a real FluidNC device and bridges WebSocket.
#
# Dependencies: pip install flask websockets requests zeroconf

proxy = True

import asyncio, json, os, re, shutil, sys, threading, random

import requests
from flask import Flask, request, send_from_directory, Response

try:
    import websockets
except ImportError:
    print("websockets missing; pip install websockets"); sys.exit(1)

fluidnc_ip     = ''
fluidnc_ws_url = ''   # resolved from real ESP800 in proxy mode
http_port  = 8080
ws_port    = 8081

# ─── Legacy websockets client (more permissive with ESP32 handshakes) ─────────
# websockets v14+ is strict about HTTP 101; ESP32 arduinoWebSockets isn't.
# Fall back to standard connect if legacy isn't available.
try:
    import websockets.legacy.client as _ws_legacy
    _ws_connect = _ws_legacy.connect
except (ImportError, AttributeError):
    _ws_connect = websockets.connect

def _resolve_ws_url(ip: str) -> str:
    """
    Fetch ESP800 from the real FluidNC device and extract the WebSocket endpoint.
    Falls back to ws://<ip>:81 if parsing fails.
    """
    try:
        r = requests.get(f'http://{ip}/command',
                         params={'plain': '[ESP800]'}, timeout=5)
        r.raise_for_status()
        raw = r.text
        print(f'  ESP800: {raw[:200]}')
        for field in raw.split('#'):
            if field.startswith('webcommunication:'):
                wscomm  = field[len('webcommunication:'):].strip()
                parts   = wscomm.split(':')
                ws_port_real = parts[1].strip() if len(parts) > 1 else '80'
                ws_ip_real   = parts[2].strip() if len(parts) > 2 else ip
                url = f'ws://{ws_ip_real}:{ws_port_real}/'
                print(f'  Real FluidNC WS endpoint: {url}')
                return url
        print('  Could not find webcommunication field in ESP800')
    except Exception as e:
        print(f'  Could not reach {ip}: {e}')
    url = f'ws://{ip}:80/'
    print(f'  Falling back to: {url}')
    return url

if proxy:
    if len(sys.argv) < 2:
        print("proxy=True requires FluidNC IP as argument"); sys.exit(1)
    fluidnc_ip = sys.argv[1]
    print(f"Proxying to FluidNC at {fluidnc_ip}")
    fluidnc_ws_url = _resolve_ws_url(fluidnc_ip)
    print()

# ─── Machine state (standalone) ───────────────────────────────────────────────

machine = {
    'state':      'Idle',
    'wpos':       [0.0, 0.0, 0.0],
    'mpos':       [0.0, 0.0, 0.0],
    'feed':       0,
    'spindle':    0,
    'feed_ov':    100,
    'rapid_ov':   100,
    'spindle_ov': 100,
    'sd_file':    None,
    'sd_pct':     0,
}
_lock = threading.Lock()

def status_report():
    with _lock:
        m = machine
        w, p = m['wpos'], m['mpos']
        s = (f"<{m['state']}|WPos:{w[0]:.3f},{w[1]:.3f},{w[2]:.3f}"
             f"|MPos:{p[0]:.3f},{p[1]:.3f},{p[2]:.3f}"
             f"|FS:{m['feed']},{m['spindle']}"
             f"|Ov:{m['feed_ov']},{m['rapid_ov']},{m['spindle_ov']}>")
        if m['sd_file']:
            s = s[:-1] + f"|SD:{m['sd_file']},{m['sd_pct']}>"
    return s

def handle_realtime(byte):
    with _lock:
        m = machine
        if   byte == 0x21: m['state'] = 'Hold' if m['state'] in ('Run', 'Jog') else m['state']
        elif byte == 0x7E: m['state'] = 'Run'  if m['state'] == 'Hold' else m['state']
        elif byte == 0x18: m.update(state='Idle', feed=0, spindle=0)
        elif byte == 0x85: m['state'] = 'Idle' if m['state'] == 'Jog' else m['state']
        elif byte == 0x90: m['feed_ov'] = 100
        elif byte == 0x91: m['feed_ov'] = min(200, m['feed_ov'] + 10)
        elif byte == 0x92: m['feed_ov'] = max(10,  m['feed_ov'] - 10)
        elif byte == 0x95: m['rapid_ov'] = 100
        elif byte == 0x96: m['rapid_ov'] = 50
        elif byte == 0x97: m['rapid_ov'] = 25
        elif byte == 0x99: m['spindle_ov'] = 100
        elif byte == 0x9A: m['spindle_ov'] = min(200, m['spindle_ov'] + 10)
        elif byte == 0x9B: m['spindle_ov'] = max(10,  m['spindle_ov'] - 10)

AXIS    = {'X':0,'Y':1,'Z':2,'A':3,'B':4,'C':5}
JOG_RE  = re.compile(r'\$J=.*?F(\d+(?:\.\d+)?)\s+([XYZABC])(-?\d+(?:\.\d+)?)', re.I)
ZERO_RE = re.compile(r'G10\s+L20\s+P0\s+([XYZABC])(-?\d+(?:\.\d+)?)', re.I)
PROBE_RE = re.compile(r'G38\.\d\s+F(\d+(?:\.\d+)?)\s+Z(-\d+(?:\.\d+)?)', re.I)
SPINDLE_RE = re.compile(r'S(\d+)\s+(M3|M4)', re.I)

async def handle_text_command(cmd, ws):
    cmd = cmd.strip()
    if not cmd:
        return
    if cmd.startswith('PING'):
        return  # out-of-band keepalive, no response needed
    print(f'  cmd: {cmd!r}')

    if cmd == '?':
        await ws.send(status_report() + '\n')
        return

    if cmd in ('$H', '$HOME'):
        with _lock: machine.update(state='Home', feed=2000)
        await asyncio.sleep(1.5)
        with _lock: machine.update(wpos=[0.,0.,0.], mpos=[0.,0.,0.], state='Idle', feed=0)
        await ws.send('ok\n'); return

    m = re.match(r'\$H([XYZABC])', cmd, re.I)
    if m:
        i = AXIS.get(m.group(1).upper(), 0)
        with _lock: machine['state'] = 'Home'
        await asyncio.sleep(0.8)
        with _lock:
            machine['wpos'][i] = machine['mpos'][i] = 0.0
            machine['state'] = 'Idle'
        await ws.send('ok\n'); return

    m = JOG_RE.search(cmd)
    if m:
        feed = float(m.group(1))
        i    = AXIS.get(m.group(2).upper(), 0)
        dist = float(m.group(3))
        with _lock: machine.update(state='Jog', feed=int(feed))
        await asyncio.sleep(min(abs(dist) / (feed / 60), 2.0))
        with _lock:
            if machine['state'] == 'Jog':
                if i < len(machine['wpos']):
                    machine['wpos'][i] += dist
                    machine['mpos'][i] += dist
                machine.update(state='Idle', feed=0)
        await ws.send('ok\n'); return

    # G38.x probe cycle — simulate contact at half the travel distance
    m = PROBE_RE.search(cmd)
    if m:
        feed = float(m.group(1))
        dist = float(m.group(2))   # negative Z distance
        with _lock: machine.update(state='Run', feed=int(feed))
        travel_time = min(abs(dist / 2) / (feed / 60), 3.0)
        await asyncio.sleep(travel_time)
        with _lock:
            contact_z = dist / 2
            machine['wpos'][2] += contact_z
            machine['mpos'][2] += contact_z
            machine.update(state='Idle', feed=0)
            pos = machine['wpos'][:]
        await ws.send(f"[PRB:{pos[0]:.3f},{pos[1]:.3f},{pos[2]:.3f}:1]\n")
        await ws.send('ok\n'); return

    # Spindle speed: S{rpm} M3/M4
    m = SPINDLE_RE.search(cmd)
    if m:
        rpm = int(m.group(1))
        with _lock: machine['spindle'] = rpm
        await ws.send('ok\n'); return

    # Spindle stop: M5
    if re.match(r'^M5\b', cmd, re.I):
        with _lock: machine['spindle'] = 0
        await ws.send('ok\n'); return

    m = ZERO_RE.search(cmd)
    if m:
        i = AXIS.get(m.group(1).upper(), 0)
        with _lock:
            if i < len(machine['wpos']): machine['wpos'][i] = float(m.group(2))
        await ws.send('ok\n'); return

    if cmd == '$SS':
        await ws.send('[MSG:INFO: FluidNC v3.8 (Simulator)]\n')
        await ws.send('[MSG:INFO: Connecting to STA SSID: SimNet]\n')
        await ws.send('[MSG:INFO: Connected - IP is 127.0.0.1]\n')
        await ws.send('ok\n'); return

    if cmd == '$X':
        with _lock: machine['state'] = 'Idle'
        await ws.send('ok\n'); return

    if cmd == '$Motors/Disable':
        await ws.send('[MSG:INFO: Motors disabled]\n')
        await ws.send('ok\n'); return

    m = re.match(r'\$SD/Run=(.*)', cmd, re.I)
    if m:
        asyncio.create_task(_run_sd(m.group(1), ws)); return

    await ws.send('ok\n')

async def _run_sd(fname, ws):
    with _lock: machine.update(state='Run', sd_file=fname, sd_pct=0, feed=1500)
    for pct in range(0, 101, 5):
        with _lock:
            if machine['state'] != 'Run': break
            machine['sd_pct'] = pct
        await asyncio.sleep(0.4)
    with _lock: machine.update(state='Idle', sd_file=None, sd_pct=0, feed=0)
    try: await ws.send('ok\n')
    except: pass

# ─── WebSocket handlers ───────────────────────────────────────────────────────

async def simulate_handler(websocket):
    page_id = str(random.randint(1000, 9999))
    await websocket.send(f'CURRENT_ID:{page_id}')
    print(f'WS connected (id={page_id})')

    async def status_loop():
        while True:
            try:
                await websocket.send(status_report() + '\n')
            except Exception:
                break
            await asyncio.sleep(0.5)

    task = asyncio.create_task(status_loop())
    try:
        async for message in websocket:
            if isinstance(message, bytes):
                if len(message) == 1:
                    handle_realtime(message[0])
                else:
                    for line in message.decode(errors='replace').split('\n'):
                        if line.strip():
                            await handle_text_command(line, websocket)
            else:
                for line in message.split('\n'):
                    if line.strip():
                        await handle_text_command(line, websocket)
    except Exception:
        pass
    finally:
        task.cancel()
        print('WS disconnected')

async def proxy_handler(websocket):
    page_id = str(random.randint(1000, 9999))
    await websocket.send(f'CURRENT_ID:{page_id}')
    print(f'WS proxy: browser connected, opening upstream → {fluidnc_ws_url}')
    try:
        async with _ws_connect(fluidnc_ws_url, subprotocols=['arduino']) as upstream:
            async def fwd():
                async for msg in upstream:
                    try: await websocket.send(msg)
                    except: break
            task = asyncio.create_task(fwd())
            try:
                async for msg in websocket:
                    await upstream.send(msg)
            except Exception:
                pass
            finally:
                task.cancel()
    except Exception as e:
        print(f'WS proxy upstream error: {e}')
        print(f'  Endpoint was: {fluidnc_ws_url}')

async def run_ws():
    handler = proxy_handler if proxy else simulate_handler
    async with websockets.serve(handler, 'localhost', ws_port, subprotocols=['arduino']):
        await asyncio.Future()

def start_ws_thread():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(run_ws())

# ─── Flask HTTP ───────────────────────────────────────────────────────────────

app = Flask(__name__)

test_files = 'test_files'

esp800resp = (
    f'FW version:FluidNC v4.0.0-sim'
    f'#FW target:grbl-embedded'
    f'#FW HW:Direct SD'
    f'#primary sd:/sd/'
    f'#secondary sd:/ext/'
    f'#authentication:no'
    f'#webcommunication:Sync:{ws_port}:localhost'
    f'#hostname:fluidnc-sim'
    f'#axis:3'
)

# Helper functions — P=H (matches real FluidNC firmware: JSONEncoder sets both to the same path)
def _R(P, V, mn='0', mx='100000'): return {'F':'nvs','P':P,'H':P,'T':'R','V':V,'M':mn,'S':mx}
def _I(P, V, mn='0', mx='32767'):  return {'F':'nvs','P':P,'H':P,'T':'I','V':V,'M':mn,'S':mx}
def _S(P, V, mx='64'):             return {'F':'nvs','P':P,'H':P,'T':'S','V':V,'M':'0','S':mx}
def _B(P, V, opts):                return {'F':'nvs','P':P,'H':P,'T':'B','V':V,'M':'0','S':'0','O':opts}
# O must be a JSON array of single-key objects: [{"OFF":0},{"ON":1}]
_YN         = [{'Disabled': 0}, {'Enabled': 1}]
_WIFI_MODE  = [{'OFF': 0}, {'STA': 1}, {'AP': 2}]
_MSG_LEVEL  = [{'None': 0}, {'Error': 1}, {'Warn': 2}, {'Info': 3}, {'Debug': 4}, {'Verbose': 5}]
_NOTIF_TYPE = [{'None': 0}, {'PushOver': 1}, {'Email': 2}, {'Line': 3}, {'Telegram': 4}]

esp400resp = json.dumps({'EEPROM': [

    # ── WiFi & Network ────────────────────────────────────────────────────────
    _B('WiFi/Mode',       '1',  _WIFI_MODE),
    _S('Sta/SSID',        '',   '32'),
    _S('Sta/Password',    '',   '64'),
    _S('Sta/StaticIP',    '',   '15'),
    _S('Sta/Gateway',     '',   '15'),
    _S('Sta/Netmask',     '',   '15'),
    _S('AP/SSID',         'FluidNC', '32'),
    _S('AP/Password',     '',   '64'),
    _S('AP/Country',      'CN', '2'),
    _I('AP/Channel',      '1',  '1', '13'),
    _S('Hostname',        'fluidnc-sim', '32'),

    # ── Services ──────────────────────────────────────────────────────────────
    _B('HTTP/Enable',              '1', _YN),
    _I('HTTP/Port',                '80',  '1', '65535'),
    _B('Telnet/Enable',            '0', _YN),
    _I('Telnet/Port',              '23',  '1', '65535'),
    _B('MDNS/Enable',              '1', _YN),
    _B('Bluetooth/Enable',         '0', _YN),
    _S('Bluetooth/Name',           'FluidNC', '32'),
    _B('Notification/Type',        '0', _NOTIF_TYPE),
    _S('Notification/T1',          '', '64'),
    _S('Notification/T2',          '', '64'),
    _S('Notification/TS',          '', '64'),

    # ── System ────────────────────────────────────────────────────────────────
    _B('Message/Level',            '3', _MSG_LEVEL),
    _S('Config/Filename',          '/sd/config.yaml', '80'),
    _I('Report/Status',            '0', '0', '60000'),
    _B('GCode/Echo',               '0', _YN),
    _B('Start/CheckMode',          '0', _YN),

    # ── Machine — Grbl proxy (read-only mirror of machine YAML config) ────────
    _R('Grbl/Resolution/X',        '200.000'),
    _R('Grbl/Resolution/Y',        '200.000'),
    _R('Grbl/Resolution/Z',        '400.000'),
    _R('Grbl/MaxRate/X',           '5000.000'),
    _R('Grbl/MaxRate/Y',           '5000.000'),
    _R('Grbl/MaxRate/Z',           '1500.000'),
    _R('Grbl/Acceleration/X',      '200.000'),
    _R('Grbl/Acceleration/Y',      '200.000'),
    _R('Grbl/Acceleration/Z',      '80.000'),
    _R('Grbl/MaxTravel/X',         '300.000'),
    _R('Grbl/MaxTravel/Y',         '300.000'),
    _R('Grbl/MaxTravel/Z',         '100.000'),
    _R('Grbl/MaxSpindleSpeed',     '24000.000'),
    _B('Grbl/LaserMode',           '0', _YN),
    _B('Grbl/HomingCycleEnable',   '1', _YN),
    _B('Grbl/HardLimitsEnable',    '0', _YN),
    _B('Grbl/SoftLimitsEnable',    '0', _YN),
]})

def do_proxy(req):
    url = req.url.replace(req.host_url, f'http://{fluidnc_ip}/')
    try:
        resp = requests.request(
            method=req.method, url=url,
            headers={k: v for k, v in req.headers if k.lower() != 'host'},
            data=req.get_data(), cookies=req.cookies, timeout=10,
        )
        excluded = {'content-encoding', 'transfer-encoding', 'connection'}
        headers  = [(k, v) for k, v in resp.headers.items() if k.lower() not in excluded]
        return Response(resp.content, status=resp.status_code, headers=headers)
    except Exception as e:
        return {'error': str(e)}, 502

def make_files_list(fs, subdir, status):
    directory = os.path.join(test_files, fs, subdir)
    os.makedirs(directory, exist_ok=True)
    usage = shutil.disk_usage(directory)
    files = []
    for name in sorted(os.listdir(directory)):
        fp = os.path.join(directory, name)
        is_dir = os.path.isdir(fp)
        files.append({
            'name': name, 'shortname': name,
            'size': -1 if is_dir else os.path.getsize(fp),
            'isDir': is_dir,
            'datetime': '',
        })
    occ = int(round(100 * usage.used / usage.total)) if usage.total else 0
    return json.dumps({'files': files, 'path': subdir,
                       'total': usage.total, 'used': usage.used,
                       'occupation': occ, 'status': status})

def _strip_path(fs_dir, path):
    """Normalise a WebUI path like '/sd/subdir/' to just 'subdir/'."""
    if path.startswith('/'): path = path[1:]
    # Strip the filesystem root prefix that the WebUI prepends
    # e.g. 'sd/' or 'ext/' when the request comes from the SD card view
    prefix = fs_dir + '/'
    if path == fs_dir:           return ''
    if path.startswith(prefix):  return path[len(prefix):]
    return path

def handle_fs_action(fs_dir, request):
    """Shared file-operation logic for both /upload (SD) and /files (localfs)."""
    action = request.args.get('action')
    raw_path = request.args.get('path', '/')
    fname    = request.args.get('filename') or ''
    path     = _strip_path(fs_dir, raw_path)
    localdir  = os.path.join(test_files, fs_dir, path)
    localpath = os.path.join(localdir, fname)
    os.makedirs(localdir, exist_ok=True)

    if request.method == 'POST':
        for f in request.files.values():
            f.save(os.path.join(localdir, f.filename))
    elif action == 'delete':
        try: os.remove(localpath)
        except: pass
    elif action == 'deletedir':
        shutil.rmtree(localpath, ignore_errors=True)
    elif action == 'createdir':
        os.makedirs(localpath, exist_ok=True)
    elif action == 'rename':
        newname = request.args.get('newname', '')
        if newname:
            try: os.rename(localpath, os.path.join(localdir, newname))
            except: pass

    return make_files_list(fs_dir, path, 'Ok')

@app.route('/')
def index():
    return send_from_directory('dist', 'index.html.gz')

@app.route('/command')
@app.route('/command_silent')
def do_command():
    plain = request.args.get('plain', '')
    if plain == '[ESP800]':
        return esp800resp
    if proxy:
        return do_proxy(request)
    if plain == '[ESP400]':         return esp400resp
    if plain.startswith('[ESP401]'): return 'ok'
    if plain == '[ESP444]RESTART':  return 'ok'
    return 'ok'

@app.route('/upload', methods=['GET', 'POST'])
def upload():
    if proxy:
        return do_proxy(request)
    return handle_fs_action('sd', request)

@app.route('/files', methods=['GET', 'POST'])
def do_files():
    if proxy:
        return do_proxy(request)
    return handle_fs_action('localfs', request)

# ─── File download routes ─────────────────────────────────────────────────────

@app.route('/sd/<path:filename>')
def serve_sd_file(filename):
    return send_from_directory(os.path.join(test_files, 'sd'), filename)

@app.route('/ext/<path:filename>')
def serve_ext_file(filename):
    return send_from_directory(os.path.join(test_files, 'localfs'), filename)

@app.route('/localfs/<path:filename>')
def serve_localfs_file(filename):
    return send_from_directory(os.path.join(test_files, 'localfs'), filename)

# ─── Start ────────────────────────────────────────────────────────────────────

threading.Thread(target=start_ws_thread, daemon=True).start()

print(f'Mode : {"proxy → " + fluidnc_ip if proxy else "standalone simulation"}')
print(f'HTTP : http://localhost:{http_port}')
print(f'WS   : ws://localhost:{ws_port}')
print()
app.run(host='0.0.0.0', port=http_port, threaded=True)
