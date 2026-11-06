// MuMu 模拟器内存监控 - 便携版本地服务(支持多实例)
// 零配置:自动探测 MuMu 自带 adb,找不到则使用包内 adb
// 可用环境变量覆盖: ADB_PATH / PORTS / PORT
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PUBLIC_DIR = __dirname;

/* ---------- adb 定位:优先 MuMu 自带(避免版本冲突),兜底包内 adb ---------- */
function findAdb() {
  if (process.env.ADB_PATH && fs.existsSync(process.env.ADB_PATH)) return process.env.ADB_PATH;

  const candidates = [];
  const pfBases = [
    process.env.ProgramFiles, process.env['ProgramFiles(x86)'],
    'C:\\Program Files', 'C:\\Program Files (x86)',
  ];
  const subDirs = [
    'Netease\\MuMuPlayer-12.0\\shell', 'Netease\\MuMuPlayerGlobal-12.0\\shell',
    'Netease\\MuMuPlayer-15.0\\shell', 'Netease\\MuMuPlayerGlobal-15.0\\shell',
    'Netease\\MuMuNxDevice\\shell', 'Netease\\MuMuPlayer\\shell',
  ];
  for (const base of pfBases) {
    if (!base) continue;
    for (const sub of subDirs) candidates.push(path.join(base, sub, 'adb.exe'));
  }
  // 常见自定义盘符安装(D:\MuMuPlayer 等)
  for (const drv of ['C:', 'D:', 'E:', 'F:', 'G:']) {
    const root = drv + '\\MuMuPlayer';
    candidates.push(path.join(root, 'nx_main', 'adb.exe'));
    // nx_device\{12.0,15.0}\shell\adb.exe 目录结构
    const nx = path.join(root, 'nx_device');
    if (fs.existsSync(nx)) {
      for (const ver of fs.readdirSync(nx)) {
        candidates.push(path.join(nx, ver, 'shell', 'adb.exe'));
      }
    }
  }
  for (const c of candidates) if (fs.existsSync(c)) return c;

  // 兜底:包内自带
  const bundled = path.join(__dirname, 'adb', 'adb.exe');
  if (fs.existsSync(bundled)) return bundled;
  return 'adb'; // 最后退回 PATH(用户自己装过 platform-tools 的情况)
}

const ADB = findAdb();

/* ---------- 端口与实例发现 ---------- */
const HTTP_PORT_BASE = parseInt(process.env.PORT || '8765', 10);
// 默认扫描 MuMu 多开端口段:实例 i → 16384 + 32*i(MuMu 12/15),外加旧版 7555
const DEFAULT_PORTS = [...Array(10).keys()].map(i => 16384 + 32 * i).concat([7555]);
const PORTS = process.env.PORTS
  ? process.env.PORTS.split(',').map(s => s.trim()).filter(Boolean)
  : DEFAULT_PORTS;

function adb(args, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const p = spawn(ADB, args, { windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill(); reject(new Error('adb 命令超时')); }, timeoutMs);
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('close', code => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(err.trim() || `adb 退出码 ${code}`)); });
    p.on('error', e => { clearTimeout(t); reject(e); });
  });
}

let liveDevices = []; // [{ addr, label }]  addr 形如 127.0.0.1:16384

async function discover() {
  // 逐端口 connect(未开的端口会被立刻拒绝,不碍事)
  await Promise.all(PORTS.map(p => adb(['connect', `127.0.0.1:${p}`], 3000).catch(() => {})));
  let list = [];
  try {
    const out = await adb(['devices'], 4000);
    for (const line of out.split('\n').slice(1)) {
      const m = line.match(/^(\S+)\s+device\b/);
      if (m) list.push(m[1]);
    }
  } catch { /* adb server 不可用则保持上次结果 */ }
  // 只保留我们端口段里的 tcp 设备(排除 emulator-xxxx 等重复入口,与 tcp 端口是同一实例)
  const wanted = new Set(PORTS.map(p => `127.0.0.1:${p}`));
  list = list.filter(a => wanted.has(a));
  // 7555(旧版别名)与 16384 同时在线时视为同一实例,只保留 16384
  if (list.includes('127.0.0.1:16384') && list.includes('127.0.0.1:7555')) {
    list = list.filter(a => a !== '127.0.0.1:7555');
  }
  const next = [];
  for (const addr of list) {
    const port = parseInt(addr.split(':')[1], 10);
    // MuMu 实例编号:16384 → 0, 16416 → 1 …;7555 为旧版单开
    const idx = port >= 16384 && (port - 16384) % 32 === 0 ? (port - 16384) / 32 : null;
    next.push({ addr, label: idx !== null ? `实例 ${idx}` : `端口 ${port}` });
  }
  if (next.length) liveDevices = next;
  return liveDevices;
}

/* ---------- 采集 ---------- */
function parseMeminfo(text) {
  const m = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const v = parseInt(line.slice(i + 1).trim(), 10);
    if (!isNaN(v)) m[line.slice(0, i).trim()] = v; // 单位 KB
  }
  return m;
}

function parseProcesses(text) {
  const procs = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([\d,]+)K:\s+(.+?)\s+\(pid\s+(\d+)/);
    if (m) procs.push({ name: m[2], pid: +m[3], pssKb: parseInt(m[1].replace(/,/g, ''), 10) });
  }
  return procs;
}

// 一次 shell 调用同时取系统内存 + 进程 PSS 列表,降低 1s 轮询开销
const SHELL_CMD =
  "cat /proc/meminfo; echo '@@SPLIT@@'; dumpsys meminfo | sed -n '/Total PSS by/,/^$/p'; echo '@@SPLIT@@'; getprop ro.product.model; getprop ro.build.version.release";

const deviceCache = new Map(); // addr -> { ts, data }
async function collectDevice(dev) {
  const now = Date.now();
  const cached = deviceCache.get(dev.addr);
  if (cached && now - cached.ts < 900) return cached.data;
  try {
    const out = await adb(['-s', dev.addr, 'shell', SHELL_CMD]);
    const parts = out.split('@@SPLIT@@');
    const meminfo = parseMeminfo(parts[0] || '');
    const processes = parseProcesses(parts[1] || '');
    if (!meminfo.MemTotal) throw new Error('未能解析 /proc/meminfo');
    const meta = (parts[2] || '').split('\n').map(s => s.trim()).filter(Boolean);
    const data = {
      addr: dev.addr, label: dev.label, ok: true, ts: now,
      model: meta[0] || '', android: meta[1] || '',
      meminfo, processes: processes.slice(0, 12),
    };
    deviceCache.set(dev.addr, { ts: now, data });
    return data;
  } catch (e) {
    return { addr: dev.addr, label: dev.label, ok: false, ts: now, error: String(e.message || e) };
  }
}

async function collectAll() {
  await discover();
  const results = await Promise.all(liveDevices.map(collectDevice));
  return { ok: results.some(r => r.ok), ts: Date.now(), devices: results };
}

/* ---------- HTTP(端口被占自动 +1 重试) ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/stats')) {
    const data = await collectAll();
    res.writeHead(data.ok ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
    return;
  }
  const file = req.url === '/' ? 'index.html' : path.basename(req.url);
  const fp = path.join(PUBLIC_DIR, file);
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
    return;
  }
  res.writeHead(404); res.end('Not Found');
});

let listenGen = 0; // Windows 下端口占用可能先触发 listening 再报 EADDRINUSE,用它作废过期的监听
function listen(port, attempt) {
  if (attempt > 10) { console.error('找不到可用端口(8765-8775 均被占用)'); process.exit(1); }
  const myGen = ++listenGen;
  server.once('error', e => {
    if (e.code === 'EADDRINUSE') { listen(port + 1, attempt + 1); }
    else { console.error(e.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    // 延迟确认:若期间发生了端口冲突重试,则放弃本次(不打印 banner、不开浏览器)
    setTimeout(() => {
      if (myGen !== listenGen) return;
      const addr = server.address();
      if (!addr) return;
      const url = `http://127.0.0.1:${addr.port}`;
      console.log(`MuMu 多实例内存监控已启动: ${url}`);
      console.log(`adb: ${ADB}`);
      console.log(`扫描端口: ${PORTS.join(', ')}`);
      console.log('提示:关闭本窗口即停止监控。若页面显示无实例,请先启动 MuMu 模拟器。');
      // 自动打开浏览器
      if (!process.env.NO_BROWSER) {
        spawn('cmd', ['/c', 'start', '', url], { windowsHide: true, detached: true }).unref();
      }
    }, 600);
  });
}

discover().then(() => listen(HTTP_PORT_BASE, 0)).catch(e => {
  console.error('启动失败:', e.message);
  process.exit(1);
});
setInterval(discover, 5000); // 定期扫描,新开的实例 5 秒内自动出现
