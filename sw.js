/* TOCFL Latihan – service worker
   - pages: network first, falls back to the saved copy when offline
   - images & audio: saved on the phone after the first use, then served from there
     (audio is requested in byte ranges, so ranges are cut from the saved file) */
const SHELL = 'tocfl-shell-202611160257';
const MEDIA = 'tocfl-media-v1';
const SHELL_FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'reading/', 'listening/', 'flashcards/', 'offline-files.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('tocfl-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isMedia = u => /\.(mp3|webp|png|jpg)$/i.test(u.pathname);
const inFlight = new Map();

function saveFull(url){
  if(inFlight.has(url)) return inFlight.get(url);
  const p = (async () => {
    const c = await caches.open(MEDIA);
    if(await c.match(url)) return;
    const r = await fetch(url, {cache: 'no-store'});
    if(r.ok && r.status === 200) await c.put(url, r);
  })().catch(() => {}).finally(() => inFlight.delete(url));
  inFlight.set(url, p);
  return p;
}

async function sliced(res, range){
  const buf = await res.arrayBuffer(), n = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range || '');
  let a = m && m[1] !== '' ? +m[1] : 0, b = m && m[2] !== '' ? +m[2] : n - 1;
  if(m && m[1] === '' && m[2] !== ''){ a = Math.max(0, n - +m[2]); b = n - 1; }
  b = Math.min(b, n - 1);
  if(a >= n) return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${n}`}});
  return new Response(buf.slice(a, b + 1), {status: 206, statusText: 'Partial Content', headers: {
    'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
    'Content-Range': `bytes ${a}-${b}/${n}`, 'Content-Length': String(b - a + 1), 'Accept-Ranges': 'bytes'}});
}

async function media(e){
  const req = e.request, url = new URL(req.url); url.hash = ''; url.search = '';
  const key = url.href, range = req.headers.get('range');
  const c = await caches.open(MEDIA), hit = await c.match(key);
  if(hit) return range ? sliced(hit, range) : hit;
  // not saved yet: answer from the network straight away, and save the whole file in the background
  e.waitUntil(saveFull(key));
  try { return await fetch(req); }
  catch(err){ await inFlight.get(key); const h = await c.match(key); if(h) return range ? sliced(h, range) : h; throw err; }
}

async function page(req){
  const c = await caches.open(SHELL);
  try {
    const r = await fetch(req);
    if(r.ok && r.status === 200) c.put(req, r.clone());
    return r;
  } catch(err){
    const h = await c.match(req, {ignoreSearch: true});
    if(h) return h;
    const u = new URL(req.url);
    if(req.mode === 'navigate'){ const alt = await c.match(u.pathname.endsWith('/') ? u.pathname + 'index.html' : u.pathname + '/'); if(alt) return alt; }
    throw err;
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin !== location.origin) return;
  e.respondWith(isMedia(url) ? media(e) : page(req));
});
