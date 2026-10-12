/* ============================================================
   MGG · Choferes / Conductores · Pagos por viaje

   Un recibo de viaje junta uno o varios viajes FINALIZADOS de un chofer:
   la tarifa de cada uno, más lo que se le reembolsa (gastó de su bolsillo),
   menos lo que se le descuenta (anticipo sin justificar), más bonos y menos
   otras deducciones. Al guardarlo, los viajes quedan marcados con el recibo
   (no se pueden pagar dos veces). Después se marca PAGADO (con la caja de
   Tesorería si se quiere) y se imprime el recibo. Anular libera los viajes.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { EmptyState } from '@/shared/ui/EmptyState';
import { DecimalInput } from '@/shared/ui/DecimalInput';
import { toast } from '@/shared/ui/Toast';
import { money, date as fmtDate } from '@/shared/lib/format';
import { calcularRecibo, liquidarViaticos, textoRuta, type LineaRecibo } from './choferes';
import {
  anularPago, crearPago, liquidarViaje, marcarPagado,
  type CajaDestino, type Conductor, type PagoViaje, type Viaje, type Viatico,
} from './choferes.repository';
import { CajaSelector } from './CajaSelector';
import { verReciboViajePdf } from './reciboViajePdf';
import { fechaHora, nombreConductor, type PropsTab } from './ChoferesPage';

const ESTADO_PAGO = {
  pendiente: { label: 'Por pagar', clase: 'warning', icon: '⏳' },
  pagado: { label: 'Pagado', clase: 'success', icon: '✅' },
  anulado: { label: 'Anulado', clase: 'danger', icon: '✖' },
} as const;

export function PagosTab({ datos, canWrite, actor, actorName }: PropsTab) {
  const { conductores, viajes, viaticos, pagos, tasa, loading, recargar } = datos;
  const [estado, setEstado] = useState<'' | 'pendiente' | 'pagado' | 'anulado'>('');
  const [choferId, setChoferId] = useState('');
  const [nuevo, setNuevo] = useState(false);
  const [pagar, setPagar] = useState<PagoViaje | null>(null);
  const [anular, setAnular] = useState<PagoViaje | null>(null);
  const [imprimiendo, setImprimiendo] = useState<string | null>(null);

  const porId = useMemo(() => new Map(conductores.map((c) => [c.id, c])), [conductores]);
  const filas = useMemo(() => pagos.filter((p) => (!estado || p.estado === estado) && (!choferId || p.chofer_id === choferId)), [pagos, estado, choferId]);
  const porPagar = useMemo(() => viajes.filter((v) => v.estado === 'finalizado' && !v.pago_id).length, [viajes]);
  const totalPendiente = useMemo(() => pagos.filter((p) => p.estado === 'pendiente').reduce((a, p) => a + p.neto_usd, 0), [pagos]);

  async function imprimir(p: PagoViaje) {
    setImprimiendo(p.id);
    try { await verReciboViajePdf(p, porId.get(p.chofer_id)); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el recibo', 'error'); }
    finally { setImprimiendo(null); }
  }

  async function confirmarAnular() {
    const p = anular; setAnular(null);
    if (!p) return;
    try { await anularPago(p.id, actorName || actor); toast(`${p.numero} anulado; sus viajes vuelven a estar por pagar`, 'success'); await recargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo anular', 'error'); }
  }

  return (
    <div className="descansos">
      <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
        <div className="kpi"><div className="label">Viajes finalizados sin recibo</div><div className="value">{porPagar}</div><div className="muted" style={{ fontSize: '.78rem' }}>listos para un recibo de viaje</div><div className="icon" aria-hidden="true">🏁</div></div>
        <div className="kpi"><div className="label">Recibos por pagar</div><div className="value">{pagos.filter((p) => p.estado === 'pendiente').length}</div><div className="muted" style={{ fontSize: '.78rem' }}>{money(totalPendiente)} en total</div><div className="icon" aria-hidden="true">⏳</div></div>
        <div className="kpi"><div className="label">Pagados</div><div className="value">{pagos.filter((p) => p.estado === 'pagado').length}</div><div className="muted" style={{ fontSize: '.78rem' }}>{money(pagos.filter((p) => p.estado === 'pagado').reduce((a, p) => a + p.neto_usd, 0))} históricos</div><div className="icon" aria-hidden="true">✅</div></div>
        <div className="kpi"><div className="label">Tasa del día</div><div className="value">{tasa ? tasa.toLocaleString('es-VE', { maximumFractionDigits: 2 }) : '—'}<small> Bs/$</small></div><div className="muted" style={{ fontSize: '.78rem' }}>para el equivalente en Bs</div><div className="icon" aria-hidden="true">💱</div></div>
      </div>

      <div className="desc-barra">
        <select className="select" style={{ width: 'auto' }} value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)} aria-label="Estado">
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_PAGO).map(([k, e]) => <option key={k} value={k}>{e.icon} {e.label}</option>)}
        </select>
        <select className="select" style={{ width: 'auto', maxWidth: 220 }} value={choferId} onChange={(e) => setChoferId(e.target.value)} aria-label="Chofer">
          <option value="">Todos los choferes</option>
          {conductores.map((c) => <option key={c.id} value={c.id}>{nombreConductor(c)}</option>)}
        </select>
        <div className="desc-acciones">
          {canWrite && <button className="btn btn-sm btn-primary" onClick={() => setNuevo(true)} disabled={!porPagar} title={porPagar ? '' : 'No hay viajes finalizados sin recibo'}>+ Recibo de viaje</button>}
        </div>
      </div>

      {loading ? <div className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Cargando…</div>
        : !filas.length ? <EmptyState icon="🧾" message={pagos.length ? 'Ningún recibo coincide con el filtro.' : 'Todavía no hay recibos de viaje. Cuando un viaje finalice, créalo con «+ Recibo de viaje».'} />
        : (
          <div className="table-wrap card" style={{ padding: 0 }}>
            <table className="table" style={{ fontSize: '.85rem' }}>
              <thead><tr><th>N°</th><th>Fecha</th><th>Chofer</th><th>Viajes</th><th style={{ textAlign: 'right' }}>Tarifas</th><th style={{ textAlign: 'right' }}>Reemb.</th><th style={{ textAlign: 'right' }}>Deduc.</th><th style={{ textAlign: 'right' }}>Neto</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {filas.map((p) => {
                  const e = ESTADO_PAGO[p.estado];
                  return (
                    <tr key={p.id} style={{ opacity: p.estado === 'anulado' ? .6 : 1 }}>
                      <td className="mono">{p.numero}</td>
                      <td className="mono" style={{ fontSize: '.8rem' }}>{fmtDate(p.created_at)}{p.pagado_at ? <div className="muted">pagado {fmtDate(p.pagado_at)}</div> : null}</td>
                      <td>{nombreConductor(porId.get(p.chofer_id))}</td>
                      <td style={{ fontSize: '.8rem' }}>{p.detalle.map((l) => l.numero).join(', ')}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{money(p.tarifas_usd + p.bonos_usd)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{money(p.reembolsos_usd)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{p.deducciones_usd + p.otras_deducciones_usd ? `- ${money(p.deducciones_usd + p.otras_deducciones_usd)}` : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{money(p.neto_usd)}{p.neto_bs != null ? <div className="muted" style={{ fontWeight: 400, fontSize: '.75rem' }}>{money(p.neto_bs, 'Bs')}</div> : null}</td>
                      <td><span className={`badge ${e.clase}`}>{e.icon} {e.label}</span>{p.movimiento_caja_id ? <div className="muted" style={{ fontSize: '.7rem' }}>💵 Tesorería</div> : null}</td>
                      <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => void imprimir(p)} disabled={imprimiendo === p.id} title="Ver / imprimir el recibo de viaje">{imprimiendo === p.id ? '…' : '🖨'}</button>
                        {canWrite && p.estado === 'pendiente' && <button className="btn btn-sm btn-success" onClick={() => setPagar(p)} title="Marcar pagado">✔ Pagar</button>}
                        {canWrite && p.estado !== 'anulado' && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setAnular(p)} title="Anular">✖</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      {nuevo && (
        <NuevoReciboModal conductores={conductores} viajes={viajes} viaticos={viaticos} tasa={tasa} actor={actor} actorName={actorName}
          onClose={() => setNuevo(false)} onSaved={async () => { setNuevo(false); await recargar(); }} />
      )}
      {pagar && (
        <PagarModal pago={pagar} conductor={porId.get(pagar.chofer_id)} tasa={tasa} actor={actor} actorName={actorName}
          onClose={() => setPagar(null)} onDone={async () => { setPagar(null); await recargar(); }} />
      )}
      {anular && (
        <ConfirmDialog title={`Anular ${anular.numero}`} danger confirmText="Sí, anular"
          message={`El recibo queda como anulado (no se borra) y sus ${anular.detalle.length} viaje(s) vuelven a estar disponibles para otro recibo.${anular.movimiento_caja_id ? ' La salida de caja que registró en Tesorería NO se revierte sola: hazlo desde el libro de la caja.' : ''}`}
          onConfirm={() => { void confirmarAnular(); }} onCancel={() => setAnular(null)} />
      )}
    </div>
  );
}

/* ───────── Nuevo recibo ───────── */
function NuevoReciboModal({ conductores, viajes, viaticos, tasa, actor, actorName, onClose, onSaved }: {
  conductores: Conductor[]; viajes: Viaje[]; viaticos: Viatico[]; tasa: number | null;
  actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [choferId, setChoferId] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [tarifas, setTarifas] = useState<Record<string, number>>({});
  const [bonos, setBonos] = useState<number | null>(null);
  const [otras, setOtras] = useState<number | null>(null);
  const [motivoOtras, setMotivoOtras] = useState('');
  const [tasaUso, setTasaUso] = useState<number | null>(tasa);
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chofer = conductores.find((c) => c.id === choferId) ?? null;
  const candidatos = useMemo(() => viajes.filter((v) => v.chofer_id === choferId && v.estado === 'finalizado' && !v.pago_id)
    .sort((a, b) => a.fecha_salida.localeCompare(b.fecha_salida)), [viajes, choferId]);
  // Choferes con viajes por pagar primero.
  const opciones = useMemo(() => conductores.filter((c) => viajes.some((v) => v.chofer_id === c.id && v.estado === 'finalizado' && !v.pago_id))
    .map((c) => ({ value: c.id, label: nombreConductor(c), hint: `${viajes.filter((v) => v.chofer_id === c.id && v.estado === 'finalizado' && !v.pago_id).length} viaje(s)` })), [conductores, viajes]);

  // Al cambiar de chofer se marcan todos sus viajes por pagar.
  useEffect(() => {
    setSel(new Set(candidatos.map((v) => v.id)));
    setTarifas(Object.fromEntries(candidatos.map((v) => [v.id, v.tarifa_usd])));
  }, [candidatos]);

  /** Liquidación de cada viaje: la congelada o, si no se liquidó, la calculada ahora con sus movimientos. */
  const liqDe = (v: Viaje) => v.liquidacion ?? liquidarViaticos(viaticos.filter((m) => m.viaje_id === v.id));

  const lineas: LineaRecibo[] = useMemo(() => candidatos.filter((v) => sel.has(v.id)).map((v) => {
    const l = liqDe(v);
    return { viaje_id: v.id, numero: v.numero, ruta: textoRuta(v), fecha: (v.llegada_real_at ?? v.fecha_salida).slice(0, 10), tarifa_usd: tarifas[v.id] ?? v.tarifa_usd, reembolso_usd: l.reembolso, deduccion_usd: l.deduccion };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [candidatos, sel, tarifas, viaticos]);

  const calc = useMemo(() => calcularRecibo({ lineas, bonos_usd: bonos ?? 0, otras_deducciones_usd: otras ?? 0, tasa: tasaUso }), [lineas, bonos, otras, tasaUso]);
  const sinLiquidar = candidatos.filter((v) => sel.has(v.id) && !v.liquidado_at && viaticos.some((m) => m.viaje_id === v.id));

  async function guardar() {
    setError(null);
    if (!chofer) { setError('Elige el chofer.'); return; }
    if (!lineas.length) { setError('Marca al menos un viaje.'); return; }
    if ((otras ?? 0) > 0 && !motivoOtras.trim()) { setError('Indica el motivo de las otras deducciones.'); return; }
    setSaving(true);
    try {
      // Liquidación automática: lo que no se liquidó a mano queda liquidado con lo cargado hasta ahora.
      for (const v of sinLiquidar) await liquidarViaje(v.id, liqDe(v), actorName || actor);
      await crearPago({ chofer_id: chofer.id, lineas, calculo: calc, otras_deducciones_motivo: motivoOtras, nota }, actor, actorName);
      toast(`Recibo de viaje creado: ${money(calc.neto_usd)} para ${nombreConductor(chofer)}`, 'success');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo crear el recibo'); setSaving(false); }
  }

  return (
    <Modal title="🧾 Nuevo recibo de viaje" size="lg" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving || !lineas.length}>{saving ? 'Guardando…' : `Crear recibo (${money(calc.neto_usd)})`}</button>
      </>
    }>
      {error && <div className="aviso danger" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">⛔</span><div>{error}</div></div>}
      <div className="form-grid">
        <div className="form-row" style={{ gridColumn: '1 / -1' }}><label htmlFor="rc-chofer">Chofer</label>
          <SearchSelect id="rc-chofer" value={choferId} onChange={setChoferId} options={opciones} placeholder="🔍 Choferes con viajes finalizados sin recibo…" /></div>
      </div>

      {chofer && (
        <>
          <div className="table-wrap" style={{ marginTop: '.6rem' }}>
            <table className="table" style={{ fontSize: '.85rem' }}>
              <thead><tr><th></th><th>Viaje</th><th>Llegó</th><th style={{ textAlign: 'right' }}>Tarifa $</th><th style={{ textAlign: 'right' }}>Reembolso</th><th style={{ textAlign: 'right' }}>Deducción</th><th>Viáticos</th></tr></thead>
              <tbody>
                {!candidatos.length && <tr><td colSpan={7}><EmptyState icon="🏁" message="Este chofer no tiene viajes finalizados sin recibo." /></td></tr>}
                {candidatos.map((v) => {
                  const l = liqDe(v);
                  const marcado = sel.has(v.id);
                  return (
                    <tr key={v.id} style={{ opacity: marcado ? 1 : .55 }}>
                      <td><input type="checkbox" checked={marcado} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(v.id)) n.delete(v.id); else n.add(v.id); return n; })} aria-label={`Incluir ${v.numero}`} /></td>
                      <td className="mono">{v.numero}<div className="muted" style={{ fontSize: '.75rem' }}>{textoRuta(v)}</div></td>
                      <td className="mono" style={{ fontSize: '.8rem' }}>{fechaHora(v.llegada_real_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <DecimalInput className="input mono" style={{ width: 100, textAlign: 'right', padding: '.2rem .4rem' }} value={tarifas[v.id] ?? v.tarifa_usd}
                          onChange={(n) => setTarifas((t) => ({ ...t, [v.id]: n ?? 0 }))} disabled={!marcado} aria-label={`Tarifa de ${v.numero}`} />
                      </td>
                      <td className="mono" style={{ textAlign: 'right', color: l.reembolso ? 'var(--info)' : undefined }}>{l.reembolso ? money(l.reembolso) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right', color: l.deduccion ? 'var(--warning)' : undefined }}>{l.deduccion ? `- ${money(l.deduccion)}` : '—'}</td>
                      <td style={{ fontSize: '.78rem' }}>{v.liquidado_at ? <span className="badge success">liquidado</span> : viaticos.some((m) => m.viaje_id === v.id) ? <span className="badge warning">se liquida al crear</span> : <span className="muted">sin viáticos</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!!sinLiquidar.length && (
            <div className="aviso warning sm" style={{ marginTop: '.5rem' }}><span className="aviso-icono">⚠</span>
              <div>{sinLiquidar.length} viaje(s) tienen viáticos sin liquidar: al crear el recibo se liquidan con lo cargado hasta ahora. Si falta cargar algún gasto, hazlo primero en «Viáticos».</div></div>
          )}

          <div className="form-grid" style={{ marginTop: '.8rem' }}>
            <div className="form-row"><label>(+) Bonos ($)</label><DecimalInput className="input" value={bonos} onChange={setBonos} placeholder="0,00" aria-label="Bonos" /></div>
            <div className="form-row"><label>(-) Otras deducciones ($)</label><DecimalInput className="input" value={otras} onChange={setOtras} placeholder="0,00" aria-label="Otras deducciones" /></div>
            {(otras ?? 0) > 0 && <div className="form-row" style={{ gridColumn: '1 / -1' }}><label htmlFor="rc-motivo">Motivo de las otras deducciones</label><input id="rc-motivo" className="input" value={motivoOtras} onChange={(e) => setMotivoOtras(e.target.value)} placeholder="Multa, daño al vehículo, préstamo…" /></div>}
            <div className="form-row"><label>Tasa BCV (Bs por $)</label><DecimalInput className="input" value={tasaUso} onChange={setTasaUso} placeholder="tasa del día" aria-label="Tasa" /></div>
            <div className="form-row"><label htmlFor="rc-nota">Nota</label><input id="rc-nota" className="input" value={nota} onChange={(e) => setNota(e.target.value)} /></div>
          </div>

          <div className="card" style={{ marginTop: '.6rem', padding: '.6rem .8rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '.4rem', fontSize: '.85rem' }}>
            <div><span className="muted">Tarifas</span><div className="mono">{money(calc.tarifas_usd)}</div></div>
            <div><span className="muted">(+) Reembolsos</span><div className="mono">{money(calc.reembolsos_usd)}</div></div>
            <div><span className="muted">(+) Bonos</span><div className="mono">{money(calc.bonos_usd)}</div></div>
            <div><span className="muted">(-) Deducciones</span><div className="mono">{money(calc.total_deducciones_usd)}</div></div>
            <div><span className="muted">Neto a pagar</span><div className="mono" style={{ fontWeight: 700, fontSize: '1.05rem' }}>{money(calc.neto_usd)}</div>{calc.neto_bs != null && <div className="muted mono" style={{ fontSize: '.78rem' }}>{money(calc.neto_bs, 'Bs')}</div>}</div>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ───────── Marcar pagado ───────── */
function PagarModal({ pago: p, conductor, tasa, actor, actorName, onClose, onDone }: {
  pago: PagoViaje; conductor?: Conductor; tasa: number | null; actor: string; actorName: string | null; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [metodo, setMetodo] = useState('Efectivo $');
  const [caja, setCaja] = useState<CajaDestino | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ejecutar() {
    setError(null); setSaving(true);
    try {
      await marcarPagado(p, { metodo, caja, chofer_nombre: nombreConductor(conductor) }, actor, actorName);
      toast(`${p.numero} pagado${caja ? ' y registrado en Tesorería' : ''}`, 'success');
      await onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo marcar'); setSaving(false); }
  }

  return (
    <Modal title={`✔ Pagar ${p.numero}`} size="md" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-success" onClick={() => void ejecutar()} disabled={saving}>{saving ? 'Guardando…' : `Marcar pagado · ${money(p.neto_usd)}`}</button>
      </>
    }>
      {error && <div className="aviso danger" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">⛔</span><div>{error}</div></div>}
      <p style={{ fontSize: '.88rem', marginTop: 0 }}><strong>{nombreConductor(conductor)}</strong> · {p.detalle.length} viaje(s) · neto <strong>{money(p.neto_usd)}</strong>{p.neto_bs != null ? ` (${money(p.neto_bs, 'Bs')})` : ''}</p>
      <div className="form-row"><label htmlFor="pg-metodo">Método de pago</label>
        <select id="pg-metodo" className="select" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
          {['Efectivo $', 'Efectivo Bs', 'Transferencia Bs', 'Pago móvil', 'Zelle', 'Binance / USDT', 'Otro'].map((m) => <option key={m} value={m}>{m}</option>)}
        </select></div>
      <CajaSelector montoUsd={p.neto_usd} tasa={p.tasa ?? tasa} modo="egreso" onChange={setCaja} disabled={saving} />
      <p className="muted" style={{ fontSize: '.78rem', marginTop: '.5rem' }}>Después de pagar, imprime el recibo con 🖨 y haz que el chofer lo firme.</p>
    </Modal>
  );
}
