/* ============================================================
   MGG · Delivery · detalle de un delivery en el periodo (03-11-2026)

   Pedido de la administradora: en «Pedidos por delivery», al tocar un
   delivery se ven sus pedidos del rango con todo — OC o retiro, proveedor,
   productos, estado, horas de cada paso y duración, almacén, fotos, nota —
   y la ruta en el mapa: la planeada (desde donde lo tomó → proveedor →
   almacén, por calle con OSRM) y el recorrido guardado (una muestra cada
   ~60 s mientras iba en curso, tabla delivery_ubicaciones_hist). Cada
   pedido abre su propia ruta.
   ============================================================ */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Modal } from '@/shared/ui/Modal';
import { crearMapaBase, iconoPildora } from '@/shared/lib/mapaBase';
import { nombreAlmacenVisible } from '@/modules/inventario/sectorizacion';
import { ESTADO_DELIVERY, fechaHoraVE, montoTxt, type EstadoDelivery, type FotoDelivery } from './delivery';
import {
  calcularRuta, detallePedidosDelivery, listProveedoresUbicacion, puntosDeProveedores, recorridoPedidos, urlFotoDelivery,
  type PedidoDetalleDelivery, type PuntoRecorrido,
} from './delivery.repository';
import { duracionTxt, type FilaHistorialDelivery } from './deliveryPanel';
import {
  claveDestino, distanciaTxt, metrosRecorrido, puntoDeDestino, puntosRutaPlaneada, tiempoRutaTxt, tiemposPedido,
  type DestinosDelivery, type Punto, type Ruta,
} from './deliveryRutas';

const msg = (e: unknown, d: string) => (e instanceof Error && e.message ? e.message : d);
const SIN_RECORRIDO: PuntoRecorrido[] = [];
const horaVE = (iso: string) => new Date(iso).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit' });

const ocDeDetalle = (d: PedidoDetalleDelivery) => {
  const o = d.orden;
  if (!o) return '—';
  return d.tipo === 'retiro_almacen' ? `${o.codigo} · Retiro Los Pinos` : (o.oc_codigo || o.codigo);
};

/** Los renglones del pedido: en un retiro, lo que entrega Los Pinos; en una OC, lo que se compra. */
function itemsDe(d: PedidoDetalleDelivery): Array<{ nombre: string; cantidad: number; unidad?: string | null }> {
  const items = d.orden?.items ?? [];
  if (d.tipo === 'retiro_almacen') {
    return items.map((i) => ({ nombre: i.nombre, cantidad: Number((i.almacen_origenes as Record<string, unknown> | null | undefined)?.['LOS PINOS']) || 0, unidad: i.unidad }))
      .filter((i) => i.cantidad > 0);
  }
  return items.filter((i) => i.comprar !== false).map((i) => ({ nombre: i.nombre, cantidad: Number(i.cantidad) || 0, unidad: i.unidad }));
}

export function DetalleDeliveryModal({ repartidor, filas, desde, hasta, destinos, onClose }: {
  repartidor: string;
  filas: FilaHistorialDelivery[];
  desde: string;
  hasta: string;
  destinos: DestinosDelivery;
  onClose: () => void;
}) {
  const [detalle, setDetalle] = useState<PedidoDetalleDelivery[]>([]);
  const [recorridos, setRecorridos] = useState<Map<string, PuntoRecorrido[]>>(new Map());
  const [provPts, setProvPts] = useState<Map<string, Punto>>(new Map());
  const [provNombre, setProvNombre] = useState<Map<string, string>>(new Map());
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);

  const ids = useMemo(() => filas.map((f) => f.id), [filas]);
  const claveIds = ids.join(',');
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    void (async () => {
      try {
        const lista = claveIds ? claveIds.split(',') : [];
        const [d, rec] = await Promise.all([detallePedidosDelivery(lista), recorridoPedidos(lista)]);
        const provIds = d.map((x) => x.orden?.proveedor_id).filter((x): x is string => !!x);
        const provs = await listProveedoresUbicacion(provIds).catch(() => []);
        if (!vivo) return;
        setDetalle(d);
        setRecorridos(rec);
        setProvPts(puntosDeProveedores(provs));
        setProvNombre(new Map(provs.map((p) => [p.id, p.razon_social])));
        setElegido((e) => e ?? d[0]?.id ?? null);
        setError(null);
      } catch (e) {
        if (vivo) setError(msg(e, 'No se pudo leer el detalle.'));
      } finally { if (vivo) setCargando(false); }
    })();
    return () => { vivo = false; };
  }, [claveIds]);

  const resumen = useMemo(() => {
    let entregados = 0; let cancelados = 0; let enCurso = 0; let metros = 0; const mins: number[] = [];
    for (const d of detalle) {
      if (d.estado === 'entregado') {
        entregados++;
        const t = tiemposPedido(d).total;
        if (t != null) mins.push(t);
      } else if (d.estado === 'cancelado') cancelados++;
      else enCurso++;
      metros += metrosRecorrido(recorridos.get(d.id) ?? []);
    }
    return { entregados, cancelados, enCurso, metros, prom: mins.length ? Math.round(mins.reduce((s, x) => s + x, 0) / mins.length) : null };
  }, [detalle, recorridos]);

  const sel = detalle.find((d) => d.id === elegido) ?? null;
  const proveedorDe = (d: PedidoDetalleDelivery) => (d.tipo === 'retiro_almacen' ? 'ALMACÉN LOS PINOS'
    : (d.orden?.proveedor_id && provNombre.get(d.orden.proveedor_id)) || filas.find((f) => f.id === d.id)?.proveedor || '—');

  return (
    <Modal title={`🛵 ${repartidor} · ${desde === hasta ? fechaCorta(desde) : `${fechaCorta(desde)} al ${fechaCorta(hasta)}`}`} size="xl" onClose={onClose}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      {error && <div className="aviso danger" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">⚠</span><div>{error}</div></div>}
      <div className="kpi-grid" style={{ marginBottom: '.75rem' }}>
        <div className="kpi"><div className="label">Entregados</div><div className="value">{resumen.entregados}</div><div className="icon" aria-hidden="true">✅</div></div>
        <div className="kpi"><div className="label">Cancelados</div><div className="value">{resumen.cancelados}</div><div className="icon" aria-hidden="true">⛔</div></div>
        <div className="kpi"><div className="label">En curso</div><div className="value">{resumen.enCurso}</div><div className="icon" aria-hidden="true">🚚</div></div>
        <div className="kpi">
          <div className="label">Tiempo promedio</div><div className="value">{duracionTxt(resumen.prom)}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>{resumen.metros > 0 ? `${distanciaTxt(resumen.metros)} recorridos` : 'Sin recorrido guardado'}</div>
          <div className="icon" aria-hidden="true">⏳</div>
        </div>
      </div>

      <MapaPedido pedido={sel} recorrido={(sel && recorridos.get(sel.id)) || SIN_RECORRIDO} provPts={provPts} destinos={destinos}
        titulo={sel ? `${ocDeDetalle(sel)} · ${proveedorDe(sel)}` : null} />

      {cargando ? <p className="muted">Cargando los pedidos…</p> : !detalle.length ? <p className="muted">Sin pedidos en el rango.</p> : (
        <div className="table-wrap" style={{ marginTop: '.75rem' }}>
          <table className="table" style={{ fontSize: '.84rem' }}>
            <thead>
              <tr>
                <th>Orden</th><th>Proveedor</th><th>Productos</th><th>Estado</th><th>Horas</th><th>Tiempos</th><th>Almacén / motivo</th><th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {detalle.map((d) => {
                const est = ESTADO_DELIVERY[d.estado as EstadoDelivery];
                const t = tiemposPedido(d);
                const items = itemsDe(d);
                const fin = d.estado === 'cancelado' ? d.cancelado_en : d.entregado_en;
                const nFotos = d.fotos_recibo.length + d.fotos_entrega.length;
                const esAbierto = abierto === d.id;
                return (
                  <Fragment key={d.id}>
                    <tr style={elegido === d.id ? { background: 'color-mix(in srgb, var(--primary) 10%, transparent)' } : undefined}>
                      <td>
                        <strong>{ocDeDetalle(d)}</strong>
                        {d.tipo !== 'retiro_almacen' && d.orden && <div className="muted" style={{ fontSize: '.75rem' }}>{montoTxt(d.orden.total, d.orden.moneda ?? 'USD')}</div>}
                      </td>
                      <td>{proveedorDe(d)}</td>
                      <td>{items.length ? `${items.length} ${items.length === 1 ? 'producto' : 'productos'}` : '—'}</td>
                      <td><span className={`badge ${est?.badge ?? ''}`}>{est?.emoji} {est?.label ?? d.estado}</span></td>
                      <td style={{ fontSize: '.76rem', whiteSpace: 'nowrap' }}>
                        <div>🛵 {fechaHoraVE(d.aceptado_en)}</div>
                        {d.en_ruta_en && <div>🚚 {fechaHoraVE(d.en_ruta_en)}</div>}
                        {fin && <div>{d.estado === 'cancelado' ? '⛔' : '✅'} {fechaHoraVE(fin)}</div>}
                      </td>
                      <td style={{ fontSize: '.76rem', whiteSpace: 'nowrap' }}>
                        {t.pasos.map((p) => <div key={p.paso}>{p.paso}: {duracionTxt(p.minutos)}</div>)}
                        <div><strong>Total: {duracionTxt(t.total)}</strong></div>
                      </td>
                      <td style={{ fontSize: '.8rem' }}>
                        {d.estado === 'cancelado'
                          ? <>{d.motivo_cancel ?? '—'}{d.detalle_cancel && <div className="muted">{d.detalle_cancel}</div>}</>
                          : d.almacen_entrega ? nombreAlmacenVisible(d.almacen_entrega)
                            : d.orden?.almacen_destino ? <span className="muted">Hacia {nombreAlmacenVisible(d.orden.almacen_destino)}</span> : '—'}
                        {d.nota_entrega && <div className="muted">📝 {d.nota_entrega}</div>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '.3rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setElegido(d.id)} aria-pressed={elegido === d.id}>🗺 Ruta</button>
                          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={esAbierto}
                            onClick={() => setAbierto(esAbierto ? null : d.id)}>
                            {esAbierto ? '▲ Ocultar' : `📋 Detalle${nFotos ? ` · 📷 ${nFotos}` : ''}`}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {esAbierto && (
                      <tr>
                        <td colSpan={8} style={{ background: 'var(--surface-2)' }}>
                          <div style={{ display: 'grid', gap: '.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                            <div>
                              <div className="card-title" style={{ fontSize: '.85rem' }}>📦 Productos</div>
                              {!items.length ? <p className="muted" style={{ margin: 0 }}>Sin renglones.</p> : (
                                <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                                  {items.map((i, k) => (
                                    <li key={`${i.nombre}-${k}`}>{i.nombre} — {i.cantidad.toLocaleString('es-VE', { maximumFractionDigits: 3 })}{i.unidad ? ` ${i.unidad}` : ''}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div>
                              <div className="card-title" style={{ fontSize: '.85rem' }}>📷 Al recibir ({d.fotos_recibo.length})</div>
                              <Miniaturas fotos={d.fotos_recibo} />
                              <div className="card-title" style={{ fontSize: '.85rem', marginTop: '.5rem' }}>📷 De la entrega ({d.fotos_entrega.length})</div>
                              <Miniaturas fotos={d.fotos_entrega} />
                            </div>
                            <div>
                              <div className="card-title" style={{ fontSize: '.85rem' }}>📜 Historial</div>
                              {!d.historial.length ? <p className="muted" style={{ margin: 0 }}>—</p> : (
                                <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '.8rem' }}>
                                  {d.historial.map((h, k) => (
                                    <li key={`${h.at}-${k}`}>{fechaHoraVE(h.at)} · {h.evento.replace(/_/g, ' ')}{h.motivo ? ` · ${h.motivo}` : ''}</li>
                                  ))}
                                </ul>
                              )}
                              <p className="muted" style={{ margin: '.4rem 0 0', fontSize: '.78rem' }}>
                                {(recorridos.get(d.id)?.length ?? 0) > 1
                                  ? `Recorrido guardado: ${recorridos.get(d.id)!.length} puntos · ${distanciaTxt(metrosRecorrido(recorridos.get(d.id)!))}`
                                  : 'Sin recorrido guardado (el delivery no compartía ubicación o es anterior al 03-11).'}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

/** Miniaturas con enlace firmado (se abren en otra pestaña). */
function Miniaturas({ fotos }: { fotos: FotoDelivery[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const clave = fotos.map((f) => f.path).join('|');
  useEffect(() => {
    let vivo = true;
    void Promise.all(fotos.map(async (f) => [f.path, await urlFotoDelivery(f.path).catch(() => '')] as const))
      .then((xs) => { if (vivo) setUrls(Object.fromEntries(xs)); });
    return () => { vivo = false; };
    // `clave` resume las rutas: el arreglo cambia de identidad en cada lectura aunque sean las mismas fotos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);
  if (!fotos.length) return <p className="muted" style={{ margin: 0, fontSize: '.8rem' }}>Sin fotos.</p>;
  return (
    <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
      {fotos.map((f) => (
        <a key={f.path} href={urls[f.path] || undefined} target="_blank" rel="noopener noreferrer" title={f.filename}>
          {urls[f.path]
            ? <img src={urls[f.path]} alt={f.filename} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
            : <span className="muted" style={{ display: 'grid', placeItems: 'center', width: 64, height: 64, border: '1px dashed var(--border)', borderRadius: 6 }}>📷</span>}
        </a>
      ))}
    </div>
  );
}

/* ── Mapa del pedido elegido: ruta planeada + recorrido guardado ── */

function MapaPedido({ pedido, recorrido, provPts, destinos, titulo }: {
  pedido: PedidoDetalleDelivery | null; recorrido: PuntoRecorrido[]; provPts: Map<string, Punto>; destinos: DestinosDelivery; titulo: string | null;
}) {
  const contenedor = useRef<HTMLDivElement | null>(null);
  const mapa = useRef<L.Map | null>(null);
  const capa = useRef<L.LayerGroup | null>(null);
  const [ruta, setRuta] = useState<Ruta | null>(null);

  useEffect(() => {
    if (!contenedor.current || mapa.current) return;
    const m = crearMapaBase(contenedor.current);
    capa.current = L.layerGroup().addTo(m);
    mapa.current = m;
    const t = setTimeout(() => m.invalidateSize(), 150);
    return () => { clearTimeout(t); m.remove(); mapa.current = null; capa.current = null; };
  }, []);

  const origen = useMemo<Punto | null>(() => {
    if (!pedido) return null;
    if (pedido.tipo === 'retiro_almacen') return puntoDeDestino(destinos['LOS PINOS']);
    return (pedido.orden?.proveedor_id && provPts.get(pedido.orden.proveedor_id)) || null;
  }, [pedido, provPts, destinos]);
  const destino = useMemo<Punto | null>(() => {
    if (!pedido) return null;
    const c = claveDestino(pedido.almacen_entrega ?? pedido.orden?.almacen_destino ?? pedido.orden?.sede_destino);
    return c ? puntoDeDestino(destinos[c]) : null;
  }, [pedido, destinos]);
  const inicio = recorrido[0] ?? null;

  // Ruta planeada: desde donde lo tomó → proveedor → almacén (por calle; si falla, línea recta).
  useEffect(() => {
    let vivo = true;
    setRuta(null);
    const puntos = puntosRutaPlaneada(inicio, origen, destino);
    void calcularRuta(puntos).then((r) => { if (vivo) setRuta(r); });
    return () => { vivo = false; };
  }, [inicio, origen, destino]);

  useEffect(() => {
    const g = capa.current;
    const m = mapa.current;
    if (!g || !m) return;
    g.clearLayers();
    const todos: L.LatLngExpression[] = [];
    if (ruta) {
      const linea = ruta.linea.map((p) => [p.lat, p.lng] as [number, number]);
      L.polyline(linea, { color: '#2563eb', weight: 5, opacity: 0.55, dashArray: ruta.fuente === 'recta' ? '8 8' : undefined })
        .bindTooltip('Ruta planeada', { sticky: true }).addTo(g);
      todos.push(...linea);
    }
    if (recorrido.length > 1) {
      const linea = recorrido.map((p) => [p.lat, p.lng] as [number, number]);
      L.polyline(linea, { color: '#ea580c', weight: 4, opacity: 0.9 }).bindTooltip('Recorrido guardado', { sticky: true }).addTo(g);
      todos.push(...linea);
    }
    if (inicio) {
      L.marker([inicio.lat, inicio.lng], { icon: iconoPildora('🟢', `Inicio ${horaVE(inicio.t)}`, '#16a34a') }).addTo(g);
      todos.push([inicio.lat, inicio.lng]);
    }
    if (origen) {
      L.marker([origen.lat, origen.lng], { icon: iconoPildora(pedido?.tipo === 'retiro_almacen' ? '🏬' : '🏭', 'Origen', '#d97706'), zIndexOffset: 200 }).addTo(g);
      todos.push([origen.lat, origen.lng]);
    }
    if (destino) {
      L.marker([destino.lat, destino.lng], { icon: iconoPildora('🏬', 'Entrega', '#374151'), zIndexOffset: 200 }).addTo(g);
      todos.push([destino.lat, destino.lng]);
    }
    const fin = recorrido.length > 1 ? recorrido[recorrido.length - 1] : null;
    if (fin) L.marker([fin.lat, fin.lng], { icon: iconoPildora('🏁', `Fin ${horaVE(fin.t)}`, '#111827') }).addTo(g);
    if (todos.length) m.fitBounds(L.latLngBounds(todos as L.LatLngTuple[]), { padding: [36, 36], maxZoom: 16 });
  }, [ruta, recorrido, inicio, origen, destino, pedido]);

  const faltan: string[] = [];
  if (pedido && !origen) faltan.push(pedido.tipo === 'retiro_almacen' ? 'el almacén LOS PINOS' : 'el proveedor');
  if (pedido && !destino) faltan.push('el almacén de entrega');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.4rem', fontSize: '.85rem' }}>
        <strong>🗺 {titulo ?? 'Elige un pedido'}</strong>
        {ruta && <span className="muted">Planeada: {distanciaTxt(ruta.metros)}{ruta.segundos != null ? ` · ${tiempoRutaTxt(ruta.segundos)}` : ''}{ruta.fuente === 'recta' ? ' (línea recta)' : ''}</span>}
        {recorrido.length > 1 && <span className="muted">· Recorrido: {distanciaTxt(metrosRecorrido(recorrido))}</span>}
        <span style={{ marginLeft: 'auto', fontSize: '.78rem' }} className="muted">
          <span style={{ color: '#2563eb', fontWeight: 700 }}>━</span> planeada · <span style={{ color: '#ea580c', fontWeight: 700 }}>━</span> recorrido guardado
        </span>
      </div>
      {faltan.length > 0 && (
        <div className="aviso info sm" style={{ marginBottom: '.4rem' }}><span className="aviso-icono">📍</span><div>Falta ubicar en el mapa {faltan.join(' y ')}: la ruta planeada queda incompleta.</div></div>
      )}
      <div ref={contenedor} style={{ height: 'min(50vh, 400px)', minHeight: 260, borderRadius: 10, overflow: 'hidden', isolation: 'isolate', position: 'relative' }} />
    </div>
  );
}
