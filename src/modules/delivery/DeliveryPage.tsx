/* ============================================================
   MGG · Delivery · Panel central (30-10-2026)

   La OC que Tesorería pagó (la retención no es requisito, 01-11-2026) la toma UN
   motorizado desde su teléfono, va en ruta y la entrega en el almacén. Acá
   se sigue todo desde la PC:
     Tablero      → por tomar / aceptados / en camino / entregados hoy, con
                    fotos, comprobante de pago, WhatsApp y cancelar si se trabó
                    (31-10: «📄 Ver PDF» y «💬 WhatsApp» del pedido y de la lista)
     Mapa         → dónde está cada motorizado (Calles / Satelital)
     Histórico    → lo tomado en un rango de fechas, filtrable por delivery
     Por delivery → cuántos pedidos lleva cada uno y su tiempo promedio
   Construido pero DESCONECTADO hasta que la administradora lo active
   (config compras.delivery): mientras tanto las listas quedan vacías.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MODULO_FLOTA, RUTA_TELEFONO_FLOTA, TITULO_FLOTA, type Flota } from './flota';
import { nombreAlmacenVisible } from '@/modules/inventario/sectorizacion';
import { Link } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { listProveedores } from '@/modules/pedidos/pedidos.repository';
import { MensajeWhatsappModal } from '@/modules/pedidos/MensajeWhatsappModal';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useRecargaAlVolver } from './useRecargaAlVolver';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import {
  ESTADO_DELIVERY, MAX_FOTOS_DELIVERY, MOTIVOS_CANCELACION, UBICACION_VIEJA_MS, claveDe, esRetiro, fechaHoraVE, mensajeCancelado, minutosEntre, montoTxt, ocDe,
  type FotoDelivery, type PedidoDelivery, type UbicacionDelivery,
} from './delivery';
import {
  cancelarPedido, comprobantePagoDelivery, listHistorialDelivery, listPedidosDelivery, listUbicaciones, quitarFotoDelivery, subirFotosDelivery,
  urlFotoDelivery, useDeliveryConectado, useDestinosDelivery,
  type ComprobantePagoDelivery,
} from './delivery.repository';
import {
  RANGOS_DELIVERY, armarFilasHistorial, conteoPorEstado, duracionTxt, filtrarPorRepartidor, rangoDelivery,
  rangoDeliveryActivo, repartidoresDe, resumenHistorial, sePuedeCancelar, totalesResumen, type FilaHistorialDelivery,
} from './deliveryPanel';
import { DeliveryMapa } from './DeliveryMapa';
import { UbicarProveedoresModal } from './UbicarProveedoresModal';
import { DetalleDeliveryModal } from './DetalleDeliveryModal';
import type { DestinosDelivery } from './deliveryRutas';
import { pdfComprobanteDelivery, pdfHistorialDelivery, pdfListaDelivery, pdfPorDelivery } from './deliveryPdf';
import { mensajeHistorialDelivery, mensajeListaDelivery, mensajePorDelivery, mensajeReporteDelivery } from './deliveryReporte';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import './deliveryMovil.css';

// 10-11-2026 (maqueta de Delivery): «Centro de control» con el mapa en vivo adentro, y dos pestañas
// nuevas: repartidores conectados y trazabilidad con horarios. Sin avisos ni WhatsApp automáticos.
type Vista = 'tablero' | 'repartidores' | 'trazabilidad' | 'historico' | 'por_delivery';

const TABS: { key: Vista; label: string; icon: string }[] = [
  { key: 'tablero', label: 'Centro de control', icon: '🖥' },
  { key: 'repartidores', label: 'Repartidores conectados', icon: '🛵' },
  { key: 'trazabilidad', label: 'Trazabilidad y horarios', icon: '🧾' },
  { key: 'historico', label: 'Histórico', icon: '📜' },
  { key: 'por_delivery', label: 'Por delivery', icon: '📊' },
];

const msgError = (e: unknown, def: string) => (e instanceof Error ? e.message : def);

/** Abre un PDF en la vista previa (solo con el botón) y marca cuál se está generando. */
function abrirPdf(clave: string, generar: () => Promise<void>, setGenerando: (v: string | null) => void) {
  setGenerando(clave);
  generar()
    .catch((e) => toast(msgError(e, 'No se pudo generar el PDF.'), 'error'))
    .finally(() => setGenerando(null));
}

export function DeliveryPage() {
  const { can, isAdmin, vistasTelefono } = usePermissions();
  const conectado = useDeliveryConectado();
  // 04-11-2026: Delivery y Carga pesada (switch). Cada quien ve las flotas que tiene.
  const flotas = (['delivery', 'carga_pesada'] as Flota[]).filter((f) => isAdmin || can(MODULO_FLOTA[f], 'lectura'));
  const [flota, setFlota] = useState<Flota>(() => flotas[0] ?? 'delivery');
  const supervisor = isAdmin || can(MODULO_FLOTA[flota], 'full');
  const tieneTelefono = vistasTelefono.some((v) => v.key === flota);
  const [vista, setVista] = useState<Vista>('tablero');
  // 03-11-2026: proveedores y almacenes en el mapa (rutas tipo Yummy / Ridery).
  const puedeUbicar = isAdmin || can('proveedores', 'escritura') || can('delivery', 'full');
  const [destinos, setDestinos] = useDestinosDelivery();
  const [ubicar, setUbicar] = useState(false);

  /* ── Tablero: pedidos actuales (y cerrados si se piden) + lo de hoy ── */
  const hoy = useMemo(hoyVenezuela, []);
  const [verCerrados, setVerCerrados] = useState(false);
  const [pedidos, setPedidos] = useState<PedidoDelivery[]>([]);
  const [deHoy, setDeHoy] = useState<FilaHistorialDelivery[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  /* ── Histórico / Por delivery: rango compartido ── */
  const [desde, setDesde] = useState(() => rangoDelivery('semana', hoy).desde);
  const [hasta, setHasta] = useState(hoy);
  const [historial, setHistorial] = useState<FilaHistorialDelivery[]>([]);
  const [cargandoHist, setCargandoHist] = useState(false);
  const [proveedores, setProveedores] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    listProveedores()
      .then((ps) => setProveedores(new Map(ps.map((p) => [p.id, p.razon_social]))))
      .catch(() => { /* sin nombres: el histórico muestra «—» */ });
  }, []);

  const recargarTablero = useCallback(async () => {
    try {
      const [ps, hh] = await Promise.all([listPedidosDelivery(verCerrados, flota), listHistorialDelivery(hoy, hoy, flota)]);
      setPedidos(ps);
      setDeHoy(armarFilasHistorial(hh, proveedores));
      setErrorCarga(null);
    } catch (e) {
      setErrorCarga(msgError(e, 'No se pudieron leer los pedidos de Delivery.'));
    } finally { setCargando(false); }
  }, [verCerrados, hoy, proveedores, flota]);
  useEffect(() => { void recargarTablero(); }, [recargarTablero]);

  const enHistorico = vista === 'historico' || vista === 'por_delivery' || vista === 'trazabilidad';
  const recargarHistorial = useCallback(async () => {
    if (!desde || !hasta || desde > hasta) return;
    setCargandoHist(true);
    try {
      setHistorial(armarFilasHistorial(await listHistorialDelivery(desde, hasta, flota), proveedores));
    } catch (e) {
      toast(msgError(e, 'No se pudo leer el histórico.'), 'error');
    } finally { setCargandoHist(false); }
  }, [desde, hasta, proveedores, flota]);
  useEffect(() => { if (enHistorico) void recargarHistorial(); }, [enHistorico, recargarHistorial]);

  // Tiempo real: lo que hace el motorizado en su teléfono (o Tesorería al pagar) se ve sin recargar.
  // Las ubicaciones las escucha el propio mapa: llegan seguido y no cambian las listas.
  useRealtime(['delivery_pedidos', 'ordenes'], () => {
    void recargarTablero();
    if (enHistorico) void recargarHistorial();
  });
  // 07-11-2026: si se cortó el tiempo real (equipo suspendido), al volver y cada 45 s se pone al día.
  useRecargaAlVolver(recargarTablero);

  return (
    <div>
      <div className="dlv-centro-head">
        <div style={{ flex: '1 1 320px' }}>
          <h1>🖥 Centro de control y despacho · {TITULO_FLOTA[flota]}</h1>
          <p>
            Seguimiento en vivo de las órdenes que Compras confirmó para retiro: quién las toma, dónde va cada {flota === 'carga_pesada' ? 'camión' : 'motorizado'} y cuándo llegan al almacén.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {flotas.length > 1 && (
            <div className="dlv-pills" role="tablist" aria-label="Flota">
              {flotas.map((f) => (
                <button key={f} role="tab" aria-selected={flota === f} className={flota === f ? 'active' : ''} onClick={() => setFlota(f)}>
                  {TITULO_FLOTA[f]}
                </button>
              ))}
            </div>
          )}
          {tieneTelefono && <Link to={RUTA_TELEFONO_FLOTA[flota]} className="btn btn-ghost btn-sm">📱 Vista de teléfono</Link>}
        </div>
      </div>

      {conectado === false && (
        <div className="aviso info" style={{ marginBottom: '1rem' }}>
          <span className="aviso-icono">ℹ</span>
          <div>
            <strong>Delivery todavía no está conectado a Compras.</strong> Cuando la administradora lo active, acá llegarán las órdenes
            pagadas por Tesorería. Mientras tanto las listas quedan vacías.
          </div>
        </div>
      )}
      {errorCarga && conectado !== false && (
        <div className="aviso warning" style={{ marginBottom: '1rem' }}>
          <span className="aviso-icono">⚠</span><div>{errorCarga}</div>
        </div>
      )}

      <div className="view-toggle" role="tablist" aria-label="Vista de Delivery" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={vista === t.key} className={vista === t.key ? 'active' : ''} onClick={() => setVista(t.key)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {vista === 'tablero' && (
        <TableroTab pedidos={pedidos} deHoy={deHoy} cargando={cargando} supervisor={supervisor}
          verCerrados={verCerrados} setVerCerrados={setVerCerrados} onCambio={() => void recargarTablero()}
          mapa={<DeliveryMapa pedidos={pedidos} destinos={destinos} flota={flota} onUbicar={puedeUbicar ? () => setUbicar(true) : undefined} />} />
      )}
      {vista === 'repartidores' && <RepartidoresTab flota={flota} pedidos={pedidos} deHoy={deHoy} />}
      {ubicar && (
        <UbicarProveedoresModal pedidos={pedidos} destinos={destinos} onDestinos={setDestinos}
          puedeAlmacenes={supervisor} onClose={() => setUbicar(false)} />
      )}
      {enHistorico && (
        <BarraRango hoy={hoy} desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} cargando={cargandoHist} />
      )}
      {vista === 'trazabilidad' && <TrazabilidadTab filas={historial} cargando={cargandoHist} />}
      {vista === 'historico' && <HistoricoTab filas={historial} desde={desde} hasta={hasta} />}
      {vista === 'por_delivery' && <PorDeliveryTab filas={historial} desde={desde} hasta={hasta} destinos={destinos} />}
    </div>
  );
}

/* ───────────── Tablero ───────────── */

function TableroTab({ pedidos, deHoy, cargando, supervisor, verCerrados, setVerCerrados, onCambio, mapa }: {
  pedidos: PedidoDelivery[]; deHoy: FilaHistorialDelivery[]; cargando: boolean; supervisor: boolean;
  verCerrados: boolean; setVerCerrados: (v: boolean) => void; onCambio: () => void;
  /** El mapa en vivo (motorizados, proveedores y almacenes), debajo de las métricas. */
  mapa?: ReactNode;
}) {
  const c = conteoPorEstado(pedidos);
  const entregadosHoy = deHoy.filter((f) => f.estado === 'entregado').length;
  const canceladosHoy = deHoy.filter((f) => f.estado === 'cancelado').length;
  const urgentes = pedidos.filter((p) => p.estado === 'por_tomar' && p.urgente).length;
  const minutosHoy = deHoy.filter((f) => f.estado === 'entregado' && f.minutos != null).map((f) => f.minutos as number);
  const promedioHoy = minutosHoy.length ? Math.round(minutosHoy.reduce((a, b) => a + b, 0) / minutosHoy.length) : null;

  const [fotos, setFotos] = useState<PedidoDelivery | null>(null);
  const [whatsapp, setWhatsapp] = useState<{ titulo: string; texto: string } | null>(null);
  const [cancelar, setCancelar] = useState<PedidoDelivery | null>(null);
  const [comprobante, setComprobante] = useState<PedidoDelivery | null>(null);
  const [generando, setGenerando] = useState<string | null>(null);

  // Primero lo urgente y lo más viejo por tomar; después lo en curso; al final lo cerrado.
  const orden: Record<string, number> = { por_tomar: 0, aceptado: 1, en_ruta: 2, entregado: 3, cancelado: 4 };
  const lista = [...pedidos].sort((a, b) => (orden[a.estado] - orden[b.estado])
    || (Number(b.urgente) - Number(a.urgente))
    || String(a.pagada_en ?? a.aceptado_en ?? '').localeCompare(String(b.pagada_en ?? b.aceptado_en ?? '')));
  const filtro = verCerrados ? 'Todos (incluye entregados y cancelados)' : 'Por tomar y en curso';

  return (
    <>
      <div className="dlv-metricas">
        <div className="dlv-metrica naranja">
          <div className="ico" aria-hidden="true">💰</div>
          <div><div className="val">{c.por_tomar}</div><div className="lbl">Por tomar</div>
            <div className="sub">{urgentes ? `${urgentes} urgente(s)` : 'Confirmadas por Compras'}</div></div>
        </div>
        <div className="dlv-metrica azul">
          <div className="ico" aria-hidden="true">🚚</div>
          <div><div className="val">{c.aceptado + c.en_ruta}</div><div className="lbl">En tránsito</div>
            <div className="sub">{c.aceptado} tomado(s) · {c.en_ruta} en ruta</div></div>
        </div>
        <div className="dlv-metrica verde">
          <div className="ico" aria-hidden="true">✅</div>
          <div><div className="val">{entregadosHoy}</div><div className="lbl">Entregados hoy</div>
            <div className="sub">{canceladosHoy ? `${canceladosHoy} cancelado(s) hoy` : 'Sin cancelaciones hoy'}</div></div>
        </div>
        <div className="dlv-metrica morado">
          <div className="ico" aria-hidden="true">⏱</div>
          <div><div className="val">{promedioHoy != null ? duracionTxt(promedioHoy) : '—'}</div><div className="lbl">Tiempo promedio</div>
            <div className="sub">De tomado a entregado, hoy</div></div>
        </div>
      </div>

      {mapa && (
        <div className="card dlv-mapa-card">
          <div className="card-title">📍 Mapa GPS en vivo · Puerto Ordaz / San Félix</div>
          {mapa}
        </div>
      )}

      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
          <span>📦 Pedidos</span>
          <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontSize: '.85rem', fontWeight: 400 }}>
            <input type="checkbox" checked={verCerrados} onChange={(e) => setVerCerrados(e.target.checked)} />
            Ver también entregados y cancelados
          </label>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!generando || !lista.length}
            title="Reporte de la lista que se ve, en vista previa"
            onClick={() => abrirPdf('lista', () => pdfListaDelivery({ pedidos: lista, filtro }), setGenerando)}>
            {generando === 'lista' ? 'Generando…' : '📄 Ver PDF'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!lista.length}
            onClick={() => setWhatsapp({ titulo: 'Pedidos de Delivery', texto: mensajeListaDelivery({ pedidos: lista, filtro }) })}>
            💬 WhatsApp
          </button>
        </div>
        {cargando ? <p className="muted">Cargando…</p> : !lista.length ? (
          <p className="muted" style={{ margin: '.4rem 0' }}>No hay pedidos {verCerrados ? '' : 'por tomar ni en curso '}por ahora.</p>
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.85rem' }}>
              <thead>
                <tr>
                  <th>OC</th><th>Proveedor</th><th>Delivery</th><th>Estado</th><th>Tiempos</th><th>Monto</th><th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => {
                  const est = ESTADO_DELIVERY[p.estado];
                  const nFotos = p.fotos_recibo.length + p.fotos_entrega.length;
                  const clave = `${claveDe(p)}-${p.pedido_id ?? 'libre'}`;
                  const fin = p.estado === 'cancelado' ? p.cancelado_en : p.entregado_en;
                  return (
                    <tr key={clave}>
                      <td>
                        <strong>{ocDe(p)}</strong>
                        {p.urgente && <> <span className="badge danger">URGENTE</span></>}
                        {p.almacen_destino && <div className="muted" style={{ fontSize: '.75rem' }}>📍 Recepción: {nombreAlmacenVisible(p.almacen_destino)}</div>}
                      </td>
                      <td>
                        {p.proveedor_nombre ?? '—'}
                        {p.proveedor_direccion && <div className="muted" style={{ fontSize: '.75rem' }}>📍 {p.proveedor_direccion}</div>}
                      </td>
                      <td>{p.repartidor_nombre ?? <span className="muted">—</span>}</td>
                      <td>
                        <span className={`badge ${est?.badge ?? ''}`}>{est?.emoji} {est?.label ?? p.estado}</span>
                        {p.estado === 'cancelado' && p.motivo_cancel && <div className="muted" style={{ fontSize: '.75rem' }}>{p.motivo_cancel}</div>}
                      </td>
                      <td style={{ fontSize: '.78rem', whiteSpace: 'nowrap' }}>
                        {p.pagada_en && <div>{esRetiro(p) ? '🏬 Almacén revisó' : '💰 Pagada'} {fechaHoraVE(p.pagada_en)}</div>}
                        {p.aceptado_en && <div>🛵 Tomada {fechaHoraVE(p.aceptado_en)}</div>}
                        {p.en_ruta_en && <div>🚚 En camino {fechaHoraVE(p.en_ruta_en)}</div>}
                        {fin && <div>{p.estado === 'cancelado' ? '⛔' : '✅'} {fechaHoraVE(fin)}</div>}
                        {p.estado === 'entregado' && <div className="muted">⏳ {duracionTxt(minutosEntre(p.aceptado_en, p.entregado_en))}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{esRetiro(p) ? <span className="badge info">Retiro</span> : montoTxt(p.total, p.moneda)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '.3rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {!esRetiro(p) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setComprobante(p)} title="Comprobante que adjuntó Tesorería al pagar">🧾 Comprobante de pago</button>}
                          <button type="button" className="btn btn-ghost btn-sm" disabled={!nFotos && !(supervisor && p.estado === 'entregado')} onClick={() => setFotos(p)}
                            title={supervisor && p.estado === 'entregado' ? 'Ver o editar las fotos' : nFotos ? 'Ver fotos' : 'Sin fotos todavía'}>📷 {nFotos}</button>
                          <button type="button" className="btn btn-ghost btn-sm" disabled={!!generando} title="Comprobante del pedido en vista previa"
                            onClick={() => abrirPdf(clave, () => pdfComprobanteDelivery(p), setGenerando)}>
                            {generando === clave ? 'Generando…' : '📄 Ver PDF'}
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" title="Reporte del pedido con su estado y tiempos"
                            onClick={() => setWhatsapp({ titulo: `Reporte · ${ocDe(p)}`, texto: mensajeReporteDelivery(p) })}>
                            💬 WhatsApp
                          </button>
                          {supervisor && sePuedeCancelar(p) && (
                            <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setCancelar(p)}>⛔ Cancelar</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {fotos && <FotosModal pedido={fotos} editable={supervisor && fotos.estado === 'entregado'} onCambio={onCambio} onClose={() => setFotos(null)} />}
      {comprobante && <ComprobanteModal pedido={comprobante} onClose={() => setComprobante(null)} />}
      {whatsapp && <MensajeWhatsappModal titulo={whatsapp.titulo} texto={whatsapp.texto} onClose={() => setWhatsapp(null)} />}
      {cancelar && (
        <CancelarModal pedido={cancelar} onClose={() => setCancelar(null)}
          onCancelado={(texto) => { setCancelar(null); onCambio(); setWhatsapp({ titulo: 'Pedido cancelado', texto }); }} />
      )}
    </>
  );
}

/* ───────────── Fotos del pedido ───────────── */

/**
 * Las fotos del pedido. 03-11-2026 (pedido de la administradora): con la orden ya
 * ENTREGADA, el supervisor puede corregir las fotos que subió el delivery (agregar o
 * quitar). La base lo permite al supervisor y al delivery que la llevó.
 */
function FotosModal({ pedido, editable = false, onCambio, onClose }: {
  pedido: PedidoDelivery; editable?: boolean; onCambio?: () => void; onClose: () => void;
}) {
  const [recibo, setRecibo] = useState<FotoDelivery[]>(pedido.fotos_recibo);
  const [entrega, setEntrega] = useState<FotoDelivery[]>(pedido.fotos_entrega);
  const [ocupado, setOcupado] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const clave = [...recibo, ...entrega].map((f) => f.path).join('|');
  useEffect(() => {
    let vivo = true;
    const todas = [...recibo, ...entrega];
    void Promise.all(todas.map(async (f) => [f.path, await urlFotoDelivery(f.path).catch(() => '')] as const))
      .then((pares) => { if (vivo) setUrls(Object.fromEntries(pares)); });
    return () => { vivo = false; };
    // `clave` resume las rutas de las fotos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  const setDe = (tipo: 'recibo' | 'entrega') => (tipo === 'recibo' ? setRecibo : setEntrega);
  async function quitar(tipo: 'recibo' | 'entrega', actuales: FotoDelivery[], f: FotoDelivery) {
    if (!pedido.pedido_id || !window.confirm(`¿Quitar la foto «${f.filename}»?`)) return;
    setOcupado(true);
    try {
      setDe(tipo)(await quitarFotoDelivery(pedido.pedido_id, tipo, actuales, f.path));
      toast('Foto quitada.', 'success');
      onCambio?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo quitar la foto', 'error');
    } finally { setOcupado(false); }
  }
  async function agregar(tipo: 'recibo' | 'entrega', actuales: FotoDelivery[], lista: FileList | null) {
    const archivos = Array.from(lista ?? []);
    if (!archivos.length || !pedido.pedido_id) return;
    if (archivos.some((f) => !/^image\//.test(f.type) && !/\.(jpe?g|png|webp|gif|heic|heif|pdf)$/i.test(f.name))) {
      toast('Solo se pueden subir fotos o documentos (imágenes o PDF).', 'error');
      return;
    }
    if (actuales.length + archivos.length > MAX_FOTOS_DELIVERY) { toast(`Se pueden adjuntar hasta ${MAX_FOTOS_DELIVERY} fotos.`, 'error'); return; }
    setOcupado(true);
    try {
      setDe(tipo)(await subirFotosDelivery(pedido.pedido_id, tipo, actuales, archivos));
      toast(archivos.length === 1 ? 'Foto agregada.' : `${archivos.length} fotos agregadas.`, 'success');
      onCambio?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron subir las fotos', 'error');
    } finally { setOcupado(false); }
  }

  const grupo = (titulo: string, tipo: 'recibo' | 'entrega', fs: FotoDelivery[]) => (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
        <div className="card-title" style={{ fontSize: '.9rem' }}>{titulo} ({fs.length}/{MAX_FOTOS_DELIVERY})</div>
        {editable && fs.length < MAX_FOTOS_DELIVERY && (
          <label className="btn btn-ghost btn-sm" style={{ cursor: ocupado ? 'wait' : 'pointer' }}>
            {ocupado ? 'Guardando…' : '+ Agregar fotos'}
            <input type="file" accept="image/*,application/pdf" multiple hidden disabled={ocupado}
              onChange={(e) => { void agregar(tipo, fs, e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </div>
      {!fs.length ? <p className="muted" style={{ margin: 0 }}>Sin fotos.</p> : (
        <div style={{ display: 'grid', gap: '.6rem', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          {fs.map((f) => {
            const url = urls[f.path];
            const esPdf = /\.pdf$/i.test(f.filename || f.path);
            return (
              <div key={f.path} style={{ position: 'relative' }}>
                {url ? (
                  <button
                    type="button"
                    onClick={() => void previewFileUrl(url, f.filename, `Foto · ${ocDe(pedido)}`)}
                    title={`Ver en vista previa: ${f.filename}`}
                    style={{
                      padding: 0,
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--surface-2, #18202c)',
                      cursor: 'pointer',
                      width: '100%',
                      display: 'block',
                      textAlign: 'left',
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    {esPdf ? (
                      <div
                        style={{
                          height: 140,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '.35rem',
                          padding: '.6rem',
                          color: 'var(--text)',
                        }}
                      >
                        <span style={{ fontSize: '2.4rem' }}>📄</span>
                        <span style={{ fontSize: '.75rem', fontWeight: 600, textAlign: 'center', wordBreak: 'break-all', lineHeight: 1.2 }}>
                          {f.filename}
                        </span>
                        <small className="muted" style={{ fontSize: '.68rem' }}>Toca para ver PDF</small>
                      </div>
                    ) : (
                      <div style={{ position: 'relative', overflow: 'hidden' }}>
                        <img
                          src={url}
                          alt={f.filename}
                          style={{
                            width: '100%',
                            height: 140,
                            objectFit: 'cover',
                            display: 'block',
                            transition: 'transform 0.18s ease',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.04)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                        />
                        <div
                          style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
                            padding: '4px 6px',
                            color: '#fff',
                            fontSize: '.72rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '.3rem',
                          }}
                        >
                          <span>👁</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Vista previa</span>
                        </div>
                      </div>
                    )}
                  </button>
                ) : (
                  <div className="muted" style={{ height: 140, display: 'grid', placeItems: 'center', border: '1px dashed var(--border)', borderRadius: 8, fontSize: '.8rem' }}>
                    {f.path in urls ? 'No se pudo abrir' : 'Cargando…'}
                  </div>
                )}
                {editable && (
                  <button type="button" className="btn btn-sm" disabled={ocupado} onClick={() => { void quitar(tipo, fs, f); }}
                    style={{ position: 'absolute', top: 6, right: 6, background: 'var(--danger)', color: '#fff', zIndex: 2 }} aria-label={`Quitar ${f.filename}`}>
                    ✕ Quitar
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <Modal title={`📷 Fotos · ${ocDe(pedido)}`} size="lg" onClose={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void pdfComprobanteDelivery(pedido)}
            title="Ver comprobante de delivery con sus datos en PDF"
          >
            📄 Ver Comprobante (PDF)
          </button>
          <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
        </div>
      }>
      {editable && <p className="hint muted" style={{ marginTop: 0 }}>Orden entregada: puedes agregar o quitar las fotos que subió el delivery.</p>}
      {grupo('🧾 Factura (la ve Compras)', 'recibo', recibo)}
      {grupo('📷 Foto del producto', 'entrega', entrega)}
      {pedido.nota_entrega && <p><strong>Nota de entrega:</strong> {pedido.nota_entrega}</p>}
    </Modal>
  );
}

/* ───────────── Comprobante de pago (se lee al abrir) ───────────── */

function ComprobanteModal({ pedido, onClose }: { pedido: PedidoDelivery; onClose: () => void }) {
  const [estado, setEstado] = useState<{ cargando: boolean; dato: ComprobantePagoDelivery | null; error: string | null }>(
    { cargando: true, dato: null, error: null },
  );
  useEffect(() => {
    let vivo = true;
    comprobantePagoDelivery(pedido.orden_id)
      .then((dato) => { if (vivo) setEstado({ cargando: false, dato, error: null }); })
      .catch((e) => { if (vivo) setEstado({ cargando: false, dato: null, error: msgError(e, 'No se pudo leer el comprobante.') }); });
    return () => { vivo = false; };
  }, [pedido.orden_id]);
  const { cargando, dato, error } = estado;

  return (
    <Modal title={`🧾 Comprobante de pago · ${ocDe(pedido)}`} size={dato && !dato.esPdf ? 'lg' : 'sm'} onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      {cargando && <p className="muted">Buscando el comprobante…</p>}
      {error && <div className="aviso danger"><span className="aviso-icono">⚠</span><div>{error}</div></div>}
      {!cargando && !error && !dato && (
        <div className="aviso warning"><span className="aviso-icono">ℹ</span><div>Tesorería no adjuntó comprobante.</div></div>
      )}
      {dato && (
        <>
          <p style={{ margin: '0 0 .6rem' }}>
            {dato.pagadaEn && <>💰 Pagada el <strong>{fechaHoraVE(dato.pagadaEn)}</strong>. </>}
            {dato.pagos.length > 0 && <>Pagos: {dato.pagos.map((x) => montoTxt(x.monto, x.moneda)).join(' + ')}.</>}
          </p>
          {dato.esPdf ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void previewFileUrl(dato.url, dato.nombre, `Comprobante de pago · ${ocDe(pedido)}`)}
            >
              📄 Abrir PDF · {dato.nombre}
            </button>
          ) : (
            <button
              type="button"
              style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', display: 'block', margin: '0 auto' }}
              onClick={() => void previewFileUrl(dato.url, dato.nombre, `Comprobante de pago · ${ocDe(pedido)}`)}
              title="Abrir en vista previa"
            >
              <img src={dato.url} alt={dato.nombre} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', display: 'block', margin: '0 auto', borderRadius: 8 }} />
            </button>
          )}
        </>
      )}
    </Modal>
  );
}

/* ───────────── Cancelar un pedido trabado (supervisor) ───────────── */

function CancelarModal({ pedido, onClose, onCancelado }: {
  pedido: PedidoDelivery; onClose: () => void; onCancelado: (mensaje: string) => void;
}) {
  const [motivo, setMotivo] = useState(MOTIVOS_CANCELACION[0]);
  const [detalle, setDetalle] = useState('');
  const [guardando, setGuardando] = useState(false);
  const esOtro = motivo === MOTIVOS_CANCELACION[MOTIVOS_CANCELACION.length - 1];
  const falta = esOtro && !detalle.trim();

  async function confirmar() {
    if (!pedido.pedido_id || falta) return;
    setGuardando(true);
    try {
      await cancelarPedido(pedido.pedido_id, motivo, detalle.trim() || null);
      toast(`${ocDe(pedido)} cancelada: queda libre para otro delivery.`, 'success');
      onCancelado(mensajeCancelado(pedido, pedido.repartidor_nombre || 'Delivery', motivo, detalle, new Date().toISOString()));
    } catch (e) {
      toast(msgError(e, 'No se pudo cancelar el pedido.'), 'error');
    } finally { setGuardando(false); }
  }

  return (
    <Modal title={`⛔ Cancelar · ${ocDe(pedido)}`} size="sm" onClose={onClose}
      footer={(
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Volver</button>
          <button className="btn btn-danger" onClick={() => void confirmar()} disabled={guardando || falta}>{guardando ? 'Cancelando…' : 'Cancelar pedido'}</button>
        </>
      )}>
      <p style={{ marginTop: 0 }}>
        Lo tiene <strong>{pedido.repartidor_nombre ?? '—'}</strong> ({ESTADO_DELIVERY[pedido.estado].label.toLowerCase()}).
        Al cancelarlo, la orden queda disponible para otro delivery.
      </p>
      <div className="form-row">
        <label htmlFor="dlv-motivo">Motivo</label>
        <select id="dlv-motivo" className="select" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
          {MOTIVOS_CANCELACION.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="dlv-detalle">Detalle {esOtro ? '(obligatorio)' : '(opcional)'}</label>
        <textarea id="dlv-detalle" className="input" rows={3} value={detalle} onChange={(e) => setDetalle(e.target.value)}
          placeholder="Qué pasó, con quién se habló…" />
      </div>
    </Modal>
  );
}

/* ───────────── Rango de fechas (Histórico y Por delivery) ───────────── */

function BarraRango({ hoy, desde, hasta, setDesde, setHasta, cargando }: {
  hoy: string; desde: string; hasta: string; setDesde: (v: string) => void; setHasta: (v: string) => void; cargando: boolean;
}) {
  const activo = rangoDeliveryActivo(desde, hasta, hoy);
  return (
    <div className="card" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'flex-end', gap: '.8rem', flexWrap: 'wrap' }}>
      <div className="form-row" style={{ margin: 0 }}>
        <label htmlFor="dlv-desde" style={{ fontSize: '.72rem' }}>Desde</label>
        <input id="dlv-desde" className="input" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
      </div>
      <div className="form-row" style={{ margin: 0 }}>
        <label htmlFor="dlv-hasta" style={{ fontSize: '.72rem' }}>Hasta</label>
        <input id="dlv-hasta" className="input" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
        {RANGOS_DELIVERY.map((r) => (
          <button key={r.valor} type="button" className={`chip${activo === r.valor ? ' chip-active' : ''}`} aria-pressed={activo === r.valor}
            onClick={() => { const x = rangoDelivery(r.valor, hoy); setDesde(x.desde); setHasta(x.hasta); }}>
            {r.label}
          </button>
        ))}
      </div>
      {cargando && <span className="muted" style={{ fontSize: '.85rem' }}>Cargando…</span>}
    </div>
  );
}

/* ───────────── Histórico ───────────── */

function HistoricoTab({ filas, desde, hasta }: { filas: FilaHistorialDelivery[]; desde: string; hasta: string }) {
  const [repartidor, setRepartidor] = useState('');
  const repartidores = useMemo(() => repartidoresDe(filas), [filas]);
  const visibles = useMemo(() => filtrarPorRepartidor(filas, repartidor), [filas, repartidor]);
  const [generando, setGenerando] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);

  function pdf() {
    abrirPdf('historico', () => pdfHistorialDelivery({ desde, hasta, repartidor: repartidor || null, filas: visibles }), setGenerando);
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
        <span>📜 Histórico ({visibles.length})</span>
        <select className="select" style={{ width: 'auto', minWidth: 200 }} value={repartidor} onChange={(e) => setRepartidor(e.target.value)} aria-label="Filtrar por delivery">
          <option value="">Todos los delivery</option>
          {repartidores.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={!!generando || !visibles.length} onClick={pdf}
          title="Histórico del rango (y del delivery elegido) en vista previa">
          {generando ? 'Generando…' : '📄 Ver PDF'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!visibles.length}
          onClick={() => setWhatsapp(mensajeHistorialDelivery({ desde, hasta, repartidor: repartidor || null, filas: visibles }))}>
          💬 WhatsApp
        </button>
      </div>
      {whatsapp && <MensajeWhatsappModal titulo="Histórico de Delivery" texto={whatsapp} onClose={() => setWhatsapp(null)} />}
      {!visibles.length ? <p className="muted" style={{ margin: '.4rem 0' }}>No hay pedidos tomados en ese rango.</p> : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead>
              <tr>
                <th>Tomado</th><th>OC</th><th>Proveedor</th><th>Delivery</th><th>Estado</th><th>En ruta</th>
                <th>Entregado / Cancelado</th><th style={{ textAlign: 'right' }}>Tiempo</th><th>Almacén / Motivo</th><th style={{ textAlign: 'right' }}>Monto</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const est = ESTADO_DELIVERY[f.estado];
                return (
                  <tr key={f.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fechaHoraVE(f.fecha)}</td>
                    <td><strong>{f.oc}</strong></td>
                    <td>{f.proveedor}</td>
                    <td>{f.repartidor}</td>
                    <td><span className={`badge ${est?.badge ?? ''}`}>{est?.emoji} {est?.label ?? f.estado}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fechaHoraVE(f.en_ruta_en) || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fechaHoraVE(f.estado === 'cancelado' ? f.cancelado_en : f.entregado_en) || '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{duracionTxt(f.minutos)}</td>
                    <td>{(f.estado === 'cancelado' ? f.motivo_cancel : f.almacen_entrega) || '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{montoTxt(f.total, f.moneda)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ───────────── Por delivery ───────────── */

function PorDeliveryTab({ filas, desde, hasta, destinos }: {
  filas: FilaHistorialDelivery[]; desde: string; hasta: string; destinos: DestinosDelivery;
}) {
  const resumen = useMemo(() => resumenHistorial(filas), [filas]);
  // 03-11-2026: al tocar un delivery se abre su detalle (pedidos, tiempos y la ruta en el mapa).
  const [detalle, setDetalle] = useState<string | null>(null);
  const t = totalesResumen(resumen);
  const [generando, setGenerando] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);

  function pdf() {
    abrirPdf('por_delivery', () => pdfPorDelivery({ desde, hasta, resumen }), setGenerando);
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
        <span>🛵 Pedidos por delivery</span>
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={!!generando || !resumen.length} onClick={pdf}
          title="Resumen por delivery del rango en vista previa">
          {generando ? 'Generando…' : '📄 Ver PDF'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!resumen.length}
          onClick={() => setWhatsapp(mensajePorDelivery({ desde, hasta, resumen }))}>
          💬 WhatsApp
        </button>
      </div>
      {whatsapp && <MensajeWhatsappModal titulo="Pedidos por delivery" texto={whatsapp} onClose={() => setWhatsapp(null)} />}
      {detalle && (
        <DetalleDeliveryModal repartidor={detalle} filas={filtrarPorRepartidor(filas, detalle)}
          desde={desde} hasta={hasta} destinos={destinos} onClose={() => setDetalle(null)} />
      )}
      {!resumen.length ? <p className="muted" style={{ margin: '.4rem 0' }}>Ningún delivery tomó pedidos en ese rango.</p> : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.88rem' }}>
            <thead>
              <tr>
                <th>Delivery</th><th style={{ textAlign: 'right' }}>Entregados</th><th style={{ textAlign: 'right' }}>Cancelados</th>
                <th style={{ textAlign: 'right' }}>En curso</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Tiempo promedio</th>
              </tr>
            </thead>
            <tbody>
              {resumen.map((r) => (
                <tr key={r.repartidor} onClick={() => setDetalle(r.repartidor)} style={{ cursor: 'pointer' }}
                  title="Ver sus pedidos, tiempos y la ruta en el mapa">
                  <td><strong>{r.repartidor}</strong> <span className="muted" style={{ fontSize: '.78rem' }}>· ver detalle y ruta</span></td>
                  <td style={{ textAlign: 'right' }}>{r.entregados}</td>
                  <td style={{ textAlign: 'right' }}>{r.cancelados}</td>
                  <td style={{ textAlign: 'right' }}>{r.enCurso}</td>
                  <td style={{ textAlign: 'right' }}>{r.entregados + r.cancelados + r.enCurso}</td>
                  <td style={{ textAlign: 'right' }}>{duracionTxt(r.minutosPromedio)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td>Total</td>
                <td style={{ textAlign: 'right' }}>{t.entregados}</td>
                <td style={{ textAlign: 'right' }}>{t.cancelados}</td>
                <td style={{ textAlign: 'right' }}>{t.enCurso}</td>
                <td style={{ textAlign: 'right' }}>{t.entregados + t.cancelados + t.enCurso}</td>
                <td style={{ textAlign: 'right' }}>{duracionTxt(t.minutosPromedio)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="hint muted" style={{ margin: '.5rem 0 0', fontSize: '.8rem' }}>
        Tiempo promedio = desde que el delivery toma el pedido hasta que lo entrega en el almacén. Cada cancelación cuenta, aunque la orden la haya retomado otro.
      </p>
    </div>
  );
}

/* ───────────── Repartidores conectados (10-11-2026) ───────────── */

/** Hace cuánto llegó la última ubicación, en palabras cortas. */
function haceTxt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h` : fechaHoraVE(iso);
}

/**
 * Cada delivery de la flota: si su GPS está al día, qué pedido lleva y cómo le fue hoy.
 * Sale de las ubicaciones que comparte el teléfono y de los pedidos (nada se inventa).
 */
function RepartidoresTab({ flota, pedidos, deHoy }: { flota: Flota; pedidos: PedidoDelivery[]; deHoy: FilaHistorialDelivery[] }) {
  const [ubic, setUbic] = useState<UbicacionDelivery[]>([]);
  const [cargando, setCargando] = useState(true);
  const cargar = useCallback(async () => {
    try { setUbic(await listUbicaciones(flota)); } catch { /* sin ubicaciones: solo pedidos */ } finally { setCargando(false); }
  }, [flota]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['delivery_ubicaciones'], () => { void cargar(); });
  // Refresca el «hace X min» aunque no lleguen ubicaciones nuevas.
  const [, setTic] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setTic((n) => n + 1), 30000); return () => window.clearInterval(t); }, []);

  const filas = useMemo(() => {
    const norm = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();
    const mapa = new Map<string, { nombre: string; u: UbicacionDelivery | null; enCurso: PedidoDelivery[]; entregados: number; minutos: number[] }>();
    const fila = (nombre: string) => {
      const k = norm(nombre) || '—';
      if (!mapa.has(k)) mapa.set(k, { nombre: nombre || '—', u: null, enCurso: [], entregados: 0, minutos: [] });
      return mapa.get(k)!;
    };
    for (const u of ubic) { const f = fila(u.repartidor_nombre ?? u.repartidor_email ?? '—'); if (!f.u || f.u.actualizado_en < u.actualizado_en) f.u = u; }
    for (const p of pedidos) if ((p.estado === 'aceptado' || p.estado === 'en_ruta') && p.repartidor_nombre) fila(p.repartidor_nombre).enCurso.push(p);
    for (const h of deHoy) {
      if (h.estado !== 'entregado' || !h.repartidor || h.repartidor === '—') continue;
      const f = fila(h.repartidor); f.entregados++; if (h.minutos != null) f.minutos.push(h.minutos);
    }
    return [...mapa.values()].sort((a, b) => b.enCurso.length - a.enCurso.length || String(b.u?.actualizado_en ?? '').localeCompare(String(a.u?.actualizado_en ?? '')));
  }, [ubic, pedidos, deHoy]);

  if (cargando && !filas.length) return <p className="muted">Cargando…</p>;
  if (!filas.length) return <div className="card"><p className="muted" style={{ margin: 0 }}>Todavía no hay repartidores con ubicación ni pedidos hoy.</p></div>;
  return (
    <div className="dlv-repartidores">
      {filas.map((r) => {
        const conSenal = !!r.u && Date.now() - new Date(r.u.actualizado_en).getTime() <= UBICACION_VIEJA_MS;
        const prom = r.minutos.length ? Math.round(r.minutos.reduce((a, b) => a + b, 0) / r.minutos.length) : null;
        const vel = r.u?.velocidad != null && r.u.velocidad > 0 ? Math.round(r.u.velocidad * 3.6) : null;
        return (
          <div key={r.nombre} className="dlv-repartidor">
            <div className="fila">
              <div className={`dlv-avatar${conSenal ? '' : ' sin-senal'}`} aria-hidden>{flota === 'carga_pesada' ? '🚚' : '🛵'}</div>
              <div style={{ minWidth: 0 }}>
                <div className="nombre">{r.nombre}</div>
                <span className={`dlv-gps-pill${conSenal ? ' on' : ''}`}>{conSenal ? '● GPS al día' : r.u ? '○ Sin señal reciente' : '○ Sin GPS compartido'}</span>
              </div>
            </div>
            <div className="dato">📡 Última ubicación: <strong>{haceTxt(r.u?.actualizado_en)}</strong>{vel != null ? <> · <strong>{vel} km/h</strong></> : null}</div>
            <div className="dato">
              {r.enCurso.length
                ? <>🚚 Lleva: {r.enCurso.map((p) => <strong key={claveDe(p)} style={{ marginRight: '.35rem' }}>{ocDe(p)} ({ESTADO_DELIVERY[p.estado]?.label ?? p.estado})</strong>)}</>
                : <>✅ Libre</>}
            </div>
            <div className="dato">📦 Entregados hoy: <strong>{r.entregados}</strong>{prom != null ? <> · ⏱ promedio <strong>{duracionTxt(prom)}</strong></> : null}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────── Trazabilidad y horarios (10-11-2026) ───────────── */

/** Cada pedido del rango con sus horas: tomado → en ruta → entregado (o cancelado) y cuánto tardó. */
function TrazabilidadTab({ filas, cargando }: { filas: FilaHistorialDelivery[]; cargando: boolean }) {
  const lista = useMemo(() => [...filas].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))), [filas]);
  if (cargando && !lista.length) return <p className="muted">Cargando…</p>;
  if (!lista.length) return <div className="card"><p className="muted" style={{ margin: 0 }}>No hay pedidos en el rango elegido.</p></div>;
  return (
    <ul className="dlv-traza">
      {lista.map((f) => {
        const est = ESTADO_DELIVERY[f.estado];
        const enRuta = f.en_ruta_en ? minutosEntre(f.fecha, f.en_ruta_en) : null;
        return (
          <li key={f.id}>
            <div className="cab">
              <div><span className="oc">{f.oc}</span> · {f.proveedor}</div>
              <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: '.82rem' }}>🛵 {f.repartidor}</span>
                <span className={`dlv-pill est-${f.estado}`}>{est?.emoji} {est?.label ?? f.estado}</span>
              </div>
            </div>
            <div className="dlv-linea">
              <span className="paso">🛵 Tomado {fechaHoraVE(f.fecha)}</span>
              {f.en_ruta_en && <><span className="flecha">→ {duracionTxt(enRuta)} →</span><span className="paso">🚚 En ruta {fechaHoraVE(f.en_ruta_en)}</span></>}
              {f.entregado_en && <><span className="flecha">→</span><span className="paso fin">📦 Entregado {fechaHoraVE(f.entregado_en)}{f.almacen_entrega ? ` · ${nombreAlmacenVisible(f.almacen_entrega)}` : ''}</span></>}
              {f.cancelado_en && <><span className="flecha">→</span><span className="paso cancel">⛔ Cancelado {fechaHoraVE(f.cancelado_en)}{f.motivo_cancel ? ` · ${f.motivo_cancel}` : ''}</span></>}
              {f.minutos != null && <span className="muted" style={{ marginLeft: 'auto' }}>⏱ Total: <strong>{duracionTxt(f.minutos)}</strong></span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
