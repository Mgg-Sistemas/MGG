/* ============================================================
   MGG · Delivery · Mapa del Controlador y Despacho (PC)
   Centro de Control en tiempo real con OpenStreetMap y Esri Satelital.
   Incorpora:
   · Identificadores/Diferenciadores anti-solapamiento (M-01, M-02... / C-01...)
   · Trazado de ruta más óptima con animación vial de flujo (stream)
   · HUD de Telemetría de Controlador (paradas, distancia vial, ETA y Google Maps)
   · Seguimiento interactivo al seleccionar un motorizado o pedido
   ============================================================ */
import type { CanalDelivery } from './delivery';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { Link } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import {
  ALMACEN_RETIRO, PUERTO_ORDAZ, UBICACION_VIEJA_MS, esRetiroAlmacen, esRetornoPendiente, fechaHoraVE, montoTxt, ocDe,
  type PedidoDelivery, type UbicacionDelivery,
} from './delivery';
import {
  fijarLugarDelivery, listRastroDelivery, listUbicaciones, useUbicacionesRuta, type PuntoRastro,
} from './delivery.repository';
import { escaparHtml, ubicacionVieja } from './deliveryPanel';
import { distanciaMetros } from './deliveryMovil';
import {
  LUGAR_LOS_PINOS, RECALCULAR_RUTA_M, calcularRuta, claveRuta, distanciaTxt, duracionTxt, paradasRuta, puntoLugar,
  urlNavegacionDestino, type ParadaRuta, type PuntoMapa, type RutaCalculada,
} from './deliveryRutas';
import {
  obtenerDiferenciador, type DiferenciadorRepartidor,
} from './deliveryIdentificadores';

const ZOOM_INICIAL = 13;

/** Pin ergonómico de controlador: badge compacto con código M-01 e ícono, sin textos largos que se solapen */
function iconoControlador(dif: DiferenciadorRepartidor, vieja: boolean, seleccionado: boolean): L.DivIcon {
  const fondo = vieja ? '#9ca3af' : dif.color;
  const html = `
    <div class="dlv-pin-controlador ${seleccionado ? 'seleccionado' : ''}" style="background:${fondo};border-color:${seleccionado ? '#38bdf8' : '#ffffff'};${vieja ? 'opacity:.82;' : ''}">
      <span class="dlv-pin-cod">${escaparHtml(dif.codigo)}</span>
      <span class="dlv-pin-ico">${dif.icono}</span>
      <span class="dlv-pin-nombre">${escaparHtml(dif.nombreVisible)}</span>
    </div>
  `;
  return L.divIcon({ html, className: 'dlv-marcador-wrap', iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -14] });
}

function chipLugar(html: string, fondo: string): L.DivIcon {
  const h = `<div style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px 2px 5px;border-radius:999px;background:${fondo};`
    + `color:#fff;font:600 11px/1.2 system-ui,sans-serif;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35);`
    + `border:2px solid #fff;transform:translate(-50%,-50%)">${html}</div>`;
  return L.divIcon({ html: h, className: 'dlv-marcador', iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -12] });
}

interface RutaPrevista { clave: string; ruta: RutaCalculada; paradas: ParadaRuta[] }

function globoDetalle(
  u: UbicacionDelivery,
  dif: DiferenciadorRepartidor,
  pedido: PedidoDelivery | undefined,
  vieja: boolean,
  prevista: RutaPrevista | undefined
): string {
  const partes = [
    `<div style="color:#1f2937;font:13px/1.4 system-ui,sans-serif;min-width:190px">`,
    `<div style="display:flex;align-items:center;gap:6px;font-weight:800;font-size:14px;color:${dif.color}">`
    + `<span style="background:${dif.color};color:#fff;padding:1px 6px;border-radius:4px;font-size:11px">${escaparHtml(dif.codigo)}</span>`
    + `${dif.icono} ${escaparHtml(dif.nombreVisible)}</div>`,
    `<div style="color:#4b5563;font-size:12px;margin-top:2px">Última señal: ${escaparHtml(fechaHoraVE(u.actualizado_en))}</div>`,
  ];
  if (vieja) partes.push('<div style="color:#b45309;font-weight:700;font-size:12px">⚠️ Sin señal reciente</div>');
  if (u.velocidad != null && u.velocidad > 0) {
    partes.push(`<div style="color:#059669;font-weight:600;font-size:12px">⚡ Velocidad: ${Math.round(u.velocidad * 3.6)} km/h</div>`);
  }
  if (pedido) {
    const retiro = esRetiroAlmacen(pedido);
    partes.push(
      `<div style="margin-top:4px;padding-top:4px;border-top:1px solid #e5e7eb">`
      + `<b>${escaparHtml(retiro ? pedido.codigo : ocDe(pedido))}</b> · ${escaparHtml(retiro ? `Retiro en ${ALMACEN_RETIRO}` : (pedido.proveedor_nombre ?? '—'))}`
      + `${pedido.almacen_destino && !retiro ? `<br>Hacia: ${escaparHtml(pedido.almacen_destino)}` : ''}`
      + `${esRetornoPendiente(pedido) ? '<br><span style="color:#0284c7;font-weight:700">📸 En retorno a almacén</span>' : ''}</div>`,
    );
  }
  if (prevista) {
    const destinos = prevista.paradas.filter((p) => p.tipo !== 'yo').map((p) => escaparHtml(p.nombre)).join(' → ');
    partes.push(
      `<div style="margin-top:4px;color:#1d4ed8"><b>🧭 Ruta óptima:</b> ${escaparHtml(distanciaTxt(prevista.ruta.metros))}`
      + `${prevista.ruta.segundos != null ? ` · ${escaparHtml(duracionTxt(prevista.ruta.segundos))}` : ' (vial)'}`
      + `${destinos ? `<br>${destinos}` : ''}</div>`,
    );
  }
  partes.push('</div>');
  return partes.join('');
}

const enCurso = (p: PedidoDelivery | undefined) => !!p && (p.estado === 'aceptado' || p.estado === 'en_ruta');

export function DeliveryMapa({
  pedidos,
  canal = 'delivery',
  repartidorEnfocar,
}: {
  pedidos: PedidoDelivery[];
  canal?: CanalDelivery;
  repartidorEnfocar?: string | null;
}) {
  const puedeMarcar = usePermissions().can('delivery', 'escritura');
  const contenedor = useRef<HTMLDivElement | null>(null);
  const mapa = useRef<L.Map | null>(null);
  const capa = useRef<L.LayerGroup | null>(null);
  const capaLugares = useRef<L.LayerGroup | null>(null);
  const capaRutas = useRef<L.LayerGroup | null>(null);
  const [ubicaciones, setUbicaciones] = useState<UbicacionDelivery[]>([]);
  const [rastro, setRastro] = useState<Map<string, PuntoRastro[]>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [modoPinos, setModoPinos] = useState(false);
  const [pinosPendiente, setPinosPendiente] = useState<PuntoMapa | null>(null);
  const [seleccionado, setSeleccionado] = useState<string | null>(repartidorEnfocar ?? null);

  useEffect(() => {
    if (repartidorEnfocar) setSeleccionado(repartidorEnfocar);
  }, [repartidorEnfocar]);

  const pedidoPorId = useMemo(() => {
    const mp = new Map<string, PedidoDelivery>();
    for (const p of pedidos) if (p.pedido_id) mp.set(p.pedido_id, p);
    return mp;
  }, [pedidos]);
  const idsEnCurso = useMemo(() => pedidos.filter((p) => enCurso(p)).map((p) => p.pedido_id as string).sort().join(','), [pedidos]);

  const { provs, lugares } = useUbicacionesRuta(pedidos.map((p) => p.proveedor_id));
  const losPinos = useMemo(() => puntoLugar(lugares, LUGAR_LOS_PINOS), [lugares]);

  const cargar = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([
        listUbicaciones(canal),
        listRastroDelivery(idsEnCurso ? idsEnCurso.split(',') : []).catch(() => new Map<string, PuntoRastro[]>()),
      ]);
      setUbicaciones(u);
      setRastro(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron leer las ubicaciones.');
    }
  }, [idsEnCurso, canal]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['delivery_ubicaciones'], () => { void cargar(); });

  // Revisión periódica de señal
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Clic en el mapa para marcar Los Pinos
  const alClic = useRef<((p: PuntoMapa) => void) | null>(null);
  useEffect(() => {
    alClic.current = modoPinos ? (p) => setPinosPendiente(p) : null;
  }, [modoPinos]);

  // Creación del mapa Leaflet
  useEffect(() => {
    if (!contenedor.current || mapa.current) return;
    const m = L.map(contenedor.current, { center: PUERTO_ORDAZ, zoom: ZOOM_INICIAL });
    const calles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    });
    const satelital = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{x}/{y}', {
      maxZoom: 19,
      attribution: 'Imágenes &copy; Esri',
    });
    calles.addTo(m);
    L.control.layers({ Calles: calles, Satelital: satelital }, undefined, { position: 'topright' }).addTo(m);
    L.control.scale({ imperial: false }).addTo(m);
    capaRutas.current = L.layerGroup().addTo(m);
    capaLugares.current = L.layerGroup().addTo(m);
    capa.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => alClic.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    mapa.current = m;

    const t = setTimeout(() => m.invalidateSize(), 120);
    return () => {
      clearTimeout(t);
      m.remove();
      mapa.current = null;
      capa.current = null;
      capaLugares.current = null;
      capaRutas.current = null;
    };
  }, []);

  useEffect(() => {
    const el = contenedor.current;
    if (el) el.style.cursor = modoPinos ? 'crosshair' : '';
  }, [modoPinos]);

  // Diferenciadores estables y persistentes para cada repartidor
  const diferenciadores = useMemo(() => {
    const mp = new Map<string, DiferenciadorRepartidor>();
    const ids = [...new Set(ubicaciones.map((u) => u.repartidor_id))].sort();
    ids.forEach((id, idx) => {
      const u = ubicaciones.find((x) => x.repartidor_id === id);
      mp.set(id, obtenerDiferenciador(id, u?.repartidor_nombre || u?.repartidor_email, canal, idx));
    });
    return mp;
  }, [ubicaciones, canal]);

  /* ── Ruta prevista de cada motorizado con pedido en curso ── */
  const [previstas, setPrevistas] = useState<Map<string, RutaPrevista>>(() => new Map());
  const origenes = useRef(new Map<string, PuntoMapa>());
  const previstasRef = useRef(previstas);
  useEffect(() => { previstasRef.current = previstas; }, [previstas]);

  useEffect(() => {
    let vivo = true;
    const activos = new Set<string>();
    const pendientes: Array<{ rep: string; clave: string; paradas: ParadaRuta[] }> = [];

    for (const u of ubicaciones) {
      const pedido = u.pedido_id ? pedidoPorId.get(u.pedido_id) : undefined;
      if (!enCurso(pedido) || ubicacionVieja(u.actualizado_en, ahora) || !Number.isFinite(u.lat) || !Number.isFinite(u.lng)) continue;
      activos.add(u.repartidor_id);
      const aqui = { lat: u.lat, lng: u.lng };
      const antes = origenes.current.get(u.repartidor_id);
      const origen = antes && distanciaMetros(antes, aqui) <= RECALCULAR_RUTA_M ? antes : aqui;
      origenes.current.set(u.repartidor_id, origen);
      const paradas = paradasRuta(pedido as PedidoDelivery, origen, provs, losPinos);
      if (paradas.length < 2) continue;
      const clave = claveRuta(paradas.map((p) => p.punto));
      if (previstasRef.current.get(u.repartidor_id)?.clave !== clave) pendientes.push({ rep: u.repartidor_id, clave, paradas });
    }

    const sobran = [...previstasRef.current.keys()].filter((k) => !activos.has(k));
    if (sobran.length) {
      setPrevistas((prev) => { const n = new Map(prev); sobran.forEach((k) => n.delete(k)); return n; });
    }
    for (const x of pendientes) {
      void calcularRuta(x.paradas.map((p) => p.punto)).then((ruta) => {
        if (!vivo) return;
        setPrevistas((prev) => new Map(prev).set(x.rep, { clave: x.clave, ruta, paradas: x.paradas }));
      });
    }
    return () => { vivo = false; };
  }, [ubicaciones, pedidoPorId, provs, losPinos, ahora]);

  // Marcadores de repartidores con badges de identificador anti-solapamiento
  useEffect(() => {
    const g = capa.current;
    if (!g) return;
    g.clearLayers();
    for (const u of ubicaciones) {
      if (!Number.isFinite(u.lat) || !Number.isFinite(u.lng)) continue;
      const vieja = ubicacionVieja(u.actualizado_en, ahora);
      const dif = diferenciadores.get(u.repartidor_id) ?? obtenerDiferenciador(u.repartidor_id, u.repartidor_nombre, canal);
      const pedido = u.pedido_id ? pedidoPorId.get(u.pedido_id) : undefined;
      const esSel = seleccionado === u.repartidor_id;

      const marker = L.marker([u.lat, u.lng], {
        icon: iconoControlador(dif, vieja, esSel),
        title: `${dif.codigo} · ${dif.nombreVisible}`,
        zIndexOffset: esSel ? 1800 : vieja ? 0 : 1000,
      })
        .bindPopup(globoDetalle(u, dif, pedido, vieja, previstas.get(u.repartidor_id)))
        .on('click', () => setSeleccionado(u.repartidor_id));

      marker.addTo(g);
    }
  }, [ubicaciones, pedidoPorId, ahora, previstas, diferenciadores, seleccionado, canal]);

  // Rutas óptimas animadas (stream vial continuo) y recorridos históricos
  useEffect(() => {
    const g = capaRutas.current;
    if (!g) return;
    g.clearLayers();

    for (const u of ubicaciones) {
      const dif = diferenciadores.get(u.repartidor_id) ?? obtenerDiferenciador(u.repartidor_id, u.repartidor_nombre, canal);
      const color = dif.color;
      const esSel = seleccionado === u.repartidor_id;

      // Recorrido histórico real
      const r = u.pedido_id ? rastro.get(u.pedido_id) : undefined;
      if (r && r.length >= 2 && enCurso(pedidoPorId.get(u.pedido_id as string))) {
        L.polyline(r.map((x) => [x.lat, x.lng] as [number, number]), {
          color,
          weight: 4,
          opacity: 0.55,
          interactive: false,
        }).addTo(g);
      }

      // Ruta óptima calculada hacia destino con animación de flujo de navegación
      const prev = previstas.get(u.repartidor_id);
      if (prev) {
        // Línea base con resplandor
        L.polyline(prev.ruta.linea, {
          color,
          weight: esSel ? 9 : 7,
          opacity: esSel ? 0.35 : 0.22,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(g);

        // Línea superior con animación continua de flujo hacia el destino
        L.polyline(prev.ruta.linea, {
          color,
          weight: esSel ? 6 : 5,
          opacity: esSel ? 1 : 0.88,
          className: 'dlv-ruta-stream-animada',
          dashArray: '12 14',
          lineCap: 'round',
          lineJoin: 'round',
        })
          .bindTooltip(`${dif.codigo} · ${dif.nombreVisible} · ${distanciaTxt(prev.ruta.metros)}${prev.ruta.segundos != null ? ` · ${duracionTxt(prev.ruta.segundos)}` : ''}`, { sticky: true })
          .on('click', () => setSeleccionado(u.repartidor_id))
          .addTo(g);

        for (const p of prev.paradas) {
          if (p.tipo === 'recogida' && !esRetiroAlmacen({ origen: pedidoPorId.get(u.pedido_id as string)?.origen })) {
            L.circleMarker([p.punto.lat, p.punto.lng], {
              radius: esSel ? 7 : 6,
              color: '#fff',
              weight: 2,
              fillColor: color,
              fillOpacity: 1,
              interactive: false,
            }).addTo(g);
          }
        }
      }
    }
  }, [ubicaciones, rastro, previstas, pedidoPorId, diferenciadores, seleccionado, canal]);

  // Proveedores y Almacén Los Pinos
  const porTomar = useMemo(() => pedidos.filter((p) => p.estado === 'por_tomar'), [pedidos]);
  const { gruposProv, sinUbicacion } = useMemo(() => {
    const grupos = new Map<string, { nombre: string; punto: PuntoMapa; ocs: PedidoDelivery[]; enCurso: number }>();
    const sin = new Set<string>();
    for (const p of pedidos) {
      const libre = p.estado === 'por_tomar';
      if (esRetiroAlmacen(p) || !p.proveedor_id || !(libre || enCurso(p))) continue;
      const punto = provs.get(p.proveedor_id);
      if (!punto) { sin.add(p.proveedor_id); continue; }
      const g = grupos.get(p.proveedor_id) ?? { nombre: p.proveedor_nombre ?? 'Proveedor', punto, ocs: [], enCurso: 0 };
      if (libre) g.ocs.push(p); else g.enCurso++;
      grupos.set(p.proveedor_id, g);
    }
    return { gruposProv: [...grupos.values()], sinUbicacion: sin.size };
  }, [pedidos, provs]);
  const retirosPorTomar = porTomar.filter((p) => esRetiroAlmacen(p)).length;

  useEffect(() => {
    const g = capaLugares.current;
    if (!g) return;
    g.clearLayers();
    for (const x of gruposProv) {
      const urgente = x.ocs.some((p) => p.urgente);
      const lista = x.ocs.map((p) => `<li><b>${escaparHtml(ocDe(p))}</b> · ${escaparHtml(montoTxt(p.total, p.moneda))}${p.urgente ? ' · 🚨 Urgente' : ''}</li>`).join('');
      const fondo = x.ocs.length ? (urgente ? '#dc2626' : '#d97706') : '#2563eb';
      L.marker([x.punto.lat, x.punto.lng], {
        icon: chipLugar(`🏭 ${escaparHtml(x.nombre.length > 26 ? `${x.nombre.slice(0, 25)}…` : x.nombre)}${x.ocs.length > 1 ? ` (${x.ocs.length})` : ''}`, fondo),
        zIndexOffset: 400,
      }).bindPopup(`<div style="color:#1f2937;font:13px/1.4 system-ui,sans-serif;min-width:180px"><div style="font-weight:700">🏭 ${escaparHtml(x.nombre)}</div>`
        + `${x.ocs.length ? `<div>💰 OC pagadas por tomar:</div><ul style="margin:.2rem 0 0;padding-left:1rem">${lista}</ul>` : ''}`
        + `${x.enCurso ? `<div>🚚 ${x.enCurso} en curso</div>` : ''}</div>`).addTo(g);
    }
    if (losPinos) {
      L.marker([losPinos.lat, losPinos.lng], {
        icon: chipLugar(`🏬 LOS PINOS${retirosPorTomar ? ` · ${retirosPorTomar} retiro${retirosPorTomar === 1 ? '' : 's'}` : ''}`, '#374151'),
        zIndexOffset: 600,
      }).addTo(g);
    }
    if (pinosPendiente) {
      L.circleMarker([pinosPendiente.lat, pinosPendiente.lng], { radius: 9, color: '#7c3aed', weight: 3, fillColor: '#c4b5fd', fillOpacity: 0.9 }).addTo(g);
    }
  }, [gruposProv, losPinos, retirosPorTomar, pinosPendiente]);

  async function guardarPinos() {
    if (!pinosPendiente) return;
    try {
      await fijarLugarDelivery(LUGAR_LOS_PINOS, pinosPendiente);
      toast(`${ALMACEN_RETIRO} quedó marcado en el mapa.`, 'success');
      setModoPinos(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo marcar el almacén.', 'error');
    } finally {
      setPinosPendiente(null);
    }
  }

  function verATodos() {
    setSeleccionado(null);
    const m = mapa.current;
    if (!m) return;
    const puntos: L.LatLng[] = ubicaciones.filter((u) => Number.isFinite(u.lat) && Number.isFinite(u.lng)).map((u) => L.latLng(u.lat, u.lng));
    gruposProv.forEach((x) => puntos.push(L.latLng(x.punto.lat, x.punto.lng)));
    if (losPinos) puntos.push(L.latLng(losPinos.lat, losPinos.lng));
    if (!puntos.length) { m.setView(PUERTO_ORDAZ, ZOOM_INICIAL); return; }
    m.fitBounds(L.latLngBounds(puntos), { padding: [48, 48], maxZoom: 16 });
  }

  function enfocarUnidad(repId: string) {
    setSeleccionado(repId);
    const u = ubicaciones.find((x) => x.repartidor_id === repId);
    if (mapa.current && u && Number.isFinite(u.lat) && Number.isFinite(u.lng)) {
      mapa.current.flyTo([u.lat, u.lng], 16, { animate: true, duration: 1.0 });
    }
  }

  const conSenal = ubicaciones.filter((u) => !ubicacionVieja(u.actualizado_en, ahora)).length;
  const enRutaConMapa = previstas.size;

  // Datos para el HUD de Telemetría Flotante de Controlador
  const repSel = seleccionado ? ubicaciones.find((u) => u.repartidor_id === seleccionado) : null;
  const difSel = seleccionado ? (diferenciadores.get(seleccionado) ?? obtenerDiferenciador(seleccionado, repSel?.repartidor_nombre, canal)) : null;
  const pedidoSel = repSel?.pedido_id ? pedidoPorId.get(repSel.pedido_id) : null;
  const prevSel = seleccionado ? previstas.get(seleccionado) : null;
  const paradaSiguiente = prevSel?.paradas.find((p) => p.tipo !== 'yo');
  const urlGmaps = paradaSiguiente && repSel ? urlNavegacionDestino(paradaSiguiente.punto, { lat: repSel.lat, lng: repSel.lng }) : null;

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
        <span>🗺 Centro de Despacho y Rutas en Vivo</span>
        <span className="badge success">{conSenal} con señal</span>
        {ubicaciones.length - conSenal > 0 && <span className="badge warning">{ubicaciones.length - conSenal} sin señal</span>}
        {enRutaConMapa > 0 && <span className="badge info">🧭 {enRutaConMapa} en ruta</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          <Link to="/app/proveedores" className="btn btn-ghost btn-sm" title="Marca la ubicación en Proveedores › Editar › «Ubicación en el mapa»">📍 Ubicar proveedores</Link>
          {puedeMarcar && (
            <button type="button" className={`btn btn-sm ${modoPinos ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setModoPinos((v) => !v); setPinosPendiente(null); }}>
              {modoPinos ? '✕ Cancelar marcado' : losPinos ? '📍 Mover Almacén Los Pinos' : '📍 Marcar Almacén Los Pinos'}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={verATodos}>🎯 Ver a todos</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => mapa.current?.setView(PUERTO_ORDAZ, ZOOM_INICIAL)}>📍 Puerto Ordaz</button>
        </span>
      </div>

      {error && <div className="aviso warning" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">⚠</span><div>{error}</div></div>}
      {modoPinos && (
        <div className="aviso info sm" style={{ marginBottom: '.6rem' }}>
          <span className="aviso-icono">📍</span><div>Haz clic en el mapa donde queda el {ALMACEN_RETIRO} (usa «Satelital» para ubicarlo mejor).</div>
        </div>
      )}
      {(sinUbicacion > 0 || (!losPinos && !modoPinos)) && (
        <div className="aviso info sm" style={{ marginBottom: '.6rem', alignItems: 'center' }}>
          <span className="aviso-icono">📍</span>
          <div style={{ flex: 1 }}>
            {sinUbicacion > 0 && <>{sinUbicacion} proveedor(es) con pedidos todavía no están en el mapa: sin ellos no hay ruta ni «más cercano». </>}
            {!losPinos && <>Almacén LOS PINOS sin ubicar: las rutas terminan en el proveedor{puedeMarcar ? ' (usa «📍 Marcar Almacén Los Pinos»)' : ''}. </>}
          </div>
          {sinUbicacion > 0 && <Link to="/app/proveedores" className="btn btn-ghost btn-sm">Ubicarlos</Link>}
        </div>
      )}

      {/* Escenario del Mapa con HUD Flotante del Controlador */}
      <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', isolation: 'isolate' }}>
        <div ref={contenedor} style={{ height: 'min(70vh, 560px)', minHeight: 340, width: '100%', background: '#e2e8f0' }} />

        {/* HUD Flotante de Telemetría sobre el Mapa */}
        {seleccionado && repSel && difSel && (
          <div className="dlv-hud-controlador">
            <div className="cab">
              <span className="dlv-badge-id" style={{ background: difSel.color }}>
                {difSel.codigo} {difSel.icono}
              </span>
              <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {difSel.nombreVisible}
              </strong>
              <button
                type="button"
                className="btn-cerrar"
                onClick={() => setSeleccionado(null)}
                title="Cerrar seguimiento y ver a todos"
              >
                ✕
              </button>
            </div>
            <div style={{ fontSize: '.76rem', color: '#94a3b8' }}>
              📡 Señal: {fechaHoraVE(repSel.actualizado_en)}
              {repSel.velocidad != null && repSel.velocidad > 0 && ` · ${Math.round(repSel.velocidad * 3.6)} km/h`}
            </div>

            {pedidoSel ? (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.14)' }}>
                <div style={{ fontWeight: 800 }}>
                  {esRetiroAlmacen(pedidoSel) ? pedidoSel.codigo : ocDe(pedidoSel)}
                  {esRetornoPendiente(pedidoSel) && <span style={{ color: '#38bdf8', fontSize: '.72rem', marginLeft: 6 }}>📸 En retorno</span>}
                </div>
                <div style={{ fontSize: '.76rem', color: '#cbd5e1' }}>
                  {esRetiroAlmacen(pedidoSel) ? `Retiro en ${ALMACEN_RETIRO}` : (pedidoSel.proveedor_nombre ?? 'Proveedor')}
                  {pedidoSel.almacen_destino && ` → ${pedidoSel.almacen_destino}`}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 4, color: '#10b981', fontSize: '.78rem', fontWeight: 600 }}>
                ✅ Sin pedido en curso (Libre)
              </div>
            )}

            {prevSel && (
              <div className="dlv-hud-telemetria">
                <span>🧭 <strong>{distanciaTxt(prevSel.ruta.metros)}</strong></span>
                <span>⏱ <strong>{duracionTxt(prevSel.ruta.segundos) || 'Vía OSRM'}</strong></span>
                {urlGmaps && (
                  <a
                    href={urlGmaps}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost btn-sm"
                    style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: '.72rem', background: '#2563eb', color: '#fff', textDecoration: 'none' }}
                  >
                    🗺 Google Maps
                  </a>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lista de Unidades y Estado de Conducción en la Torre de Despacho */}
      {ubicaciones.some((u) => !ubicacionVieja(u.actualizado_en, ahora)) && (
        <div className="table-wrap" style={{ marginTop: '.75rem' }}>
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead>
              <tr>
                <th>Unidad / Delivery</th>
                <th>Pedido en curso</th>
                <th>Ruta óptima vial</th>
                <th>Última señal</th>
                <th style={{ textAlign: 'right' }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {ubicaciones.filter((u) => !ubicacionVieja(u.actualizado_en, ahora)).map((u) => {
                const dif = diferenciadores.get(u.repartidor_id) ?? obtenerDiferenciador(u.repartidor_id, u.repartidor_nombre, canal);
                const p = u.pedido_id ? pedidoPorId.get(u.pedido_id) : undefined;
                const pr = previstas.get(u.repartidor_id);
                const retiro = p ? esRetiroAlmacen(p) : false;
                const esSel = seleccionado === u.repartidor_id;

                return (
                  <tr key={u.repartidor_id} style={esSel ? { background: 'rgba(56, 189, 248, 0.08)' } : undefined}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="dlv-badge-id" style={{ background: dif.color }}>
                          {dif.codigo}
                        </span>
                        <strong>{dif.nombreVisible}</strong>
                        {dif.alias && <span className="muted" style={{ fontSize: '.72rem' }}>({u.repartidor_nombre})</span>}
                      </div>
                    </td>
                    <td>
                      {p && enCurso(p) ? (
                        <>
                          <strong>{retiro ? p.codigo : ocDe(p)}</strong> · {retiro ? `Retiro en ${ALMACEN_RETIRO}` : (p.proveedor_nombre ?? '—')}
                          {esRetornoPendiente(p) && <span style={{ color: '#38bdf8', fontSize: '.72rem', display: 'block' }}>📸 Foto tomada · Posible retorno</span>}
                        </>
                      ) : (
                        <span className="muted">Libre</span>
                      )}
                    </td>
                    <td>
                      {pr ? (
                        <>
                          <span style={{ color: '#0284c7', fontWeight: 700 }}>🧭 {distanciaTxt(pr.ruta.metros)}</span>
                          {pr.ruta.segundos != null ? ` · ${duracionTxt(pr.ruta.segundos)}` : <span className="muted"> (vial)</span>}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {fechaHoraVE(u.actualizado_en)}
                      {u.velocidad != null && u.velocidad > 0 && <span style={{ color: '#059669', marginLeft: 4 }}>({Math.round(u.velocidad * 3.6)} km/h)</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className={`btn btn-sm ${esSel ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => enfocarUnidad(u.repartidor_id)}
                      >
                        {esSel ? '🎯 Siguiendo' : '🎯 Seguir'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="muted" style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem 1.1rem', margin: '.55rem 0 0', fontSize: '.8rem' }} aria-label="Leyenda">
        <span><span style={{ color: '#2563eb' }}>●</span> 🛵 Unidad / Repartidor con código identificador único</span>
        <span><span style={{ color: '#9ca3af' }}>●</span> Sin señal reciente</span>
        <span><span style={{ color: '#d97706' }}>●</span> 🏭 Proveedor con OC por tomar (<span style={{ color: '#dc2626' }}>rojo</span> = urgente)</span>
        <span><span style={{ color: '#2563eb' }}>●</span> 🏭 Proveedor con pedido en curso</span>
        <span><span style={{ color: '#374151' }}>●</span> 🏬 {ALMACEN_RETIRO}</span>
        <span>┄━ Ruta óptima animada (flujo hacia destino)</span>
      </div>

      {pinosPendiente && (
        <ConfirmDialog
          title={losPinos ? `Mover ${ALMACEN_RETIRO}` : `Marcar ${ALMACEN_RETIRO}`}
          message={`¿Guardar este punto (${pinosPendiente.lat.toFixed(5)}, ${pinosPendiente.lng.toFixed(5)}) como el ${ALMACEN_RETIRO}? Las rutas de Delivery terminan ahí.`}
          confirmText="Guardar"
          onConfirm={() => void guardarPinos()}
          onCancel={() => setPinosPendiente(null)}
        />
      )}
    </div>
  );
}
