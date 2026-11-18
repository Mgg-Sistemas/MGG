/* ============================================================
   MGG · Delivery · Panel central (31/10/2026)

   La OC de productos que Tesorería pagó la toma UN motorizado desde su
   teléfono, va en ruta y la entrega en el almacén. Acá se sigue todo desde
   la PC:
     Tablero      → por tomar / aceptados / en camino / entregados hoy, con
                    fotos, comprobante de pago, WhatsApp, reporte del pedido
                    (PDF y WhatsApp) y cancelar si se trabó
     Mapa         → dónde está cada motorizado (Calles / Satelital)
     Histórico    → lo tomado en un rango de fechas, filtrable por estado y
                    delivery, con el reporte en PDF (vista previa) y WhatsApp
     Por delivery → cuántos pedidos lleva cada uno y su tiempo promedio
   Construido pero DESCONECTADO hasta que la administración lo active
   (interruptor compras_delivery): mientras tanto las listas quedan vacías.
   En GT la OC entra apenas queda pagada (sin esperar la
   retención) y solo las creadas desde que se encendió.
   02/11/2026: también los RETIROS EN ALMACÉN LOS PINOS (📦, lo que la
   revisión de Almacén marcó como disponible: sin monto ni comprobante, se
   entrega A la unidad / persona); filtro por origen en Histórico; al aceptar
   queda directo «En camino»; los «No disponible» del motorizado se ven con
   su motivo en el Tablero.
   ============================================================ */
import { etiquetaSedeEntrega } from '@/shared/lib/types';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { listProveedores } from '@/modules/pedidos/pedidos.repository';
import { useRealtime } from '@/shared/lib/useRealtime';
import { CANALES_DELIVERY, tituloPantallaCanal, type CanalDelivery } from './delivery';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { quienSync, useQuien } from '@/shared/lib/directorioUsuarios';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import {
  ALMACEN_RETIRO, ESTADO_DELIVERY, UBICACION_VIEJA_MS, cerradoPorRecepcion, MOTIVOS_CANCELACION, ORIGEN_DELIVERY, claveDelivery, destinoRetiro, esRetiroAlmacen,
  esRetornoPendiente, etiquetaEstado, fechaHoraVE, mensajeCancelado, minutosEntre, montoTxt, ocDe, rechazosDe, rotuloFotos,
  type FotoDelivery, type PedidoDelivery, type RechazoDelivery, type UbicacionDelivery,
} from './delivery';
import {
  cancelarPedido, listHistorialDelivery, listPedidosDelivery, listRechazosDelivery, listUbicaciones, urlFotoDelivery, useDeliveryConectado,
  type FilaHistorialCruda,
} from './delivery.repository';
import {
  RANGOS_DELIVERY, armarFilasHistorial, conteoPorEstado, duracionTxt, mensajeDelPedido, rangoDelivery,
  rangoDeliveryActivo, repartidoresDe, resumenHistorial, sePuedeCancelar, totalesResumen, minutosPromedio, minutosTxt, type FilaHistorialDelivery,
} from './deliveryPanel';
import {
  ESTADOS_FILTRO, ORIGENES_FILTRO, filtrarHistorial, textoReporteGeneral, textoReportePedido,
  type FiltroEstadoDelivery, type FiltroOrigenDelivery,
} from './deliveryReporte';
import { DeliveryMapa } from './DeliveryMapa';
import { previewGaleria, type PreviewImagenItem } from '@/shared/lib/reportePreview';
import { pdfFotosDelivery, pdfHistorialDelivery, pdfPedidoDelivery, pdfPorDelivery } from './deliveryPdf';
import { WhatsappDeliveryModal } from './WhatsappDeliveryModal';
import { ComprobantePagoCuerpo } from './ComprobantePagoDelivery';
import { EditarFotosDeliveryModal, puedeEditarFotosDelivery } from './EditarFotosDelivery';
import { obtenerDiferenciador, guardarAliasRepartidor } from './deliveryIdentificadores';
import './deliveryPanel.css';

// 10/11/2026 (como MGG, maqueta de Delivery): «Centro de control» con el mapa en vivo adentro y dos
// pestañas nuevas: repartidores conectados y trazabilidad con horarios. Sin avisos ni WhatsApp automáticos.
type Vista = 'tablero' | 'repartidores' | 'trazabilidad' | 'historico' | 'por_delivery';

const TABS: { key: Vista; label: string; icon: string }[] = [
  { key: 'tablero', label: 'Centro de control', icon: '🖥' },
  { key: 'repartidores', label: 'Repartidores conectados', icon: '🛵' },
  { key: 'trazabilidad', label: 'Trazabilidad y horarios', icon: '🧾' },
  { key: 'historico', label: 'Histórico', icon: '📜' },
  { key: 'por_delivery', label: 'Por delivery', icon: '📊' },
];

const msgError = (e: unknown, def: string) => (e instanceof Error ? e.message : def);

/** GT: el histórico muestra nombre y apellido aunque la toma solo guardara el correo. */
function filasConNombres(rows: FilaHistorialCruda[], proveedores: Map<string, string>): FilaHistorialDelivery[] {
  return armarFilasHistorial(rows, proveedores).map((f) => (f.repartidor.includes('@')
    ? { ...f, repartidor: quienSync(null, f.repartidor) || f.repartidor } : f));
}

export function DeliveryPage({ canal: canalInicial = 'delivery' }: { canal?: CanalDelivery } = {}) {
  // 05/11/2026 (como MGG): Delivery y Carga pesada son dos segmentos de esta misma
  // página; cada quien ve las flotas que su rol tiene.
  const { can, isAdmin, vistasTelefono } = usePermissions();
  const flotas = (Object.keys(CANALES_DELIVERY) as CanalDelivery[]).filter((f) => isAdmin || can(CANALES_DELIVERY[f].modulo));
  const [canal, setCanal] = useState<CanalDelivery>(() => (flotas.includes(canalInicial) ? canalInicial : (flotas[0] ?? 'delivery')));
  const cfgCanal = CANALES_DELIVERY[canal];
  const conectado = useDeliveryConectado();
  const supervisor = isAdmin || can(cfgCanal.modulo, 'full');
  const tieneTelefono = vistasTelefono.some((v) => v.key === canal);
  const puedeAmbos = flotas.length > 1;
  const [vista, setVista] = useState<Vista>('tablero');
  const [repartidorEnfocar, setRepartidorEnfocar] = useState<string | null>(null);

  /* ── Tablero: pedidos actuales (y cerrados si se piden) + lo de hoy ── */
  const hoy = useMemo(hoyVenezuela, []);
  const [verCerrados, setVerCerrados] = useState(false);
  const [pedidos, setPedidos] = useState<PedidoDelivery[]>([]);
  const [rechazos, setRechazos] = useState<RechazoDelivery[]>([]);
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
      const [ps, hh] = await Promise.all([listPedidosDelivery(verCerrados, canal), listHistorialDelivery(hoy, hoy, canal)]);
      // Los «No disponible» de lo que se ve (no frenan el tablero si fallan).
      setRechazos(await listRechazosDelivery(ps.map((p) => p.orden_id)).catch(() => []));
      setPedidos(ps);
      setDeHoy(filasConNombres(hh, proveedores));
      setErrorCarga(null);
    } catch (e) {
      setErrorCarga(msgError(e, 'No se pudieron leer los pedidos de Delivery.'));
    } finally { setCargando(false); }
  }, [verCerrados, hoy, proveedores, canal]);
  useEffect(() => { void recargarTablero(); }, [recargarTablero]);

  const enHistorico = vista === 'historico' || vista === 'por_delivery' || vista === 'trazabilidad';
  const recargarHistorial = useCallback(async () => {
    if (!desde || !hasta || desde > hasta) return;
    setCargandoHist(true);
    try {
      setHistorial(filasConNombres(await listHistorialDelivery(desde, hasta, canal), proveedores));
    } catch (e) {
      toast(msgError(e, 'No se pudo leer el histórico.'), 'error');
    } finally { setCargandoHist(false); }
  }, [desde, hasta, proveedores, canal]);
  useEffect(() => { if (enHistorico) void recargarHistorial(); }, [enHistorico, recargarHistorial]);

  // Tiempo real: lo que hace el motorizado en su teléfono (o Tesorería al pagar) se ve sin recargar.
  // Las ubicaciones las escucha el propio mapa: llegan seguido y no cambian las listas.
  useRealtime(['delivery_pedidos', 'delivery_rechazos', 'ordenes', 'solicitudes_revision_almacen'], () => {
    void recargarTablero();
    if (enHistorico) void recargarHistorial();
  });

  return (
    <div>
      {/* 10/11/2026 (como MGG): cabecera del Centro de control con el segmento de flota. */}
      <div className="dlv-centro-head">
        <div style={{ flex: '1 1 320px' }}>
          <h1>🖥 Centro de control y despacho · {cfgCanal.icono} {tituloPantallaCanal(canal)}</h1>
          <p>
            Seguimiento en vivo de las órdenes pagadas y de los retiros en {ALMACEN_RETIRO}: quién las toma, dónde va
            cada {canal === 'carga_pesada' ? 'camión' : 'motorizado'} y cuándo llegan al almacén.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {puedeAmbos && (
            <div className="dlv-pills" role="tablist" aria-label="Delivery o Carga pesada">
              {flotas.map((k) => (
                <button key={k} type="button" role="tab" aria-selected={k === canal} onClick={() => setCanal(k)}
                  className={k === canal ? 'active' : ''}>{CANALES_DELIVERY[k].icono} {CANALES_DELIVERY[k].titulo}</button>
              ))}
            </div>
          )}
          {tieneTelefono && <Link to={cfgCanal.rutaTelefono} className="btn btn-ghost btn-sm">📱 Vista de teléfono</Link>}
        </div>
      </div>

      {conectado === false && (
        <div className="aviso info" style={{ marginBottom: '1rem' }}>
          <span className="aviso-icono">ℹ</span>
          <div>
            <strong>Delivery todavía no está conectado a Compras.</strong> Cuando la administración lo active, acá llegarán las órdenes
            de productos que Tesorería pague desde ese momento (sin esperar la retención). Mientras tanto las listas quedan vacías.
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
        <TableroTab
          pedidos={pedidos}
          rechazos={rechazos}
          deHoy={deHoy}
          cargando={cargando}
          supervisor={supervisor}
          verCerrados={verCerrados}
          setVerCerrados={setVerCerrados}
          onCambio={() => void recargarTablero()}
          canal={canal}
          repartidorEnfocar={repartidorEnfocar}
          setRepartidorEnfocar={setRepartidorEnfocar}
        />
      )}
      {vista === 'repartidores' && (
        <RepartidoresTab
          canal={canal}
          pedidos={pedidos}
          deHoy={deHoy}
          onVerEnMapa={(repId) => {
            setRepartidorEnfocar(repId);
            setVista('tablero');
          }}
        />
      )}
      {enHistorico && (
        <BarraRango hoy={hoy} desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} cargando={cargandoHist} />
      )}
      {vista === 'trazabilidad' && <TrazabilidadTab filas={historial} cargando={cargandoHist} />}
      {vista === 'historico' && <HistoricoTab filas={historial} desde={desde} hasta={hasta} />}
      {vista === 'por_delivery' && <PorDeliveryTab filas={historial} desde={desde} hasta={hasta} />}
    </div>
  );
}

/* ───────────── Tablero ───────────── */

function TableroTab({
  pedidos,
  rechazos,
  deHoy,
  cargando,
  supervisor,
  verCerrados,
  setVerCerrados,
  onCambio,
  canal,
  repartidorEnfocar,
  setRepartidorEnfocar,
}: {
  pedidos: PedidoDelivery[];
  rechazos: RechazoDelivery[];
  deHoy: FilaHistorialDelivery[];
  cargando: boolean;
  supervisor: boolean;
  verCerrados: boolean;
  setVerCerrados: (v: boolean) => void;
  onCambio: () => void;
  canal: CanalDelivery;
  repartidorEnfocar: string | null;
  setRepartidorEnfocar: (id: string | null) => void;
}) {
  const quien = useQuien();
  const c = conteoPorEstado(pedidos);
  const entregadosHoy = deHoy.filter((f) => f.estado === 'entregado').length;
  const canceladosHoy = deHoy.filter((f) => f.estado === 'cancelado').length;
  const promedioHoy = minutosPromedio(deHoy);
  const urgentes = pedidos.filter((p) => p.estado === 'por_tomar' && p.urgente).length;
  const retirosPorTomar = pedidos.filter((p) => p.estado === 'por_tomar' && esRetiroAlmacen(p)).length;

  const [fotos, setFotos] = useState<PedidoDelivery | null>(null);
  const [whatsapp, setWhatsapp] = useState<{ titulo: string; texto: string } | null>(null);
  const [cancelar, setCancelar] = useState<PedidoDelivery | null>(null);
  const [comprobante, setComprobante] = useState<PedidoDelivery | null>(null);
  const [generando, setGenerando] = useState<string | null>(null);

  // Primero lo urgente y lo más viejo por tomar; después lo en curso; al final lo cerrado.
  const orden: Record<string, number> = { por_tomar: 0, aceptado: 1, en_ruta: 2, entregado: 3, cancelado: 4 };
  const lista = [...pedidos].sort((a, b) => (orden[a.estado] - orden[b.estado])
    || (Number(b.urgente) - Number(a.urgente))
    || String(a.pagada_en ?? a.revisada_en ?? a.aceptado_en ?? '').localeCompare(String(b.pagada_en ?? b.revisada_en ?? b.aceptado_en ?? '')));

  function pdfPedido(p: PedidoDelivery) {
    const k = `${claveDelivery(p)}-${p.pedido_id ?? 'libre'}`;
    setGenerando(k);
    pdfPedidoDelivery(p)
      .catch((e) => toast(msgError(e, 'No se pudo generar el PDF.'), 'error'))
      .finally(() => setGenerando(null));
  }

  return (
    <>
      {/* 10/11/2026 (como MGG): métricas del Centro de control y el mapa en vivo debajo. */}
      <div className="dlv-metricas">
        <div className="dlv-metrica naranja">
          <div className="ico" aria-hidden="true">💰</div>
          <div><div className="val">{c.por_tomar}</div><div className="lbl">Por tomar</div>
            <div className="sub">{[urgentes ? `${urgentes} urgente(s)` : 'Pagadas y retiros', retirosPorTomar ? `📦 ${retirosPorTomar} en Almacén` : '', rechazos.length ? `✕ ${rechazos.length} no disponible` : ''].filter(Boolean).join(' · ')}</div></div>
        </div>
        <div className="dlv-metrica azul">
          <div className="ico" aria-hidden="true">🚚</div>
          {/* 02/11/2026: al aceptar queda directo «En camino» (los «Aceptado» son de antes). */}
          <div><div className="val">{c.en_ruta + c.aceptado}</div><div className="lbl">En tránsito</div>
            <div className="sub">Aceptados por un delivery, sin entregar</div></div>
        </div>
        <div className="dlv-metrica verde">
          <div className="ico" aria-hidden="true">✅</div>
          <div><div className="val">{entregadosHoy}</div><div className="lbl">Entregados hoy</div>
            <div className="sub">{canceladosHoy ? `${canceladosHoy} cancelado(s) hoy` : 'Sin cancelaciones hoy'}</div></div>
        </div>
        <div className="dlv-metrica morado">
          <div className="ico" aria-hidden="true">⏱</div>
          <div><div className="val">{minutosTxt(promedioHoy)}</div><div className="lbl">Tiempo promedio</div>
            <div className="sub">De tomado a entregado, hoy</div></div>
        </div>
      </div>

      <div className="card dlv-mapa-card">
        <DeliveryMapa pedidos={pedidos} canal={canal} repartidorEnfocar={repartidorEnfocar} />
      </div>

      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
          <span>📦 Pedidos</span>
          <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontSize: '.85rem', fontWeight: 400 }}>
            <input type="checkbox" checked={verCerrados} onChange={(e) => setVerCerrados(e.target.checked)} />
            Ver también entregados y cancelados
          </label>
        </div>
        {cargando ? <p className="muted">Cargando…</p> : !lista.length ? (
          <p className="muted" style={{ margin: '.4rem 0' }}>No hay pedidos {verCerrados ? '' : 'por tomar ni en curso '}por ahora.</p>
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.85rem' }}>
              <thead>
                <tr>
                  <th>OC / SP</th><th>Proveedor / Origen</th><th>Delivery</th><th>Estado</th><th>Tiempos</th><th>Monto</th><th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => {
                  const retiro = esRetiroAlmacen(p);
                  const est = ESTADO_DELIVERY[p.estado];
                  const nFotos = p.fotos_recibo.length + p.fotos_entrega.length + p.fotos_factura.length;
                  const msg = mensajeDelPedido(p);
                  const fin = p.estado === 'cancelado' ? p.cancelado_en : p.entregado_en;
                  const clave = `${claveDelivery(p)}-${p.pedido_id ?? 'libre'}`;
                  const noDisp = rechazosDe(p, rechazos);
                  const destino = retiro ? (p.almacen_entrega || destinoRetiro(p)) : p.almacen_destino;
                  const dif = p.repartidor_id ? obtenerDiferenciador(p.repartidor_id, p.repartidor_nombre, canal) : null;
                  return (
                    <tr key={clave}>
                      <td>
                        <strong>{retiro ? p.codigo : ocDe(p)}</strong>
                        {p.urgente && <> <span className="badge danger">URGENTE</span></>}
                        {destino && <div className="muted" style={{ fontSize: '.75rem' }}>🏬 {retiro ? `Entregar a: ${destino}` : destino}</div>}
                        {!retiro && etiquetaSedeEntrega(p.sede_entrega) && <div className="muted" style={{ fontSize: '.75rem' }}>📍 Recepción: <strong>Almacén {etiquetaSedeEntrega(p.sede_entrega)}</strong></div>}
                      </td>
                      <td>
                        {retiro ? <span className="badge info">{ORIGEN_DELIVERY.almacen.emoji} Retiro en {ALMACEN_RETIRO}</span> : (p.proveedor_nombre ?? '—')}
                        {!retiro && p.proveedor_direccion && <div className="muted" style={{ fontSize: '.75rem' }}>📍 {p.proveedor_direccion}</div>}
                        {retiro && p.analista_nombre && <div className="muted" style={{ fontSize: '.75rem' }}>Revisó: {p.analista_nombre}</div>}
                      </td>
                      <td>
                        {p.repartidor_nombre ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            {dif && (
                              <span className="dlv-badge-id" style={{ background: dif.color }}>
                                {dif.codigo}
                              </span>
                            )}
                            <strong>{dif?.nombreVisible ?? quien(p.repartidor_nombre)}</strong>
                            {p.repartidor_id && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                style={{ padding: '0 6px', fontSize: '.72rem', height: 22 }}
                                onClick={() => {
                                  setRepartidorEnfocar(p.repartidor_id);
                                  window.scrollTo({ top: 180, behavior: 'smooth' });
                                }}
                                title="Enfocar ruta en el mapa del controlador"
                              >
                                🎯 Ver
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                        {noDisp.map((r) => (
                          <div key={r.id} className="muted" style={{ fontSize: '.75rem', color: 'var(--danger)' }}
                            title={`${fechaHoraVE(r.created_at)} · ${r.motivo}`}>
                            ✕ No disponible: {r.repartidor_nombre ? quien(r.repartidor_nombre) : (r.repartidor_email ?? '—')} — {r.motivo}
                          </div>
                        ))}
                      </td>
                      <td>
                        <span className={`badge ${est?.badge ?? ''}`}>{cerradoPorRecepcion(p) ? '📥' : est?.emoji} {etiquetaEstado(p.estado, p.origen, p.motivo_cancel)}</span>
                        {esRetornoPendiente(p) && (
                          <div style={{ fontSize: '.72rem', color: '#38bdf8', fontWeight: 600, marginTop: 3 }}>
                            📸 Foto tomada · Posible retorno
                          </div>
                        )}
                        {p.estado === 'cancelado' && p.motivo_cancel && <div className="muted" style={{ fontSize: '.75rem' }}>{p.motivo_cancel}</div>}
                      </td>
                      <td style={{ fontSize: '.78rem', whiteSpace: 'nowrap' }}>
                        {!retiro && p.pagada_en && <div>💰 Pagada {fechaHoraVE(p.pagada_en)}</div>}
                        {retiro && p.revisada_en && <div>📦 Revisada {fechaHoraVE(p.revisada_en)}</div>}
                        {p.aceptado_en && <div>🛵 Aceptada {fechaHoraVE(p.aceptado_en)}</div>}
                        {p.en_ruta_en && p.en_ruta_en !== p.aceptado_en && <div>🚚 En camino {fechaHoraVE(p.en_ruta_en)}</div>}
                        {fin && <div>{p.estado === 'cancelado' ? '⛔' : '✅'} {fechaHoraVE(fin)}</div>}
                        {p.estado === 'entregado' && <div className="muted">⏳ {duracionTxt(minutosEntre(p.aceptado_en, p.entregado_en))}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{retiro ? <span className="muted">—</span> : montoTxt(p.total, p.moneda)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '.3rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {!retiro && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setComprobante(p)} title="Comprobante que adjuntó Tesorería al pagar">🧾 Comprobante de pago</button>}
                          <button type="button" className="btn btn-ghost btn-sm" disabled={!nFotos && p.estado !== 'entregado'} onClick={() => setFotos(p)} title={nFotos ? 'Ver fotos' : p.estado === 'entregado' ? 'Sin fotos: puedes agregarlas' : 'Sin fotos todavía'}>📷 {nFotos}</button>
                          {msg && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWhatsapp(msg)}>💬 WhatsApp</button>}
                          <button type="button" className="btn btn-ghost btn-sm" disabled={generando === clave} onClick={() => pdfPedido(p)}
                            title="Reporte del pedido en PDF (vista previa)">
                            {generando === clave ? 'Generando…' : '📄 PDF'}
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" title="Reporte del pedido por WhatsApp"
                            onClick={() => setWhatsapp({ titulo: `Reporte del pedido ${retiro ? p.codigo : ocDe(p)}`, texto: textoReportePedido(p, quienSync) })}>
                            📋 Reporte
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

      {fotos && <FotosModal pedido={fotos} onClose={() => setFotos(null)} onCambio={onCambio} />}
      {comprobante && <ComprobanteModal pedido={comprobante} onClose={() => setComprobante(null)} />}
      {whatsapp && <WhatsappDeliveryModal titulo={whatsapp.titulo} texto={whatsapp.texto} onClose={() => setWhatsapp(null)} />}
      {cancelar && (
        <CancelarModal pedido={cancelar} onClose={() => setCancelar(null)}
          onCancelado={(texto) => { setCancelar(null); onCambio(); setWhatsapp({ titulo: 'Pedido cancelado', texto }); }} />
      )}
    </>
  );
}

/* ───────────── Fotos del pedido ───────────── */

function FotosModal({ pedido, onClose, onCambio }: { pedido: PedidoDelivery; onClose: () => void; onCambio: () => void }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const { can, isAdmin } = usePermissions();
  const [editar, setEditar] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState<'fotos' | 'reporte' | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const titulo = esRetiroAlmacen(pedido) ? pedido.codigo : ocDe(pedido);
  useEffect(() => {
    let vivo = true;
    const todas = [...pedido.fotos_recibo, ...pedido.fotos_factura, ...pedido.fotos_entrega];
    void Promise.all(todas.map(async (f) => [f.path, await urlFotoDelivery(f.path).catch(() => '')] as const))
      .then((pares) => { if (vivo) setUrls(Object.fromEntries(pares)); });
    return () => { vivo = false; };
  }, [pedido]);

  const galeria = useMemo(() => {
    const out: Array<PreviewImagenItem & { path: string }> = [];
    const rotRecibo = rotuloFotos(pedido.origen, 'recibo');
    const rotEntrega = rotuloFotos(pedido.origen, 'entrega');
    for (const f of pedido.fotos_recibo) {
      if (urls[f.path]) out.push({ path: f.path, url: urls[f.path], filename: f.filename, etiqueta: `${titulo} · ${rotRecibo}` });
    }
    for (const f of pedido.fotos_factura) {
      if (urls[f.path]) out.push({ path: f.path, url: urls[f.path], filename: f.filename, etiqueta: `${titulo} · ${rotuloFotos(pedido.origen, 'factura')}` });
    }
    for (const f of pedido.fotos_entrega) {
      if (urls[f.path]) out.push({ path: f.path, url: urls[f.path], filename: f.filename, etiqueta: `${titulo} · ${rotEntrega}` });
    }
    return out;
  }, [pedido, titulo, urls]);

  const abrirFoto = (path: string) => {
    const idx = galeria.findIndex((x) => x.path === path);
    previewGaleria(galeria, idx >= 0 ? idx : 0);
  };

  const abrirPdfFotos = () => {
    setGenerandoPdf('fotos');
    pdfFotosDelivery(pedido, urls)
      .catch((e) => toast(msgError(e, 'No se pudo generar el PDF de fotos.'), 'error'))
      .finally(() => setGenerandoPdf(null));
  };

  const abrirPdfReporte = () => {
    setGenerandoPdf('reporte');
    pdfPedidoDelivery(pedido, urls)
      .catch((e) => toast(msgError(e, 'No se pudo generar el reporte en PDF.'), 'error'))
      .finally(() => setGenerandoPdf(null));
  };

  const totalFotos = pedido.fotos_recibo.length + pedido.fotos_entrega.length + pedido.fotos_factura.length;

  const grupo = (rotulo: string, fs: FotoDelivery[]) => (
    <div style={{ marginBottom: '1rem' }}>
      <div className="card-title" style={{ fontSize: '.9rem' }}>{rotulo} ({fs.length})</div>
      {!fs.length ? <p className="muted" style={{ margin: 0 }}>Sin fotos.</p> : (
        <div style={{ display: 'grid', gap: '.6rem', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          {fs.map((f) => (
            urls[f.path] ? (
              <button key={f.path} type="button" onClick={() => abrirFoto(f.path)} title={`Vista previa · ${f.filename}`}
                style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'transparent', cursor: 'zoom-in', width: '100%', display: 'block' }}>
                <img src={urls[f.path]} alt={f.filename} style={{ width: '100%', height: 140, objectFit: 'cover', display: 'block' }} />
              </button>
            ) : (
              <div key={f.path} className="muted" style={{ height: 140, display: 'grid', placeItems: 'center', border: '1px dashed var(--border)', borderRadius: 8, fontSize: '.8rem' }}>
                {f.path in urls ? 'No se pudo abrir' : 'Cargando…'}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Modal title={`📷 Fotos · ${titulo}`} size="lg" onClose={onClose}
      footer={<>
        {totalFotos > 0 && (
          <>
            <button type="button" className="btn btn-ghost" disabled={!galeria.length} onClick={() => previewGaleria(galeria, 0)}
              title="Abrir las fotos en la vista previa del sistema (zoom, rotación, imprimir y descargar)">
              🖼 Vista previa
            </button>
            <button type="button" className="btn btn-ghost" disabled={generandoPdf !== null} onClick={abrirPdfFotos}
              title="Ver las fotos con formato PDF en vista previa">
              {generandoPdf === 'fotos' ? 'Generando…' : '📄 PDF (vista previa)'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={generandoPdf !== null} onClick={abrirPdfReporte}
              title="Reporte completo del pedido con fotos en PDF (vista previa)">
              {generandoPdf === 'reporte' ? 'Generando…' : '📋 Reporte PDF'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setWhatsapp(textoReportePedido(pedido, quienSync))}
              title="Reporte del pedido en formato WhatsApp">
              💬 WhatsApp
            </button>
          </>
        )}
        {/* 03/11/2026: pedido entregado → se pueden corregir las fotos (agregar / quitar). */}
        {puedeEditarFotosDelivery(pedido, isAdmin, can('delivery', 'escritura') || can('carga_pesada', 'escritura')) && (
          <button type="button" className="btn btn-ghost" onClick={() => setEditar(true)}>✏ Editar fotos</button>
        )}
        <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
      </>}>
      {editar && pedido.pedido_id && (
        <EditarFotosDeliveryModal pedidoId={pedido.pedido_id} origen={pedido.origen} titulo={titulo}
          fotosRecibo={pedido.fotos_recibo} fotosEntrega={pedido.fotos_entrega} fotosFactura={pedido.fotos_factura}
          onClose={() => setEditar(false)} onGuardado={() => { onCambio(); onClose(); }} />
      )}
      {whatsapp && <WhatsappDeliveryModal titulo={`Reporte del pedido ${titulo}`} texto={whatsapp} onClose={() => setWhatsapp(null)} />}
      {grupo(rotuloFotos(pedido.origen, 'recibo'), pedido.fotos_recibo)}
      {pedido.origen !== 'almacen' && grupo(rotuloFotos(pedido.origen, 'factura'), pedido.fotos_factura)}
      {grupo(rotuloFotos(pedido.origen, 'entrega'), pedido.fotos_entrega)}
      {pedido.nota_entrega && <p><strong>Nota de entrega:</strong> {pedido.nota_entrega}</p>}
    </Modal>
  );
}

/* ───────────── Comprobante de pago (se lee al abrir) ───────────── */

function ComprobanteModal({ pedido, onClose }: { pedido: PedidoDelivery; onClose: () => void }) {
  return (
    <Modal title={`🧾 Comprobante de pago · ${ocDe(pedido)}`} size="lg" onClose={onClose} minimizable={false}
      footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <ComprobantePagoCuerpo pedido={pedido} />
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
      toast(`${esRetiroAlmacen(pedido) ? `Retiro ${pedido.codigo}` : ocDe(pedido)} cancelado: queda libre para otro delivery.`, 'success');
      onCancelado(mensajeCancelado(pedido, pedido.repartidor_nombre || 'Delivery', motivo, detalle, new Date().toISOString()));
    } catch (e) {
      toast(msgError(e, 'No se pudo cancelar el pedido.'), 'error');
    } finally { setGuardando(false); }
  }

  return (
    <Modal title={`⛔ Cancelar · ${esRetiroAlmacen(pedido) ? pedido.codigo : ocDe(pedido)}`} compact onClose={onClose}
      footer={(
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Volver</button>
          <button className="btn btn-danger" onClick={() => void confirmar()} disabled={guardando || falta}>{guardando ? 'Cancelando…' : 'Cancelar pedido'}</button>
        </>
      )}>
      <p style={{ marginTop: 0 }}>
        Lo tiene <strong>{pedido.repartidor_nombre ?? '—'}</strong> ({etiquetaEstado(pedido.estado, pedido.origen).toLowerCase()}).
        Al cancelarlo, {esRetiroAlmacen(pedido) ? `el retiro en ${ALMACEN_RETIRO}` : 'la orden'} queda disponible para otro delivery.
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
  const [estado, setEstado] = useState<FiltroEstadoDelivery>('');
  const [origen, setOrigen] = useState<FiltroOrigenDelivery>('');
  const repartidores = useMemo(() => repartidoresDe(filas), [filas]);
  const visibles = useMemo(() => filtrarHistorial(filas, { estado, repartidor, origen }), [filas, estado, repartidor, origen]);
  const [generando, setGenerando] = useState(false);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);

  function pdf() {
    setGenerando(true);
    pdfHistorialDelivery({ desde, hasta, repartidor: repartidor || null, estado: estado || null, origen: origen || null, filas: visibles })
      .catch((e) => toast(msgError(e, 'No se pudo generar el PDF.'), 'error'))
      .finally(() => setGenerando(false));
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
        <span>📜 Histórico ({visibles.length})</span>
        <select className="select" style={{ width: 'auto', minWidth: 180 }} value={origen}
          onChange={(e) => setOrigen(e.target.value as FiltroOrigenDelivery)} aria-label="Filtrar por origen">
          {ORIGENES_FILTRO.map((x) => <option key={x.valor} value={x.valor}>{x.label}</option>)}
        </select>
        <select className="select" style={{ width: 'auto', minWidth: 180 }} value={estado}
          onChange={(e) => setEstado(e.target.value as FiltroEstadoDelivery)} aria-label="Filtrar por estado">
          {ESTADOS_FILTRO.map((x) => <option key={x.valor} value={x.valor}>{x.label}</option>)}
        </select>
        <select className="select" style={{ width: 'auto', minWidth: 200 }} value={repartidor} onChange={(e) => setRepartidor(e.target.value)} aria-label="Filtrar por delivery">
          <option value="">Todos los delivery</option>
          {repartidores.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={generando} onClick={pdf}>
            {generando ? 'Generando…' : '📄 PDF (vista previa)'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => setWhatsapp(textoReporteGeneral({ desde, hasta, estado: estado || null, repartidor: repartidor || null, origen: origen || null, filas: visibles }))}>
            💬 WhatsApp
          </button>
        </span>
      </div>
      {!visibles.length ? <p className="muted" style={{ margin: '.4rem 0' }}>No hay pedidos tomados con esos filtros.</p> : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead>
              <tr>
                <th>Tomado</th><th>Origen</th><th>OC / SP</th><th>Proveedor</th><th>Delivery</th><th>Estado</th><th>En camino</th>
                <th>Entregado / Cancelado</th><th style={{ textAlign: 'right' }}>Tiempo</th><th>Almacén / Entregado a / Motivo</th>
                <th style={{ textAlign: 'right' }}>Fotos</th><th style={{ textAlign: 'right' }}>Monto</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const est = ESTADO_DELIVERY[f.estado];
                return (
                  <tr key={f.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fechaHoraVE(f.fecha)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{ORIGEN_DELIVERY[f.origen].emoji} {ORIGEN_DELIVERY[f.origen].corto}</td>
                    <td><strong>{f.oc}</strong></td>
                    <td>{f.proveedor}</td>
                    <td>{f.repartidor}</td>
                    <td><span className={`badge ${est?.badge ?? ''}`}>{cerradoPorRecepcion(f) ? '📥' : est?.emoji} {etiquetaEstado(f.estado, f.origen, f.motivo_cancel)}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fechaHoraVE(f.en_ruta_en) || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fechaHoraVE(f.estado === 'cancelado' ? f.cancelado_en : f.entregado_en) || '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{duracionTxt(f.minutos)}</td>
                    <td>
                      {(f.estado === 'cancelado' ? f.motivo_cancel : f.almacen_entrega) || '—'}
                      {f.estado !== 'cancelado' && f.nota_entrega && <div className="muted" style={{ fontSize: '.75rem' }}>📝 {f.nota_entrega}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{f.fotos}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{f.origen === 'almacen' ? '—' : montoTxt(f.total, f.moneda)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {whatsapp && <WhatsappDeliveryModal titulo="Reporte de Delivery" texto={whatsapp} onClose={() => setWhatsapp(null)} />}
    </div>
  );
}

/* ───────────── Por delivery ───────────── */

function PorDeliveryTab({ filas, desde, hasta }: { filas: FilaHistorialDelivery[]; desde: string; hasta: string }) {
  const resumen = useMemo(() => resumenHistorial(filas), [filas]);
  const t = totalesResumen(resumen);
  const [generando, setGenerando] = useState(false);

  function pdf() {
    setGenerando(true);
    pdfPorDelivery({ desde, hasta, resumen })
      .catch((e) => toast(msgError(e, 'No se pudo generar el PDF.'), 'error'))
      .finally(() => setGenerando(false));
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
        <span>🛵 Pedidos por delivery</span>
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={generando || !resumen.length} onClick={pdf}>
          📄 PDF (vista previa)
        </button>
      </div>
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
                <tr key={r.repartidor}>
                  <td><strong>{r.repartidor}</strong></td>
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

/* ───────────── Repartidores conectados (10/11/2026 · como MGG) ───────────── */

/** Hace cuánto llegó la última ubicación, en palabras cortas. */
function haceTxt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h` : fechaHoraVE(iso);
}

/** Cada delivery de la flota: si su GPS está al día, qué lleva y cómo le fue hoy (de las ubicaciones y los pedidos). */
function RepartidoresTab({
  canal,
  pedidos,
  deHoy,
  onVerEnMapa,
}: {
  canal: CanalDelivery;
  pedidos: PedidoDelivery[];
  deHoy: FilaHistorialDelivery[];
  onVerEnMapa?: (repartidorId: string) => void;
}) {
  const quien = useQuien();
  const [ubic, setUbic] = useState<UbicacionDelivery[]>([]);
  const [cargando, setCargando] = useState(true);
  const [editandoAlias, setEditandoAlias] = useState<{ id: string; nombre: string; aliasActual: string } | null>(null);
  const [nuevoAlias, setNuevoAlias] = useState('');
  const [recargaLocal, setRecargaLocal] = useState(0);

  const cargar = useCallback(async () => {
    try { setUbic(await listUbicaciones(canal)); } catch { /* sin ubicaciones: solo pedidos */ } finally { setCargando(false); }
  }, [canal]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['delivery_ubicaciones'], () => { void cargar(); });
  // Refresca el «hace X min» aunque no lleguen ubicaciones nuevas.
  const [, setTic] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setTic((n) => n + 1), 30000); return () => window.clearInterval(t); }, []);

  const filas = useMemo(() => {
    const norm = (x: string | null | undefined) => (x ?? '').trim().toUpperCase();
    const mapa = new Map<string, { id: string; nombre: string; u: UbicacionDelivery | null; enCurso: PedidoDelivery[]; entregados: number; minutos: number[] }>();
    const fila = (id: string, nombre: string) => {
      const k = norm(nombre) || id || '—';
      if (!mapa.has(k)) mapa.set(k, { id, nombre: nombre || '—', u: null, enCurso: [], entregados: 0, minutos: [] });
      return mapa.get(k)!;
    };
    for (const u of ubic) {
      const f = fila(u.repartidor_id, u.repartidor_nombre || quien(null, u.repartidor_email) || u.repartidor_email || '—');
      if (!f.u || f.u.actualizado_en < u.actualizado_en) f.u = u;
    }
    for (const p of pedidos) {
      if ((p.estado === 'aceptado' || p.estado === 'en_ruta') && p.repartidor_nombre) {
        fila(p.repartidor_id || p.repartidor_nombre, p.repartidor_nombre).enCurso.push(p);
      }
    }
    for (const h of deHoy) {
      if (h.estado !== 'entregado' || !h.repartidor || h.repartidor === '—') continue;
      const f = fila(h.repartidor, h.repartidor);
      f.entregados++;
      if (h.minutos != null) f.minutos.push(h.minutos);
    }
    return [...mapa.values()].sort((a, b) => b.enCurso.length - a.enCurso.length || String(b.u?.actualizado_en ?? '').localeCompare(String(a.u?.actualizado_en ?? '')));
  }, [ubic, pedidos, deHoy, quien, recargaLocal]);

  if (cargando && !filas.length) return <p className="muted">Cargando…</p>;
  if (!filas.length) return <div className="card"><p className="muted" style={{ margin: 0 }}>Todavía no hay repartidores con ubicación ni pedidos hoy.</p></div>;

  return (
    <>
      <div className="dlv-repartidores">
        {filas.map((r, idx) => {
          const dif = obtenerDiferenciador(r.id || r.u?.repartidor_id || r.nombre, r.nombre, canal, idx);
          const conSenal = !!r.u && Date.now() - new Date(r.u.actualizado_en).getTime() <= UBICACION_VIEJA_MS;
          const prom = r.minutos.length ? Math.round(r.minutos.reduce((a, b) => a + b, 0) / r.minutos.length) : null;
          const vel = r.u?.velocidad != null && r.u.velocidad > 0 ? Math.round(r.u.velocidad * 3.6) : null;

          return (
            <div key={r.nombre} className="dlv-repartidor">
              <div className="fila">
                <div
                  className={`dlv-avatar${conSenal ? '' : ' sin-senal'}`}
                  style={{ background: dif.color }}
                  aria-hidden
                  title={`Unidad ${dif.codigo}`}
                >
                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#fff' }}>{dif.codigo}</span>
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="nombre" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 800 }}>{dif.nombreVisible}</span>
                    {dif.alias && <span className="muted" style={{ fontSize: '.75rem' }}>({r.nombre})</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <span className={`dlv-gps-pill${conSenal ? ' on' : ''}`}>
                      {conSenal ? '● GPS al día' : r.u ? '○ Sin señal reciente' : '○ Sin GPS compartido'}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '0 6px', fontSize: '.72rem', height: 22 }}
                      onClick={() => {
                        setEditandoAlias({ id: r.id || r.u?.repartidor_id || r.nombre, nombre: r.nombre, aliasActual: dif.alias || '' });
                        setNuevoAlias(dif.alias || '');
                      }}
                      title="Asignar o editar identificador / unidad"
                    >
                      ✏ Alias / Unidad
                    </button>
                  </div>
                </div>
              </div>

              <div className="dato">
                📡 Última ubicación: <strong>{haceTxt(r.u?.actualizado_en)}</strong>
                {vel != null ? <> · <strong>{vel} km/h</strong></> : null}
              </div>

              <div className="dato">
                {r.enCurso.length ? (
                  <>
                    🚚 Lleva:{' '}
                    {r.enCurso.map((p) => (
                      <strong key={claveDelivery(p)} style={{ marginRight: '.35rem' }}>
                        {esRetiroAlmacen(p) ? p.codigo : ocDe(p)} ({etiquetaEstado(p.estado, p.origen, p.motivo_cancel)})
                      </strong>
                    ))}
                  </>
                ) : (
                  <>✅ Libre</>
                )}
              </div>

              <div className="dato">
                📦 Entregados hoy: <strong>{r.entregados}</strong>
                {prom != null ? <> · ⏱ promedio <strong>{minutosTxt(prom)}</strong></> : null}
              </div>

              {onVerEnMapa && r.u && (
                <div style={{ marginTop: 'auto', paddingTop: 6, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => onVerEnMapa(r.u!.repartidor_id)}
                  >
                    🎯 Ver en Centro de Control
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editandoAlias && (
        <Modal
          title={`✏ Asignar Identificador / Unidad a ${editandoAlias.nombre}`}
          compact
          onClose={() => setEditandoAlias(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setEditandoAlias(null)}>Cancelar</button>
              {editandoAlias.aliasActual && (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    guardarAliasRepartidor(editandoAlias.id, null);
                    setEditandoAlias(null);
                    setRecargaLocal((n) => n + 1);
                    toast('Identificador restaurado al valor por defecto.', 'info');
                  }}
                >
                  Restaurar por defecto
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={() => {
                  guardarAliasRepartidor(editandoAlias.id, nuevoAlias.trim() || null);
                  setEditandoAlias(null);
                  setRecargaLocal((n) => n + 1);
                  toast('Identificador de la unidad guardado.', 'success');
                }}
              >
                Guardar
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0, fontSize: '.88rem' }}>
            Asigna un identificador reconocible o número de unidad (ej. <strong>Unidad 1</strong>, <strong>Móvil 02</strong>, <strong>Héctor (01)</strong> o placa) para diferenciarlo inmediatamente en el mapa y la lista aunque el nombre esté incompleto o solapado.
          </p>
          <div className="form-row">
            <label htmlFor="dlv-alias-inp">Identificador / Alias de Unidad</label>
            <input
              id="dlv-alias-inp"
              className="input"
              placeholder="ej. Unidad 1, Móvil 02..."
              value={nuevoAlias}
              onChange={(e) => setNuevoAlias(e.target.value)}
              autoFocus
            />
          </div>
        </Modal>
      )}
    </>
  );
}

/* ───────────── Trazabilidad y horarios (10/11/2026 · como MGG) ───────────── */

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
              {f.en_ruta_en && enRuta != null && enRuta > 0 && <><span className="flecha">→ {minutosTxt(enRuta)} →</span><span className="paso">🚚 En ruta {fechaHoraVE(f.en_ruta_en)}</span></>}
              {f.entregado_en && <><span className="flecha">→</span><span className="paso fin">📦 Entregado {fechaHoraVE(f.entregado_en)}{f.almacen_entrega ? ` · ${f.almacen_entrega}` : ''}</span></>}
              {f.cancelado_en && <><span className="flecha">→</span><span className="paso cancel">⛔ Cancelado {fechaHoraVE(f.cancelado_en)}{f.motivo_cancel ? ` · ${f.motivo_cancel}` : ''}</span></>}
              {f.minutos != null && <span className="muted" style={{ marginLeft: 'auto' }}>⏱ Total: <strong>{minutosTxt(f.minutos)}</strong></span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
