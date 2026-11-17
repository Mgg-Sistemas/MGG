/* ============================================================
   Mineral Group Guayana C.A. · Service Worker de notificaciones (Web Push)
   Solo PUSH: sin caché ni interceptación de fetch, para no interferir con la
   carga ni con las actualizaciones de la aplicación (gestionadas en main.tsx).
   Muestra la notificación cuando llega un push y, al pulsarla, enfoca o abre
   el navegador en la ruta indicada.
   ============================================================ */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Mineral Group Guayana C.A.';
  const options = {
    body: data.body || data.message || '',
    icon: data.icon || '/android-chrome-192x192.png',
    badge: '/favicon-32x32.png',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || data.link || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const cliente of clientes) {
      if ('focus' in cliente) {
        try {
          await cliente.focus();
          if (url && 'navigate' in cliente) await cliente.navigate(url);
          return;
        } catch (_e) { /* Si no permite navegar, al menos la ventana queda enfocada */ }
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
