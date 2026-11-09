import express from 'express';
import { refresh } from './scraper.js';

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.API_KEY || '';
const REFRESH_MS = Number(process.env.REFRESH_MIN || 15) * 60_000;

let servers = [];
let updatedAt = null;
let lastError = null;
let busy = false;

async function update() {
  if (busy) return;
  busy = true;
  try {
    const list = await refresh();
    if (list.length) { servers = list; updatedAt = new Date().toISOString(); lastError = null; }
    else lastError = 'No valid servers found';
  } catch (e) { lastError = String(e.message || e); }
  finally { busy = false; }
  console.log(new Date().toISOString(), 'refresh:', servers.length, 'servers', lastError ? `(err: ${lastError})` : '');
}
update();
setInterval(update, REFRESH_MS);

const app = express();
app.disable('x-powered-by');
app.get('/health', (_q, r) => r.json({ ok: true, servers: servers.length, updatedAt, lastError }));

app.use('/api', (req, res, next) => {
  if (API_KEY && req.get('x-api-key') !== API_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
});

const pub = ({ config, ...s }) => s;
app.get('/api/servers', (_q, r) => r.json({ updatedAt, servers: servers.map(pub) }));

// Fastest server + sanitised config. Optional ?country=JP&proto=tcp&exclude=id1,id2
app.get('/api/best', (req, res) => {
  const { country, proto, exclude } = req.query;
  const ex = new Set(String(exclude || '').split(',').filter(Boolean));
  const pick = servers.find((s) =>
    (!country || s.country === String(country).toUpperCase()) &&
    (!proto || s.proto === proto) && !ex.has(s.id));
  if (!pick) return res.status(503).json({ error: 'no server available yet', lastError });
  res.json(pick);
});

app.listen(PORT, '0.0.0.0', () => console.log('listening on', PORT));
