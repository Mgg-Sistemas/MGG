/* ============================================================
   MGG · Delivery · Vista de teléfono del motorizado (30-10-2026)

   La OC que Tesorería pagó (la retención no es requisito) aparece «Por
   tomar». El motorizado la ACEPTA (solo uno: si otro se adelantó, la base
   lo rechaza con su nombre), sube fotos al recibirla del proveedor, la
   marca EN RUTA y la ENTREGA en el almacén con fotos. Si no puede buscarla
   la CANCELA con motivo y la OC vuelve a quedar libre. Cada paso termina en
   su mensaje de WhatsApp, que se copia o se envía con un botón (nada sale
   solo). Con el pedido tomado puede llamar al analista de Compras que armó
   la OC y al proveedor, y compartir su ubicación mientras va en curso.
   Antes de aceptar puede ver el comprobante de pago que adjuntó Tesorería.
   Mientras la administradora no conecte Delivery a Compras, no llegan OC.
   31-10: cada pedido y la lista del chip elegido tienen «📄 Ver PDF» (vista
   previa) y «💬 WhatsApp» con el reporte; solo salen al tocar el botón.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { FlotaContext, MODULO_FLOTA, TITULO_FLOTA, useFlota, type Flota } from './flota';
import { Link } from 'react-router-dom';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { RUTA_TELEFONO } from '@/modules/auth/vistasTelefono';
import { DESTINOS_RECEPCION, RESPALDO_POR_CORREO, nombreAlmacenVisible } from '@/modules/inventario/sectorizacion';
import { avisarRecepcionPendiente } from '@/modules/inventario/recepcionTelefono.repository';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useRecargaAlVolver } from './useRecargaAlVolver';
import { PanelRutaMovil, metrosAlPedido, useMiPosicion } from './RutaDeliveryMovil';
import { ordenarLibresPorCercania, type Punto } from './deliveryRutas';
import { useQuien } from '@/shared/lib/directorioUsuarios';
import { toast } from '@/shared/ui/Toast';
import { Modal } from '@/shared/ui/Modal';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { MensajeWhatsappModal } from '@/modules/pedidos/MensajeWhatsappModal';
import { AtajosTelefono } from '@/shared/ui/AtajosTelefono';
import { NombreUsuario } from '@/shared/ui/NombreUsuario';
import {
  ESTADO_DELIVERY, MAX_FOTOS_DELIVERY, MOTIVOS_CANCELACION, fechaHoraVE, mensajeAceptado, mensajeCancelado,
  claveDe, esRetiro, mensajeEnRuta, mensajeEntregado, mensajeNoDisponible, montoTxt, ocDe, type FotoDelivery, type PedidoDelivery,
} from './delivery';
import {
  cancelarPedido, compartirUbicacion, listProveedoresUbicacion, puntosDeProveedores, useDestinosDelivery, marcarNoDisponible,  comprobantePagoDelivery, listPedidosDelivery, marcarEnRuta, marcarEntregado,
  quitarFotoDelivery, subirFotosDelivery, tomarPedido, urlFotoDelivery, useDeliveryConectado, type ComprobantePagoDelivery,
} from './delivery.repository';
import {
  armarFeed, debeEnviarUbicacion, enChip, errorUbicacion, mapaHref, mensajeDeEstado, telHref, trabajoEnCurso,
  type ChipDelivery, type EnvioGps, type PedidoFeed,
} from './deliveryMovil';
import { pdfComprobanteDelivery, pdfListaDelivery } from './deliveryPdf';
import { mensajeListaDelivery, mensajeReporteDelivery, pedidosDelFeed } from './deliveryReporte';
import './deliveryMovil.css';

export const RUTA_DELIVERY_TELEFONO = '/app/delivery/telefono';
const CLAVE_GPS = 'mgg.deliveryMovil.compartirUbicacion';

const errMsg = (e: unknown, d: string) => {
  const m = String((e as { message?: string } | null)?.message ?? '').trim();
  return m || d;
};
const esImagen = (f: File) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name);
const leerGps = () => { try { return localStorage.getItem(CLAVE_GPS) !== '0'; } catch { return true; } };
const guardarGps = (v: boolean) => { try { localStorage.setItem(CLAVE_GPS, v ? '1' : '0'); } catch { /* sin almacenamiento: vuelve a encendido */ } };
const cant = (n: number) => (Number(n) || 0).toLocaleString('es-VE', { maximumFractionDigits: 3 });
/** 10-11-2026 (rediseño): «850 m» o «1,2 km» hasta el proveedor. */
const distanciaTxt = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString('es-VE', { maximumFractionDigits: 1 })} km`);

const CHIPS: Array<{ key: ChipDelivery; label: string }> = [
  { key: 'por_tomar', label: '💰 Por tomar' },
  { key: 'en_ruta', label: '🚚 En camino' },
  { key: 'entregados', label: '✅ Entregados' },
];

type Accion = { tipo: 'cancelar' | 'entregar'; ordenId: string };

/** 04-11-2026: la misma pantalla sirve a Delivery y a Carga pesada; cada una ve solo sus pedidos. */
export function DeliveryMovilView() {
  return <FlotaContext.Provider value="delivery"><PantallaFlota flota="delivery" /></FlotaContext.Provider>;
}

/** La pantalla de teléfono del rol CARGA PESADA: solo los pedidos marcados «Carga pesada». */
export function CargaPesadaMovilView() {
  return <FlotaContext.Provider value="carga_pesada"><PantallaFlota flota="carga_pesada" /></FlotaContext.Provider>;
}

function PantallaFlota({ flota }: { flota: Flota }) {
  const { user } = useSession();
  const { can, appUser, soloTelefono, vistasTelefono } = usePermissions();
  const quienDe = useQuien();
  const canWrite = can(MODULO_FLOTA[flota], 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre?.trim() || user?.email || null;
  const quien = quienDe(actorName, actor) || actorName || actor;
  const conectado = useDeliveryConectado();

  const [activos, setActivos] = useState<PedidoDelivery[]>([]);
  const [cerrados, setCerrados] = useState<PedidoDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [chip, setChip] = useState<ChipDelivery>('por_tomar');
  const [accion, setAccion] = useState<Accion | null>(null);
  const [listo, setListo] = useState<{ titulo: string; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [comprobanteDe, setComprobanteDe] = useState<PedidoDelivery | null>(null);
  // Reportes (31-10): PDF en vista previa y WhatsApp, solo al tocar el botón.
  const [reporte, setReporte] = useState<{ titulo: string; texto: string } | null>(null);
  const [generando, setGenerando] = useState<string | null>(null);

  // Solo la última carga pinta (el realtime puede disparar varias seguidas).
  const turno = useRef(0);
  const reload = useCallback(async () => {
    const mio = ++turno.current;
    const [a, c] = await Promise.all([
      listPedidosDelivery(false, flota),
      listPedidosDelivery(true, flota).catch(() => [] as PedidoDelivery[]),
    ]);
    if (mio !== turno.current) return;
    setActivos(a);
    setCerrados(c);
  }, [flota]);

  useEffect(() => {
    let vivo = true;
    reload().catch((e) => { if (vivo) toast(errMsg(e, 'No se pudieron cargar los pedidos'), 'error'); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [reload]);
  useRealtime(['delivery_pedidos', 'ordenes'], () => { void reload().catch(() => {}); });
  // 07-11-2026: con la pantalla apagada se corta el tiempo real; al volver (y cada 45 s) se recarga.
  useRecargaAlVolver(reload);


  // 03-11-2026 (tipo Yummy / Ridery): mi posición, los proveedores ubicados y los almacenes,
  // para el proveedor más cercano, el orden por cercanía y la ruta del pedido en curso.
  const gps = useMiPosicion();
  const [destinos] = useDestinosDelivery();
  const [provPts, setProvPts] = useState<Map<string, Punto>>(new Map());
  const idsProv = useMemo(() => [...new Set([...activos, ...cerrados].map((x) => x.proveedor_id).filter((x): x is string => !!x))].sort().join(','), [activos, cerrados]);
  const cargarProv = useCallback(() => {
    if (!idsProv) { setProvPts(new Map()); return; }
    listProveedoresUbicacion(idsProv.split(',')).then((ps) => setProvPts(puntosDeProveedores(ps))).catch(() => { /* sin ubicaciones */ });
  }, [idsProv]);
  useEffect(() => { cargarProv(); }, [cargarProv]);

  const feedBase = useMemo(() => armarFeed(activos, cerrados), [activos, cerrados]);
  const feed = useMemo(() => ordenarLibresPorCercania(feedBase, (x) => metrosAlPedido(gps.yo, x, provPts, destinos)), [feedBase, gps.yo, provPts, destinos]);
  const libres = useMemo(() => feed.filter((f) => f.disponible).map((f) => f.p), [feed]);
  const visibles = useMemo(() => feed.filter((f) => enChip(f, chip)), [feed, chip]);
  const cuenta = useMemo(() => Object.fromEntries(CHIPS.map((c) => [c.key, feed.filter((f) => enChip(f, c.key)).length])) as Record<ChipDelivery, number>, [feed]);
  const enCurso = trabajoEnCurso(feed);
  const pedidoAccion = accion ? feed.find((f) => claveDe(f.p) === accion.ordenId)?.p ?? null : null;

  // Si el pedido de la acción dejó de estar en curso (otra pestaña, la PC), se vuelve a la lista.
  useEffect(() => {
    if (!accion || loading) return;
    // «No disponible» se marca sobre un pedido libre; lo demás, sobre uno mío en curso.
    const libre = !!pedidoAccion && accion.tipo === 'cancelar' && (pedidoAccion.estado === 'por_tomar' || pedidoAccion.estado === 'cancelado');
    const mioEnCurso = !!pedidoAccion && pedidoAccion.es_mio && ['aceptado', 'en_ruta'].includes(pedidoAccion.estado);
    if (!libre && !mioEnCurso) setAccion(null);
  }, [accion, pedidoAccion, loading]);

  function hecho(titulo: string, texto: string) {
    setAccion(null);
    setListo({ titulo, texto });
    void reload().catch(() => {});
  }
  function volver() { setAccion(null); setListo(null); }

  async function tomar(p: PedidoDelivery) {
    setOcupado(claveDe(p));
    try {
      await tomarPedido(p.orden_id, p.tipo ?? 'oc');
      toast(`Aceptaste ${ocDe(p)}: va en camino.`, 'success');
      hecho('Pedido aceptado · en camino', mensajeAceptado(p, quien));
    } catch (e) {
      toast(errMsg(e, 'No se pudo tomar el pedido'), 'error');
      void reload().catch(() => {});
    } finally { setOcupado(null); }
  }

  async function enRuta(p: PedidoDelivery) {
    if (!p.pedido_id) return;
    setOcupado(claveDe(p));
    try {
      await marcarEnRuta(p.pedido_id);
      toast('Marcado en ruta.', 'success');
      hecho('En camino', mensajeEnRuta(p, quien));
    } catch (e) {
      toast(errMsg(e, 'No se pudo marcar en ruta'), 'error');
    } finally { setOcupado(null); }
  }

  function verMensaje(p: PedidoDelivery) {
    const m = mensajeDeEstado(p, quien, nombreAlmacenVisible);
    if (m) { setAccion(null); setListo(m); }
  }

  function verPdf(clave: string, generar: () => Promise<void>) {
    setGenerando(clave);
    generar()
      .catch((e) => toast(errMsg(e, 'No se pudo generar el PDF'), 'error'))
      .finally(() => setGenerando(null));
  }
  const filtroChip = CHIPS.find((c) => c.key === chip)?.label ?? 'Por tomar';
  const pedidosVisibles = pedidosDelFeed(visibles);

  const enPantallaPrincipal = !accion && !listo;

  return (
    <div className="surtidor">
      {/* 10-11-2026 (maqueta de Delivery): cabecera con el conductor, su flota y el estado del GPS. */}
      <header className="dlv-hero">
        <div className="dlv-hero-fila">
          <div className="dlv-conductor">
            <div className="dlv-avatar" aria-hidden>{flota === 'carga_pesada' ? '🚚' : '🛵'}</div>
            <div style={{ minWidth: 0 }}>
              <h1><NombreUsuario nombre={actorName} correo={actor} /></h1>
              <p>{TITULO_FLOTA[flota]}{enCurso ? ` · en curso ${ocDe(enCurso)}` : ''}</p>
            </div>
          </div>
          <span className={`dlv-gps-pill${gps.yo ? ' on' : ''}`} title={gps.error ?? undefined}>{gps.yo ? '● GPS activo' : '○ Sin GPS'}</span>
        </div>
        <div className="dlv-hero-links">
          {!soloTelefono && <Link to="/app/delivery" className="btn btn-ghost">🖥 Módulo completo</Link>}
          {soloTelefono && vistasTelefono.length > 1 && <Link to={RUTA_TELEFONO} className="btn btn-ghost">📱 Mis pantallas</Link>}
        </div>
      </header>
      <AtajosTelefono actual={RUTA_DELIVERY_TELEFONO} />

      {conectado === false && (
        <div className="aviso info sm" style={{ margin: '.25rem 0 .85rem' }}>
          <span className="aviso-icono">ℹ</span>
          <div>Delivery todavía no está conectado a Compras: los pedidos aparecerán cuando la administración lo active.</div>
        </div>
      )}
      {!canWrite && (
        <div className="aviso warning sm" style={{ margin: '.25rem 0 .85rem' }}>
          <span className="aviso-icono">👁</span>
          <div>Tu rol solo puede ver. Para tomar y entregar pedidos hace falta escritura en Delivery.</div>
        </div>
      )}

      {canWrite && <CompartirUbicacion pedido={enCurso} />}

      {listo && (
        <div className="surt-form">
          <div className="surt-form-titulo"><span className="icono" aria-hidden>✅</span><strong>{listo.titulo}</strong></div>
          <CompartirWhatsapp texto={listo.texto} />
          <button type="button" className="btn btn-primary surt-guardar" onClick={volver}>← Volver a los pedidos</button>
        </div>
      )}

      {accion?.tipo === 'cancelar' && pedidoAccion && (
        <FormCancelar p={pedidoAccion} quien={quien} onCancel={volver} onHecho={hecho} />
      )}
      {accion?.tipo === 'entregar' && pedidoAccion && (
        <FormEntregar p={pedidoAccion} quien={quien} onCancel={volver} onHecho={hecho} />
      )}

      {enPantallaPrincipal && (
        <>
          <PanelRutaMovil yo={gps.yo} gpsError={gps.error} libres={libres} enCurso={enCurso} provPts={provPts}
            destinos={destinos} canWrite={canWrite} onUbicado={cargarProv} />
          <div className="dlv-chips" role="tablist" aria-label="Filtrar pedidos">
            {CHIPS.map((c) => (
              <button key={c.key} type="button" role="tab" aria-selected={chip === c.key}
                className={`dlv-chip${chip === c.key ? ' activo' : ''}`} onClick={() => setChip(c.key)}>
                <span>{c.label}</span> <span className="dlv-chip-n">{cuenta[c.key]}</span>
              </button>
            ))}
          </div>

          {!loading && visibles.length > 0 && (
            <div className="dlv-reporte dlv-reporte-lista" aria-label="Reporte de la lista">
              <button type="button" className="btn btn-ghost" disabled={!!generando}
                onClick={() => verPdf('lista', () => pdfListaDelivery({ pedidos: pedidosVisibles, filtro: filtroChip, ver: nombreAlmacenVisible }))}>
                {generando === 'lista' ? 'Generando…' : `📄 Ver PDF (${visibles.length})`}
              </button>
              <button type="button" className="btn btn-ghost"
                onClick={() => setReporte({
                  titulo: flota === 'carga_pesada' ? 'Pedidos de Carga pesada' : 'Pedidos de Delivery',
                  texto: mensajeListaDelivery({ pedidos: pedidosVisibles, filtro: filtroChip, ver: nombreAlmacenVisible }),
                })}>
                💬 WhatsApp
              </button>
            </div>
          )}

          {loading && <p className="muted">Cargando…</p>}
          {!loading && !visibles.length && (
            <p className="muted" style={{ textAlign: 'center', padding: '1.5rem .5rem' }}>
              {chip === 'por_tomar' ? 'No hay pedidos por tomar.'
                : chip === 'en_ruta' ? 'No hay pedidos en curso.'
                  : chip === 'entregados' ? 'Todavía no hay entregas.'
                    : 'No hay pedidos por ahora.'}
            </p>
          )}

          {visibles.map((f) => (
            <TarjetaPedido key={claveDe(f.p)} f={f} canWrite={canWrite} ocupado={ocupado === claveDe(f.p)} bloqueado={!!ocupado}
              metros={metrosAlPedido(gps.yo, f.p, provPts, destinos)}
              onTomar={() => void tomar(f.p)}
              onEnRuta={() => void enRuta(f.p)}
              onCancelar={() => { setListo(null); setAccion({ tipo: 'cancelar', ordenId: claveDe(f.p) }); }}
              onNoDisponible={() => { setListo(null); setAccion({ tipo: 'cancelar', ordenId: claveDe(f.p) }); }}
              onEntregar={() => { setListo(null); setAccion({ tipo: 'entregar', ordenId: claveDe(f.p) }); }}
              onVerMensaje={() => verMensaje(f.p)}
              onComprobante={() => setComprobanteDe(f.p)}
              onFotos={() => void reload().catch(() => {})}
              generandoPdf={generando === claveDe(f.p)} pdfBloqueado={!!generando}
              onPdf={() => verPdf(claveDe(f.p), () => pdfComprobanteDelivery(f.p, nombreAlmacenVisible))}
              onReporte={() => setReporte({ titulo: `Reporte · ${ocDe(f.p)}`, texto: mensajeReporteDelivery(f.p, nombreAlmacenVisible) })}
            />
          ))}
        </>
      )}

      {comprobanteDe && <ComprobantePago p={comprobanteDe} onClose={() => setComprobanteDe(null)} />}
      {reporte && <MensajeWhatsappModal titulo={reporte.titulo} texto={reporte.texto} onClose={() => setReporte(null)} />}
    </div>
  );
}

/* ── Una orden en el listado ── */

function TarjetaPedido({
  f, canWrite, ocupado, bloqueado, metros = null, onTomar, onEnRuta, onCancelar, onNoDisponible, onEntregar, onVerMensaje, onComprobante, onFotos,
  generandoPdf, pdfBloqueado, onPdf, onReporte,
}: {
  f: PedidoFeed; canWrite: boolean; ocupado: boolean; bloqueado: boolean;
  /** Metros desde mi posición hasta donde se busca (null = sin GPS o sin ubicar). */
  metros?: number | null;
  onTomar: () => void; onEnRuta: () => void; onCancelar: () => void; onNoDisponible: () => void; onEntregar: () => void;
  onVerMensaje: () => void; onComprobante: () => void; onFotos: () => void;
  generandoPdf: boolean; pdfBloqueado: boolean; onPdf: () => void; onReporte: () => void;
}) {
  const { p, disponible } = f;
  const estado = disponible ? ESTADO_DELIVERY.por_tomar : ESTADO_DELIVERY[p.estado];
  const claseEstado = disponible ? 'por_tomar' : p.estado;
  const enCurso = !disponible && (p.estado === 'aceptado' || p.estado === 'en_ruta');
  const mioEnCurso = enCurso && p.es_mio;
  const mioEntregado = !disponible && p.es_mio && p.estado === 'entregado';
  const items = (p.items ?? []).filter((i) => i.comprar !== false);
  const telProv = telHref(p.proveedor_telefono);
  const telAnalista = telHref(p.analista_telefono);
  const mapa = mapaHref(p.proveedor_direccion);
  // Lo mío, en cualquier paso (si está libre otra vez y es mío, es porque yo lo cancelé).
  const puedeVerMensaje = p.es_mio;
  // 02-11-2026: la tarjeta muestra cuántos productos son; la lista se abre con «Ver orden».
  const [verOrden, setVerOrden] = useState(false);

  return (
    <article className={`dlv-card est-${claseEstado}${mioEnCurso ? ' mio' : ''}${p.urgente ? ' urgente' : ''}`}>
      <div className="dlv-card-cab">
        <div style={{ minWidth: 0 }}>
          <div className="dlv-oc">{ocDe(p)}{p.urgente && <span className="dlv-urgente">🚨 Urgente</span>}</div>
          {p.pagada_en && <div className="dlv-sub">{esRetiro(p) ? 'Almacén revisó' : 'Entrada'}: {fechaHoraVE(p.pagada_en)}</div>}
        </div>
        <span className={`dlv-pill est-${claseEstado}`}>{estado.emoji} {estado.label}</span>
      </div>

      <div className="dlv-prov">
        <div className="dlv-prov-linea">
          <span className="nombre">{esRetiro(p) ? '🏬' : '🏭'} {p.proveedor_nombre ?? 'Proveedor sin nombre'}</span>
          {metros != null && <span className="dlv-dist" title="Distancia desde donde estás">📍 {distanciaTxt(metros)}</span>}
        </div>
        {esRetiro(p) && <div className="dlv-sub">Retiro en almacén: lo que Los Pinos entrega de la solicitud. Llévalo a donde se necesita.</div>}
        {p.proveedor_contacto && <div className="dlv-sub">Contacto: {p.proveedor_contacto}</div>}
        {p.proveedor_direccion && (mapa
          ? <a className="dir" href={mapa} target="_blank" rel="noopener noreferrer">📍 {p.proveedor_direccion}</a>
          : <div className="dlv-sub">📍 {p.proveedor_direccion}</div>)}
        {!p.proveedor_direccion && !esRetiro(p) && <div className="dlv-sub">Sin dirección cargada: pregúntale al analista.</div>}
        {(p.almacen_entrega || p.almacen_destino) && (
          <span className="dlv-destino">🏬 {p.estado === 'entregado' ? 'Entregado en' : 'Destino'}: <strong>{nombreAlmacenVisible(p.almacen_entrega ?? p.almacen_destino)}</strong></span>
        )}
      </div>

      {/* Avance del pedido: tomado → en ruta → entregado. */}
      {!disponible && p.estado !== 'cancelado' && (
        <ol className="dlv-pasos" aria-label="Avance del pedido">
          <li className="hecho"><span className="punto" aria-hidden />Tomado{p.aceptado_en && <small>{fechaHoraVE(p.aceptado_en)}</small>}</li>
          <li className={p.estado === 'entregado' || p.estado === 'en_ruta' ? (p.estado === 'entregado' ? 'hecho' : 'actual') : ''}>
            <span className="punto" aria-hidden />En ruta{p.en_ruta_en && <small>{fechaHoraVE(p.en_ruta_en)}</small>}
          </li>
          <li className={p.estado === 'entregado' ? 'hecho' : ''}><span className="punto" aria-hidden />Entregado{p.entregado_en && <small>{fechaHoraVE(p.entregado_en)}</small>}</li>
        </ol>
      )}

      {mioEnCurso && (
        <div className="dlv-llamar">
          {telProv
            ? <a className="btn btn-ghost btn-grande" href={telProv}>📞 {esRetiro(p) ? 'Llamar almacén' : 'Llamar proveedor'}<small>{p.proveedor_telefono}</small></a>
            : <span className="btn btn-ghost btn-grande" aria-disabled>📞 {esRetiro(p) ? 'Almacén' : 'Proveedor'}<small>sin teléfono</small></span>}
          {telAnalista
            ? <a className="btn btn-ghost btn-grande" href={telAnalista}>📞 {esRetiro(p) ? 'Llamar solicitante' : 'Llamar analista'}<small>{p.analista_nombre ?? p.analista_email ?? ''}</small></a>
            : <span className="btn btn-ghost btn-grande" aria-disabled>📞 {p.analista_nombre ?? 'Analista'}<small>sin teléfono</small></span>}
        </div>
      )}

      {(!esRetiro(p) || !!items.length) && (
        <div className="dlv-fila2">
          {!esRetiro(p) && (
            <button type="button" className="btn btn-ghost" onClick={onComprobante} title="Comprobante de pago que adjuntó Tesorería">
              🧾 Comprobante<small>{montoTxt(p.total, p.moneda)}</small>
            </button>
          )}
          {!!items.length && (
            <button type="button" className="btn btn-ghost" aria-expanded={verOrden} onClick={() => setVerOrden((v) => !v)}>
              📋 {verOrden ? 'Ocultar materiales' : 'Ver materiales'}<small>{items.length} {items.length === 1 ? 'producto' : 'productos'}</small>
            </button>
          )}
        </div>
      )}
      {verOrden && !!items.length && (
        <ul className="dlv-items">
          {items.map((i, k) => (
            <li key={`${i.nombre}-${k}`}><span>{i.nombre}</span><span>{cant(i.cantidad)}{i.unidad ? ` ${i.unidad}` : ''}</span></li>
          ))}
        </ul>
      )}
      {p.estado === 'entregado' && p.entregado_en && p.repartidor_nombre && (
        <div className="dlv-sub">✅ Lo llevó {p.repartidor_nombre}</div>
      )}
      {disponible && p.estado === 'cancelado' && (
        <div className="dlv-nota-cancel">
          ⛔ La canceló {p.repartidor_nombre ?? 'otro delivery'}{p.motivo_cancel ? `: ${p.motivo_cancel}` : ''}. Está libre otra vez.
        </div>
      )}
      {enCurso && !p.es_mio && <div className="dlv-tomado">🛵 Tomado por <strong>{p.repartidor_nombre ?? 'otro delivery'}</strong>{p.aceptado_en ? ` · ${fechaHoraVE(p.aceptado_en)}` : ''}</div>}

      {/* Aceptar deja el pedido «en camino» (02-11-2026): las fotos al recibir se suben en camino.
          03-11: ya entregado, el delivery que lo llevó puede corregir sus fotos (agregar o quitar). */}
      {(p.fotos_recibo.length > 0 || mioEnCurso || mioEntregado) && (
        <FotosPedido p={p} tipo="recibo" puedeSubir={canWrite && (mioEnCurso || mioEntregado)}
          puedeQuitar={canWrite && (mioEnCurso || mioEntregado)} onCambio={onFotos} />
      )}
      {(p.fotos_entrega.length > 0 || (mioEnCurso && p.estado === 'en_ruta') || mioEntregado) && (
        <FotosPedido p={p} tipo="entrega" puedeSubir={canWrite && ((mioEnCurso && p.estado === 'en_ruta') || mioEntregado)}
          puedeQuitar={canWrite && (mioEnCurso || mioEntregado)} onCambio={onFotos} />
      )}

      <div className="dlv-acciones">
        {canWrite && disponible && (
          <button type="button" className="btn btn-primary dlv-btn-tomar" disabled={bloqueado} onClick={onTomar}>
            {ocupado ? 'Aceptando…' : '✓ Aceptar pedido · En camino'}
          </button>
        )}
        {canWrite && disponible && (
          <button type="button" className="btn btn-ghost dlv-btn-peligro" disabled={bloqueado} onClick={onNoDisponible}>
            ✕ No disponible para retirar
          </button>
        )}
        {canWrite && mioEnCurso && p.estado === 'aceptado' && (
          <button type="button" className="btn btn-primary" disabled={bloqueado} onClick={onEnRuta}>
            {ocupado ? 'Guardando…' : '🚚 Marcar en ruta'}
          </button>
        )}
        {canWrite && mioEnCurso && p.estado === 'en_ruta' && (
          <button type="button" className="btn btn-success dlv-btn-entregar" disabled={bloqueado} onClick={onEntregar}>📦 Entregado en almacén</button>
        )}
        {canWrite && mioEnCurso && (
          <button type="button" className="btn btn-ghost dlv-btn-peligro" disabled={bloqueado} onClick={onCancelar}>
            ✕ No puedo buscarlo
          </button>
        )}
        {puedeVerMensaje && (
          <button type="button" className="btn btn-ghost" onClick={onVerMensaje}>💬 Ver mensaje de WhatsApp</button>
        )}
        {/* Por tomar: solo comprobante, aceptar o no disponible (02-11-2026). */}
        {!disponible && <div className="dlv-reporte">
          <button type="button" className="btn btn-ghost" disabled={pdfBloqueado} onClick={onPdf}>
            {generandoPdf ? 'Generando…' : '📄 Ver PDF'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onReporte} title="Reporte del pedido por WhatsApp">💬 WhatsApp</button>
        </div>}
      </div>
    </article>
  );
}

/* ── Fotos al recibir / de la entrega ── */

function FotosPedido({ p, tipo, puedeSubir, puedeQuitar = false, onCambio }: {
  p: PedidoDelivery; tipo: 'recibo' | 'entrega'; puedeSubir: boolean; puedeQuitar?: boolean; onCambio: () => void;
}) {
  const fotos = tipo === 'recibo' ? p.fotos_recibo : p.fotos_entrega;
  const [subiendo, setSubiendo] = useState(false);

  async function quitar(f: FotoDelivery) {
    if (!p.pedido_id) return;
    if (!window.confirm(`¿Quitar la foto «${f.filename}»?`)) return;
    setSubiendo(true);
    try {
      await quitarFotoDelivery(p.pedido_id, tipo, fotos, f.path);
      toast('Foto quitada.', 'success');
      onCambio();
    } catch (e) {
      toast(errMsg(e, 'No se pudo quitar la foto'), 'error');
    } finally { setSubiendo(false); }
  }
  const faltan = MAX_FOTOS_DELIVERY - fotos.length;
  const titulo = tipo === 'recibo' ? '📷 Fotos al recibir' : '📷 Fotos de la entrega';
  const id = `dlv-fotos-${tipo}-${claveDe(p)}`;

  async function agregar(lista: FileList | null) {
    const archivos = Array.from(lista ?? []);
    if (!archivos.length || !p.pedido_id) return;
    if (archivos.some((f) => !esImagen(f))) { toast('Solo se pueden subir fotos (imágenes).', 'error'); return; }
    if (archivos.length > faltan) { toast(`Se pueden adjuntar hasta ${MAX_FOTOS_DELIVERY} fotos; te quedan ${faltan}.`, 'error'); return; }
    setSubiendo(true);
    try {
      await subirFotosDelivery(p.pedido_id, tipo, fotos, archivos);
      toast(archivos.length === 1 ? 'Foto agregada.' : `${archivos.length} fotos agregadas.`, 'success');
      onCambio();
    } catch (e) {
      toast(errMsg(e, 'No se pudieron subir las fotos'), 'error');
    } finally { setSubiendo(false); }
  }

  return (
    <div className="surt-campo">
      <label htmlFor={puedeSubir ? id : undefined}>{titulo} ({fotos.length}/{MAX_FOTOS_DELIVERY})</label>
      <MiniaturasFotos fotos={fotos} onQuitar={puedeQuitar && !subiendo ? (f) => { void quitar(f); } : undefined} />
      {puedeSubir && faltan > 0 && (
        <div className="dlv-subir" style={{ marginTop: fotos.length ? '.5rem' : 0 }}>
          <span className="btn btn-ghost" aria-hidden>{subiendo ? 'Subiendo…' : `${titulo}${fotos.length ? ' (agregar)' : ''}`}</span>
          <input id={id} type="file" accept="image/*" multiple disabled={subiendo}
            aria-label={titulo} onChange={(e) => { void agregar(e.target.files); e.target.value = ''; }} />
        </div>
      )}
      {puedeSubir && faltan <= 0 && <small className="muted">Ya tiene las {MAX_FOTOS_DELIVERY} fotos.</small>}
    </div>
  );
}

/** Miniaturas con enlace firmado (se abren en otra pestaña). */
function MiniaturasFotos({ fotos, onQuitar }: { fotos: FotoDelivery[]; onQuitar?: (f: FotoDelivery) => void }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const clave = fotos.map((f) => f.path).join('|');
  useEffect(() => {
    let vivo = true;
    void Promise.all(fotos.map(async (f) => [f.path, await urlFotoDelivery(f.path).catch(() => '')] as const))
      .then((xs) => { if (vivo) setUrls(Object.fromEntries(xs)); });
    return () => { vivo = false; };
    // `clave` resume las rutas: el arreglo cambia de identidad en cada recarga aunque sean las mismas fotos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);
  if (!fotos.length) return null;
  return (
    <div className="rep-fotos">
      {fotos.map((f) => (
        <span key={f.path} style={{ position: 'relative', display: 'inline-block' }}>
          <a className="rep-foto" href={urls[f.path] || undefined} target="_blank" rel="noopener noreferrer" aria-label={`Ver ${f.filename}`}>
            {urls[f.path] ? <img src={urls[f.path]} alt={f.filename} /> : <span className="rep-foto-doc">📷</span>}
          </a>
          {onQuitar && (
            <button type="button" className="btn btn-xs" onClick={() => onQuitar(f)} aria-label={`Quitar ${f.filename}`}
              style={{ position: 'absolute', top: 2, right: 2, padding: '0 .35rem', background: 'var(--danger)', color: '#fff', borderRadius: 999 }}>
              ✕
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/* ── Cancelar (no puede buscarlo) ── */

function FormCancelar({ p, quien, onCancel, onHecho }: {
  p: PedidoDelivery; quien: string; onCancel: () => void; onHecho: (titulo: string, texto: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [detalle, setDetalle] = useState('');
  const [guardando, setGuardando] = useState(false);
  const esOtro = motivo === MOTIVOS_CANCELACION[MOTIVOS_CANCELACION.length - 1];
  // Pedido libre (por tomar): «No disponible» (02-11-2026). Uno mío en curso: «No puedo buscarlo».
  const libre = p.estado === 'por_tomar' || p.estado === 'cancelado' || !p.es_mio;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!libre && !p.pedido_id) return;
    if (!motivo) { toast('Elige el motivo.', 'error'); return; }
    if (esOtro && !detalle.trim()) { toast('Escribe cuál es el motivo.', 'error'); return; }
    setGuardando(true);
    try {
      if (libre) {
        await marcarNoDisponible(p.orden_id, p.tipo ?? 'oc', motivo, detalle.trim() || null);
        toast(`Marcaste ${ocDe(p)} como no disponible. Sigue libre para otro delivery.`, 'success');
        onHecho('Pedido no disponible', mensajeNoDisponible(p, quien, motivo, detalle));
        return;
      }
      await cancelarPedido(p.pedido_id!, motivo, detalle.trim() || null);
      toast(`Cancelaste la orden ${ocDe(p)}. Queda libre para otro delivery.`, 'success');
      onHecho('Pedido cancelado', mensajeCancelado(p, quien, motivo, detalle));
    } catch (err) {
      toast(errMsg(err, 'No se pudo cancelar el pedido'), 'error');
    } finally { setGuardando(false); }
  }

  return (
    <form className="surt-form" onSubmit={(e) => void guardar(e)}>
      <div className="surt-form-titulo">
        <span className="icono" aria-hidden>⛔</span>
        <div><strong>{libre ? 'No disponible' : 'No puedo buscarlo'}</strong><div className="muted" style={{ fontSize: '.85rem' }}>{ocDe(p)} · {p.proveedor_nombre ?? '—'}</div></div>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: '.88rem' }}>
        {libre ? 'El pedido sigue libre para otro delivery y sale el mensaje de WhatsApp con el motivo.' : 'La orden vuelve a quedar libre para que la tome otro delivery.'} Elige el motivo:
      </p>
      <div className="dlv-motivos" role="radiogroup" aria-label="Motivo">
        {MOTIVOS_CANCELACION.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={motivo === m}
            className={`dlv-motivo${motivo === m ? ' sel' : ''}`} onClick={() => setMotivo(m)}>
            <span aria-hidden>{motivo === m ? '●' : '○'}</span> {m}
          </button>
        ))}
      </div>
      <div className="surt-campo">
        <label htmlFor="dlv-cancel-detalle">Detalle {esOtro ? '(obligatorio)' : '(opcional)'}</label>
        <textarea id="dlv-cancel-detalle" className="input surt-input" rows={3} value={detalle}
          placeholder="Ej.: el proveedor dice que lo tiene mañana a las 9" onChange={(e) => setDetalle(e.target.value)} />
      </div>
      <div className="surt-grid2">
        <button type="button" className="btn btn-ghost btn-grande" onClick={onCancel} disabled={guardando}>← Volver</button>
        <button type="submit" className="btn btn-peligro btn-grande" disabled={guardando || !motivo}>
          {guardando ? 'Guardando…' : libre ? 'Confirmar: no disponible' : 'Confirmar cancelación'}
        </button>
      </div>
    </form>
  );
}

/* ── Entregado en almacén ── */

/** Dónde entrega el delivery (02-11-2026): solo LOS PINOS o MATANZA, como la recepción de Compras. */
const DESTINOS_ENTREGA = DESTINOS_RECEPCION.filter((d) => d.label === 'LOS PINOS' || d.label === 'MATANZA');

function FormEntregar({ p, quien, onCancel, onHecho }: {
  p: PedidoDelivery; quien: string;
  onCancel: () => void; onHecho: (titulo: string, texto: string) => void;
}) {
  // Propuesto: el almacén de la OC (o la sede de la SP) si es uno de los dos.
  const propuesto = DESTINOS_ENTREGA.find((d) => d.almacen === p.almacen_destino || d.sede === p.almacen_destino)?.almacen ?? '';
  const [almacen, setAlmacen] = useState(propuesto);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!p.pedido_id) return;
    if (!almacen) { toast('Indica si lo entregaste en LOS PINOS o en MATANZA.', 'error'); return; }
    setGuardando(true);
    const donde = nombreAlmacenVisible(almacen);
    // La OC queda recibida en inventario en ese almacén. Si no se puede (p. ej. un renglón
    // sin ficha), la entrega se registra igual y se avisa: Compras la recibe a mano.
    // 04-11-2026 (pedido de la administradora): ya NO se recibe sola al entregar. Queda
    // pendiente y le llega el aviso al almacenista de ese almacén (Los Pinos → Isner,
    // Matanza → Carlos), que la RECEPCIONA en su teléfono: ahí entra al inventario y
    // la orden queda recibida en Compras.
    const inventario = esRetiro(p) ? null : `pendiente de recepción por el almacenista de ${donde}`;
    try {
      await marcarEntregado(p.pedido_id, almacen, nota.trim() || null);
      if (!esRetiro(p)) {
        const correos = Object.entries(RESPALDO_POR_CORREO).filter(([, v]) => v.almacenRecepcion === almacen).map(([c]) => c);
        void avisarRecepcionPendiente(correos, { codigo: ocDe(p), repartidor: quien, almacen: donde }).catch(() => { /* el aviso es extra */ });
      }
      toast(`${ocDe(p)} entregada en ${donde}${esRetiro(p) ? '' : ': el almacenista la recepciona'}.`, 'success');
      onHecho('Entregado en almacén', mensajeEntregado(p, quien, donde, nota, null, inventario));
    } catch (err) {
      toast(errMsg(err, 'No se pudo marcar la entrega'), 'error');
    } finally { setGuardando(false); }
  }

  return (
    <form className="surt-form" onSubmit={(e) => void guardar(e)}>
      <div className="surt-form-titulo">
        <span className="icono" aria-hidden>📦</span>
        <div><strong>Entregado en almacén</strong><div className="muted" style={{ fontSize: '.85rem' }}>{ocDe(p)} · {p.proveedor_nombre ?? '—'}</div></div>
      </div>
      <div className="surt-campo">
        <span className="surt-rotulo" id="dlv-ent-almacen">¿Dónde lo entregaste?</span>
        <div className="surt-grid2" role="radiogroup" aria-labelledby="dlv-ent-almacen">
          {DESTINOS_ENTREGA.map((d) => (
            <button key={d.almacen} type="button" role="radio" aria-checked={almacen === d.almacen}
              className={`btn btn-grande ${almacen === d.almacen ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setAlmacen(d.almacen)}>
              🏬 {d.label}
            </button>
          ))}
        </div>
        <small className="muted">
          {esRetiro(p) ? 'Material de almacén: no se vuelve a recibir.' : 'Al confirmar, le llega el aviso al almacenista de ese almacén para que la recepcione en su teléfono.'}
          {p.almacen_destino ? ` La orden indica ${nombreAlmacenVisible(p.almacen_destino)}.` : ''}
        </small>
      </div>
      <div className="surt-campo">
        <label htmlFor="dlv-ent-nota">Nota (opcional)</label>
        <textarea id="dlv-ent-nota" className="input surt-input" rows={3} value={nota}
          placeholder="Ej.: lo recibió el almacenista; faltó un renglón" onChange={(e) => setNota(e.target.value)} />
      </div>
      {!p.fotos_entrega.length && (
        <div className="aviso warning sm"><span className="aviso-icono">📷</span><div>Todavía no subiste fotos de la entrega. Puedes volver y agregarlas antes de confirmar.</div></div>
      )}
      <div className="surt-grid2">
        <button type="button" className="btn btn-ghost btn-grande" onClick={onCancel} disabled={guardando}>← Volver</button>
        <button type="submit" className="btn btn-primary btn-grande" disabled={guardando || !almacen}>
          {guardando ? 'Guardando…' : '✅ Confirmar entrega'}
        </button>
      </div>
    </form>
  );
}

/* ── Comprobante de pago (Tesorería) ── */

function ComprobantePago({ p, onClose }: { p: PedidoDelivery; onClose: () => void }) {
  const [estado, setEstado] = useState<{ cargando: boolean; dato: ComprobantePagoDelivery | null; error: string | null }>({
    cargando: true, dato: null, error: null,
  });
  useEffect(() => {
    let vivo = true;
    comprobantePagoDelivery(p.orden_id)
      .then((dato) => { if (vivo) setEstado({ cargando: false, dato, error: null }); })
      .catch((e) => { if (vivo) setEstado({ cargando: false, dato: null, error: errMsg(e, 'No se pudo leer el pago de la orden.') }); });
    return () => { vivo = false; };
  }, [p.orden_id]);

  const { cargando, dato, error } = estado;
  let cuerpo: ReactNode;
  if (cargando) cuerpo = <p className="muted">Cargando el comprobante…</p>;
  else if (error) cuerpo = <div className="aviso danger sm"><span className="aviso-icono">⚠</span><div>{error}</div></div>;
  else if (!dato) {
    cuerpo = (
      <div className="aviso info sm"><span className="aviso-icono">🧾</span><div>Tesorería no adjuntó comprobante (pago en efectivo u otro).</div></div>
    );
  } else {
    cuerpo = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        <div className="surt-detalle">
          {dato.pagadaEn && <div className="surt-fila"><span>Pagada</span><span>{fechaHoraVE(dato.pagadaEn)}</span></div>}
          {dato.pagos.length
            ? dato.pagos.map((x, i) => (
              <div key={i} className="surt-fila"><span>{dato.pagos.length > 1 ? `Pago ${i + 1}` : 'Monto pagado'}</span><span>{montoTxt(x.monto, x.moneda)}</span></div>
            ))
            : <div className="surt-fila"><span>Total de la OC</span><span>{montoTxt(p.total, p.moneda)}</span></div>}
        </div>
        {dato.esPdf ? (
          <a className="btn btn-primary btn-grande" href={dato.url} target="_blank" rel="noopener noreferrer" style={{ justifyContent: 'center' }}>
            📄 Abrir PDF · {dato.nombre}
          </a>
        ) : (
          <a href={dato.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${dato.nombre}`}>
            <img src={dato.url} alt={dato.nombre} style={{ width: '100%', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }} />
          </a>
        )}
        <small className="muted">El enlace dura 10 minutos; si vence, cierra y vuelve a abrir el comprobante.</small>
      </div>
    );
  }

  return (
    <Modal title={`🧾 Comprobante de pago · ${ocDe(p)}`} onClose={onClose} minimizable={false}
      footer={<button type="button" className="btn btn-ghost btn-grande" onClick={onClose}>Cerrar</button>}>
      {cuerpo}
    </Modal>
  );
}

/* ── Compartir mi ubicación ── */

function CompartirUbicacion({ pedido }: { pedido: PedidoDelivery | null }) {
  const flota = useFlota();
  const [quiere, setQuiere] = useState(leerGps);
  const [enviado, setEnviado] = useState<{ t: number; precision: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 03-11-2026: se comparte también sin pedido en curso (la PC ve a todos los delivery en el mapa).
  const activo = quiere;

  const pedidoId = useRef<string | null>(null);
  useEffect(() => { pedidoId.current = pedido?.pedido_id ?? null; }, [pedido?.pedido_id]);

  useEffect(() => {
    if (!activo) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Este teléfono o navegador no permite compartir la ubicación.');
      return;
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setError('La ubicación solo funciona cuando la página abre con https.');
      return;
    }
    let ultimo: EnvioGps | null = null;
    let enviando = false;
    const id = navigator.geolocation.watchPosition((pos) => {
      const punto: EnvioGps = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now() };
      if (enviando || !debeEnviarUbicacion(ultimo, punto)) return;
      enviando = true;
      ultimo = punto;
      compartirUbicacion({
        lat: punto.lat, lng: punto.lng, precision: pos.coords.accuracy ?? null,
        velocidad: pos.coords.speed ?? null, rumbo: pos.coords.heading ?? null,
      }, pedidoId.current, flota)
        .then(() => { setEnviado({ t: punto.t, precision: pos.coords.accuracy ?? null }); setError(null); })
        .catch((e) => setError(errMsg(e, 'No se pudo compartir la ubicación.')))
        .finally(() => { enviando = false; });
    }, (e) => setError(errorUbicacion(e.code)), { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [activo, flota]);

  function cambiar() {
    const v = !quiere;
    setQuiere(v); guardarGps(v);
    if (!v) setError(null);
  }

  const hora = enviado ? new Date(enviado.t).toLocaleTimeString('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;

  return (
    <section className={`dlv-gps${activo && !error ? ' on' : ''}`} aria-label="Compartir mi ubicación">
      <div className="dlv-gps-fila">
        <div>
          <strong>📍 Compartir mi ubicación</strong>
          <div className="muted" style={{ fontSize: '.8rem' }}>
            {activo ? (pedido ? `Compartiendo con la oficina · ${ocDe(pedido)}` : 'Compartiendo con la oficina (sin pedido en curso)')
              : 'Apagada: la oficina no ve dónde estás.'}
          </div>
        </div>
        <button type="button" role="switch" aria-checked={quiere} aria-label="Compartir mi ubicación"
          className="dlv-switch" onClick={cambiar} />
      </div>
      {activo && hora && <small className="muted">Última enviada: {hora}{enviado?.precision != null ? ` (±${Math.round(enviado.precision)} m)` : ''}</small>}
      {activo && !hora && !error && <small className="muted">Buscando señal de GPS…</small>}
      {activo && error && <small className="error">{error}</small>}
    </section>
  );
}
