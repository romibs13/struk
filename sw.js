/* Service worker "Struk Keuangan".
   Tugasnya hanya menangkap gambar yang dibagikan dari menu Bagikan Android,
   menyimpannya sementara, lalu membuka halaman kirim.html untuk mengirimnya. */
const NAMA_CACHE = 'kk-share';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function (e) {
  const u = new URL(e.request.url);
  if (e.request.method === 'POST' && u.pathname.endsWith('/share')) {
    e.respondWith((async function () {
      try {
        const data = await e.request.formData();
        const f = data.get('gambar');
        if (f && f.size) {
          const c = await caches.open(NAMA_CACHE);
          await c.put(new URL('shared-image', self.registration.scope).href,
            new Response(f, { headers: { 'Content-Type': f.type || 'image/png' } }));
        }
      } catch (err) { /* lanjut ke halaman; halaman akan menampilkan pesan bila gambar tidak ada */ }
      return Response.redirect(new URL('kirim.html?shared=1', self.registration.scope).href, 303);
    })());
  }
});
