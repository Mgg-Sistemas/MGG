/* ============================================================
   MGG · Delivery Móvil · Estilo Ridery / Yummy Partner
   Lienzo nocturno con mapa como protagonista, navegación giro a giro,
   fases claras con fotos obligatorias y ergonomía a un pulgar.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { CANALES_DELIVERY, type CanalDelivery } from './delivery';
import { toast } from '@/shared/ui/Toast';
import { Modal } from '@/shared/ui/Modal';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { Quien } from '@/shared/ui/Quien';
import { playNotificationSound } from '@/shared/lib/sound';
import { emitirWebPush } from '@/shared/lib/webpush';
import {
  ALMACEN_RETIRO, MOTIVOS_CANCELACION, MOTIVOS_NO_DISPONIBLE, claveDelivery,
  esRetiroAlmacen, esRetornoPendiente, fechaHoraVE, mensajeCancelado, mensajeEntregado,
  mensajeNoDisponible, ocDe, type PedidoDelivery, type RechazoDelivery,
} from './delivery';
import {
  cancelarPedido, compartirUbicacion, listPedidosDelivery, listRechazosDelivery, marcarEnRuta, marcarEntregado,
  rechazarPedido, tomarPedido, useUbicacionesRuta,
} from './delivery.repository';
import { ComprobantePagoCuerpo } from './ComprobantePagoDelivery';
import { EditarFotosDeliveryModal } from './EditarFotosDelivery';
import {
  armarFeed, debeEnviarUbicacion, distanciaMetros, fueCanceladoPreviamente, rechazadosPor, telHref,
  type ChipDelivery, type EnvioGps,
} from './deliveryMovil';
import {
  LUGAR_LOS_PINOS, RECALCULAR_RUTA_M, calcularRuta, claveRuta, distanciaTxt, duracionTxt, ordenarDisponibles, paradasRuta,
  puntoLugar, puntoRecogida, siguienteParada, urlNavegacionDestino, type PuntoMapa, type RutaCalculada,
} from './deliveryRutas';
import { MapaMotorizado, type DestinoMapa } from './MapaMotorizado';
import { usePosicionGps, type PosicionGps } from './usePosicionGps';
import './deliveryMovil.css';

const nombreAlmacenVisible = (a: string | null | undefined) => (a ?? '').trim() || '—';
export const RUTA_DELIVERY_TELEFONO = '/app/delivery/telefono';

const GPS_KEY = 'mgg_delivery_gps_activo';
const leerGps = () => { try { return localStorage.getItem(GPS_KEY) !== '0'; } catch { return true; } };
const GPS_VIGENTE_MS = 2 * 60 * 1000;
const errMsg = (err: unknown, defecto: string) => (err instanceof Error ? err.message : defecto);

export function DeliveryMovilView({ canal = 'delivery' }: { canal?: CanalDelivery }) {
  const { user } = useSession();
  const actor = user?.email ?? 'anon';
  const actorName = user?.user_metadata?.nombre as string | undefined;
  const quien = actorName?.trim() || actor;
  const cfgCanal = CANALES_DELIVERY[canal] ?? CANALES_DELIVERY.delivery;
  const { can, isAdmin, soloTelefono } = usePermissions();
  const canWrite = isAdmin || can(cfgCanal.modulo, 'escritura');

  const [activos, setActivos] = useState<PedidoDelivery[]>([]);
  const [cerrados, setCerrados] = useState<PedidoDelivery[]>([]);
  const [rechazos, setRechazos] = useState<RechazoDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  const turno = useRef(0);
  const prevPedidosRef = useRef<Set<string> | null>(null);

  const reload = useCallback(async () => {
    const mio = ++turno.current;
    try {
      const [a, c] = await Promise.all([
        listPedidosDelivery(false, canal),
        listPedidosDelivery(true, canal).catch(() => [] as PedidoDelivery[]),
      ]);
      const r = await listRechazosDelivery(
        a.filter((p) => p.estado === 'por_tomar' || p.estado === 'cancelado').map((p) => p.orden_id),
      ).catch(() => [] as RechazoDelivery[]);
      if (mio !== turno.current) return;

      // Detección de nuevos pedidos en estado 'por_tomar' para alertar al motorizado
      const porTomarActuales = a.filter((p) => p.estado === 'por_tomar');
      if (prevPedidosRef.current !== null) {
        const nuevos = porTomarActuales.filter((p) => !prevPedidosRef.current!.has(claveDelivery(p)));
        if (nuevos.length > 0) {
          const primer = nuevos[0];
          const ordenTxt = primer.codigo || `Orden #${primer.orden_id}`;
          const titulo = canal === 'carga_pesada'
            ? '🚚 Carga Pesada: Nuevo pedido disponible'
            : '🛵 Delivery: Nuevo pedido disponible';
          const cuerpo = nuevos.length === 1
            ? `Hay 1 nuevo pedido por tomar: ${ordenTxt}. Toca para abrir.`
            : `Hay ${nuevos.length} nuevos pedidos disponibles para entrega.`;

          try { playNotificationSound(); } catch { /* ignore */ }
          void emitirWebPush({
            modulo: 'delivery',
            titulo,
            cuerpo,
            url: canal === 'carga_pesada' ? '/app/carga-pesada/telefono' : '/app/delivery/telefono',
            tag: `gt-delivery-${claveDelivery(primer).replace(/[^a-zA-Z0-9_-]/g, '_')}`,
            vibrar: true,
          });
          toast(cuerpo, 'info');
        }
      }
      prevPedidosRef.current = new Set(porTomarActuales.map((p) => claveDelivery(p)));

      setActivos(a);
      setCerrados(c);
      setRechazos(r);
    } catch (e) {
      toast(errMsg(e, 'No se pudieron cargar los pedidos'), 'error');
    } finally {
      if (mio === turno.current) setLoading(false);
    }
  }, [canal]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useRealtime(['delivery_pedidos', 'delivery_rechazos', 'ordenes', 'solicitudes_revision_almacen'], () => { void reload(); });

  const uid = user?.id ?? null;
  const feedBase = useMemo(() => armarFeed(activos, cerrados, rechazadosPor(rechazos, uid)), [activos, cerrados, rechazos, uid]);

  const gps = usePosicionGps(true);
  const yo = gps.pos;

  const idsProveedores = useMemo(() => activos.map((p) => p.proveedor_id), [activos]);
  const { provs, lugares } = useUbicacionesRuta(idsProveedores);
  const losPinos = useMemo(() => puntoLugar(lugares, LUGAR_LOS_PINOS), [lugares]);

  const distDe = useCallback((p: PedidoDelivery) => {
    if (!yo) return null;
    const pt = puntoRecogida(p, provs, losPinos);
    return pt ? distanciaMetros(yo, pt) : null;
  }, [yo, provs, losPinos]);

  const feed = useMemo(() => {
    const orden = ordenarDisponibles(feedBase.filter((f) => f.disponible), (f) => distDe(f.p));
    let i = 0;
    return feedBase.map((f) => (f.disponible ? orden[i++] : f));
  }, [feedBase, distDe]);

  const enCurso = useMemo(
    () => feed.find((f) => !f.disponible && f.p.es_mio && (f.p.estado === 'aceptado' || f.p.estado === 'en_ruta'))?.p ?? null,
    [feed],
  );

  // Pestañas y estado del Bottom Sheet con Snap Points ('peek' | 'mid' | 'full')
  type SnapState = 'peek' | 'mid' | 'full';
  type TabMovil = 'en_curso' | 'por_tomar' | 'entregados';

  const [tab, setTab] = useState<TabMovil>(enCurso ? 'en_curso' : 'por_tomar');
  const [snap, setSnap] = useState<SnapState>('mid');

  // Si cambia el pedido en curso o se acepta uno, enfocar automáticamente en la carrera
  useEffect(() => {
    if (enCurso) {
      setTab('en_curso');
      setSnap('mid');
    }
  }, [enCurso?.pedido_id]);

  // Gestos táctiles en el tirador (swipe up / swipe down)
  const touchStartY = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const endY = e.changedTouches[0].clientY;
    const diff = endY - touchStartY.current;
    touchStartY.current = null;
    if (diff > 45) {
      // Swipe down -> colapsar
      setSnap((curr) => (curr === 'full' ? 'mid' : 'peek'));
    } else if (diff < -45) {
      // Swipe up -> expandir
      setSnap((curr) => (curr === 'peek' ? 'mid' : 'full'));
    }
  };

  const toggleSnap = () => {
    setSnap((curr) => (curr === 'peek' ? 'mid' : curr === 'mid' ? 'full' : 'mid'));
  };

  // Modales
  const [accion, setAccion] = useState<{ tipo: 'cancelar' | 'entregar' | 'no_disponible'; clave: string } | null>(null);
  const [listo, setListo] = useState<{ titulo: string; texto: string } | null>(null);
  const [fotosModalDe, setFotosModalDe] = useState<PedidoDelivery | null>(null);
  const [comprobanteDe, setComprobanteDe] = useState<PedidoDelivery | null>(null);
  const [modalLlamar, setModalLlamar] = useState(false);
  const [modalGpsInfo, setModalGpsInfo] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  // Ruta seleccionada en el mapa
  const [rutaClave, setRutaClave] = useState<string | null>(null);
  const claveRutaActiva = rutaClave ?? (enCurso ? claveDelivery(enCurso) : null);
  const feedRuta = claveRutaActiva ? feed.find((f) => claveDelivery(f.p) === claveRutaActiva) ?? null : null;
  const pedidoRuta = feedRuta && (feedRuta.disponible || feedRuta.p.estado === 'aceptado' || feedRuta.p.estado === 'en_ruta') ? feedRuta.p : null;

  const [yoRuta, setYoRuta] = useState<PuntoMapa | null>(null);
  useEffect(() => {
    if (!yo) return;
    setYoRuta((prev) => (!prev || distanciaMetros(prev, yo) > RECALCULAR_RUTA_M ? { lat: yo.lat, lng: yo.lng } : prev));
  }, [yo]);

  const paradas = useMemo(() => (pedidoRuta ? paradasRuta(pedidoRuta, yoRuta, provs, losPinos) : []), [pedidoRuta, yoRuta, provs, losPinos]);
  const claveParadas = claveRuta(paradas.map((x) => x.punto));
  const paradasRef = useRef(paradas);
  useEffect(() => { paradasRef.current = paradas; });

  const [rutaCalc, setRutaCalc] = useState<{ clave: string; ruta: RutaCalculada } | null>(null);
  useEffect(() => {
    const ps = paradasRef.current;
    if (ps.length < 2) return;
    let vivo = true;
    void calcularRuta(ps.map((x) => x.punto)).then((r) => { if (vivo) setRutaCalc({ clave: claveParadas, ruta: r }); });
    return () => { vivo = false; };
  }, [claveParadas]);

  const rutaVigente = rutaCalc && rutaCalc.clave === claveParadas && paradas.length >= 2 ? rutaCalc.ruta : null;
  const rutaMapa = useMemo(() => (pedidoRuta ? { ruta: rutaVigente, paradas } : null), [pedidoRuta, rutaVigente, paradas]);

  // Destinos para el mapa nocturno
  const destinosMapa = useMemo<DestinoMapa[]>(() => {
    const out: DestinoMapa[] = [];
    for (const f of feed) {
      if (!f.disponible) continue;
      const pt = puntoRecogida(f.p, provs, losPinos);
      if (!pt) continue;
      const m = yo ? distanciaMetros(yo, pt) : null;
      out.push({
        clave: claveDelivery(f.p),
        nombre: esRetiroAlmacen(f.p) ? ALMACEN_RETIRO : (f.p.proveedor_nombre ?? 'Proveedor'),
        punto: pt,
        metros: m,
        cercano: false,
      });
    }
    return out;
  }, [feed, provs, losPinos, yo]);

  const cuenta = useMemo<Record<ChipDelivery, number>>(() => ({
    todos: feed.length,
    por_tomar: feed.filter((f) => f.disponible).length,
    en_ruta: feed.filter((f) => !f.disponible && f.p.es_mio && (f.p.estado === 'aceptado' || f.p.estado === 'en_ruta')).length,
    entregados: feed.filter((f) => f.p.estado === 'entregado').length,
    cancelados: feed.filter((f) => f.p.estado === 'cancelado').length,
  }), [feed]);

  const pedidosDisponibles = useMemo(() => feed.filter((f) => f.disponible), [feed]);
  const pedidosEntregados = useMemo(() => feed.filter((f) => f.p.estado === 'entregado'), [feed]);

  // Acciones operativas
  async function tomar(p: PedidoDelivery) {
    setOcupado(claveDelivery(p));
    try {
      await tomarPedido(p.orden_id, p.origen ?? 'compra');
      toast(`Aceptaste ${esRetiroAlmacen(p) ? `el retiro ${p.codigo}` : `la orden ${ocDe(p)}`}: va en camino.`, 'success');
      setRutaClave(claveDelivery(p));
      void reload();
    } catch (e) {
      toast(errMsg(e, 'No se pudo aceptar el pedido'), 'error');
      void reload();
    } finally {
      setOcupado(null);
    }
  }

  async function enRuta(p: PedidoDelivery) {
    if (!p.pedido_id) return;
    if ((p.fotos_recibo?.length ?? 0) === 0) {
      toast('📸 Es obligatorio subir al menos 1 foto al recibir (remisión/factura) antes de iniciar retorno.', 'error');
      setFotosModalDe(p);
      return;
    }
    setOcupado(claveDelivery(p));
    try {
      await marcarEnRuta(p.pedido_id);
      toast('Iniciado retorno a la sede.', 'success');
      void reload();
    } catch (e) {
      toast(errMsg(e, 'No se pudo iniciar retorno'), 'error');
    } finally {
      setOcupado(null);
    }
  }

  function volver() { setAccion(null); setListo(null); }
  function hecho(titulo: string, texto: string) { setAccion(null); setListo({ titulo, texto }); void reload(); }

  // Parada siguiente del pedido en curso para Google Maps / Waze
  const siguiente = useMemo(() => (enCurso ? siguienteParada(enCurso, provs, losPinos) : null), [enCurso, provs, losPinos]);

  const handleNavegar = () => {
    if (siguiente?.punto) {
      const url = urlNavegacionDestino(siguiente.punto, yo);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } else if (enCurso) {
      toast('Calculando destino en el mapa de la app.', 'info');
      setRutaClave(claveDelivery(enCurso));
    }
  };

  const pedidoAccion = accion ? feed.find((f) => claveDelivery(f.p) === accion.clave)?.p ?? null : null;

  return (
    <div className="dlv-app-viewport">
      {/* ── CAPA 0: ESCENARIO DEL MAPA NOCTURNO A SANGRE TOTAL ── */}
      <div className="dlv-map-stage">
        <MapaMotorizado
          yo={yo}
          destinos={destinosMapa}
          losPinos={losPinos}
          ruta={rutaMapa}
          iconoVehiculo={cfgCanal.icono}
          onElegir={(clave) => setRutaClave(clave)}
        />
      </div>

      {/* ── CAPA 1: CABECERA FLOTANTE DE VIDRIO (TOP BAR) ── */}
      <header className="dlv-topbar-glass">
        <div className="dlv-conductor-mini">
          <div className="dlv-avatar-mini" aria-hidden>{cfgCanal.icono}</div>
          <div className="dlv-conductor-textos">
            <span className="dlv-conductor-nombre"><Quien nombre={null} correo={actor} vacio={actorName ?? actor} /></span>
            <span className="dlv-conductor-flota">{canal === 'carga_pesada' ? 'Chofer Carga Pesada' : 'Motorizado Delivery'}</span>
          </div>
        </div>

        <div className="dlv-topbar-pills">
          {yo ? (
            <div className="dlv-pill-status">
              <span className="dlv-dot-live"></span>
              <span>En línea</span>
            </div>
          ) : (
            <button type="button" className="dlv-pill-gps-warn" onClick={() => setModalGpsInfo(true)} title="Ver ayuda de GPS">
              <span>⚠️ Sin GPS</span>
            </button>
          )}

          {canWrite && <CompartirUbicacion pedido={enCurso} gps={gps} />}
          {!soloTelefono && (
            <Link to={cfgCanal.ruta} className="dlv-btn-icon-top" title="Abrir módulo completo en PC">
              🖥
            </Link>
          )}
          <button type="button" className="dlv-btn-icon-top" onClick={() => void reload()} title="Recargar pedidos">
            🔄
          </button>
        </div>
      </header>

      {/* ── CAPA 1.5: HUD DE NAVEGACIÓN ACTIVA EN RUTA (UBER / RIDERY / YUMMY) ── */}
      {enCurso && siguiente && (
        <div className="dlv-nav-hud-top">
          <div className="dlv-nav-hud-icono">
            {siguiente.tipo === 'entrega' ? '🏬' : '📦'}
          </div>
          <div className="dlv-nav-hud-info">
            <div className="dlv-nav-hud-paso">
              {siguiente.tipo === 'entrega' ? 'Retorno a Almacén' : 'Recogida en Proveedor'}
            </div>
            <div className="dlv-nav-hud-destino">{siguiente.nombre}</div>
            {rutaMapa?.ruta && (
              <div className="dlv-nav-hud-meta">
                🧭 {distanciaTxt(rutaMapa.ruta.metros)} {rutaMapa.ruta.segundos != null ? `· ${duracionTxt(rutaMapa.ruta.segundos)}` : ''}
              </div>
            )}
          </div>
          <button type="button" className="dlv-nav-hud-btn-gmaps" onClick={handleNavegar} title="Abrir navegación en Google Maps">
            🗺 Google Maps
          </button>
        </div>
      )}

      {/* ── CAPA 2: HOJA INFERIOR DESLIZANTE CON GESTOS TÁCTILES Y SNAP POINTS ── */}
      <div className={`dlv-bottom-sheet snap-${snap}`}>
        <div
          className="dlv-sheet-handle-wrap"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onClick={toggleSnap}
        >
          <div className="dlv-sheet-handle-bar" />
          {snap === 'peek' && (
            <div className="dlv-sheet-peek-bar">
              <div className="dlv-sheet-peek-info">
                {enCurso ? (
                  <>
                    <span className="dlv-dot-live"></span>
                    <span>
                      {enCurso.estado === 'aceptado'
                        ? esRetornoPendiente(enCurso)
                          ? '📸 Retorno preliminar'
                          : 'Recogiendo'
                        : 'En retorno'}: {esRetiroAlmacen(enCurso) ? enCurso.codigo : ocDe(enCurso)} · Almacén {nombreAlmacenVisible(enCurso.almacen_entrega ?? enCurso.almacen_destino)}
                    </span>
                  </>
                ) : (
                  <span>📦 {cuenta.por_tomar} pedido(s) disponible(s)</span>
                )}
              </div>
              <span className="dlv-sheet-peek-hint">▲ Desliza para abrir</span>
            </div>
          )}
        </div>

        {snap !== 'peek' && (
          <div className="dlv-sheet-body">
            {/* Pestañas de Navegación y Atajo al Mapa */}
            <div className="dlv-sheet-subbar">
              <div className="dlv-tabs-ridery">
                {enCurso && (
                  <button
                    type="button"
                    className={`dlv-tab-btn ${tab === 'en_curso' ? 'activo' : ''}`}
                    onClick={() => { setTab('en_curso'); setSnap('mid'); }}
                  >
                    <span className="dlv-dot-live" />
                    <span>En Ruta</span>
                  </button>
                )}

                <button
                  type="button"
                  className={`dlv-tab-btn ${tab === 'por_tomar' ? 'activo' : ''}`}
                  onClick={() => { setTab('por_tomar'); }}
                >
                  <span>📦 Disponibles</span>
                  <span className="dlv-tab-badge">{cuenta.por_tomar}</span>
                </button>

                <button
                  type="button"
                  className={`dlv-tab-btn ${tab === 'entregados' ? 'activo' : ''}`}
                  onClick={() => { setTab('entregados'); }}
                >
                  <span>✅ Entregas</span>
                  <span className="dlv-tab-badge">{cuenta.entregados}</span>
                </button>
              </div>

              <button
                type="button"
                className="dlv-btn-mapa-shortcut"
                onClick={() => setSnap(enCurso ? 'mid' : 'peek')}
                title="Minimizar panel para ver mapa completo"
              >
                🗺 Mapa
              </button>
            </div>

            {/* CASO A: Formulario de Acción en Curso */}
            {accion?.tipo === 'cancelar' && pedidoAccion && (
              <FormCancelar p={pedidoAccion} quien={quien} onCancel={volver} onHecho={hecho} />
            )}
            {accion?.tipo === 'entregar' && pedidoAccion && (
              <FormEntregar p={pedidoAccion} quien={quien} onCancel={volver} onHecho={hecho} />
            )}
            {accion?.tipo === 'no_disponible' && pedidoAccion && (
              <NoDisponibleModal p={pedidoAccion} quien={quien} onCancel={volver} onHecho={hecho} />
            )}

            {/* CASO B: Mensaje de Entrega Realizada (WhatsApp) */}
            {listo && !accion && (
              <div className="dlv-cockpit">
                <div className="dlv-cockpit-bar" style={{ background: 'rgba(16, 185, 129, 0.15)', borderColor: '#10b981' }}>
                  <span className="dlv-cockpit-tag" style={{ color: '#34d399' }}>✅ {listo.titulo}</span>
                </div>
                <CompartirWhatsapp texto={listo.texto} />
                <button type="button" className="btn btn-primary dlv-btn-hero dlv-btn-hero-green" onClick={volver}>
                  ← Volver a la Ruta
                </button>
              </div>
            )}

            {/* CONTENIDO SEGÚN LA PESTAÑA SELECCIONADA */}
            {!accion && !listo && (
              <>
                {/* PESTAÑA 1: COCKPIT DE PEDIDO EN CURSO */}
                {tab === 'en_curso' && enCurso && (
                  <div className="dlv-cockpit">
                    <div className="dlv-cockpit-bar">
                      <span className="dlv-cockpit-tag">
                        {enCurso.estado === 'aceptado'
                          ? esRetornoPendiente(enCurso)
                            ? '📸 FOTO CARGADA · RETORNO PRELIMINAR'
                            : '🚀 FASE 1: RETIRO EN CURSO'
                          : '🚚 FASE 2: RETORNO A SEDE'}
                      </span>
                      <span className="dlv-cockpit-eta">
                        {distDe(enCurso) != null ? distanciaTxt(distDe(enCurso)) : ''} {duracionTxt(rutaVigente?.segundos)}
                      </span>
                    </div>

                    {/* Trazado y paradas de la carrera */}
                    <div className="dlv-trip-card" style={{ cursor: 'default' }}>
                      <div className="dlv-trip-header">
                        <span className="dlv-trip-codigo">{esRetiroAlmacen(enCurso) ? enCurso.codigo : ocDe(enCurso)}</span>
                        <span className="dlv-trip-dist">{esRetiroAlmacen(enCurso) ? 'Retiro de Almacén' : 'Compra con Proveedor'}</span>
                      </div>

                      <div className="dlv-route-timeline">
                        <div className="dlv-route-point">
                          <span className="dlv-route-dot origen">1</span>
                          <span className="dlv-route-label">Recogida / Retiro</span>
                          <div className="dlv-route-name">{esRetiroAlmacen(enCurso) ? ALMACEN_RETIRO : (enCurso.proveedor_nombre ?? 'Proveedor')}</div>
                          {enCurso.proveedor_direccion && <small style={{ color: '#94a3b8' }}>{enCurso.proveedor_direccion}</small>}
                        </div>

                        <div className="dlv-route-point">
                          <span className="dlv-route-dot destino">2</span>
                          <span className="dlv-route-label">Entrega en Destino</span>
                          <div className="dlv-route-name">Almacén {nombreAlmacenVisible(enCurso.almacen_entrega ?? enCurso.almacen_destino)}</div>
                        </div>
                      </div>
                    </div>

                    {/* Fila de Navegación y Llamada (Google Maps intencional bajo demanda) */}
                    <div className="dlv-quick-nav-row" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
                      <button type="button" className="dlv-btn-nav-gmaps" onClick={handleNavegar} title="Abrir ruta en Google Maps">
                        <span>🧭 Abrir en Google Maps</span>
                      </button>
                      <button type="button" className="dlv-btn-call" onClick={() => setModalLlamar(true)} title="Llamar al analista">
                        <span>📞 Llamar</span>
                      </button>
                    </div>

                    {/* Acceso dedicado para tomar o revisar fotos (SOLO con pedido activo) */}
                    <div
                      className="dlv-cockpit-photo-chip"
                      onClick={() => setFotosModalDe(enCurso)}
                      title="Administrar fotos de esta orden"
                    >
                      <span>
                        📸 Evidencias ({enCurso.fotos_recibo.length} recibo · {enCurso.fotos_entrega.length} entrega)
                      </span>
                      <span className="dlv-chip-cta">Tomar / Ver →</span>
                    </div>

                    {/* BOTONES PROTAGONISTAS SEGÚN LA FASE ACTIVA */}
                    {enCurso.estado === 'aceptado' && (
                      <>
                        {(enCurso.fotos_recibo?.length ?? 0) === 0 ? (
                          <>
                            <button
                              type="button"
                              className="dlv-btn-hero dlv-btn-hero-amber"
                              onClick={() => setFotosModalDe(enCurso)}
                            >
                              📸 Tomar Foto al Recibir (0/5) · Obligatoria
                            </button>
                            <div className="dlv-hero-subtext">
                              Sube foto de la remisión, factura física o paquetes para habilitar el retorno.
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="dlv-phase-badge-ok" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                <span>✓ Foto recibida ({enCurso.fotos_recibo.length} foto/s cargada/s)</span>
                                <button type="button" className="dlv-btn-link" onClick={() => setFotosModalDe(enCurso)}>
                                  Ver / Agregar
                                </button>
                              </div>
                              <span style={{ fontSize: '.72rem', color: '#93c5fd', fontWeight: 500 }}>
                                ℹ️ Retorno preliminar: confirma cuando inicies el viaje o registra entrega si ya estás en almacén.
                              </span>
                            </div>
                            <button
                              type="button"
                              className="dlv-btn-hero dlv-btn-hero-blue"
                              disabled={!!ocupado}
                              onClick={() => void enRuta(enCurso)}
                            >
                              {ocupado ? 'Iniciando…' : '🚚 Iniciar Retorno a Sede'}
                            </button>
                            <button
                              type="button"
                              className="dlv-btn-subtle"
                              style={{ color: '#34d399', alignSelf: 'center', marginTop: -4 }}
                              onClick={() => setAccion({ tipo: 'entregar', clave: claveDelivery(enCurso) })}
                            >
                              📦 ¿Ya llegaste a Almacén? Registrar Entrega Directa
                            </button>
                          </>
                        )}
                      </>
                    )}

                    {enCurso.estado === 'en_ruta' && (
                      <>
                        <div className="dlv-phase-badge-ok">
                          <span>✓ Fase 1 completada · En camino al almacén de recepción</span>
                        </div>
                        <button
                          type="button"
                          className="dlv-btn-hero dlv-btn-hero-green"
                          disabled={!!ocupado}
                          onClick={() => setAccion({ tipo: 'entregar', clave: claveDelivery(enCurso) })}
                        >
                          📦 Registrar Entrega Final
                        </button>
                      </>
                    )}

                    {/* Acciones Secundarias Limpias */}
                    <div className="dlv-secondary-actions">
                      <button
                        type="button"
                        className="dlv-btn-subtle dlv-btn-subtle-danger"
                        onClick={() => setAccion({ tipo: 'cancelar', clave: claveDelivery(enCurso) })}
                      >
                        ✕ Desasignar / Cancelar
                      </button>

                      {!esRetiroAlmacen(enCurso) && (
                        <button
                          type="button"
                          className="dlv-btn-subtle"
                          onClick={() => setComprobanteDe(enCurso)}
                        >
                          🧾 Ver Comprobante
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* PESTAÑA 2: BANDEJA DE PEDIDOS DISPONIBLES */}
                {tab === 'por_tomar' && (
                  <>
                    {loading && <p style={{ textAlign: 'center', color: '#94a3b8' }}>Actualizando mapa y pedidos…</p>}

                    {!loading && pedidosDisponibles.length === 0 && (
                      <div className="dlv-radar-empty">
                        <div className="dlv-radar-icon">📡</div>
                        <h3>Esperando pedidos</h3>
                        <p>En cuanto Compras o Almacén asigne una orden, aparecerá aquí automáticamente en tiempo real.</p>
                      </div>
                    )}

                    {!loading && pedidosDisponibles.map((f) => {
                      const p = f.p;
                      const k = claveDelivery(p);
                      const sel = claveRutaActiva === k;
                      const m = distDe(p);
                      const retiro = esRetiroAlmacen(p);
                      const canceladoPrev = fueCanceladoPreviamente(p);

                      return (
                        <div
                          key={k}
                          className={`dlv-trip-card ${sel ? 'sel' : ''}`}
                          onClick={() => { setRutaClave(k); }}
                        >
                          <div className="dlv-trip-header">
                            <span className="dlv-trip-codigo">{retiro ? p.codigo : ocDe(p)}</span>
                            {p.urgente ? (
                              <span className="dlv-trip-urgente">🚨 Urgente</span>
                            ) : (
                              <span className="dlv-trip-dist">{distanciaTxt(m)}</span>
                            )}
                          </div>

                          {/* ALERTA DE REASIGNACIÓN SI FUE CANCELADO PREVIAMENTE */}
                          {canceladoPrev && (
                            <div className="dlv-trip-cancel-alert">
                              <div className="dlv-trip-cancel-tag">
                                ⚠️ Liberado tras cancelación
                              </div>
                              <div className="dlv-trip-cancel-body">
                                <div className="dlv-trip-cancel-row">
                                  <strong>Motivo:</strong> {p.motivo_cancel || 'Desasignado / Liberado'}
                                </div>
                                {p.detalle_cancel && (
                                  <div className="dlv-trip-cancel-det">{p.detalle_cancel}</div>
                                )}
                                <div className="dlv-trip-cancel-meta">
                                  Motorizado previo: {p.repartidor_nombre || 'No registrado'}
                                  {p.cancelado_en && <span> · {fechaHoraVE(p.cancelado_en)}</span>}
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="dlv-route-timeline">
                            <div className="dlv-route-point">
                              <span className="dlv-route-dot origen">●</span>
                              <span className="dlv-route-label">Recoger en</span>
                              <div className="dlv-route-name">{retiro ? ALMACEN_RETIRO : (p.proveedor_nombre ?? 'Proveedor')}</div>
                            </div>

                            <div className="dlv-route-point">
                              <span className="dlv-route-dot destino">●</span>
                              <span className="dlv-route-label">Entregar en</span>
                              <div className="dlv-route-name">Almacén {nombreAlmacenVisible(p.almacen_entrega ?? p.almacen_destino)}</div>
                            </div>
                          </div>

                          {canWrite && (
                            <button
                              type="button"
                              className="dlv-btn-tomar-viaje"
                              disabled={!!ocupado || (!!enCurso && enCurso.pedido_id !== p.pedido_id)}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (enCurso && enCurso.pedido_id !== p.pedido_id) {
                                  toast('Tienes un pedido activo. Finaliza o desasigna tu carrera actual antes de tomar otro.', 'warning');
                                  return;
                                }
                                void tomar(p);
                              }}
                            >
                              <span>
                                {enCurso && enCurso.pedido_id !== p.pedido_id
                                  ? '⚠️ Carrera activa en curso'
                                  : '✓ Aceptar Pedido y En Camino'}
                              </span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}

                {/* PESTAÑA 3: BANDEJA DE ENTREGADOS */}
                {tab === 'entregados' && (
                  <>
                    {pedidosEntregados.length === 0 ? (
                      <div className="dlv-radar-empty">
                        <div className="dlv-radar-icon">📦</div>
                        <h3>Sin entregas registradas</h3>
                        <p>Tus entregas completadas de la jornada aparecerán en este historial.</p>
                      </div>
                    ) : (
                      pedidosEntregados.map((f) => {
                        const p = f.p;
                        const k = claveDelivery(p);
                        const retiro = esRetiroAlmacen(p);
                        return (
                          <div key={k} className="dlv-trip-card" style={{ cursor: 'default' }}>
                            <div className="dlv-trip-header">
                              <span className="dlv-trip-codigo">{retiro ? p.codigo : ocDe(p)}</span>
                              <span style={{ color: '#34d399', fontWeight: 700, fontSize: '.8rem' }}>
                                ✅ Entregado
                              </span>
                            </div>
                            <div style={{ fontSize: '.85rem', color: '#cbd5e1' }}>
                              <div>🏬 Recibido en: Almacén {nombreAlmacenVisible(p.almacen_entrega ?? p.almacen_destino)}</div>
                              <div style={{ color: '#94a3b8', fontSize: '.78rem', marginTop: 4 }}>
                                📷 {p.fotos_recibo.length + p.fotos_entrega.length} fotos guardadas
                              </div>
                            </div>
                            {p.pedido_id && (
                              <button
                                type="button"
                                className="dlv-btn-subtle"
                                style={{ alignSelf: 'flex-start', color: '#38bdf8' }}
                                onClick={() => setFotosModalDe(p)}
                              >
                                ✏ Ver / Editar fotos
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── MODALES Y PANTALLAS DE SOPORTE ── */}
      {modalGpsInfo && (
        <Modal title="Permisos de Ubicación (GPS)" compact onClose={() => setModalGpsInfo(false)}>
          <div style={{ display: 'grid', gap: '1rem', color: '#f8fafc' }}>
            <p style={{ margin: 0, fontSize: '.92rem' }}>
              Para mostrar tu posición en el mapa en vivo y calcular distancias hacia los proveedores, la página necesita permiso de geolocalización.
            </p>
            <ol style={{ paddingLeft: '1.2rem', margin: 0, fontSize: '.88rem', lineHeight: '1.6' }}>
              <li>Toca el candado 🔒 junto a la barra de direcciones del navegador.</li>
              <li>Entra en <strong>Permisos</strong> &gt; <strong>Ubicación</strong> &gt; <strong>Permitir</strong>.</li>
              <li>Asegúrate de tener el GPS encendido en el teléfono y recarga la página.</li>
            </ol>
            <button type="button" className="btn btn-primary" onClick={() => setModalGpsInfo(false)}>
              Entendido
            </button>
          </div>
        </Modal>
      )}

      {modalLlamar && (
        <ModalLlamarRapido
          pedido={enCurso}
          onClose={() => setModalLlamar(false)}
        />
      )}

      {fotosModalDe && fotosModalDe.pedido_id && (
        <EditarFotosDeliveryModal
          pedidoId={fotosModalDe.pedido_id}
          origen={fotosModalDe.origen}
          titulo={esRetiroAlmacen(fotosModalDe) ? `Fotos de ${fotosModalDe.codigo}` : `Fotos de ${ocDe(fotosModalDe)}`}
          fotosRecibo={fotosModalDe.fotos_recibo}
          fotosEntrega={fotosModalDe.fotos_entrega}
          fotosFactura={fotosModalDe.fotos_factura}
          onClose={() => setFotosModalDe(null)}
          onGuardado={() => { setFotosModalDe(null); void reload(); }}
        />
      )}

      {comprobanteDe && <ComprobantePago p={comprobanteDe} onClose={() => setComprobanteDe(null)} />}
    </div>
  );
}

/* ── Formulario de Desasignación / Cancelación ── */
function FormCancelar({ p, quien, onCancel, onHecho }: {
  p: PedidoDelivery; quien: string; onCancel: () => void; onHecho: (titulo: string, texto: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [detalle, setDetalle] = useState('');
  const [guardando, setGuardando] = useState(false);
  const esOtro = motivo === MOTIVOS_CANCELACION[MOTIVOS_CANCELACION.length - 1];

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!p.pedido_id) return;
    if (!motivo) { toast('Elige el motivo.', 'error'); return; }
    if (esOtro && !detalle.trim()) { toast('Escribe cuál es el motivo.', 'error'); return; }
    setGuardando(true);
    try {
      await cancelarPedido(p.pedido_id, motivo, detalle.trim() || null);
      toast(`Liberaste ${esRetiroAlmacen(p) ? `el retiro ${p.codigo}` : `la orden ${ocDe(p)}`}. Queda disponible para otro compañero.`, 'success');
      onHecho(esRetiroAlmacen(p) ? 'Retiro liberado' : 'Pedido liberado', mensajeCancelado(p, quien, motivo, detalle));
    } catch (err) {
      toast(errMsg(err, 'No se pudo cancelar el pedido'), 'error');
    } finally { setGuardando(false); }
  }

  return (
    <form className="dlv-cockpit" onSubmit={(e) => void guardar(e)}>
      <div className="dlv-cockpit-bar" style={{ borderColor: '#ef4444' }}>
        <span className="dlv-cockpit-tag" style={{ color: '#f87171' }}>⛔ Desasignar Pedido</span>
        <span style={{ fontSize: '.85rem', color: '#94a3b8' }}>{esRetiroAlmacen(p) ? p.codigo : ocDe(p)}</span>
      </div>
      <p style={{ margin: 0, fontSize: '.85rem', color: '#94a3b8' }}>
        El pedido volverá a quedar disponible para toda la flota. Selecciona el motivo:
      </p>
      <div style={{ display: 'grid', gap: '8px' }}>
        {MOTIVOS_CANCELACION.map((m) => (
          <button
            key={m}
            type="button"
            className="dlv-tab-btn"
            style={{
              justifyContent: 'flex-start',
              background: motivo === m ? '#1e293b' : 'rgba(255, 255, 255, 0.05)',
              border: motivo === m ? '1.5px solid #f59e0b' : '1px solid transparent',
              color: motivo === m ? '#f8fafc' : '#cbd5e1',
              padding: '10px 14px',
            }}
            onClick={() => setMotivo(m)}
          >
            <span>{motivo === m ? '●' : '○'}</span> {m}
          </button>
        ))}
      </div>
      {esOtro && (
        <textarea
          className="input surt-input"
          rows={3}
          value={detalle}
          placeholder="Escribe el motivo aquí…"
          onChange={(e) => setDetalle(e.target.value)}
        />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 6 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={guardando}>
          ← Volver
        </button>
        <button type="submit" className="btn btn-peligro" disabled={guardando || !motivo}>
          {guardando ? 'Guardando…' : 'Confirmar'}
        </button>
      </div>
    </form>
  );
}

/* ── Formulario de Entrega ── */
function FormEntregar({ p, quien, onCancel, onHecho }: {
  p: PedidoDelivery; quien: string; onCancel: () => void; onHecho: (titulo: string, texto: string) => void;
}) {
  const [recibidoPor, setRecibidoPor] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!p.pedido_id) return;
    if (!recibidoPor.trim()) { toast('Escribe el nombre de quien recibe.', 'error'); return; }
    if ((p.fotos_entrega?.length ?? 0) === 0) {
      toast('📸 Es obligatorio subir la foto de la guía firmada / entrega antes de finalizar.', 'error');
      return;
    }
    setGuardando(true);
    const almacen = nombreAlmacenVisible(p.almacen_entrega ?? p.almacen_destino);
    try {
      await marcarEntregado(p.pedido_id, almacen, nota.trim() || null);
      toast(`Entrega registrada correctamente.`, 'success');
      onHecho('Entrega finalizada', mensajeEntregado(p, quien, almacen, nota.trim() || null));
    } catch (err) {
      toast(errMsg(err, 'No se pudo registrar la entrega'), 'error');
    } finally { setGuardando(false); }
  }

  return (
    <form className="dlv-cockpit" onSubmit={(e) => void guardar(e)}>
      <div className="dlv-cockpit-bar" style={{ borderColor: '#10b981' }}>
        <span className="dlv-cockpit-tag" style={{ color: '#34d399' }}>📦 Finalizar Entrega</span>
        <span style={{ fontSize: '.85rem', color: '#94a3b8' }}>{esRetiroAlmacen(p) ? p.codigo : ocDe(p)}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: '.82rem', color: '#94a3b8' }}>¿Quién recibe el material?</label>
        <input
          className="input surt-input"
          value={recibidoPor}
          placeholder="Nombre y apellido de quien firma / recibe"
          required
          onChange={(e) => setRecibidoPor(e.target.value)}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: '.82rem', color: '#94a3b8' }}>Nota u observaciones (opcional)</label>
        <textarea
          className="input surt-input"
          rows={2}
          value={nota}
          placeholder="Detalles de la entrega o descarga…"
          onChange={(e) => setNota(e.target.value)}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 6 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={guardando}>
          ← Volver
        </button>
        <button type="submit" className="btn btn-primary dlv-btn-hero-green" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Confirmar Entrega'}
        </button>
      </div>
    </form>
  );
}

/* ── Modal No Disponible ── */
function NoDisponibleModal({ p, quien, onCancel, onHecho }: {
  p: PedidoDelivery; quien: string; onCancel: () => void; onHecho: (titulo: string, texto: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!motivo) { toast('Elige un motivo.', 'error'); return; }
    setGuardando(true);
    try {
      await rechazarPedido(p.orden_id, p.origen ?? 'compra', motivo);
      toast('Marcado como no disponible para ti.', 'info');
      onHecho('No disponible', mensajeNoDisponible(p, quien, motivo));
    } catch (e) {
      toast(errMsg(e, 'No se pudo guardar el reporte'), 'error');
    } finally { setGuardando(false); }
  }

  return (
    <div className="dlv-cockpit">
      <div className="dlv-cockpit-bar" style={{ borderColor: '#f59e0b' }}>
        <span className="dlv-cockpit-tag">✕ No puedo tomar este pedido</span>
      </div>
      <div style={{ display: 'grid', gap: '8px' }}>
        {MOTIVOS_NO_DISPONIBLE.map((m) => (
          <button
            key={m}
            type="button"
            className="dlv-tab-btn"
            style={{
              justifyContent: 'flex-start',
              background: motivo === m ? '#1e293b' : 'rgba(255, 255, 255, 0.05)',
              border: motivo === m ? '1.5px solid #f59e0b' : '1px solid transparent',
              color: motivo === m ? '#f8fafc' : '#cbd5e1',
              padding: '10px 14px',
            }}
            onClick={() => setMotivo(m)}
          >
            <span>{motivo === m ? '●' : '○'}</span> {m}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 6 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={guardando}>
          ← Volver
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={guardando || !motivo}>
          {guardando ? 'Guardando…' : 'Confirmar'}
        </button>
      </div>
    </div>
  );
}

/* ── Modal de Contacto Rápido ── */
function ModalLlamarRapido({ pedido, onClose }: {
  pedido: PedidoDelivery | null;
  onClose: () => void;
}) {
  const telAnalista = pedido ? telHref(pedido.analista_telefono) : null;
  const telSolicitante = pedido ? telHref(pedido.solicitante_telefono) : null;

  return (
    <Modal title="Contactos de Despacho" compact onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', color: '#f8fafc' }}>
        {pedido ? (
          <>
            <p style={{ margin: 0, fontSize: '.88rem', color: '#94a3b8' }}>
              Contactos autorizados para coordinar la entrega en curso:
            </p>
            {telAnalista && (
              <a
                href={telAnalista}
                className="dlv-btn-nav-gmaps"
                style={{ textDecoration: 'none', background: '#0284c7', borderColor: '#38bdf8', color: '#fff' }}
              >
                📞 Llamar al Analista ({pedido.analista_nombre || 'Compras'} · {pedido.analista_telefono})
              </a>
            )}
            {telSolicitante && (
              <a
                href={telSolicitante}
                className="dlv-btn-nav-gmaps"
                style={{ textDecoration: 'none', background: '#1e293b', borderColor: '#94a3b8', color: '#f8fafc' }}
              >
                📞 Llamar al Solicitante ({pedido.solicitante_nombre || 'Mina'} · {pedido.solicitante_telefono})
              </a>
            )}
            {!telAnalista && !telSolicitante && (
              <p style={{ color: '#fca5a5' }}>No hay teléfonos registrados para esta orden.</p>
            )}
          </>
        ) : (
          <p style={{ margin: 0, fontSize: '.88rem', color: '#94a3b8' }}>
            Acepta un pedido para comunicarte con su analista responsable.
          </p>
        )}
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Modal>
  );
}

/* ── Modal Comprobante de Pago ── */
function ComprobantePago({ p, onClose }: { p: PedidoDelivery; onClose: () => void }) {
  return (
    <Modal title={`Comprobante de ${ocDe(p)}`} onClose={onClose}>
      <ComprobantePagoCuerpo pedido={p} />
    </Modal>
  );
}

/* ── Compartir Ubicación al Backend en Background ── */
function CompartirUbicacion({ pedido, gps }: { pedido: PedidoDelivery | null; gps: { pos: PosicionGps | null; error: string | null } }) {
  const quiere = leerGps();
  const activo = quiere && !!pedido;
  const pedidoId = useRef<string | null>(null);
  useEffect(() => { pedidoId.current = pedido?.pedido_id ?? null; }, [pedido?.pedido_id]);
  const ultimo = useRef<EnvioGps | null>(null);
  const enviando = useRef(false);
  const posRef = useRef<PosicionGps | null>(gps.pos);
  useEffect(() => { posRef.current = gps.pos; }, [gps.pos]);

  const enviar = useCallback((pos: PosicionGps, forzarHora = false) => {
    const punto: EnvioGps = { lat: pos.lat, lng: pos.lng, t: forzarHora ? Date.now() : pos.t };
    if (enviando.current || !debeEnviarUbicacion(ultimo.current, punto)) return;
    enviando.current = true;
    ultimo.current = punto;
    compartirUbicacion({ lat: pos.lat, lng: pos.lng, precision: pos.precision, velocidad: pos.velocidad, rumbo: pos.rumbo }, pedidoId.current)
      .finally(() => { enviando.current = false; });
  }, []);

  useEffect(() => {
    if (activo && gps.pos) enviar(gps.pos);
  }, [activo, gps.pos, enviar]);

  useEffect(() => {
    if (!activo) { ultimo.current = null; return; }
    const t = setInterval(() => {
      const p = posRef.current;
      if (p && Date.now() - p.t < GPS_VIGENTE_MS) enviar(p, true);
    }, 30_000);
    return () => clearInterval(t);
  }, [activo, enviar]);

  return null;
}

export function CargaPesadaMovilView() {
  return <DeliveryMovilView canal="carga_pesada" />;
}
