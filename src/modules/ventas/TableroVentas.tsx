/* ============================================================
   MGG · (traído de Golden Touch 11-11-2026) · Ventas · TABLERO (como el de Compras) · 10/11/2026

   Adaptado de La Cantera: una tarjeta por venta, en su etapa, de la
   cotización al cobro. Al tocarla se abre su detalle con los papeles
   encadenados y los botones de su etapa.

     Cotización → 🚚 Pedir despacho → Despacho por aprobar
       → «¿Se despacha?» (✅ SÍ: sale el material y queda por cobrar ·
          ⏳ NO, por ahora: queda con su motivo · 🚫 NO PROCEDE: se anula)
       → Despachada · por cobrar → 🧾 Emitir factura → Facturada · por cobrar
       → 💵 Registrar cobro → Cobrada

   Una sola aprobación por venta: al despachar. La dan los administradores y
   «Usuarios autorizados › Aprobar despachos de ventas»; la base lo vuelve a
   comprobar (y no deja aprobar el despacho que uno mismo pidió).
   La lógica pura (etapas, chips, indicadores, búsqueda) está en ventasTablero.ts
   y los mensajes en ventasWhatsapp.ts.
   ============================================================ */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dateTime, montoMoneda, relTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Caja, CuentaCaja } from '@/shared/lib/types';
import { getTasaHoy } from '@/modules/tesoreria/tasas.repository';
import { getCuentaPorCobrar, registrarCobro, type CuentaPorCobrar } from '@/modules/tesoreria/cuentasPorCobrar.repository';
import { round2 } from './ventasCalculos';
import {
  aprobarDespacho, enviarVentaAAutorizar, facturarVenta, getVentaCabecera, listCobradoPorVenta,
  listRenglonesDeVentas, noSeDespacha, rechazarDespacho, sumaPagoLegs,
  type MotivoNoDespacho, type Venta, type VentaRenglon,
} from './ventas.repository';
import {
  armarTarjeta, chipsDe, coincide, columnasConFoco, COLUMNAS_VENTAS, fechaCorta, FOCO_LABEL, hoyIso,
  indicadores, montoDe, MOTIVO_NO_DESPACHO, pasaFoco, TITULO_ETAPA, TOPE_POR_COLUMNA, validaHasta,
  visibleEnTablero, type EtapaVenta, type FocoVentas, type TarjetaVenta, type TonoVenta, type VentanaDias,
} from './ventasTablero';
import {
  textoCobro, textoDespachoAprobado, textoDespachoNoAprobado, textoDespachoPorAprobar, textoFactura,
  textoRecordatorio, whatsappDe,
} from './ventasWhatsapp';

export interface TableroVentasProps {
  /** Solo las del tipo «venta» (las permutas van por su pestaña). */
  ventas: Venta[];
  actor: string;
  actorName: string | null;
  puedeEscribir: boolean;
  /** Admin o en la lista «Aprobar despachos de ventas». */
  puedeAprobar: boolean;
  puedeAnular: (v: Venta) => boolean;
  cajas: Caja[];
  onNueva: () => void;
  onEditar: (v: Venta) => void;
  onBorrar: (v: Venta) => void;
  onAnular: (v: Venta) => void;
  onComprobante: (v: Venta) => void;
  /** Abre la ficha completa (renglones con costo, cajas, trazabilidad). */
  onFicha: (v: Venta) => void;
  onCambio: () => Promise<void>;
}

type ModalT =
  | { kind: 'none' }
  | { kind: 'detalle'; id: string }
  | { kind: 'pedir'; id: string }
  | { kind: 'aprobar'; id: string }
  | { kind: 'facturar'; id: string }
  | { kind: 'cobrar'; id: string }
  | { kind: 'historico'; etapa: EtapaVenta | 'todas' }
  | { kind: 'whatsapp'; titulo: string; texto: string };

const TONO_CLASE: Record<TonoVenta, string> = {
  info: 'badge info', warning: 'badge warning', success: 'badge success', danger: 'badge danger', neutral: 'badge',
};

export function TableroVentas(p: TableroVentasProps) {
  const { ventas, actor, actorName, puedeEscribir, puedeAprobar, onCambio } = p;
  const quien = actorName ?? actor;
  const [renglones, setRenglones] = useState<Record<string, VentaRenglon[]>>({});
  const [cobrado, setCobrado] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [dias, setDias] = useState<VentanaDias>(30);
  const [foco, setFoco] = useState<FocoVentas | null>(null);
  const [modal, setModal] = useState<ModalT>({ kind: 'none' });
  const [trabajando, setTrabajando] = useState(false);
  const hoy = hoyIso();

  /* ── Renglones (para el resumen de productos) y lo cobrado por venta ── */
  const idsKey = useMemo(() => ventas.map((v) => v.id).sort().join(','), [ventas]);
  useEffect(() => {
    let vivo = true;
    const ids = idsKey ? idsKey.split(',') : [];
    listRenglonesDeVentas(ids)
      .then((rs) => {
        if (!vivo) return;
        const m: Record<string, VentaRenglon[]> = {};
        for (const r of rs) (m[r.venta_id] ??= []).push(r);
        setRenglones(m);
      })
      .catch(() => { /* sin resumen de productos */ });
    return () => { vivo = false; };
  }, [idsKey]);

  const cargarCobrado = useCallback(() => {
    listCobradoPorVenta().then(setCobrado).catch(() => { /* sin abonos */ });
  }, []);
  useEffect(() => { cargarCobrado(); }, [cargarCobrado, idsKey]);
  useRealtime(['cuentas_por_cobrar_abonos'], cargarCobrado);

  /* ── Tarjetas ── */
  const tarjetas = useMemo(
    () => ventas.map((v) => armarTarjeta(v, renglones[v.id] ?? [], cobrado[v.id] ?? 0, hoy)),
    [ventas, renglones, cobrado, hoy],
  );
  const porId = useMemo(() => new Map(tarjetas.map((t) => [t.venta.id, t])), [tarjetas]);
  const kpi = useMemo(() => indicadores(tarjetas), [tarjetas]);
  const visibles = useMemo(
    () => tarjetas.filter((t) => visibleEnTablero(t, dias, hoy) && coincide(t, q) && pasaFoco(t, foco)),
    [tarjetas, dias, hoy, q, foco],
  );
  const columnas = useMemo(() => {
    const ver = columnasConFoco(foco);
    return COLUMNAS_VENTAS.filter((c) => ver.includes(c.etapa)).map((c) => ({
      ...c, tarjetas: visibles.filter((t) => t.etapa === c.etapa),
    }));
  }, [visibles, foco]);

  /* ── Acciones ── */
  const rs = (id: string) => renglones[id] ?? [];

  async function trasCambio(id: string, mensaje: string, wa?: (v: Venta) => { titulo: string; texto: string } | null) {
    notify(mensaje, 'success', { link: '#/app/ventas' });
    await onCambio();
    cargarCobrado();
    if (wa) {
      const fresca = await getVentaCabecera(id).catch(() => null);
      const w = fresca ? wa(fresca) : null;
      if (w) { setModal({ kind: 'whatsapp', ...w }); return; }
    }
    setModal({ kind: 'none' });
  }

  async function ejecutar(fn: () => Promise<void>) {
    setTrabajando(true);
    try { await fn(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo completar la operación.', 'error'); }
    finally { setTrabajando(false); }
  }

  function abrirWhatsapp(t: TarjetaVenta) {
    setModal({ kind: 'whatsapp', ...whatsappDe(t, rs(t.venta.id)) });
  }

  const sel = modal.kind === 'detalle' || modal.kind === 'pedir' || modal.kind === 'aprobar'
    || modal.kind === 'facturar' || modal.kind === 'cobrar'
    ? porId.get(modal.id) ?? null : null;

  /* ─────────────────────────── Render ─────────────────────────── */
  const KPIS: { foco: FocoVentas; valor: string; alerta?: boolean }[] = [
    { foco: 'cot', valor: String(kpi.cot) },
    { foco: 'aprobar', valor: String(kpi.aprobar) },
    { foco: 'despachada', valor: String(kpi.despachada) },
    { foco: 'porcobrar', valor: kpi.porCobrar.length ? kpi.porCobrar.map((x) => montoMoneda(x.monto, x.moneda)).join(' · ') : montoMoneda(0, 'USD') },
    { foco: 'vencidas', valor: String(kpi.vencidas), alerta: kpi.vencidas > 0 },
  ];

  return (
    <>
      <p className="muted hint" style={{ marginTop: 0 }}>
        Cada venta en su etapa, de la cotización al cobro. Toca una tarjeta para ver sus papeles y lo que sigue.
        Una sola aprobación por venta: <strong>al despachar</strong>.
      </p>

      {/* Indicadores: tocarlos filtra el tablero */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '.6rem', marginBottom: '.8rem' }}>
        {KPIS.map((k) => (
          <button key={k.foco} type="button" className="card"
            onClick={() => setFoco((f) => (f === k.foco ? null : k.foco))}
            aria-pressed={foco === k.foco}
            style={{
              margin: 0, padding: '.6rem .8rem', textAlign: 'left', cursor: 'pointer',
              borderColor: foco === k.foco ? 'var(--brand, #ff8a00)' : k.alerta ? 'var(--danger)' : undefined,
            }}>
            <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{FOCO_LABEL[k.foco]}</div>
            <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 700, color: k.alerta ? 'var(--danger)' : undefined }}>{k.valor}</div>
          </button>
        ))}
      </div>

      {foco && (
        <div className="card" style={{ margin: '0 0 .7rem', padding: '.45rem .8rem', display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
          <span>Mostrando solo: <strong>{FOCO_LABEL[foco]}</strong></span>
          <button className="btn btn-sm btn-ghost" onClick={() => setFoco(null)}>✕ Ver todo el tablero</button>
        </div>
      )}

      <div className="filterbar">
        <input className="input search" placeholder="🔍 Cliente, RIF, código, producto, nº de factura…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.82rem' }}>
          Cobradas y anuladas de los últimos
          <select className="select" value={dias} onChange={(e) => setDias(Number(e.target.value) as VentanaDias)} style={{ width: 'auto' }}>
            <option value={7}>7 días</option>
            <option value={30}>30 días</option>
            <option value={90}>90 días</option>
          </select>
        </label>
        <button className="btn btn-ghost" onClick={() => setModal({ kind: 'historico', etapa: 'todas' })}>📚 Ver histórico</button>
        {puedeEscribir && <button className="btn btn-primary" onClick={p.onNueva}>＋ Nueva cotización</button>}
      </div>

      {!ventas.length ? (
        <EmptyState message="Todavía no hay ventas. Empieza con «＋ Nueva cotización»." icon="🧾" />
      ) : (
        <div className="kanban">
          {columnas.map((col) => {
            const mostrar = col.tarjetas.slice(0, TOPE_POR_COLUMNA);
            const resto = col.tarjetas.length - mostrar.length;
            return (
              <div key={col.etapa} className="kanban-col" data-state={col.estadoCss}>
                <div className="kanban-col-head">
                  <span className="title" title={col.ayuda}>{col.titulo}</span>
                  <span className="count">{col.tarjetas.length}</span>
                </div>
                <div className="muted" style={{ fontSize: '.72rem', padding: '0 .2rem .35rem' }}>{col.ayuda}</div>
                <div className="kanban-col-body">
                  {!mostrar.length && <div className="kanban-empty">Sin ventas en esta etapa</div>}
                  {mostrar.map((t) => (
                    <TarjetaCard key={t.venta.id} t={t} hoy={hoy} onClick={() => setModal({ kind: 'detalle', id: t.venta.id })} />
                  ))}
                  {resto > 0 && (
                    <button className="btn btn-sm btn-ghost" style={{ width: '100%' }}
                      onClick={() => setModal({ kind: 'historico', etapa: col.etapa })}>
                      + {resto} más · ver en el histórico →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Detalle ── */}
      {modal.kind === 'detalle' && sel && (
        <DetalleTablero
          t={sel} renglones={rs(sel.venta.id)} hoy={hoy}
          puedeEscribir={puedeEscribir} puedeAprobar={puedeAprobar} puedeAnular={p.puedeAnular(sel.venta)}
          onClose={() => setModal({ kind: 'none' })}
          onPedir={() => setModal({ kind: 'pedir', id: sel.venta.id })}
          onAprobar={() => setModal({ kind: 'aprobar', id: sel.venta.id })}
          onFacturar={() => setModal({ kind: 'facturar', id: sel.venta.id })}
          onCobrar={() => setModal({ kind: 'cobrar', id: sel.venta.id })}
          onRecordar={() => setModal({ kind: 'whatsapp', titulo: `Recordatorio de cobro · ${sel.venta.codigo}`, texto: textoRecordatorio(sel, hoy) })}
          onWhatsapp={() => abrirWhatsapp(sel)}
          onEditar={() => { setModal({ kind: 'none' }); p.onEditar(sel.venta); }}
          onBorrar={() => { setModal({ kind: 'none' }); p.onBorrar(sel.venta); }}
          onAnular={() => { setModal({ kind: 'none' }); p.onAnular(sel.venta); }}
          onComprobante={() => p.onComprobante(sel.venta)}
          onFicha={() => { setModal({ kind: 'none' }); p.onFicha(sel.venta); }}
        />
      )}

      {/* ── Pedir despacho (cotización → por aprobar) ── */}
      {modal.kind === 'pedir' && sel && (
        <PedirDespachoModal
          t={sel} trabajando={trabajando}
          onClose={() => setModal({ kind: 'detalle', id: sel.venta.id })}
          onConfirmar={() => void ejecutar(async () => {
            const v = await enviarVentaAAutorizar(sel.venta.id, actor, quien);
            await trasCambio(v.id, `${v.codigo} · despacho pedido`, (f) => ({
              titulo: `Despacho por aprobar · ${f.codigo}`, texto: textoDespachoPorAprobar(f, rs(f.id)),
            }));
          })}
        />
      )}

      {/* ── ¿Se despacha? ── */}
      {modal.kind === 'aprobar' && sel && (
        <AprobarDespachoModal
          t={sel} trabajando={trabajando}
          onClose={() => setModal({ kind: 'detalle', id: sel.venta.id })}
          onSi={() => void ejecutar(async () => {
            const v = await aprobarDespacho(sel.venta.id, actor, quien);
            await trasCambio(v.id, `Despacho ${v.codigo} aprobado · salió el material`, (f) => ({
              titulo: `Despacho aprobado · ${f.codigo}`, texto: textoDespachoAprobado(f, rs(f.id)),
            }));
          })}
          onPorAhora={(motivo, detalle) => void ejecutar(async () => {
            const v = await noSeDespacha(sel.venta.id, motivo, detalle, quien);
            await trasCambio(v.id, `Despacho ${v.codigo} no aprobado por ahora`, (f) => ({
              titulo: `Despacho no aprobado por ahora · ${f.codigo}`, texto: textoDespachoNoAprobado(f, rs(f.id)),
            }));
          })}
          onNoProcede={(justificacion) => void ejecutar(async () => {
            const v = await rechazarDespacho(sel.venta.id, justificacion, quien);
            await trasCambio(v.id, `Despacho ${v.codigo} no aprobado`, (f) => ({
              titulo: `Despacho no aprobado · ${f.codigo}`, texto: textoDespachoNoAprobado(f, rs(f.id)),
            }));
          })}
        />
      )}

      {/* ── Emitir factura ── */}
      {modal.kind === 'facturar' && sel && (
        <FacturarModal
          t={sel} trabajando={trabajando}
          onClose={() => setModal({ kind: 'detalle', id: sel.venta.id })}
          onEmitir={(d) => void ejecutar(async () => {
            const v = await facturarVenta({ id: sel.venta.id, ...d, actor, actorName: quien });
            await trasCambio(v.id, `Factura ${v.numero_factura} emitida · ${v.codigo}`, (f) => ({
              titulo: `Factura · ${f.numero_factura ?? f.codigo}`, texto: textoFactura(f, rs(f.id)),
            }));
          })}
        />
      )}

      {/* ── Registrar cobro ── */}
      {modal.kind === 'cobrar' && sel && (
        <CobroVentaModal
          t={sel} cajas={p.cajas} trabajando={trabajando}
          onClose={() => setModal({ kind: 'detalle', id: sel.venta.id })}
          onCobrar={(d) => void ejecutar(async () => {
            await registrarCobro({ ...d, actor, actorName: quien, refVentaId: sel.venta.id });
            const saldo = Math.max(0, round2(sel.saldo - d.monto));
            const caja = p.cajas.find((c) => c.id === d.cajaId)?.nombre ?? null;
            await trasCambio(sel.venta.id, saldo <= 0.01 ? `${sel.venta.codigo} cobrada` : `Abono a ${sel.venta.codigo}`, (f) => ({
              titulo: `${saldo <= 0.01 ? 'Venta cobrada' : 'Abono'} · ${f.codigo}`,
              texto: textoCobro(f, { monto: d.monto, saldo, caja, nota: d.nota }),
            }));
          })}
        />
      )}

      {/* ── Histórico ── */}
      {modal.kind === 'historico' && (
        <HistoricoVentasModal
          tarjetas={tarjetas} etapaInicial={modal.etapa} hoy={hoy}
          onClose={() => setModal({ kind: 'none' })}
          onAbrir={(t) => setModal({ kind: 'detalle', id: t.venta.id })}
          onWhatsapp={abrirWhatsapp}
          onComprobante={(t) => p.onComprobante(t.venta)}
        />
      )}

      {modal.kind === 'whatsapp' && (
        <Modal title={`💬 ${modal.titulo}`} onClose={() => setModal({ kind: 'none' })}>
          <p className="muted" style={{ marginTop: 0 }}>Revisa el mensaje y envíalo por WhatsApp o cópialo. No se manda nada solo.</p>
          <CompartirWhatsapp texto={modal.texto} />
        </Modal>
      )}
    </>
  );
}

/* ─────────────────────────── Tarjeta ─────────────────────────── */

const TarjetaCard = memo(function TarjetaCard({ t, hoy, onClick }: { t: TarjetaVenta; hoy: string; onClick: () => void }) {
  const v = t.venta;
  const m = montoDe(t);
  const fecha = v.anulada_at || v.facturada_at || v.entregada_at || v.enviada_at || v.updated_at || v.created_at;
  return (
    <div className="kanban-card" role="button" tabIndex={0} onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      style={t.vencida ? { borderColor: 'var(--danger)' } : undefined}>
      <div className="code">
        {v.codigo}
        {v.numero_factura && <span className="muted" style={{ fontWeight: 400 }}> → Fact. {v.numero_factura}</span>}
      </div>
      <div className="prov">{(v.cliente_nombre ?? '').trim() || <span className="muted">Sin cliente todavía</span>}</div>
      {t.resumen && (
        <div className="muted" style={{ fontSize: '.74rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {t.resumen}
        </div>
      )}
      <div className="meta">
        {chipsDe(t, hoy).map((c, i) => <span key={i} className={TONO_CLASE[c.tono]} title={c.titulo}>{c.texto}</span>)}
      </div>
      <div className="foot">
        <span className="total">{m.texto}{m.etiqueta && <span className="muted" style={{ fontWeight: 400, fontSize: '.7rem' }}> {m.etiqueta}</span>}</span>
        <span className="when">{relTime(fecha)}</span>
      </div>
    </div>
  );
});

/* ─────────────────────────── Detalle ─────────────────────────── */

function DetalleTablero({
  t, renglones, hoy, puedeEscribir, puedeAprobar, puedeAnular,
  onClose, onPedir, onAprobar, onFacturar, onCobrar, onRecordar, onWhatsapp, onEditar, onBorrar, onAnular, onComprobante, onFicha,
}: {
  t: TarjetaVenta; renglones: VentaRenglon[]; hoy: string;
  puedeEscribir: boolean; puedeAprobar: boolean; puedeAnular: boolean;
  onClose: () => void; onPedir: () => void; onAprobar: () => void; onFacturar: () => void; onCobrar: () => void;
  onRecordar: () => void; onWhatsapp: () => void; onEditar: () => void; onBorrar: () => void; onAnular: () => void;
  onComprobante: () => void; onFicha: () => void;
}) {
  const v = t.venta;
  const porCobrar = t.etapa === 'despachada' || t.etapa === 'facturada';
  const pasos: { label: string; hecho: boolean; actual: boolean; detalle: string | null }[] = [
    { label: 'Cotización', hecho: true, actual: t.etapa === 'cot', detalle: fechaCorta(v.created_at) },
    { label: 'Despacho pedido', hecho: !!v.enviada_at || v.estado !== 'borrador', actual: t.etapa === 'aprobar', detalle: v.enviada_at ? fechaCorta(v.enviada_at) : null },
    { label: v.documento === 'factura' && !v.facturada_at ? 'Despachada' : 'Nota de entrega', hecho: !!v.entregada_at, actual: t.etapa === 'despachada', detalle: v.entregada_at ? fechaCorta(v.entregada_at) : null },
    { label: 'Factura', hecho: t.etapa === 'facturada' || (t.etapa === 'cobrada' && !!v.numero_control), actual: t.etapa === 'facturada', detalle: v.numero_factura ? `Nº ${v.numero_factura}` : null },
    { label: 'Cobrada', hecho: t.etapa === 'cobrada', actual: t.etapa === 'cobrada', detalle: t.cobrado > 0 ? montoMoneda(t.cobrado, v.moneda) : null },
  ];
  const esAnulada = t.etapa === 'anulada';

  const botonWa: Record<EtapaVenta, string> = {
    cot: '💬 WhatsApp de la cotización',
    aprobar: v.no_despacho_motivo ? '💬 WhatsApp «no aprobado por ahora»' : '💬 WhatsApp para aprobar',
    despachada: '💬 Reporte del despacho',
    facturada: '💬 WhatsApp de la factura',
    cobrada: '💬 Venta finalizada',
    anulada: '💬 WhatsApp de la anulación',
  };

  return (
    <Modal
      title={`${(v.cliente_nombre ?? '').trim() || 'Sin cliente'} · ${v.codigo}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          <button className="btn btn-ghost" onClick={onFicha} title="Renglones con costo y ganancia, cajas y trazabilidad">📋 Ficha completa</button>
          {v.estado !== 'borrador' && <button className="btn btn-ghost" onClick={onComprobante}>📄 PDF</button>}
          <button className="btn btn-ghost" onClick={onWhatsapp}>{botonWa[t.etapa]}</button>
          {porCobrar && t.saldo > 0.01 && <button className="btn btn-ghost" onClick={onRecordar}>🔔 Recordar cobro</button>}
          {t.etapa === 'cot' && puedeEscribir && (
            <>
              <button className="btn btn-ghost" onClick={onBorrar}>🗑 Borrar</button>
              <button className="btn btn-ghost" onClick={onEditar}>✏️ Editar</button>
              <button className="btn btn-primary" onClick={onPedir}>🚚 Pedir despacho</button>
            </>
          )}
          {t.etapa === 'aprobar' && v.estado === 'por_autorizar' && puedeEscribir && (
            <button className="btn btn-ghost" onClick={onEditar} title="Editarla la devuelve a cotización">✏️ Editar</button>
          )}
          {t.etapa === 'aprobar' && v.estado === 'por_autorizar' && puedeAprobar && (
            <button className="btn btn-success" onClick={onAprobar}>✔ Aprobar despacho</button>
          )}
          {t.etapa === 'despachada' && puedeEscribir && <button className="btn btn-ghost" onClick={onFacturar}>🧾 Emitir factura</button>}
          {porCobrar && puedeEscribir && t.saldo > 0.01 && <button className="btn btn-primary" onClick={onCobrar}>💵 Registrar cobro</button>}
          {puedeAnular && !esAnulada && t.etapa !== 'cot' && (
            <button className="btn btn-danger" onClick={onAnular}>{t.etapa === 'aprobar' ? '⊘ Cancelar' : '⊘ Anular'}</button>
          )}
        </>
      }
    >
      {/* Papeles encadenados */}
      <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.7rem' }}>
        {pasos.map((s, i) => (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
            <span className={s.actual ? 'badge info' : s.hecho ? 'badge success' : 'badge'} style={{ opacity: s.hecho || s.actual ? 1 : 0.5 }}>
              {s.label}{s.detalle ? ` · ${s.detalle}` : ''}
            </span>
            {i < pasos.length - 1 && <span className="muted">→</span>}
          </span>
        ))}
      </div>

      <div className="meta" style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        <span className="badge">{TITULO_ETAPA[t.etapa]}</span>
        {chipsDe(t, hoy).map((c, i) => <span key={i} className={TONO_CLASE[c.tono]} title={c.titulo}>{c.texto}</span>)}
      </div>

      {t.etapa === 'aprobar' && v.no_despacho_motivo && (
        <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '.7rem' }}>
          <strong>⏳ No aprobado por ahora</strong> · {MOTIVO_NO_DESPACHO[v.no_despacho_motivo].largo}
          {v.no_despacho_detalle ? `: ${v.no_despacho_detalle}` : ''}
          <div className="muted" style={{ fontSize: '.8rem' }}>{v.no_despacho_por ?? ''}{v.no_despacho_en ? ` · ${dateTime(v.no_despacho_en)}` : ''}</div>
        </div>
      )}
      {t.etapa === 'aprobar' && (v.estado === 'autorizada' || v.estado === 'confirmada') && (
        <div className="card" style={{ borderColor: 'var(--info)', marginBottom: '.7rem' }}>
          Esta venta quedó del flujo anterior ({v.estado}). Ábrela en la <strong>ficha completa</strong> para terminarla.
        </div>
      )}
      {t.etapa === 'cot' && v.rechazo_motivo && (
        <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '.7rem' }}>
          <strong>Devuelta</strong>: {v.rechazo_motivo}
        </div>
      )}
      {esAnulada && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.7rem' }}>
          <strong>Motivo</strong> · {v.motivo_anulacion || '—'}
          <div className="muted" style={{ fontSize: '.8rem' }}>{v.anulada_por ?? ''}{v.anulada_at ? ` · ${dateTime(v.anulada_at)}` : ''}</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '.35rem .9rem', fontSize: '.86rem', marginBottom: '.7rem' }}>
        <div><span className="muted">RIF:</span> <strong>{v.cliente_rif || '—'}</strong></div>
        <div><span className="muted">Fecha:</span> <strong>{fechaCorta(v.created_at)}</strong></div>
        <div><span className="muted">Documento:</span> <strong>{v.documento === 'factura' ? 'Factura' : 'Nota de entrega'}</strong></div>
        <div><span className="muted">Condición:</span> <strong>{v.condicion === 'credito' ? 'Crédito' : 'Contado'}</strong></div>
        {v.actor_name && <div><span className="muted">Hizo:</span> <strong>{v.actor_name}</strong></div>}
        {v.enviada_por && <div><span className="muted">Pidió el despacho:</span> <strong>{v.enviada_por}</strong></div>}
        {v.autorizada_por && v.estado !== 'borrador' && <div><span className="muted">Aprobó:</span> <strong>{v.autorizada_por}</strong></div>}
        {t.etapa === 'cot' && <div><span className="muted">Válida hasta:</span> <strong>{fechaCorta(validaHasta(v))}</strong></div>}
        {v.cobrar_el && <div><span className="muted">Cobrar el:</span> <strong>{fechaCorta(v.cobrar_el)}</strong></div>}
        {v.numero_control && <div><span className="muted">Nº de control:</span> <strong className="mono">{v.numero_control}</strong></div>}
      </div>

      <strong style={{ fontSize: '.84rem' }}>Productos</strong>
      <ul style={{ margin: '.3rem 0 .7rem', paddingLeft: '1.1rem', fontSize: '.86rem' }}>
        {!renglones.length && <li className="muted">Sin renglones.</li>}
        {renglones.map((r) => (
          <li key={r.id}>
            {r.producto_nombre || r.producto_sku || 'Producto'} — {(Number(r.cantidad) || 0).toLocaleString('es-VE', { maximumFractionDigits: 3 })} {r.unidad ?? ''}
            <span className="muted"> · {montoMoneda(r.subtotal, v.moneda)}</span>
          </li>
        ))}
      </ul>

      <div className="card" style={{ margin: 0, padding: '.6rem .85rem', display: 'grid', gap: '.15rem', fontSize: '.88rem' }}>
        {v.iva_monto > 0 && <Fila label={`IVA (${v.iva_pct} %)`} valor={montoMoneda(v.iva_monto, v.moneda)} />}
        {v.igtf_monto > 0 && <Fila label={`IGTF (${v.igtf_pct} %)`} valor={montoMoneda(v.igtf_monto, v.moneda)} />}
        <Fila label="Total" valor={montoMoneda(v.total, v.moneda)} fuerte />
        {v.tasa_bs && v.moneda !== 'Bs' ? <Fila label="En Bs" valor={montoMoneda(round2(v.total * v.tasa_bs), 'Bs')} /> : null}
        {(porCobrar || t.etapa === 'cobrada') && <Fila label="Cobrado" valor={montoMoneda(t.cobrado, v.moneda)} />}
        {porCobrar && <Fila label="Saldo" valor={montoMoneda(t.saldo, v.moneda)} fuerte color={t.vencida ? 'var(--danger)' : 'var(--warning)'} />}
      </div>

      {v.nota && <p className="muted" style={{ margin: '.7rem 0 0' }}>📝 {v.nota}</p>}
    </Modal>
  );
}

function Fila({ label, valor, fuerte, color }: { label: string; valor: string; fuerte?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem' }}>
      <span className="muted">{label}</span>
      <span className="mono" style={{ fontWeight: fuerte ? 700 : 400, color }}>{valor}</span>
    </div>
  );
}

/* ─────────────────────────── Pedir despacho ─────────────────────────── */

function PedirDespachoModal({ t, trabajando, onClose, onConfirmar }: {
  t: TarjetaVenta; trabajando: boolean; onClose: () => void; onConfirmar: () => void;
}) {
  const v = t.venta;
  const cobradoEnCaja = sumaPagoLegs(v.pago_legs);
  const quedaPorCobrar = round2(v.diferencia - cobradoEnCaja) > 0.01;
  const sinCliente = !(v.cliente_nombre ?? '').trim();
  const bloqueo = sinCliente && quedaPorCobrar
    ? 'La venta queda por cobrar y no tiene cliente: edítala y elige el cliente antes de pedir el despacho.'
    : null;
  return (
    <Modal title={`🚚 Pedir despacho · ${v.codigo}`} compact onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={trabajando}>Volver</button>
          <button className="btn btn-primary" disabled={!!bloqueo || trabajando} onClick={onConfirmar}>
            {trabajando ? 'Pidiendo…' : '🚚 Pedir despacho'}
          </button>
        </>
      }>
      <p style={{ marginTop: 0 }}>
        {v.documento === 'factura' ? 'Factura' : 'Nota de entrega'} por <strong>{montoMoneda(v.total, v.moneda)}</strong>
        {v.cliente_nombre ? <> a <strong>{v.cliente_nombre}</strong></> : null}. Le llega el aviso a quienes aprueban despachos.
        No se mueve nada hasta que respondan «¿Se despacha?».
      </p>
      <p className="muted" style={{ fontSize: '.84rem' }}>
        {quedaPorCobrar
          ? 'Al aprobarse sale el material y la venta queda por cobrar en la cuenta del cliente.'
          : 'Ya trae el cobro cargado: al aprobarse entra a caja y sale el material.'}
      </p>
      {bloqueo && <div className="card" style={{ borderColor: 'var(--danger)', margin: 0 }}>{bloqueo}</div>}
    </Modal>
  );
}

/* ─────────────────────────── ¿Se despacha? ─────────────────────────── */

type Respuesta = 'si' | 'no';
type MotivoNo = MotivoNoDespacho | 'no_procede';
const MOTIVOS_NO: { key: MotivoNo; label: string }[] = [
  { key: 'deuda_vencida', label: '⏳ Cliente con deuda vencida' },
  { key: 'sin_cupo', label: '💳 Cliente sin cupo de crédito' },
  { key: 'sin_existencia', label: '📦 No hay existencia en el inventario' },
  { key: 'no_procede', label: '🚫 No procede esta venta' },
  { key: 'otro', label: '📝 Otro' },
];

function AprobarDespachoModal({ t, trabajando, onClose, onSi, onPorAhora, onNoProcede }: {
  t: TarjetaVenta; trabajando: boolean; onClose: () => void;
  onSi: () => void; onPorAhora: (m: MotivoNoDespacho, detalle: string | null) => void; onNoProcede: (j: string) => void;
}) {
  const v = t.venta;
  const [resp, setResp] = useState<Respuesta | null>(null);
  const [motivo, setMotivo] = useState<MotivoNo>('deuda_vencida');
  const [detalle, setDetalle] = useState('');
  const det = detalle.trim();
  const falta = resp === 'no' && (motivo === 'otro' || motivo === 'no_procede') && det.length < 4;

  function enviar() {
    if (resp === 'si') onSi();
    else if (motivo === 'no_procede') onNoProcede(det);
    else onPorAhora(motivo, det || null);
  }

  return (
    <Modal title={`✔ Aprobar despacho · ${v.codigo}`} onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={trabajando}>Volver</button>
          <button className={resp === 'no' ? 'btn btn-danger' : 'btn btn-success'} disabled={!resp || falta || trabajando} onClick={enviar}>
            {trabajando ? 'Guardando…'
              : resp === 'si' ? '✅ Despachar y enviar WhatsApp'
                : resp === 'no' && motivo === 'no_procede' ? '🚫 No aprobar y enviar WhatsApp'
                  : '📲 Guardar motivo y enviar WhatsApp'}
          </button>
        </>
      }>
      <p style={{ marginTop: 0 }}>
        <strong>{(v.cliente_nombre ?? '').trim() || 'Sin cliente'}</strong> · {montoMoneda(v.total, v.moneda)} · {v.condicion === 'credito' ? 'Crédito' : 'Contado'}
        {t.resumen && <span className="muted" style={{ display: 'block', fontSize: '.82rem' }}>{t.resumen}</span>}
      </p>
      <div style={{ fontWeight: 700, marginBottom: '.4rem' }}>¿Se despacha esta venta?</div>
      <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.7rem' }}>
        <button type="button" className={`btn ${resp === 'si' ? 'btn-success' : 'btn-ghost'}`} aria-pressed={resp === 'si'} onClick={() => setResp('si')}>✅ SÍ</button>
        <button type="button" className={`btn ${resp === 'no' ? 'btn-danger' : 'btn-ghost'}`} aria-pressed={resp === 'no'} onClick={() => setResp('no')}>❌ NO</button>
      </div>

      {resp === 'si' && (
        <div className="card" style={{ borderColor: 'var(--success)', margin: 0 }}>
          ✓ Sale el material del inventario y la venta queda <strong>por cobrar</strong> con su nota de entrega
          {sumaPagoLegs(v.pago_legs) > 0 ? ' (lo ya cobrado entra a caja)' : ''}. Si falta existencia, no se mueve nada.
        </div>
      )}

      {resp === 'no' && (
        <div style={{ display: 'grid', gap: '.35rem' }}>
          {MOTIVOS_NO.map((m) => (
            <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer' }}>
              <input type="radio" name="motivo-no" checked={motivo === m.key} onChange={() => setMotivo(m.key)} />
              {m.label}
            </label>
          ))}
          <div className="form-row" style={{ marginTop: '.3rem' }}>
            <label>
              {motivo === 'no_procede' ? 'Justificación *' : motivo === 'otro' ? 'Especifica el motivo *' : 'Detalle (opcional)'}
            </label>
            <textarea className="input" rows={2} value={detalle} maxLength={motivo === 'no_procede' ? 400 : 500}
              onChange={(e) => setDetalle(e.target.value)}
              placeholder={motivo === 'deuda_vencida' ? 'Ej.: VT-2026-0088 sin cobrar' : ''} />
          </div>
          <small className="muted">
            {motivo === 'no_procede'
              ? 'El despacho queda no aprobado y la venta pasa a «Anuladas». Para despachar después, se hace otra cotización.'
              : 'El despacho sigue por aprobar con este motivo a la vista. Cuando se resuelva, se vuelve a «✔ Aprobar despacho».'}
          </small>
        </div>
      )}
    </Modal>
  );
}

/* ─────────────────────────── Emitir factura ─────────────────────────── */

function FacturarModal({ t, trabajando, onClose, onEmitir }: {
  t: TarjetaVenta; trabajando: boolean; onClose: () => void;
  onEmitir: (d: { numeroFactura: string; numeroControl: string; ivaPct: number; igtfPct: number }) => void;
}) {
  const v = t.venta;
  const cobradoEnCaja = sumaPagoLegs(v.pago_legs) > 0;
  const [nf, setNf] = useState(v.numero_factura ?? '');
  const [nc, setNc] = useState(v.numero_control ?? '');
  const [iva, setIva] = useState(String(v.iva_pct > 0 ? v.iva_pct : v.documento === 'factura' ? 0 : 16));
  const [igtf, setIgtf] = useState(String(v.igtf_pct || 0));
  const ivaN = Math.max(0, Number(iva) || 0);
  const igtfN = Math.max(0, Number(igtf) || 0);
  const base = round2(v.subtotal - v.descuento);
  const nuevoTotal = cobradoEnCaja ? v.total : round2(base + round2(base * ivaN / 100) + round2(base * igtfN / 100));
  const listo = nf.trim().length > 0 && nc.trim().length > 0;
  return (
    <Modal title={`🧾 Emitir factura · ${v.codigo}`} onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={trabajando}>Volver</button>
          <button className="btn btn-primary" disabled={!listo || trabajando}
            onClick={() => onEmitir({ numeroFactura: nf, numeroControl: nc, ivaPct: cobradoEnCaja ? v.iva_pct : ivaN, igtfPct: cobradoEnCaja ? v.igtf_pct : igtfN })}>
            {trabajando ? 'Emitiendo…' : '🧾 Emitir factura'}
          </button>
        </>
      }>
      <p className="muted" style={{ marginTop: 0 }}>La factura se emite sin otra autorización: la venta ya se aprobó al despacharla.</p>
      <div className="form-grid">
        <div className="form-row">
          <label>Nº de factura *</label>
          <input className="input mono" value={nf} onChange={(e) => setNf(e.target.value)} autoFocus />
        </div>
        <div className="form-row">
          <label>Nº de control *</label>
          <input className="input mono" value={nc} onChange={(e) => setNc(e.target.value)} />
        </div>
        <div className="form-row">
          <label>IVA %</label>
          <input className="input mono" type="number" min={0} step="any" value={iva} disabled={cobradoEnCaja} onChange={(e) => setIva(e.target.value)} />
        </div>
        <div className="form-row">
          <label>IGTF %</label>
          <input className="input mono" type="number" min={0} step="any" value={igtf} disabled={cobradoEnCaja} onChange={(e) => setIgtf(e.target.value)} />
        </div>
      </div>
      {cobradoEnCaja
        ? <small className="muted">Esta venta ya se cobró en caja al despacharla: los impuestos se quedan como estaban.</small>
        : nuevoTotal !== v.total && (
          <div className="card" style={{ borderColor: 'var(--warning)', margin: '.4rem 0 0' }}>
            El total pasa de <strong>{montoMoneda(v.total, v.moneda)}</strong> a <strong>{montoMoneda(nuevoTotal, v.moneda)}</strong>;
            la diferencia se ajusta en la cuenta por cobrar del cliente.
          </div>
        )}
    </Modal>
  );
}

/* ─────────────────────────── Registrar cobro ─────────────────────────── */

function CobroVentaModal({ t, cajas, trabajando, onClose, onCobrar }: {
  t: TarjetaVenta; cajas: Caja[]; trabajando: boolean; onClose: () => void;
  onCobrar: (d: { cuenta: CuentaPorCobrar; cajaId: string; cuentaCaja: CuentaCaja; monto: number; tasaBs: number; nota: string | null }) => void;
}) {
  const v = t.venta;
  const [cuenta, setCuenta] = useState<CuentaPorCobrar | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cajaId, setCajaId] = useState(cajas[0]?.id ?? '');
  const [cuentaCaja, setCuentaCaja] = useState<CuentaCaja>(v.moneda === 'Bs' ? 'juridica' : 'general');
  const [montoStr, setMontoStr] = useState(String(t.saldo));
  const [tasaStr, setTasaStr] = useState(v.tasa_bs ? String(v.tasa_bs) : '');
  const [nota, setNota] = useState('');
  const esBs = v.moneda === 'Bs';

  useEffect(() => {
    let vivo = true;
    getCuentaPorCobrar(v.cxc_id ?? '')
      .then((c) => { if (vivo) setCuenta(c); })
      .catch(() => { if (vivo) setCuenta(null); })
      .finally(() => { if (vivo) setCargando(false); });
    if (!v.tasa_bs && !esBs) {
      getTasaHoy().then((x) => { if (vivo && x.usd) setTasaStr((s) => s || String(x.usd)); }).catch(() => undefined);
    }
    return () => { vivo = false; };
  }, [v.cxc_id, v.tasa_bs, esBs]);

  const saldoCuenta = cuenta ? round2(Number(cuenta.monto) - (Number(cuenta.abonado) || 0)) : 0;
  const maximo = Math.min(t.saldo, saldoCuenta);
  const monto = round2(Number(montoStr) || 0);
  const error = !cuenta ? null
    : monto <= 0 ? 'Indica el monto.'
      : monto > maximo + 0.01 ? `Máximo ${montoMoneda(maximo, v.moneda)}.`
        : !cajaId ? 'Elige la caja que recibe.'
          : !esBs && (Number(tasaStr) || 0) <= 0 ? `Indica la tasa (Bs por ${v.moneda}).`
            : null;

  return (
    <Modal title={`💵 Registrar cobro · ${v.codigo}`} onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={trabajando}>Volver</button>
          <button className="btn btn-primary" disabled={!cuenta || !!error || trabajando}
            onClick={() => cuenta && onCobrar({ cuenta, cajaId, cuentaCaja, monto, tasaBs: esBs ? 1 : Number(tasaStr) || 0, nota: nota.trim() || null })}>
            {trabajando ? 'Registrando…' : '＋ Registrar cobro'}
          </button>
        </>
      }>
      <p style={{ marginTop: 0 }}>
        Saldo de la venta: <strong className="mono">{montoMoneda(t.saldo, v.moneda)}</strong>. El dinero entra a la caja por el mismo camino que usa Tesorería.
      </p>
      {cargando ? <p className="muted">Cargando la cuenta del cliente…</p> : !cuenta ? (
        <div className="card" style={{ borderColor: 'var(--danger)', margin: 0 }}>
          Esta venta no tiene cuenta por cobrar. Revísala en la ficha completa o en Tesorería.
        </div>
      ) : (
        <>
          {saldoCuenta < t.saldo - 0.01 && (
            <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '.5rem' }}>
              La cuenta de {cuenta.contraparte} tiene saldo {montoMoneda(saldoCuenta, cuenta.moneda)}: parte se cobró desde Tesorería sin indicar la venta.
            </div>
          )}
          <div className="form-grid">
            <div className="form-row">
              <label>Caja que recibe</label>
              <select className="select" value={cajaId} onChange={(e) => setCajaId(e.target.value)}>
                {cajas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            {esBs ? (
              <div className="form-row">
                <label>Cuenta (Bs)</label>
                <select className="select" value={cuentaCaja} onChange={(e) => setCuentaCaja(e.target.value as CuentaCaja)}>
                  <option value="juridica">Jurídica</option>
                  <option value="personal">Personal</option>
                </select>
              </div>
            ) : (
              <div className="form-row">
                <label>Tasa (Bs por {v.moneda})</label>
                <input className="input mono" type="number" min={0} step="any" value={tasaStr} onChange={(e) => setTasaStr(e.target.value)} />
              </div>
            )}
            <div className="form-row">
              <label>Monto ({v.moneda})</label>
              <input className="input mono" type="number" min={0} step="any" value={montoStr} onChange={(e) => setMontoStr(e.target.value)} />
              <small className="muted">Máx. {montoMoneda(maximo, v.moneda)}</small>
            </div>
            <div className="form-row">
              <label>Referencia / nota <span className="muted">(opcional)</span></label>
              <input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nº de transferencia, pago móvil…" />
            </div>
          </div>
          {error && monto > 0 && <small style={{ color: 'var(--danger)' }}>{error}</small>}
        </>
      )}
    </Modal>
  );
}

/* ─────────────────────────── Histórico ─────────────────────────── */

function HistoricoVentasModal({ tarjetas, etapaInicial, hoy, onClose, onAbrir, onWhatsapp, onComprobante }: {
  tarjetas: TarjetaVenta[]; etapaInicial: EtapaVenta | 'todas'; hoy: string; onClose: () => void;
  onAbrir: (t: TarjetaVenta) => void; onWhatsapp: (t: TarjetaVenta) => void; onComprobante: (t: TarjetaVenta) => void;
}) {
  const [etapa, setEtapa] = useState<EtapaVenta | 'todas'>(etapaInicial);
  const [q, setQ] = useState('');
  const deEtapa = tarjetas.filter((t) => etapa === 'todas' || t.etapa === etapa);
  const filas = deEtapa.filter((t) => coincide(t, q));
  return (
    <Modal title={`📚 Histórico · ${etapa === 'todas' ? 'todas las ventas' : TITULO_ETAPA[etapa]}`} size="xl" onClose={onClose}>
      <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        <button className={`btn btn-sm ${etapa === 'todas' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setEtapa('todas')}>Todas · {tarjetas.length}</button>
        {COLUMNAS_VENTAS.map((c) => (
          <button key={c.etapa} className={`btn btn-sm ${etapa === c.etapa ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setEtapa(c.etapa)}>
            {c.titulo} · {tarjetas.filter((t) => t.etapa === c.etapa).length}
          </button>
        ))}
      </div>
      <div className="filterbar">
        <input className="input search" autoFocus placeholder="🔍 Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted" style={{ fontSize: '.82rem' }}>
          {q.trim() ? `${filas.length} de ${deEtapa.length} coinciden` : `${filas.length} en la lista`}
        </span>
      </div>
      <div className="table-wrap" style={{ maxHeight: '60vh', overflow: 'auto' }}>
        <table className="table" style={{ fontSize: '.82rem', minWidth: 860 }}>
          <thead>
            <tr>
              <th>Venta</th><th>Cliente</th><th>Productos</th><th style={{ textAlign: 'right' }}>Monto</th>
              {etapa === 'todas' && <th>Etapa</th>}
              <th>Estado</th><th>Fecha</th><th />
            </tr>
          </thead>
          <tbody>
            {!filas.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center' }}>Nada coincide.</td></tr>}
            {filas.map((t) => {
              const v = t.venta;
              const m = montoDe(t);
              return (
                <tr key={v.id} className="row-selectable" style={{ cursor: 'pointer' }} onClick={() => onAbrir(t)}>
                  <td className="mono">{v.codigo}{v.numero_factura && <div className="muted">Fact. {v.numero_factura}</div>}</td>
                  <td>{v.cliente_nombre || '—'}{v.cliente_rif && <div className="muted mono">{v.cliente_rif}</div>}</td>
                  <td className="muted" style={{ maxWidth: 260 }}>{t.resumen || '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{m.texto}{m.etiqueta && <div className="muted">{m.etiqueta}</div>}</td>
                  {etapa === 'todas' && <td>{TITULO_ETAPA[t.etapa]}</td>}
                  <td>{chipsDe(t, hoy).map((c, i) => <span key={i} className={TONO_CLASE[c.tono]} title={c.titulo} style={{ marginRight: '.2rem' }}>{c.texto}</span>)}</td>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{dateTime(v.updated_at || v.created_at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    {v.estado !== 'borrador' && <button className="btn btn-sm btn-ghost" onClick={() => onComprobante(t)}>📄 PDF</button>}
                    <button className="btn btn-sm btn-ghost" onClick={() => onWhatsapp(t)}>💬 WhatsApp</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
