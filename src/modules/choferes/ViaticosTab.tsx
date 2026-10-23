/* ============================================================
   MGG · Choferes / Conductores · Viáticos y caja chica

   Tres movimientos, todos en $ (si se pagó en Bs se guarda cuánto y a qué tasa):
     · Anticipo   → lo que se le entrega al chofer antes de salir
     · Gasto      → lo que gastó de verdad en la ruta (combustible, peajes…)
     · Devolución → lo que trajo de vuelta en efectivo
   Con la casilla «Registrar en Tesorería», la plata sale (o entra) de la
   caja elegida y queda enlazada; sin la casilla, queda solo en el módulo.

   Liquidar un viaje finalizado congela anticipos − gastos − devoluciones:
   lo que sobra sin devolver se descuenta en el recibo de viaje y lo que el
   chofer puso de su bolsillo se le reembolsa ahí mismo.
   ============================================================ */
import { useMemo, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { EmptyState } from '@/shared/ui/EmptyState';
import { DecimalInput } from '@/shared/ui/DecimalInput';
import { FechaVe } from '@/shared/ui/FechaVe';
import { toast } from '@/shared/ui/Toast';
import { money, date as fmtDate, formatoCI } from '@/shared/lib/format';
import { CONCEPTOS_GASTO, TIPO_VIATICO, datosConductor, liquidarViaticos, textoLiquidacion, textoRuta, type TipoViatico } from './choferes';
import {
  crearViatico, eliminarViatico, liquidarViaje, reabrirLiquidacion,
  type CajaDestino, type Conductor, type Viaje, type Viatico,
} from './choferes.repository';
import { CajaSelector } from './CajaSelector';
import { fechaHora, nombreConductor, type PropsTab } from './ChoferesPage';

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function ViaticosTab({ datos, canWrite, actor, actorName }: PropsTab) {
  const { conductores, viajes, viaticos, tasa, hoy, loading, recargar } = datos;
  const [choferId, setChoferId] = useState('');
  const [tipo, setTipo] = useState<TipoViatico | ''>('');
  const [vista, setVista] = useState<'movimientos' | 'liquidaciones'>('movimientos');
  const [nuevo, setNuevo] = useState<TipoViatico | null>(null);
  const [borrar, setBorrar] = useState<Viatico | null>(null);
  const [liquidar, setLiquidar] = useState<Viaje | null>(null);

  const porId = useMemo(() => new Map(conductores.map((c) => [c.id, c])), [conductores]);
  const viajePorId = useMemo(() => new Map(viajes.map((v) => [v.id, v])), [viajes]);

  const filas = useMemo(() => viaticos.filter((m) => (!choferId || m.chofer_id === choferId) && (!tipo || m.tipo === tipo)), [viaticos, choferId, tipo]);

  const mes = hoy.slice(0, 7);
  const kpis = useMemo(() => {
    const delMes = viaticos.filter((m) => m.fecha.slice(0, 7) === mes);
    const gastosMes = r2(delMes.filter((m) => m.tipo === 'gasto').reduce((a, m) => a + m.monto_usd, 0));
    const anticiposMes = r2(delMes.filter((m) => m.tipo === 'anticipo').reduce((a, m) => a + m.monto_usd, 0));
    // Abiertos: anticipos de viajes sin liquidar (o sin viaje).
    const abiertos = r2(viaticos.filter((m) => m.tipo === 'anticipo' && !(m.viaje_id && viajePorId.get(m.viaje_id)?.liquidado_at)).reduce((a, m) => a + m.monto_usd, 0));
    return { gastosMes, anticiposMes, abiertos };
  }, [viaticos, mes, viajePorId]);

  // Viajes finalizados: por liquidar (con movimientos) y ya liquidados.
  const porLiquidar = useMemo(() => viajes.filter((v) => v.estado === 'finalizado' && !v.liquidado_at)
    .map((v) => ({ v, liq: liquidarViaticos(viaticos.filter((m) => m.viaje_id === v.id)), n: viaticos.filter((m) => m.viaje_id === v.id).length })), [viajes, viaticos]);
  const liquidados = useMemo(() => viajes.filter((v) => v.estado === 'finalizado' && v.liquidado_at), [viajes]);

  async function confirmarBorrar() {
    const m = borrar; setBorrar(null);
    if (!m) return;
    try { await eliminarViatico(m); toast('Movimiento eliminado', 'success'); await recargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  async function confirmarLiquidar() {
    const v = liquidar; setLiquidar(null);
    if (!v) return;
    try {
      const liq = liquidarViaticos(viaticos.filter((m) => m.viaje_id === v.id));
      await liquidarViaje(v.id, liq, actorName || actor);
      toast(`${v.numero} liquidado: ${liq.reembolso ? `reembolso ${money(liq.reembolso)}` : liq.deduccion ? `deducción ${money(liq.deduccion)}` : 'cuadrado'}`, 'success');
      await recargar();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo liquidar', 'error'); }
  }

  async function reabrir(v: Viaje) {
    try { await reabrirLiquidacion(v.id); toast(`${v.numero} reabierto`, 'success'); await recargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo reabrir', 'error'); }
  }

  return (
    <div className="descansos">
      <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
        <div className="kpi"><div className="label">Anticipos abiertos</div><div className="value">{money(kpis.abiertos)}</div><div className="muted" style={{ fontSize: '.78rem' }}>entregados y aún sin liquidar</div><div className="icon" aria-hidden="true">💵</div></div>
        <div className="kpi"><div className="label">Gastos en ruta del mes</div><div className="value">{money(kpis.gastosMes)}</div><div className="muted" style={{ fontSize: '.78rem' }}>anticipos del mes: {money(kpis.anticiposMes)}</div><div className="icon" aria-hidden="true">🧾</div></div>
        <button type="button" className={`kpi desc-kpi${porLiquidar.filter((x) => x.n).length ? ' alerta' : ''}`} onClick={() => setVista('liquidaciones')}>
          <div className="label">Viajes por liquidar</div><div className="value">{porLiquidar.filter((x) => x.n).length}<small> / {porLiquidar.length} finalizados</small></div>
          <div className="muted" style={{ fontSize: '.78rem' }}>con viáticos cargados</div><div className="icon" aria-hidden="true">⚖</div>
        </button>
        <div className="kpi"><div className="label">Tasa del día</div><div className="value">{tasa ? tasa.toLocaleString('es-VE', { maximumFractionDigits: 2 }) : '—'}<small> Bs/$</small></div><div className="muted" style={{ fontSize: '.78rem' }}>para los gastos en bolívares</div><div className="icon" aria-hidden="true">💱</div></div>
      </div>

      <div className="desc-barra">
        <div className="view-toggle" role="tablist" style={{ margin: 0 }}>
          <button className={vista === 'movimientos' ? 'active' : ''} onClick={() => setVista('movimientos')}>Movimientos</button>
          <button className={vista === 'liquidaciones' ? 'active' : ''} onClick={() => setVista('liquidaciones')}>Liquidaciones por viaje</button>
        </div>
        {vista === 'movimientos' && (
          <>
            <select className="select" style={{ width: 'auto', maxWidth: 220 }} value={choferId} onChange={(e) => setChoferId(e.target.value)} aria-label="Chofer">
              <option value="">Todos los choferes</option>
              {conductores.map((c) => <option key={c.id} value={c.id}>{nombreConductor(c)}</option>)}
            </select>
            <select className="select" style={{ width: 'auto' }} value={tipo} onChange={(e) => setTipo(e.target.value as TipoViatico | '')} aria-label="Tipo">
              <option value="">Todos los tipos</option>
              {Object.entries(TIPO_VIATICO).map(([k, t]) => <option key={k} value={k}>{t.icon} {t.label}</option>)}
            </select>
          </>
        )}
        {canWrite && (
          <div className="desc-acciones">
            <button className="btn btn-sm btn-primary" onClick={() => setNuevo('anticipo')} disabled={!conductores.length}>+ Anticipo</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setNuevo('gasto')} disabled={!conductores.length}>+ Gasto en ruta</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setNuevo('devolucion')} disabled={!conductores.length}>+ Devolución</button>
          </div>
        )}
      </div>

      {loading ? <div className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Cargando…</div>
        : vista === 'movimientos' ? (
          !filas.length ? <EmptyState icon="💵" message={viaticos.length ? 'Ningún movimiento coincide con el filtro.' : 'Todavía no hay viáticos cargados.'} /> : (
            <div className="table-wrap card" style={{ padding: 0 }}>
              <table className="table" style={{ fontSize: '.85rem' }}>
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Chofer</th><th>Viaje</th><th>Concepto</th><th style={{ textAlign: 'right' }}>Monto $</th><th>Pagado en</th><th>Caja</th><th></th></tr></thead>
                <tbody>
                  {filas.map((m) => {
                    const t = TIPO_VIATICO[m.tipo];
                    const v = m.viaje_id ? viajePorId.get(m.viaje_id) : null;
                    return (
                      <tr key={m.id}>
                        <td className="mono">{fmtDate(m.fecha)}</td>
                        <td><span className={`badge ${m.tipo === 'anticipo' ? 'primary' : m.tipo === 'gasto' ? 'warning' : 'success'}`}>{t.icon} {t.label}</span></td>
                        <td>{nombreConductor(porId.get(m.chofer_id))}</td>
                        <td className="mono" style={{ fontSize: '.8rem' }}>{v ? `${v.numero}` : <span className="muted">caja chica</span>}{v ? <div className="muted">{textoRuta(v)}</div> : null}</td>
                        <td>{m.concepto}{m.comprobante ? <div className="muted" style={{ fontSize: '.75rem' }}>Comprobante {m.comprobante}</div> : null}{m.nota ? <div className="muted" style={{ fontSize: '.75rem' }}>{m.nota}</div> : null}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{money(m.monto_usd)}</td>
                        <td className="mono" style={{ fontSize: '.8rem' }}>{m.moneda === 'Bs' && m.monto_moneda != null ? `${money(m.monto_moneda, 'Bs')}${m.tasa ? ` @ ${m.tasa.toLocaleString('es-VE', { maximumFractionDigits: 2 })}` : ''}` : '$'}</td>
                        <td>{m.movimiento_caja_id ? <span className="badge info" title="Movió una caja de Tesorería">💵 Tesorería</span> : <span className="muted" style={{ fontSize: '.78rem' }}>—</span>}</td>
                        <td className="actions">
                          {canWrite && !m.movimiento_caja_id && !(v?.liquidado_at) && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setBorrar(m)} title="Eliminar">🗑</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div className="card">
              <div className="card-title">⚖ Finalizados sin liquidar ({porLiquidar.length})</div>
              {!porLiquidar.length ? <EmptyState icon="✅" message="No hay viajes finalizados pendientes de liquidación." /> : (
                <div className="table-wrap"><table className="table" style={{ fontSize: '.85rem' }}>
                  <thead><tr><th>Viaje</th><th>Chofer</th><th>Llegó</th><th style={{ textAlign: 'right' }}>Anticipos</th><th style={{ textAlign: 'right' }}>Gastos</th><th style={{ textAlign: 'right' }}>Devuelto</th><th style={{ textAlign: 'right' }}>Saldo</th><th></th></tr></thead>
                  <tbody>{porLiquidar.map(({ v, liq, n }) => (
                    <tr key={v.id}>
                      <td className="mono">{v.numero}<div className="muted" style={{ fontSize: '.75rem' }}>{textoRuta(v)}</div></td>
                      <td>{nombreConductor(porId.get(v.chofer_id))}</td>
                      <td className="mono" style={{ fontSize: '.8rem' }}>{fechaHora(v.llegada_real_at)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{money(liq.anticipos)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{money(liq.gastos)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{money(liq.devoluciones)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: liq.saldo > 0 ? 'var(--warning)' : liq.saldo < 0 ? 'var(--info)' : undefined }}>
                        {liq.saldo > 0 ? `descuenta ${money(liq.saldo)}` : liq.saldo < 0 ? `reembolsa ${money(-liq.saldo)}` : n ? 'cuadra' : 'sin viáticos'}
                      </td>
                      <td className="actions">{canWrite && <button className="btn btn-sm btn-primary" onClick={() => setLiquidar(v)}>Liquidar</button>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </div>
            <div className="card">
              <div className="card-title">✅ Liquidados ({liquidados.length})</div>
              {!liquidados.length ? <div className="muted" style={{ fontSize: '.85rem' }}>Todavía no hay viajes liquidados.</div> : (
                <div className="table-wrap"><table className="table" style={{ fontSize: '.85rem' }}>
                  <thead><tr><th>Viaje</th><th>Chofer</th><th>Liquidado</th><th style={{ textAlign: 'right' }}>Anticipos</th><th style={{ textAlign: 'right' }}>Gastos</th><th style={{ textAlign: 'right' }}>Resultado</th><th>Recibo</th><th></th></tr></thead>
                  <tbody>{liquidados.slice(0, 200).map((v) => {
                    const l = v.liquidacion;
                    return (
                      <tr key={v.id}>
                        <td className="mono">{v.numero}<div className="muted" style={{ fontSize: '.75rem' }}>{textoRuta(v)}</div></td>
                        <td>{nombreConductor(porId.get(v.chofer_id))}</td>
                        <td className="mono" style={{ fontSize: '.8rem' }}>{fechaHora(v.liquidado_at)}<div className="muted">{v.liquidado_por}</div></td>
                        <td className="mono" style={{ textAlign: 'right' }}>{money(l?.anticipos ?? 0)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{money(l?.gastos ?? 0)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{l?.reembolso ? `reembolso ${money(l.reembolso)}` : l?.deduccion ? `deducción ${money(l.deduccion)}` : 'cuadrado'}</td>
                        <td>{v.pago_id ? <span className="badge success">🧾 en recibo</span> : <span className="muted" style={{ fontSize: '.78rem' }}>pendiente</span>}</td>
                        <td className="actions">{canWrite && !v.pago_id && <button className="btn btn-sm btn-ghost" onClick={() => void reabrir(v)} title="Reabrir para corregir viáticos">↺</button>}</td>
                      </tr>
                    );
                  })}</tbody>
                </table></div>
              )}
            </div>
          </div>
        )}

      {nuevo && (
        <ViaticoModal tipo={nuevo} conductores={conductores} viajes={viajes} tasa={tasa} hoy={hoy} actor={actor} actorName={actorName}
          onClose={() => setNuevo(null)} onSaved={async () => { setNuevo(null); await recargar(); }} />
      )}
      {borrar && (
        <ConfirmDialog title="Eliminar movimiento" danger confirmText="Sí, eliminar"
          message={`Se borra ${TIPO_VIATICO[borrar.tipo].label.toLowerCase()} de ${money(borrar.monto_usd)} (${borrar.concepto}). No movió caja, así que no hay nada que revertir en Tesorería.`}
          onConfirm={() => { void confirmarBorrar(); }} onCancel={() => setBorrar(null)} />
      )}
      {liquidar && (
        <ConfirmDialog title={`Liquidar ${liquidar.numero}`} success confirmText="Liquidar"
          message={`${textoRuta(liquidar)} · ${nombreConductor(porId.get(liquidar.chofer_id))}. ${textoLiquidacion(liquidarViaticos(viaticos.filter((m) => m.viaje_id === liquidar.id)))} Después de liquidar, los movimientos del viaje quedan congelados (se puede reabrir mientras no entre en un recibo).`}
          onConfirm={() => { void confirmarLiquidar(); }} onCancel={() => setLiquidar(null)} />
      )}
    </div>
  );
}

/* ───────── Nuevo movimiento ───────── */
function ViaticoModal({ tipo, conductores, viajes, tasa, hoy, actor, actorName, onClose, onSaved }: {
  tipo: TipoViatico; conductores: Conductor[]; viajes: Viaje[]; tasa: number | null; hoy: string;
  actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [choferId, setChoferId] = useState('');
  const [viajeId, setViajeId] = useState('');
  const [concepto, setConcepto] = useState(tipo === 'anticipo' ? 'Anticipo de viáticos' : tipo === 'devolucion' ? 'Devolución de viáticos' : '');
  const [moneda, setMoneda] = useState<'USD' | 'Bs'>('USD');
  const [monto, setMonto] = useState<number | null>(null);
  const [tasaUso, setTasaUso] = useState<number | null>(tasa);
  const [fecha, setFecha] = useState(hoy);
  const [comprobante, setComprobante] = useState('');
  const [nota, setNota] = useState('');
  const [caja, setCaja] = useState<CajaDestino | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = TIPO_VIATICO[tipo];

  const chofer = conductores.find((c) => c.id === choferId) ?? null;
  // Viajes del chofer que pueden recibir viáticos: no liquidados ni cancelados.
  const viajesChofer = viajes.filter((v) => v.chofer_id === choferId && v.estado !== 'cancelado' && !v.liquidado_at)
    .sort((a, b) => b.fecha_salida.localeCompare(a.fecha_salida));
  const viaje = viajes.find((v) => v.id === viajeId) ?? null;

  const montoUsd = useMemo(() => {
    if (monto == null || monto <= 0) return 0;
    if (moneda === 'USD') return r2(monto);
    return tasaUso && tasaUso > 0 ? r2(monto / tasaUso) : 0;
  }, [monto, moneda, tasaUso]);

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!chofer) { setError('Elige el chofer.'); return; }
    if (montoUsd <= 0) { setError(moneda === 'Bs' && !(tasaUso && tasaUso > 0) ? 'Indica la tasa para convertir los bolívares a dólares.' : 'Indica el monto.'); return; }
    if (tipo === 'gasto' && !concepto.trim()) { setError('Elige el concepto del gasto.'); return; }
    setSaving(true);
    try {
      await crearViatico({
        chofer_id: chofer.id, viaje_id: viajeId || null, tipo, concepto,
        monto_usd: montoUsd, moneda, monto_moneda: moneda === 'Bs' ? monto : null, tasa: moneda === 'Bs' ? tasaUso : null,
        fecha, comprobante, nota, caja, chofer_nombre: nombreConductor(chofer), viaje_numero: viaje?.numero ?? null,
      }, actor, actorName);
      toast(`${t.label} de ${money(montoUsd)} registrado${caja ? ' y movido en Tesorería' : ''}`, 'success');
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal title={`${t.icon} ${t.label}`} size="md" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" form="viat-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </>
    }>
      <form id="viat-form" onSubmit={guardar}>
        {error && <div className="aviso danger" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">⛔</span><div>{error}</div></div>}
        <div className="form-grid">
          <div className="form-row"><label htmlFor="vt-chofer">Chofer</label>
            <SearchSelect id="vt-chofer" value={choferId} onChange={(id) => { setChoferId(id); setViajeId(''); }} placeholder="🔍 Buscar chofer…"
              options={conductores.filter((c) => c.activo).map((c) => ({ value: c.id, label: nombreConductor(c), hint: [formatoCI(datosConductor(c).cedula), c.externo ? 'externo' : null].filter(Boolean).join(' · ') || undefined }))} /></div>
          <div className="form-row"><label htmlFor="vt-viaje">Viaje (opcional)</label>
            <select id="vt-viaje" className="select" value={viajeId} onChange={(e) => setViajeId(e.target.value)} disabled={!choferId}>
              <option value="">Caja chica (sin viaje)</option>
              {viajesChofer.map((v) => <option key={v.id} value={v.id}>{v.numero} · {textoRuta(v)} · {v.estado}</option>)}
            </select>
            <span className="muted" style={{ fontSize: '.75rem' }}>Con viaje, entra en su liquidación. Sin viaje es caja chica del chofer.</span></div>
          <div className="form-row" style={{ gridColumn: '1 / -1' }}><label htmlFor="vt-concepto">Concepto</label>
            {tipo === 'gasto'
              ? <select id="vt-concepto" className="select" value={concepto} onChange={(e) => setConcepto(e.target.value)} required>
                  <option value="">— elige —</option>
                  {CONCEPTOS_GASTO.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              : <input id="vt-concepto" className="input" value={concepto} onChange={(e) => setConcepto(e.target.value)} required />}</div>
          <div className="form-row"><label htmlFor="vt-moneda">Se {tipo === 'devolucion' ? 'devolvió' : 'pagó'} en</label>
            <select id="vt-moneda" className="select" value={moneda} onChange={(e) => setMoneda(e.target.value as 'USD' | 'Bs')}>
              <option value="USD">Dólares ($)</option><option value="Bs">Bolívares (Bs)</option>
            </select></div>
          <div className="form-row"><label>Monto ({moneda === 'Bs' ? 'Bs' : '$'})</label>
            <DecimalInput className="input" value={monto} onChange={setMonto} placeholder="0,00" aria-label="Monto" /></div>
          {moneda === 'Bs' && (
            <div className="form-row"><label>Tasa (Bs por $)</label>
              <DecimalInput className="input" value={tasaUso} onChange={setTasaUso} placeholder="tasa BCV" aria-label="Tasa" />
              <span className="muted" style={{ fontSize: '.75rem' }}>Equivale a <strong>{money(montoUsd)}</strong>{tasa ? ` · tasa del día ${tasa.toLocaleString('es-VE', { maximumFractionDigits: 2 })}` : ''}.</span></div>
          )}
          <div className="form-row"><label htmlFor="vt-fecha">Fecha</label><FechaVe id="vt-fecha" value={fecha} onChange={setFecha} /></div>
          {tipo === 'gasto' && <div className="form-row"><label htmlFor="vt-comp">N° de factura / comprobante</label><input id="vt-comp" className="input" value={comprobante} onChange={(e) => setComprobante(e.target.value)} /></div>}
          <div className="form-row" style={{ gridColumn: '1 / -1' }}><label htmlFor="vt-nota">Nota</label><input id="vt-nota" className="input" value={nota} onChange={(e) => setNota(e.target.value)} /></div>
        </div>
        <CajaSelector montoUsd={montoUsd} tasa={tasaUso ?? tasa} modo={tipo === 'devolucion' ? 'ingreso' : 'egreso'} onChange={setCaja} disabled={saving} />
        {tipo === 'gasto' && <p className="muted" style={{ fontSize: '.75rem', marginTop: '.4rem' }}>Un gasto que el chofer pagó con su anticipo NO mueve caja (la plata ya salió con el anticipo). Marca la caja solo si la empresa lo pagó directo.</p>}
      </form>
    </Modal>
  );
}
