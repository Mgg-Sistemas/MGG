/* ============================================================
   MGG · Delivery · Mapa de los motorizados (30-10-2026)

   Leaflet a secas (sin react-leaflet), centrado en Puerto Ordaz, estado
   Bolívar. Dos capas: «Calles» (OpenStreetMap) y «Satelital» (Esri World
   Imagery). Un marcador por motorizado con su última ubicación; si tiene
   más de UBICACION_VIEJA_MS se pinta gris, «sin señal reciente». Se mueve
   solo con el tiempo real de `delivery_ubicaciones`.
   03-11-2026 (tipo Yummy / Ridery): los proveedores con OC pagadas por
   tomar o en curso salen como alfileres, los almacenes de entrega (LOS
   PINOS / MATANZA) también, y cada delivery con pedido en curso lleva su
   ruta por calle (OSRM; si falla, línea recta punteada): su posición →
   proveedor (si falta recogerlo) → almacén.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Flota } from './flota';
import L from 'leaflet';
import { useRealtime } from '@/shared/lib/useRealtime';
import { CENTRO_PUERTO_ORDAZ, ZOOM_CIUDAD, colorDe, crearMapaBase, iconoPildora } from '@/shared/lib/mapaBase';
import { nombreAlmacenVisible } from '@/modules/inventario/sectorizacion';
import { UBICACION_VIEJA_MS, esRetiro, fechaHoraVE, ocDe, type PedidoDelivery, type UbicacionDelivery } from './delivery';
import { calcularRuta, listProveedoresUbicacion, listUbicaciones, puntosDeProveedores, type ProveedorUbicacion } from './delivery.repository';
import { escaparHtml, ubicacionVieja } from './deliveryPanel';
import {
  CLAVES_DESTINO, debeRecalcularRuta, distanciaTxt, marcaRuta, paradasDelPedido, puntoDeDestino, puntosRuta, tiempoRutaTxt,
  type DestinosDelivery, type MarcaRuta, type Punto, type Ruta,
} from './deliveryRutas';

/** Cada cuánto se vuelve a leer, por si el tiempo real se corta. */
const RELEER_MS = 60_000;

function globo(u: UbicacionDelivery, pedido: PedidoDelivery | undefined, vieja: boolean, ruta: Ruta | undefined): string {
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
      + `${pedido.almacen_destino ? `<br>Hacia: ${escaparHtml(nombreAlmacenVisible(pedido.almacen_destino))}` : ''}`
      + `${ruta ? `<br>Ruta: ${escaparHtml(distanciaTxt(ruta.metros))}${ruta.segundos != null ? ` · ${escaparHtml(tiempoRutaTxt(ruta.segundos))}` : ''}${ruta.fuente === 'recta' ? ' (línea recta)' : ''}` : ''}</div>`,
    );
  } else partes.push('<div style="color:#6b7280">Sin pedido en curso</div>');
  partes.push('</div>');
  return partes.join('');
}

/** El pedido en curso de un delivery: el que manda con su ubicación, o el suyo en camino. */
function pedidoDe(u: UbicacionDelivery, porId: Map<string, PedidoDelivery>, pedidos: PedidoDelivery[]): PedidoDelivery | undefined {
  const enCurso = (p: PedidoDelivery | undefined) => !!p && (p.estado === 'aceptado' || p.estado === 'en_ruta');
  const directo = u.pedido_id ? porId.get(u.pedido_id) : undefined;
  if (enCurso(directo)) return directo;
  const suyos = pedidos.filter((p) => p.repartidor_id === u.repartidor_id && enCurso(p));
  return suyos.find((p) => p.estado === 'en_ruta') ?? suyos[0];
}

export function DeliveryMapa({ pedidos, destinos, onUbicar, flota = 'delivery' }: {
  pedidos: PedidoDelivery[];
  /** 04-11-2026: se ven solo los repartidores de esta flota. */
  flota?: Flota;
  destinos: DestinosDelivery;
  /** Abre «📍 Ubicar proveedores» (solo si el usuario puede ubicar). */
  onUbicar?: () => void;
}) {
  const contenedor = useRef<HTMLDivElement | null>(null);
  const mapa = useRef<L.Map | null>(null);
  const capaLugares = useRef<L.LayerGroup | null>(null);
  const capaRutas = useRef<L.LayerGroup | null>(null);
  const capaDelivery = useRef<L.LayerGroup | null>(null);
  const [ubicaciones, setUbicaciones] = useState<UbicacionDelivery[]>([]);
  const [proveedores, setProveedores] = useState<ProveedorUbicacion[]>([]);
  const [rutas, setRutas] = useState<Map<string, Ruta>>(new Map());
  const marcas = useRef(new Map<string, MarcaRuta>());
  const [error, setError] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());

  const cargar = useCallback(async () => {
    try {
      setUbicaciones(await listUbicaciones(flota));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron leer las ubicaciones.');
    }
  }, [flota]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['delivery_ubicaciones'], () => { void cargar(); });

  // Proveedores de lo que está por tomar o en curso.
  const idsProv = useMemo(() => [...new Set(pedidos.filter((p) => !esRetiro(p) && p.proveedor_id
    && ['por_tomar', 'cancelado', 'aceptado', 'en_ruta'].includes(p.estado)).map((p) => p.proveedor_id as string))].sort(), [pedidos]);
  const claveProv = idsProv.join(',');
  const cargarProv = useCallback(async () => {
    try { setProveedores(await listProveedoresUbicacion(claveProv ? claveProv.split(',') : [])); } catch { /* sin alfileres */ }
  }, [claveProv]);
  useEffect(() => { void cargarProv(); }, [cargarProv]);
  useRealtime(['proveedores'], () => { void cargarProv(); });
  const provPts = useMemo(() => puntosDeProveedores(proveedores), [proveedores]);

  // Cada 30 s se revisa quién quedó «sin señal reciente»; cada minuto se relee por si el tiempo real se cortó.
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30_000);
    const r = setInterval(() => { void cargar(); }, RELEER_MS);
    return () => { clearInterval(t); clearInterval(r); };
  }, [cargar]);

  // El mapa se crea una sola vez.
  useEffect(() => {
    if (!contenedor.current || mapa.current) return;
    const m = crearMapaBase(contenedor.current);
    capaLugares.current = L.layerGroup().addTo(m);
    capaRutas.current = L.layerGroup().addTo(m);
    capaDelivery.current = L.layerGroup().addTo(m);
    mapa.current = m;
    // El contenedor puede haber cambiado de tamaño al abrir la pestaña.
    const t = setTimeout(() => m.invalidateSize(), 120);
    return () => {
      clearTimeout(t);
      m.remove();
      mapa.current = null;
      capaLugares.current = null;
      capaRutas.current = null;
      capaDelivery.current = null;
    };
  }, []);

  const pedidoPorId = useMemo(() => {
    const mp = new Map<string, PedidoDelivery>();
    for (const p of pedidos) if (p.pedido_id) mp.set(p.pedido_id, p);
    return mp;
  }, [pedidos]);

  // Rutas: se piden de nuevo solo si cambian las paradas o el delivery se movió > 150 m.
  // (Sin cancelar al rehacer el efecto: la marca ya quedó puesta y la ruta pedida debe llegar igual.)
  useEffect(() => {
    void (async () => {
      const t = Date.now();
      for (const u of ubicaciones) {
        if (ubicacionVieja(u.actualizado_en, t)) continue;
        const p = pedidoDe(u, pedidoPorId, pedidos);
        if (!p) {
          if (marcas.current.delete(u.repartidor_id)) setRutas((r) => { const n = new Map(r); n.delete(u.repartidor_id); return n; });
          continue;
        }
        const paradas = paradasDelPedido(p, provPts, destinos);
        const yo = { lat: u.lat, lng: u.lng };
        const marca = marcaRuta(yo, paradas, t);
        if (!debeRecalcularRuta(marcas.current.get(u.repartidor_id) ?? null, marca)) continue;
        marcas.current.set(u.repartidor_id, marca);
        const ruta = await calcularRuta(puntosRuta(yo, paradas));
        setRutas((r) => { const n = new Map(r); if (ruta) n.set(u.repartidor_id, ruta); else n.delete(u.repartidor_id); return n; });
      }
    })();
  }, [ubicaciones, pedidoPorId, pedidos, provPts, destinos]);

  // Proveedores y almacenes.
  useEffect(() => {
    const g = capaLugares.current;
    if (!g) return;
    g.clearLayers();
    const porProv = new Map<string, { libres: number; enCurso: number }>();
    for (const p of pedidos) {
      if (esRetiro(p) || !p.proveedor_id) continue;
      const c = porProv.get(p.proveedor_id) ?? { libres: 0, enCurso: 0 };
      if (p.estado === 'por_tomar' || p.estado === 'cancelado') c.libres++;
      else if (p.estado === 'aceptado' || p.estado === 'en_ruta') c.enCurso++;
      porProv.set(p.proveedor_id, c);
    }
    for (const pr of proveedores) {
      const pt = provPts.get(pr.id);
      const c = porProv.get(pr.id);
      if (!pt || !c) continue;
      const fondo = c.libres ? '#d97706' : '#2563eb';
      L.marker([pt.lat, pt.lng], { icon: iconoPildora('🏭', pr.razon_social, fondo), title: pr.razon_social, zIndexOffset: 200 })
        .bindPopup(`<div style="color:#1f2937;font:13px/1.4 system-ui,sans-serif"><b>🏭 ${escaparHtml(pr.razon_social)}</b>`
          + `${pr.direccion ? `<br>${escaparHtml(pr.direccion)}` : ''}`
          + `${c.libres ? `<br>💰 ${c.libres} por tomar` : ''}${c.enCurso ? `<br>🚚 ${c.enCurso} en curso` : ''}</div>`)
        .addTo(g);
    }
    for (const clave of CLAVES_DESTINO) {
      const pt = puntoDeDestino(destinos[clave]);
      if (!pt) continue;
      L.marker([pt.lat, pt.lng], { icon: iconoPildora('🏬', clave, '#374151'), title: clave, zIndexOffset: 100 })
        .bindPopup(`<div style="color:#1f2937;font:13px/1.4 system-ui,sans-serif"><b>🏬 Almacén ${escaparHtml(clave)}</b>`
          + `${destinos[clave].aproximada ? '<br><span style="color:#b45309">Ubicación aproximada</span>' : ''}</div>`)
        .addTo(g);
    }
  }, [proveedores, provPts, pedidos, destinos]);

  // Motorizados y sus rutas: se rehacen con cada cambio (son pocos).
  useEffect(() => {
    const gd = capaDelivery.current;
    const gr = capaRutas.current;
    if (!gd || !gr) return;
    gd.clearLayers();
    gr.clearLayers();
    for (const u of ubicaciones) {
      if (!Number.isFinite(u.lat) || !Number.isFinite(u.lng)) continue;
      const vieja = ubicacionVieja(u.actualizado_en, ahora);
      const nombre = u.repartidor_nombre || u.repartidor_email || 'Delivery';
      const pedido = pedidoDe(u, pedidoPorId, pedidos);
      const ruta = vieja ? undefined : rutas.get(u.repartidor_id);
      const color = vieja ? '#9ca3af' : colorDe(u.repartidor_id);
      if (ruta && pedido) {
        L.polyline(ruta.linea.map((p) => [p.lat, p.lng] as [number, number]), {
          color, weight: 5, opacity: 0.8, dashArray: ruta.fuente === 'recta' ? '8 8' : undefined,
        }).bindTooltip(`${nombre} · ${ocDe(pedido)}`, { sticky: true }).addTo(gr);
      }
      L.marker([u.lat, u.lng], { icon: iconoPildora('🛵', nombre, color, { tenue: vieja }), title: nombre, zIndexOffset: vieja ? 300 : 1000 })
        .bindPopup(globo(u, pedido, vieja, ruta))
        .addTo(gd);
    }
  }, [ubicaciones, pedidoPorId, pedidos, rutas, ahora]);

  function verATodos() {
    const m = mapa.current;
    if (!m) return;
    const puntos: L.LatLng[] = ubicaciones.filter((u) => Number.isFinite(u.lat) && Number.isFinite(u.lng)).map((u) => L.latLng(u.lat, u.lng));
    for (const pt of provPts.values()) puntos.push(L.latLng(pt.lat, pt.lng));
    if (!puntos.length) { m.setView(CENTRO_PUERTO_ORDAZ, ZOOM_CIUDAD); return; }
    m.fitBounds(L.latLngBounds(puntos), { padding: [48, 48], maxZoom: 16 });
  }

  function irA(p: Punto) { mapa.current?.setView([p.lat, p.lng], 16); }

  const conSenal = ubicaciones.filter((u) => !ubicacionVieja(u.actualizado_en, ahora));
  const sinUbicar = new Set(pedidos.filter((p) => !esRetiro(p) && p.proveedor_id && (p.estado === 'por_tomar' || p.estado === 'cancelado' || p.estado === 'aceptado' || p.estado === 'en_ruta')
    && !provPts.has(p.proveedor_id)).map((p) => p.proveedor_nombre ?? p.proveedor_id)).size;
  const almacenesSinUbicar = CLAVES_DESTINO.filter((c) => !puntoDeDestino(destinos[c]) || destinos[c].aproximada);

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
        <span>🗺 Motorizados y rutas</span>
        <span className="badge success">{conSenal.length} con señal</span>
        {ubicaciones.length - conSenal.length > 0 && <span className="badge warning">{ubicaciones.length - conSenal.length} sin señal reciente</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {onUbicar && <button type="button" className="btn btn-ghost btn-sm" onClick={onUbicar}>📍 Ubicar proveedores</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={verATodos}>🎯 Ver a todos</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => mapa.current?.setView(CENTRO_PUERTO_ORDAZ, ZOOM_CIUDAD)}>📍 Puerto Ordaz</button>
        </span>
      </div>
      {error && <div className="aviso warning" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">⚠</span><div>{error}</div></div>}
      {(sinUbicar > 0 || almacenesSinUbicar.length > 0) && (
        <div className="aviso info sm" style={{ marginBottom: '.6rem' }}>
          <span className="aviso-icono">📍</span>
          <div>
            {sinUbicar > 0 && <>{sinUbicar} proveedor(es) con pedidos todavía no están en el mapa: sin ellos no hay ruta ni «más cercano». </>}
            {almacenesSinUbicar.length > 0 && <>Almacén {almacenesSinUbicar.join(' y ')} sin ubicar o con ubicación aproximada. </>}
            {onUbicar ? <button type="button" className="btn btn-ghost btn-sm" onClick={onUbicar}>Ubicarlos</button> : 'Pídele a Compras que los ubique.'}
          </div>
        </div>
      )}
      {/* isolation: los paneles de Leaflet (z-index 400–1000) no se montan sobre las ventanas del sistema. */}
      <div ref={contenedor} style={{ height: 'min(70vh, 560px)', minHeight: 320, borderRadius: 10, overflow: 'hidden', isolation: 'isolate', position: 'relative' }} />

      {conSenal.length > 0 && (
        <div className="table-wrap" style={{ marginTop: '.75rem' }}>
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead><tr><th>Delivery</th><th>Pedido en curso</th><th>Ruta</th><th>Última señal</th><th /></tr></thead>
            <tbody>
              {conSenal.map((u) => {
                const p = pedidoDe(u, pedidoPorId, pedidos);
                const r = rutas.get(u.repartidor_id);
                return (
                  <tr key={u.repartidor_id}>
                    <td><span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 999, background: colorDe(u.repartidor_id), marginRight: 6 }} />
                      <strong>{u.repartidor_nombre || u.repartidor_email || 'Delivery'}</strong></td>
                    <td>{p ? <>{ocDe(p)} · {p.proveedor_nombre ?? '—'}{p.almacen_destino ? <> → {nombreAlmacenVisible(p.almacen_destino)}</> : null}</> : <span className="muted">Libre</span>}</td>
                    <td>{p && r ? <>{distanciaTxt(r.metros)}{r.segundos != null ? ` · ${tiempoRutaTxt(r.segundos)}` : ''}{r.fuente === 'recta' ? <span className="muted"> (línea recta)</span> : null}</> : <span className="muted">—</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fechaHoraVE(u.actualizado_en)}</td>
                    <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => irA({ lat: u.lat, lng: u.lng })}>🎯 Ver</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint muted" style={{ margin: '.5rem 0 0', fontSize: '.8rem' }}>
        Cada delivery comparte su ubicación mientras tiene abierta la vista de teléfono. En gris, los que no mandan señal hace más de {Math.round(UBICACION_VIEJA_MS / 60000)} minutos.
        {' '}Alfiler naranja = proveedor con OC por tomar; azul = con pedido en curso. Ruta continua = por calle; punteada = línea recta (no se pudo calcular la ruta).
        {' '}Solo quien supervisa Delivery ve a todos los delivery.
        {!ubicaciones.length && !error && ' Todavía no hay ubicaciones compartidas.'}
      </p>
    </div>
  );
}
