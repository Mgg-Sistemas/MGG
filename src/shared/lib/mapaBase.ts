/* ============================================================
   MGG · Mapa base (Leaflet a secas) · 03-11-2026

   Lo que comparten los mapas del sistema (Delivery en PC y teléfono, ubicar
   un proveedor): capas «Calles» (OpenStreetMap) y «Satelital» (Esri), la
   escala y los marcadores hechos con HTML (divIcon), que no dependen de las
   imágenes de Leaflet que Vite no empaqueta.
   ============================================================ */
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** Centro de Puerto Ordaz, estado Bolívar. */
export const CENTRO_PUERTO_ORDAZ: [number, number] = [8.2869, -62.7467];
export const ZOOM_CIUDAD = 13;

export function escaparHtmlMapa(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** Crea el mapa con las dos capas, el selector de capa y la escala. */
export function crearMapaBase(el: HTMLElement, opts: { centro?: [number, number]; zoom?: number; capas?: boolean } = {}): L.Map {
  const m = L.map(el, { center: opts.centro ?? CENTRO_PUERTO_ORDAZ, zoom: opts.zoom ?? ZOOM_CIUDAD });
  const calles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  });
  const satelital = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Imágenes &copy; Esri, Maxar, Earthstar Geographics y la comunidad GIS',
  });
  calles.addTo(m);
  if (opts.capas !== false) L.control.layers({ Calles: calles, Satelital: satelital }, undefined, { position: 'topright' }).addTo(m);
  L.control.scale({ imperial: false }).addTo(m);
  return m;
}

/**
 * Píldora con emoji y texto, centrada sobre el punto (proveedor, almacén, delivery).
 * Tamaño 0: el contenido se centra solo con el translate, sea cual sea el largo del texto.
 */
export function iconoPildora(emoji: string, texto: string, fondo: string, opts: { tenue?: boolean } = {}): L.DivIcon {
  const html = `<div style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px 3px 4px;border-radius:999px;`
    + `background:${fondo};color:#fff;font:600 12px/1.2 system-ui,sans-serif;white-space:nowrap;`
    + `box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid #fff;transform:translate(-50%,-50%);`
    + `${opts.tenue ? 'opacity:.8;' : ''}"><span style="font-size:15px">${emoji}</span>${escaparHtmlMapa(texto)}</div>`;
  return L.divIcon({ html, className: 'mgg-marcador', iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -14] });
}

/** Alfiler (gota) para marcar un lugar; se puede arrastrar. */
export function iconoAlfiler(color = '#dc2626'): L.DivIcon {
  const html = `<div style="width:30px;height:30px;transform:translate(-50%,-100%);">`
    + `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="${color}" stroke="#fff" stroke-width="1.5" `
    + `d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z"/><circle cx="12" cy="9" r="2.6" fill="#fff"/></svg></div>`;
  return L.divIcon({ html, className: 'mgg-marcador', iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -30] });
}

/** Punto azul «tú estás aquí». */
export function iconoYo(): L.DivIcon {
  const html = '<div style="width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #fff;'
    + 'box-shadow:0 0 0 4px rgba(37,99,235,.3),0 1px 4px rgba(0,0,0,.4);transform:translate(-50%,-50%);"></div>';
  return L.divIcon({ html, className: 'mgg-marcador', iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -10] });
}

/** Colores para distinguir la ruta de cada delivery en la PC. */
export const COLORES_RUTA = ['#2563eb', '#16a34a', '#9333ea', '#dc2626', '#0891b2', '#ca8a04', '#db2777', '#4b5563'];

export function colorDe(clave: string): string {
  let h = 0;
  for (let i = 0; i < clave.length; i++) h = (h * 31 + clave.charCodeAt(i)) >>> 0;
  return COLORES_RUTA[h % COLORES_RUTA.length];
}

