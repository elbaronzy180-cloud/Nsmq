// Blaise workspace agent. Started by .devcontainer/blaise/devcontainer.json. Plain Node, no packages.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, openSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

const PORT = Number(process.env.BLAISE_AGENT_PORT || 7777);
const ROOT = process.cwd();
const OK = [ROOT, homedir(), tmpdir()];
const MAX_FILE = 40 * 1024 * 1024;
const bg = new Map();
const MARK = join(homedir(), '.blaise-setup-v1');
let setup = existsSync(MARK) ? 'done' : 'running';
const findChrome = () => { try { const base = join(homedir(), '.cache', 'ms-playwright'); const d = readdirSync(base).filter((x) => x.startsWith('chromium-')).sort().pop(); if (d) for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) { const p = join(base, d, sub); if (existsSync(p)) return p; } } catch {} return existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : ''; };
const extraEnv = () => { const c = findChrome(); return c ? { CHROME: c } : {}; };
if (setup === 'running') {
  const script = join(ROOT, '.devcontainer/blaise/setup.sh');
  const child = spawn('bash', [script], { cwd: ROOT, stdio: 'ignore' });
  child.on('close', (code) => { setup = findChrome() ? 'done' : 'failed'; if (setup === 'done') { try { writeFileSync(MARK, String(Date.now())); } catch {} } });
  child.on('error', () => { setup = 'failed'; });
}
const inside = (p) => OK.some((r) => p === r || p.startsWith(r + sep));
const safe = (p) => { const full = resolve(ROOT, String(p || '.')); return inside(full) ? full : null; };
const send = (res, status, body) => { const b = JSON.stringify(body); res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) }); res.end(b); };
const body = (req) => new Promise((ok, no) => { let n = 0; const parts = []; req.on('data', (c) => { n += c.length; if (n > 60e6) { no(new Error('too big')); req.destroy(); } else parts.push(c); }); req.on('end', () => { try { ok(parts.length ? JSON.parse(Buffer.concat(parts).toString()) : {}); } catch (e) { no(e); } }); req.on('error', no); });
const tail = (file, n) => { try { const b = readFileSync(file); return b.subarray(Math.max(0, b.length - n)).toString('utf8'); } catch { return ''; } };

function run(command, o) {
  return new Promise((done) => {
    let out = '', err = '', timedOut = false, truncated = false, cwd = ROOT;
    const marker = '__BLAISE_CWD__' + Math.random().toString(36).slice(2);
    const child = spawn('bash', ['-lc', 'trap \'echo ' + marker + '"$PWD" >&2\' EXIT\n' + command], { cwd: ROOT, env: { ...process.env, ...extraEnv(), ...(o.env || {}), CI: '1', GIT_TERMINAL_PROMPT: '0' }, detached: true });
    const cap = 1_000_000;
    child.stdout.on('data', (d) => { if (out.length < cap) out += d; else truncated = true; });
    child.stderr.on('data', (d) => { if (err.length < cap) err += d; else truncated = true; });
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, Math.min(Math.max(o.timeoutMs || 60000, 1000), 600000));
    child.on('close', (code) => { clearTimeout(timer); const i = err.lastIndexOf(marker); if (i >= 0) { cwd = err.slice(i + marker.length).trim() || cwd; err = err.slice(0, i); } done({ stdout: out, stderr: err, exitCode: timedOut ? null : code, timedOut, truncated, cwd }); });
  });
}

function startBg(command, o) {
  const log = join(tmpdir(), 'blaise-bg-' + Date.now() + '.log');
  const fd = openSync(log, 'a');
  const child = spawn('bash', ['-lc', command], { cwd: ROOT, env: { ...process.env, ...extraEnv(), ...(o.env || {}) }, detached: true, stdio: ['ignore', fd, fd] });
  child.unref(); bg.set(child.pid, { pid: child.pid, cmd: command.slice(0, 200), log, alive: true }); child.on('close', () => { const p = bg.get(child.pid); if (p) p.alive = false; });
  return child.pid;
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://x'); const path = url.pathname.replace(/^\/computers\/[a-f0-9]{32}/, '') || '/';
    const pv = /^\/preview\/(\d{4,5})(\/.*)?$/.exec(path);
    if (pv) {
      const port = Number(pv[1]); const target = (pv[2] || '/') + url.search;
      const chunks = []; if (!['GET', 'HEAD'].includes(req.method)) for await (const c of req) chunks.push(c);
      const hdr = {}; for (const k of ['accept', 'accept-language', 'content-type', 'range', 'user-agent']) if (typeof req.headers[k] === 'string') hdr[k] = req.headers[k];
      const up = http.request({ host: '127.0.0.1', port, path: target, method: req.method, headers: hdr, timeout: 25000 }, (r) => { const h = { ...r.headers }; delete h['transfer-encoding']; delete h.connection; res.writeHead(r.statusCode || 502, h); r.pipe(res); });
      up.on('error', () => { if (!res.headersSent) send(res, 502, { error: 'nothing_listening' }); else res.end(); }); up.on('timeout', () => up.destroy());
      up.end(Buffer.concat(chunks)); return;
    }
    if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true, root: ROOT, agent: 1, setup, chrome: !!findChrome() });
    if (req.method === 'POST' && path === '/exec') { const b = await body(req); if (b.background) return send(res, 200, { pid: startBg(String(b.command), b) }); return send(res, 200, await run(String(b.command), b)); }
    if (req.method === 'GET' && path === '/file') { const f = safe(url.searchParams.get('path')); if (!f) return send(res, 400, { error: 'bad_path' }); try { const s = statSync(f); if (!s.isFile()) return send(res, 404, { error: 'not_found' }); if (s.size > MAX_FILE) return send(res, 413, { error: 'too_big' }); return send(res, 200, { data: readFileSync(f).toString('base64'), size: s.size }); } catch { return send(res, 404, { error: 'not_found' }); } }
    if (req.method === 'PUT' && path === '/file') { const b = await body(req); const f = safe(b.path); if (!f) return send(res, 400, { error: 'bad_path' }); const buf = b.encoding === 'base64' ? Buffer.from(String(b.content), 'base64') : Buffer.from(String(b.content), 'utf8'); if (buf.length > MAX_FILE) return send(res, 413, { error: 'too_big' }); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, buf); return send(res, 200, { size: buf.length }); }
    if (req.method === 'GET' && path === '/list') { const d = safe(url.searchParams.get('path')); if (!d) return send(res, 400, { error: 'bad_path' }); try { const all = readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); const entries = all.slice(0, 500).map((e) => { let size = 0; try { size = e.isFile() ? statSync(join(d, e.name)).size : 0; } catch {} return { name: e.name, type: e.isDirectory() ? 'dir' : 'file', size }; }); return send(res, 200, { entries, truncated: all.length > 500 }); } catch { return send(res, 404, { error: 'not_found' }); } }
    if (req.method === 'GET' && path === '/bg') return send(res, 200, { processes: [...bg.values()].map((p) => ({ pid: p.pid, cmd: p.cmd, alive: p.alive, log: tail(p.log, 4000) })) });
    if (req.method === 'POST' && path === '/kill') { const b = await body(req); const p = bg.get(Number(b.pid)); if (!p) return send(res, 404, { error: 'no_such_process' }); try { process.kill(-p.pid, 'SIGTERM'); } catch {} p.alive = false; return send(res, 200, { ok: true }); }
    send(res, 404, { error: 'not_found' });
  } catch (e) { send(res, 500, { error: 'agent_error' }); }
}).listen(PORT, '0.0.0.0', () => console.log('blaise agent on ' + PORT + ' in ' + ROOT));
