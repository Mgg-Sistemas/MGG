/* ============================================================
   MGG · Delivery · Mapa de los motorizados (30-10-2026)

   Leaflet a secas (sin react-leaflet), centrado en Puerto Ordaz, estado
   Bolívar. Dos capas: «Calles» (OpenStreetMap) y «Satelital» (Esri World
   Imagery). Un marcador por motorizado con su última ubicación; si tiene
   más de UBICACION_VIEJA_MS se pinta gris, «sin señal reciente». Se mueve
   solo con el tiempo real de `delivery_ubicaciones`.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useRealtime } from '@/shared/lib/useRealtime';
import { PUERTO_ORDAZ, UBICACION_VIEJA_MS, fechaHoraVE, ocDe, type PedidoDelivery, type UbicacionDelivery } from './delivery';
import { listUbicaciones } from './delivery.repository';
import { escaparHtml, ubicacionVieja } from './deliveryPanel';

const ZOOM_INICIAL = 13;

function icono(nombre: string, vieja: boolean): L.DivIcon {
  const fondo = vieja ? '#9ca3af' : '#ff8a00';
  const html = `<div style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px 3px 4px;border-radius:999px;`
    + `background:${fondo};color:#fff;font:600 12px/1.2 system-ui,sans-serif;white-space:nowrap;`
    + `box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px solid #fff;transform:translate(-50%,-50%);`
    + `${vieja ? 'opacity:.85;' : ''}"><span style="font-size:16px">🛵</span>${escaparHtml(nombre)}</div>`;
  // Tamaño 0: el contenido se centra solo con el translate, sea cual sea el largo del nombre.
  return L.divIcon({ html, className: 'dlv-marcador', iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -14] });
}

function globo(u: UbicacionDelivery, pedido: PedidoDelivery | undefined, vieja: boolean): string {
  const nombre = u.repartidor_nombre || u.repartidor_email || 'Delivery';
  const partes = [
    `<div style="color:#1f2937;font:13px/1.4 system-ui,sans-serif;min-width:180px">`,
    `<div style="font-weight:700;font-size:14px">🛵 ${escaparHtml(nombre)}</div>`,
    `<div>Última señal: ${escaparHtml(fechaHoraVE(u.actualizado_en))}</div>`,
  ];
  if (vieja) partes.push('<div style="color:#b45309;font-weight:600">Sin señal reciente</div>');
  if (u.precision_m != null) partes.push(`<div style="color:#6b7280">Precisión ± ${Math.round(u.precision_m)} m</div>`);
  if (pedido) {
    partes.push(
      `<div style="margin-top:4px;padding-top:4px;border-top:1px solid #e5e7eb">`
      + `<b>${escaparHtml(ocDe(pedido))}</b> · ${escaparHtml(pedido.proveedor_nombre ?? '—')}`
      + `${pedido.almacen_destino ? `<br>Hacia: ${escaparHtml(pedido.almacen_destino)}` : ''}</div>`,
    );
  }
  partes.push('</div>');
  return partes.join('');
}

export function DeliveryMapa({ pedidos }: { pedidos: PedidoDelivery[] }) {
  const contenedor = useRef<HTMLDivElement | null>(null);
  const mapa = useRef<L.Map | null>(null);
  const capa = useRef<L.LayerGroup | null>(null);
  const [ubicaciones, setUbicaciones] = useState<UbicacionDelivery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());

  const cargar = useCallback(async () => {
    try {
      setUbicaciones(await listUbicaciones());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron leer las ubicaciones.');
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['delivery_ubicaciones'], () => { void cargar(); });

  // Cada 30 s se revisa quién quedó «sin señal reciente» aunque no llegue nada nuevo.
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // El mapa se crea una sola vez.
  useEffect(() => {
    if (!contenedor.current || mapa.current) return;
    const m = L.map(contenedor.current, { center: PUERTO_ORDAZ, zoom: ZOOM_INICIAL });
    const calles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    });
    const satelital = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Imágenes &copy; Esri, Maxar, Earthstar Geographics y la comunidad GIS',
    });
    calles.addTo(m);
    L.control.layers({ Calles: calles, Satelital: satelital }, undefined, { position: 'topright' }).addTo(m);
    L.control.scale({ imperial: false }).addTo(m);
    capa.current = L.layerGroup().addTo(m);
    mapa.current = m;
    // El contenedor puede haber cambiado de tamaño al abrir la pestaña.
    const t = setTimeout(() => m.invalidateSize(), 120);
    return () => {
      clearTimeout(t);
      m.remove();
      mapa.current = null;
      capa.current = null;
    };
  }, []);

  const pedidoPorId = useMemo(() => {
    const mp = new Map<string, PedidoDelivery>();
    for (const p of pedidos) if (p.pedido_id) mp.set(p.pedido_id, p);
    return mp;
  }, [pedidos]);

  // Marcadores: se rehacen con cada cambio (son pocos motorizados).
  useEffect(() => {
    const g = capa.current;
    if (!g) return;
    g.clearLayers();
    for (const u of ubicaciones) {
      if (!Number.isFinite(u.lat) || !Number.isFinite(u.lng)) continue;
      const vieja = ubicacionVieja(u.actualizado_en, ahora);
      const nombre = u.repartidor_nombre || u.repartidor_email || 'Delivery';
      const pedido = u.pedido_id ? pedidoPorId.get(u.pedido_id) : undefined;
      L.marker([u.lat, u.lng], { icon: icono(nombre, vieja), title: nombre, zIndexOffset: vieja ? 0 : 1000 })
        .bindPopup(globo(u, pedido, vieja))
        .addTo(g);
    }
  }, [ubicaciones, pedidoPorId, ahora]);

  function verATodos() {
    const m = mapa.current;
    if (!m) return;
    const puntos = ubicaciones.filter((u) => Number.isFinite(u.lat) && Number.isFinite(u.lng)).map((u) => L.latLng(u.lat, u.lng));
    if (!puntos.length) { m.setView(PUERTO_ORDAZ, ZOOM_INICIAL); return; }
    m.fitBounds(L.latLngBounds(puntos), { padding: [48, 48], maxZoom: 16 });
  }

  const conSenal = ubicaciones.filter((u) => !ubicacionVieja(u.actualizado_en, ahora)).length;

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
        <span>🗺 Motorizados en el mapa</span>
        <span className="badge success">{conSenal} con señal</span>
        {ubicaciones.length - conSenal > 0 && <span className="badge warning">{ubicaciones.length - conSenal} sin señal reciente</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '.4rem' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={verATodos}>🎯 Ver a todos</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => mapa.current?.setView(PUERTO_ORDAZ, ZOOM_INICIAL)}>📍 Puerto Ordaz</button>
        </span>
      </div>
      {error && <div className="aviso warning" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">⚠</span><div>{error}</div></div>}
      {/* isolation: los paneles de Leaflet (z-index 400–1000) no se montan sobre las ventanas del sistema. */}
      <div ref={contenedor} style={{ height: 'min(70vh, 560px)', minHeight: 320, borderRadius: 10, overflow: 'hidden', isolation: 'isolate', position: 'relative' }} />
      <p className="hint muted" style={{ margin: '.5rem 0 0', fontSize: '.8rem' }}>
        Cada motorizado comparte su ubicación desde la vista de teléfono. En gris, los que no mandan señal hace más de {Math.round(UBICACION_VIEJA_MS / 60000)} minutos.
        {!ubicaciones.length && !error && ' Todavía no hay ubicaciones compartidas.'}
      </p>
    </div>
  );
}
