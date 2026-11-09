import { load } from 'cheerio';
import net from 'node:net';

const SOURCE = process.env.SOURCE_URL || 'https://ipspeed.info/free-openvpn.php';
const CANDIDATES = Number(process.env.CANDIDATES || 12);
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  ...(process.env.SOURCE_COOKIE ? { cookie: process.env.SOURCE_COOKIE } : {}),
};

async function get(url) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return r;
}

// ---- 1. parse the listing page (heuristic: any table row / block with an .ovpn-ish link)
export function parseListing(html) {
  const $ = load(html);
  const out = [];
  const seen = new Set();
  const linkSel = 'a[href*=".ovpn"], a[href*="ovpn"], a[href*="download"], a[href*="config"]';

  const push = (el, link) => {
    if (!link || seen.has(link)) return;
    seen.add(link);
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const speed = text.match(/([\d.]+)\s*m(?:bps|bit|b\/s)/i);
    const gspeed = text.match(/([\d.]+)\s*g(?:bps|bit)/i);
    const ping = text.match(/(\d+)\s*ms/i);
    const cc = text.match(/\b([A-Z]{2})\b/);
    out.push({
      url: new URL(link, SOURCE).toString(),
      label: text.slice(0, 80),
      country: cc ? cc[1] : '??',
      speedMbps: gspeed ? Number(gspeed[1]) * 1000 : speed ? Number(speed[1]) : 0,
      sitePing: ping ? Number(ping[1]) : null,
    });
  };

  $('tr').each((_, tr) => push(tr, $(tr).find(linkSel).first().attr('href')));
  if (!out.length) $(linkSel).each((_, a) => push($(a).parent(), $(a).attr('href')));
  return out;
}

// ---- 2. sanitise untrusted .ovpn (strip anything that can run code / install hooks)
const BAD = /^\s*(script-security|up|down|route-up|route-pre-down|ipchange|client-connect|client-disconnect|learn-address|tls-verify|auth-user-pass-verify|plugin|setenv|setenv-safe|management|up-restart|up-delay)\b/i;
export function sanitize(cfg) {
  return cfg.replace(/\r/g, '').split('\n').filter((l) => !BAD.test(l)).join('\n').trim() + '\n';
}

function parseRemote(cfg) {
  const m = cfg.match(/^\s*remote\s+(\S+)\s+(\d+)(?:\s+(tcp|udp)\S*)?/im);
  const p = cfg.match(/^\s*proto\s+(tcp|udp)/im);
  if (!m) return null;
  return { host: m[1], port: Number(m[2]), proto: (m[3] || (p && p[1]) || 'udp').toLowerCase() };
}

function tcpProbe(host, port, ms = 3500) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const s = net.connect({ host, port });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(ms, () => done(null));
    s.on('connect', () => done(Date.now() - t0));
    s.on('error', () => done(null));
  });
}

async function fetchConfig(item) {
  if (item.url.startsWith('data:')) return Buffer.from(item.url.split(',')[1], 'base64').toString('utf8');
  return await (await get(item.url)).text();
}

// ---- 3. main: list -> top candidates -> download -> validate -> score
export async function refresh() {
  const html = await (await get(SOURCE)).text();
  const items = parseListing(html).sort((a, b) => b.speedMbps - a.speedMbps).slice(0, CANDIDATES);
  if (!items.length) throw new Error('No servers parsed - adjust parseListing() selectors for the site layout');

  const results = await Promise.all(items.map(async (it) => {
    try {
      const raw = await fetchConfig(it);
      if (!/^\s*remote\s/im.test(raw)) return null;
      const config = sanitize(raw);
      const r = parseRemote(config);
      if (!r) return null;
      let ping = null;
      if (r.proto === 'tcp') {
        ping = await tcpProbe(r.host, r.port);
        if (ping === null) return null; // dead TCP server
      }
      const effPing = ping ?? it.sitePing ?? 150;
      const score = it.speedMbps - effPing * 0.2 + (r.proto === 'udp' ? 5 : 0);
      return { id: `${r.host}:${r.port}/${r.proto}`, host: r.host, port: r.port, proto: r.proto,
               country: it.country, speedMbps: it.speedMbps, ping: effPing, score, config };
    } catch { return null; }
  }));
  return results.filter(Boolean).sort((a, b) => b.score - a.score);
}
