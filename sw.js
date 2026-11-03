/* Service worker "Struk Keuangan".
   Saat gambar dibagikan dari menu Bagikan Android, service worker ini:
   1) langsung membuka halaman kecil (tidak menunggu),
   2) mengecilkan gambar dan mengirimnya ke Keuangan Kita di latar belakang,
   3) menampilkan hasilnya sebagai notifikasi.
   Bila gagal, gambar disimpan supaya bisa dicoba lagi dengan satu ketukan. */
const C_SHARE = 'kk-share';
const C_CFG = 'kk-config';
const K_GAMBAR = 'shared-image';
const K_CFG = 'kk-config.json';
const K_HASIL = 'kk-hasil.json';

const kunci = function (n) { return new URL(n, self.registration.scope).href; };

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function (e) {
  const u = new URL(e.request.url);
  if (e.request.method !== 'POST' || !u.pathname.endsWith('/share')) return;

  // Jaga service worker tetap hidup sampai pengiriman selesai
  let selesai;
  e.waitUntil(new Promise(function (r) { selesai = r; }));

  e.respondWith((async function () {
    const id = String(Date.now());
    let file = null;
    try { file = (await e.request.formData()).get('gambar'); } catch (err) { file = null; }
    if (file && file.size) {
      proses(file, id).catch(function () {}).then(selesai);
      return Response.redirect(kunci('kirim.html?bg=' + id), 303);
    }
    selesai();
    return Response.redirect(kunci('kirim.html?shared=1'), 303);
  })());
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  const ulang = !!(e.notification.data && e.notification.data.ulang);
  const url = kunci(ulang ? 'kirim.html?shared=1' : 'kirim.html');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (daftar) {
    if (!ulang) {
      for (let i = 0; i < daftar.length; i++) {
        if (daftar[i].url.indexOf(self.registration.scope) === 0 && daftar[i].focus) return daftar[i].focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});

/* ---------- Alur utama ---------- */
async function proses(file, id) {
  let hasil;
  try {
    const cfg = await bacaConfig();
    if (!cfg) {
      await simpanGambar(file);
      hasil = { ok: false, judul: 'Belum diatur', pesan: 'Buka aplikasi Struk Keuangan sekali dan isi pengaturannya.' };
    } else {
      try {
        const b64 = await siapkan(file);
        const j = await kirim(cfg, b64);
        if (j && j.ok) {
          hasil = { ok: true, judul: j.duplikat ? 'Sudah pernah dikirim' : 'Tercatat!', pesan: j.pesan || 'Tersimpan.' };
        } else {
          await simpanGambar(file);
          hasil = { ok: false, judul: 'Belum tercatat', pesan: (j && j.pesan) || 'Terjadi kesalahan. Coba lagi atau catat manual.' };
        }
      } catch (err) {
        await simpanGambar(file);
        hasil = { ok: false, judul: 'Belum tercatat', pesan: (err && err.pesan) || 'Tidak bisa terhubung. Periksa internet, lalu coba lagi.' };
      }
    }
  } catch (err) {
    hasil = { ok: false, judul: 'Belum tercatat', pesan: 'Terjadi kesalahan tak terduga.' };
  }
  hasil.id = id;
  hasil.t = Date.now();
  await Promise.all([simpanHasil(hasil), tampilNotif(hasil)]);
}

async function bacaConfig() {
  try {
    const c = await caches.open(C_CFG);
    const r = await c.match(kunci(K_CFG));
    if (!r) return null;
    const j = await r.json();
    if (j && /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(j.url || '') && j.token) return j;
  } catch (err) { /* abaikan */ }
  return null;
}

async function simpanGambar(file) {
  try {
    const c = await caches.open(C_SHARE);
    await c.put(kunci(K_GAMBAR), new Response(file, { headers: { 'Content-Type': file.type || 'image/png' } }));
  } catch (err) { /* abaikan */ }
}

async function simpanHasil(h) {
  try {
    const c = await caches.open(C_CFG);
    await c.put(kunci(K_HASIL), new Response(JSON.stringify(h), { headers: { 'Content-Type': 'application/json' } }));
  } catch (err) { /* abaikan */ }
}

async function tampilNotif(h) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    await self.registration.showNotification(h.judul, {
      body: h.pesan + (h.ok ? '' : '\nKetuk untuk coba lagi.'),
      icon: kunci('icon-192.png'),
      badge: kunci('icon-192.png'),
      tag: 'kk-hasil',
      renotify: true,
      data: { ulang: !h.ok }
    });
  } catch (err) { /* abaikan */ }
}

/* ---------- Gambar ---------- */
function keBase64(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

async function siapkan(file) {
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
    try {
      const bmp = await createImageBitmap(file);
      const sc = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * sc), h = Math.round(bmp.height * sc);
      const cv = new OffscreenCanvas(w, h);
      const x = cv.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      const out = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
      return keBase64(await out.arrayBuffer());
    } catch (err) { /* coba kirim apa adanya di bawah */ }
  }
  if (file.size <= 4 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/.test(file.type)) return keBase64(await file.arrayBuffer());
  const e = new Error('x');
  e.pesan = 'Gambar terlalu besar untuk dikirim otomatis. Buka aplikasi lalu pilih gambar dari galeri.';
  throw e;
}

async function kirim(cfg, b64) {
  const ac = new AbortController();
  const timer = setTimeout(function () { ac.abort(); }, 60000);
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // tanpa preflight CORS
      body: JSON.stringify({ token: cfg.token, gambar: b64 }),
      signal: ac.signal
    });
    return await res.json();
  } finally { clearTimeout(timer); }
}
