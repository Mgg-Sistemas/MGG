/* ============================================================
   MGG · Delivery · Panel central (30-10-2026)

   La OC que Tesorería pagó (y Retenciones retuvo, si tocaba) la toma UN
   motorizado desde su teléfono, va en ruta y la entrega en el almacén. Acá
   se sigue todo desde la PC:
     Tablero      → por tomar / aceptados / en camino / entregados hoy, con
                    fotos, comprobante de pago, WhatsApp y cancelar si se trabó
     Mapa         → dónde está cada motorizado (Calles / Satelital)
     Histórico    → lo tomado en un rango de fechas, filtrable por delivery
     Por delivery → cuántos pedidos lleva cada uno y su tiempo promedio
   Construido pero DESCONECTADO hasta que la administradora lo active
   (config compras.delivery): mientras tanto las listas quedan vacías.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { listProveedores } from '@/modules/pedidos/pedidos.repository';
import { MensajeWhatsappModal } from '@/modules/pedidos/MensajeWhatsappModal';
import { useRealtime } from '@/shared/lib/useRealtime';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import {
  ESTADO_DELIVERY, MOTIVOS_CANCELACION, fechaHoraVE, mensajeCancelado, minutosEntre, montoTxt, ocDe,
  type FotoDelivery, type PedidoDelivery,
} from './delivery';
import {
  cancelarPedido, comprobantePagoDelivery, listHistorialDelivery, listPedidosDelivery, urlFotoDelivery, useDeliveryConectado,
  type ComprobantePagoDelivery,
} from './delivery.repository';
import {
  RANGOS_DELIVERY, armarFilasHistorial, conteoPorEstado, duracionTxt, filtrarPorRepartidor, mensajeDelPedido, rangoDelivery,
  rangoDeliveryActivo, repartidoresDe, resumenHistorial, sePuedeCancelar, totalesResumen, type FilaHistorialDelivery,
} from './deliveryPanel';
import { DeliveryMapa } from './DeliveryMapa';
import { pdfHistorialDelivery, pdfPorDelivery } from './deliveryPdf';

type Vista = 'tablero' | 'mapa' | 'historico' | 'por_delivery';

const TABS: { key: Vista; label: string; icon: string }[] = [
  { key: 'tablero', label: 'Tablero', icon: '📊' },
  { key: 'mapa', label: 'Mapa', icon: '🗺' },
  { key: 'historico', label: 'Histórico', icon: '📜' },
  { key: 'por_delivery', label: 'Por delivery', icon: '🛵' },
];

const msgError = (e: unknown, def: string) => (e instanceof Error ? e.message : def);

export function DeliveryPage() {
  const { can, isAdmin, vistasTelefono } = usePermissions();
  const conectado = useDeliveryConectado();
  const supervisor = isAdmin || can('delivery', 'full');
  const tieneTelefono = vistasTelefono.some((v) => v.key === 'delivery');
  const [vista, setVista] = useState<Vista>('tablero');

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
      const [ps, hh] = await Promise.all([listPedidosDelivery(verCerrados), listHistorialDelivery(hoy, hoy)]);
      setPedidos(ps);
      setDeHoy(armarFilasHistorial(hh, proveedores));
      setErrorCarga(null);
    } catch (e) {
      setErrorCarga(msgError(e, 'No se pudieron leer los pedidos de Delivery.'));
    } finally { setCargando(false); }
  }, [verCerrados, hoy, proveedores]);
  useEffect(() => { void recargarTablero(); }, [recargarTablero]);

  const enHistorico = vista === 'historico' || vista === 'por_delivery';
  const recargarHistorial = useCallback(async () => {
    if (!desde || !hasta || desde > hasta) return;
    setCargandoHist(true);
    try {
      setHistorial(armarFilasHistorial(await listHistorialDelivery(desde, hasta), proveedores));
    } catch (e) {
      toast(msgError(e, 'No se pudo leer el histórico.'), 'error');
    } finally { setCargandoHist(false); }
  }, [desde, hasta, proveedores]);
  useEffect(() => { if (enHistorico) void recargarHistorial(); }, [enHistorico, recargarHistorial]);

  // Tiempo real: lo que hace el motorizado en su teléfono (o Tesorería al pagar) se ve sin recargar.
  // Las ubicaciones las escucha el propio mapa: llegan seguido y no cambian las listas.
  useRealtime(['delivery_pedidos', 'ordenes'], () => {
    void recargarTablero();
    if (enHistorico) void recargarHistorial();
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.8rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div style={{ flex: '1 1 320px' }}>
          <h1 style={{ margin: 0 }}>🛵 Delivery</h1>
          <p className="hint muted" style={{ margin: '.25rem 0 0' }}>
            Órdenes pagadas por Tesorería que un motorizado toma, busca donde el proveedor y entrega en el almacén, con fotos y aviso por WhatsApp.
          </p>
        </div>
        {tieneTelefono && <Link to="/app/delivery/telefono" className="btn btn-ghost btn-sm">📱 Vista de teléfono</Link>}
      </div>

      {conectado === false && (
        <div className="aviso info" style={{ marginBottom: '1rem' }}>
          <span className="aviso-icono">ℹ</span>
          <div>
            <strong>Delivery todavía no está conectado a Compras.</strong> Cuando la administradora lo active, acá llegarán las órdenes
            pagadas por Tesorería (y retenidas, si corresponde). Mientras tanto las listas quedan vacías.
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
          verCerrados={verCerrados} setVerCerrados={setVerCerrados} onCambio={() => void recargarTablero()} />
      )}
      {vista === 'mapa' && <DeliveryMapa pedidos={pedidos} />}
      {enHistorico && (
        <BarraRango hoy={hoy} desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} cargando={cargandoHist} />
      )}
      {vista === 'historico' && <HistoricoTab filas={historial} desde={desde} hasta={hasta} />}
      {vista === 'por_delivery' && <PorDeliveryTab filas={historial} desde={desde} hasta={hasta} />}
    </div>
  );
}

/* ───────────── Tablero ───────────── */

function TableroTab({ pedidos, deHoy, cargando, supervisor, verCerrados, setVerCerrados, onCambio }: {
  pedidos: PedidoDelivery[]; deHoy: FilaHistorialDelivery[]; cargando: boolean; supervisor: boolean;
  verCerrados: boolean; setVerCerrados: (v: boolean) => void; onCambio: () => void;
}) {
  const c = conteoPorEstado(pedidos);
  const entregadosHoy = deHoy.filter((f) => f.estado === 'entregado').length;
  const canceladosHoy = deHoy.filter((f) => f.estado === 'cancelado').length;
  const urgentes = pedidos.filter((p) => p.estado === 'por_tomar' && p.urgente).length;

  const [fotos, setFotos] = useState<PedidoDelivery | null>(null);
  const [whatsapp, setWhatsapp] = useState<{ titulo: string; texto: string } | null>(null);
  const [cancelar, setCancelar] = useState<PedidoDelivery | null>(null);
  const [comprobante, setComprobante] = useState<PedidoDelivery | null>(null);

  // Primero lo urgente y lo más viejo por tomar; después lo en curso; al final lo cerrado.
  const orden: Record<string, number> = { por_tomar: 0, aceptado: 1, en_ruta: 2, entregado: 3, cancelado: 4 };
  const lista = [...pedidos].sort((a, b) => (orden[a.estado] - orden[b.estado])
    || (Number(b.urgente) - Number(a.urgente))
    || String(a.pagada_en ?? a.aceptado_en ?? '').localeCompare(String(b.pagada_en ?? b.aceptado_en ?? '')));

  return (
    <>
      <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
        <div className="kpi">
          <div className="label">Por tomar</div>
          <div className="value">{c.por_tomar}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>{urgentes ? `${urgentes} urgente(s)` : 'OC pagadas sin delivery'}</div>
          <div className="icon" aria-hidden="true">💰</div>
        </div>
        <div className="kpi">
          <div className="label">Aceptados</div>
          <div className="value">{c.aceptado}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>Tomados, aún donde el proveedor</div>
          <div className="icon" aria-hidden="true">🛵</div>
        </div>
        <div className="kpi">
          <div className="label">En camino</div>
          <div className="value">{c.en_ruta}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>Rumbo al almacén</div>
          <div className="icon" aria-hidden="true">🚚</div>
        </div>
        <div className="kpi">
          <div className="label">Entregados hoy</div>
          <div className="value">{entregadosHoy}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>{canceladosHoy ? `${canceladosHoy} cancelado(s) hoy` : 'Sin cancelaciones hoy'}</div>
          <div className="icon" aria-hidden="true">✅</div>
        </div>
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
                  <th>OC</th><th>Proveedor</th><th>Delivery</th><th>Estado</th><th>Tiempos</th><th>Monto</th><th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => {
                  const est = ESTADO_DELIVERY[p.estado];
                  const nFotos = p.fotos_recibo.length + p.fotos_entrega.length;
                  const msg = mensajeDelPedido(p);
                  const fin = p.estado === 'cancelado' ? p.cancelado_en : p.entregado_en;
                  return (
                    <tr key={`${p.orden_id}-${p.pedido_id ?? 'libre'}`}>
                      <td>
                        <strong>{ocDe(p)}</strong>
                        {p.urgente && <> <span className="badge danger">URGENTE</span></>}
                        {p.almacen_destino && <div className="muted" style={{ fontSize: '.75rem' }}>🏬 {p.almacen_destino}</div>}
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
                        {p.pagada_en && <div>💰 Pagada {fechaHoraVE(p.pagada_en)}</div>}
                        {p.aceptado_en && <div>🛵 Tomada {fechaHoraVE(p.aceptado_en)}</div>}
                        {p.en_ruta_en && <div>🚚 En ruta {fechaHoraVE(p.en_ruta_en)}</div>}
                        {fin && <div>{p.estado === 'cancelado' ? '⛔' : '✅'} {fechaHoraVE(fin)}</div>}
                        {p.estado === 'entregado' && <div className="muted">⏳ {duracionTxt(minutosEntre(p.aceptado_en, p.entregado_en))}</div>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{montoTxt(p.total, p.moneda)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '.3rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setComprobante(p)} title="Comprobante que adjuntó Tesorería al pagar">🧾 Comprobante de pago</button>
                          <button type="button" className="btn btn-ghost btn-sm" disabled={!nFotos} onClick={() => setFotos(p)} title={nFotos ? 'Ver fotos' : 'Sin fotos todavía'}>📷 {nFotos}</button>
                          {msg && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWhatsapp(msg)}>💬 WhatsApp</button>}
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

      {fotos && <FotosModal pedido={fotos} onClose={() => setFotos(null)} />}
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

function FotosModal({ pedido, onClose }: { pedido: PedidoDelivery; onClose: () => void }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let vivo = true;
    const todas = [...pedido.fotos_recibo, ...pedido.fotos_entrega];
    void Promise.all(todas.map(async (f) => [f.path, await urlFotoDelivery(f.path).catch(() => '')] as const))
      .then((pares) => { if (vivo) setUrls(Object.fromEntries(pares)); });
    return () => { vivo = false; };
  }, [pedido]);

  const grupo = (titulo: string, fs: FotoDelivery[]) => (
    <div style={{ marginBottom: '1rem' }}>
      <div className="card-title" style={{ fontSize: '.9rem' }}>{titulo} ({fs.length})</div>
      {!fs.length ? <p className="muted" style={{ margin: 0 }}>Sin fotos.</p> : (
        <div style={{ display: 'grid', gap: '.6rem', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          {fs.map((f) => (
            urls[f.path] ? (
              <a key={f.path} href={urls[f.path]} target="_blank" rel="noopener noreferrer" title={f.filename}>
                <img src={urls[f.path]} alt={f.filename} style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
              </a>
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
    <Modal title={`📷 Fotos · ${ocDe(pedido)}`} size="lg" onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      {grupo('Al recibir del proveedor', pedido.fotos_recibo)}
      {grupo('Al entregar en el almacén', pedido.fotos_entrega)}
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
            // Un enlace (no window.open tras la espera): el navegador no lo bloquea como ventana emergente.
            <a className="btn btn-primary" href={dato.url} target="_blank" rel="noopener noreferrer">📄 Abrir PDF · {dato.nombre}</a>
          ) : (
            <a href={dato.url} target="_blank" rel="noopener noreferrer" title="Abrir en grande">
              <img src={dato.url} alt={dato.nombre} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', display: 'block', margin: '0 auto', borderRadius: 8 }} />
            </a>
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
  const [generando, setGenerando] = useState(false);

  function pdf() {
    setGenerando(true);
    pdfHistorialDelivery({ desde, hasta, repartidor: repartidor || null, filas: visibles })
      .catch((e) => toast(msgError(e, 'No se pudo generar el PDF.'), 'error'))
      .finally(() => setGenerando(false));
  }

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
        <span>📜 Histórico ({visibles.length})</span>
        <select className="select" style={{ width: 'auto', minWidth: 200 }} value={repartidor} onChange={(e) => setRepartidor(e.target.value)} aria-label="Filtrar por delivery">
          <option value="">Todos los delivery</option>
          {repartidores.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} disabled={generando || !visibles.length} onClick={pdf}>
          📄 PDF (vista previa)
        </button>
      </div>
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
