import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { date, money } from '@/shared/lib/format';
import type { Cuadre, CuadreMovimiento, ConteoBillete, CategoriaCuadre, TipoMovCuadre } from '@/shared/lib/types';
import {
  CATEGORIAS_CUADRE, catLabel, DENOMINACIONES, totalBilletes, calcularCuadre,
  crearCuadre, actualizarCuadre, setEstadoCuadre, eliminarCuadre,
  agregarMovimiento, actualizarMovimiento, eliminarMovimiento,
  type CuadreInput, type MovCuadreInput,
} from './cuadre.repository';

export function CuadreView({ cuadres, canWrite, actor, actorName, onReload }: {
  cuadres: Cuadre[]; canWrite: boolean; actor: string; actorName: string | null; onReload: () => Promise<void>;
}) {
  const [sel, setSel] = useState<Cuadre | 'nuevo' | null>(null);

  return (
    <div>
      <div className="filterbar" style={{ justifyContent: 'space-between' }}>
        <span className="muted" style={{ fontSize: '.82rem' }}>Cuadre de caja en efectivo: entrada con conteo de billetes, salidas categorizadas, saldo y vales pendientes.</span>
        {canWrite && <button className="btn btn-primary btn-sm" onClick={() => setSel('nuevo')}>+ Nuevo cuadre</button>}
      </div>

      {!cuadres.length ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>Sin cuadres. Creá el primero con “+ Nuevo cuadre”.</p></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {cuadres.map((c) => {
            const { totales } = calcularCuadre(c);
            return (
              <div key={c.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setSel(c)}>
                <div className="card-title"><span>🧾 {c.numero}</span><span className="badge">{c.estado === 'cerrado' ? '🔒 Cerrado' : '● Abierto'}</span></div>
                <div className="muted" style={{ fontSize: '.8rem' }}>{date(c.fecha)} · {c.fuente || '—'} → {c.responsable || '—'}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '.5rem' }}>
                  <div><div className="muted" style={{ fontSize: '.72rem' }}>Saldo</div><div className="mono" style={{ fontWeight: 700 }}>{money(totales.saldo)}</div></div>
                  <div style={{ textAlign: 'right' }}><div className="muted" style={{ fontSize: '.72rem' }}>Vales pend.</div><div className="mono" style={{ fontWeight: 700, color: totales.valesPendientes ? 'var(--warning)' : undefined }}>{money(totales.valesPendientes)}</div></div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {sel && (
        <CuadreEditor
          cuadre={sel === 'nuevo' ? null : sel}
          canWrite={canWrite}
          actor={actor}
          actorName={actorName}
          onClose={() => setSel(null)}
          onSaved={async () => { await onReload(); }}
          onSavedClose={async () => { setSel(null); await onReload(); }}
        />
      )}
    </div>
  );
}

function CuadreEditor({ cuadre, canWrite, actor, actorName, onClose, onSaved, onSavedClose }: {
  cuadre: Cuadre | null; canWrite: boolean; actor: string; actorName: string | null;
  onClose: () => void; onSaved: () => Promise<void>; onSavedClose: () => Promise<void>;
}) {
  const esNuevo = !cuadre;
  const editable = canWrite && (esNuevo || cuadre!.estado === 'abierto');

  const [fecha, setFecha] = useState(cuadre?.fecha ?? new Date().toISOString().slice(0, 10));
  const [fuente, setFuente] = useState(cuadre?.fuente ?? 'Sr. Cheli');
  const [responsable, setResponsable] = useState(cuadre?.responsable ?? '');
  const [obs, setObs] = useState(cuadre?.observaciones ?? '');
  const [montoRecibido, setMontoRecibido] = useState(cuadre?.monto_recibido ? String(cuadre.monto_recibido) : '');
  const [verificado, setVerificado] = useState(cuadre?.verificado ?? false);
  const [billetes, setBilletes] = useState<Record<number, string>>(() => {
    const m: Record<number, string> = {};
    (cuadre?.billetes ?? []).forEach((b) => { m[b.denom] = String(b.cantidad); });
    return m;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movModal, setMovModal] = useState<CuadreMovimiento | 'nuevo' | null>(null);

  const conteoArr: ConteoBillete[] = useMemo(
    () => DENOMINACIONES.map((d) => ({ denom: d, cantidad: Number(billetes[d]) || 0 })).filter((b) => b.cantidad > 0),
    [billetes],
  );
  const totalConteo = totalBilletes(conteoArr);
  const montoNum = Number(montoRecibido) || 0;

  const { movs, totales } = useMemo(
    () => (cuadre ? calcularCuadre({ ...cuadre, monto_recibido: montoNum }) : { movs: [], totales: { entradas: 0, salidas: 0, saldo: montoNum, valesPendientes: 0, conteo: totalConteo, difConteo: totalConteo - montoNum } }),
    [cuadre, montoNum, totalConteo],
  );

  function buildInput(): CuadreInput {
    return { fecha, fuente, responsable, monto_recibido: montoNum, billetes: conteoArr, verificado, observaciones: obs };
  }

  async function guardarHeader(): Promise<string | null> {
    if (!fecha) { setError('Indicá la fecha.'); return null; }
    if (esNuevo) { const c = await crearCuadre(buildInput(), actor, actorName); return c.id; }
    await actualizarCuadre(cuadre!.id, buildInput());
    return cuadre!.id;
  }

  async function guardar() {
    setError(null); setSaving(true);
    try {
      await guardarHeader();
      toast(esNuevo ? 'Cuadre creado' : 'Cuadre actualizado', 'success');
      if (esNuevo) await onSavedClose(); else await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); }
    finally { setSaving(false); }
  }

  async function cerrarToggle() {
    if (!cuadre) return;
    setSaving(true);
    try { await setEstadoCuadre(cuadre.id, cuadre.estado === 'cerrado' ? 'abierto' : 'cerrado', actor); await onSavedClose(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Error', 'error'); setSaving(false); }
  }
  async function eliminar() {
    if (!cuadre) return;
    if (!window.confirm(`¿Eliminar el cuadre ${cuadre.numero}?`)) return;
    setSaving(true);
    try { await eliminarCuadre(cuadre.id); toast('Cuadre eliminado', 'success'); await onSavedClose(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Error', 'error'); setSaving(false); }
  }

  async function onMovSaved() { setMovModal(null); await onSaved(); }

  const titulo = esNuevo ? 'Nuevo cuadre de caja' : `Cuadre ${cuadre!.numero} · ${cuadre!.estado === 'cerrado' ? '🔒 Cerrado' : '● Abierto'}`;
  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cerrar</button>
      {!esNuevo && canWrite && <button className="btn btn-danger" onClick={eliminar} disabled={saving}>Eliminar</button>}
      {!esNuevo && canWrite && <button className="btn btn-ghost" onClick={cerrarToggle} disabled={saving}>{cuadre!.estado === 'cerrado' ? 'Reabrir' : 'Cerrar cuadre'}</button>}
      {editable && <button className="btn btn-primary" onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : (esNuevo ? 'Crear cuadre' : 'Guardar')}</button>}
    </>
  );

  return (
    <Modal title={titulo} size="xl" onClose={onClose} footer={footer}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

      {/* Totales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '.6rem', marginBottom: '.9rem' }}>
        <div className="card" style={{ borderColor: 'var(--primary)' }}><div className="muted" style={{ fontSize: '.72rem' }}>Saldo de caja</div><div className="mono" style={{ fontSize: '1.3rem', fontWeight: 800 }}>{money(totales.saldo)}</div></div>
        <div className="card"><div className="muted" style={{ fontSize: '.72rem' }}>Recibido</div><div className="mono" style={{ fontWeight: 700 }}>{money(montoNum)}</div></div>
        <div className="card"><div className="muted" style={{ fontSize: '.72rem' }}>Salidas</div><div className="mono" style={{ fontWeight: 700, color: 'var(--danger)' }}>{money(totales.salidas)}</div></div>
        <div className="card"><div className="muted" style={{ fontSize: '.72rem' }}>Vales pendientes</div><div className="mono" style={{ fontWeight: 700, color: totales.valesPendientes ? 'var(--warning)' : undefined }}>{money(totales.valesPendientes)}</div></div>
      </div>

      {/* Encabezado */}
      <div className="form-grid">
        <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={!editable} /></div>
        <div className="form-row"><label>Quién suministra</label><input className="input" value={fuente} onChange={(e) => setFuente(e.target.value)} placeholder="Sr. Cheli" disabled={!editable} /></div>
        <div className="form-row"><label>Responsable de la caja</label><input className="input" value={responsable} onChange={(e) => setResponsable(e.target.value)} placeholder="Maikel…" disabled={!editable} /></div>
      </div>

      {/* Conteo de billetes */}
      <div className="card" style={{ marginTop: '.5rem' }}>
        <div className="card-title"><span>💵 Conteo de billetes (USD)</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '.5rem' }}>
          {DENOMINACIONES.map((d) => (
            <div key={d} className="form-row" style={{ margin: 0 }}>
              <label style={{ fontSize: '.74rem' }}>${d} ×</label>
              <input className="input mono" type="number" min={0} step={1} value={billetes[d] ?? ''} onChange={(e) => setBilletes((p) => ({ ...p, [d]: e.target.value }))} disabled={!editable} placeholder="0" />
              <small className="muted">{money(d * (Number(billetes[d]) || 0))}</small>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '.6rem', flexWrap: 'wrap' }}>
          <span>Total contado: <strong className="mono">{money(totalConteo)}</strong></span>
          <div className="form-row" style={{ margin: 0 }}>
            <label style={{ fontSize: '.74rem' }}>Monto recibido (saldo inicial)</label>
            <div style={{ display: 'flex', gap: '.4rem' }}>
              <input className="input mono" type="number" min={0} step="any" value={montoRecibido} onChange={(e) => setMontoRecibido(e.target.value)} disabled={!editable} style={{ width: 130 }} />
              {editable && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMontoRecibido(String(totalConteo))}>= contado</button>}
            </div>
          </div>
          {montoNum > 0 && (
            <span style={{ color: Math.abs(totalConteo - montoNum) < 0.01 ? 'var(--success)' : 'var(--warning)', fontWeight: 600 }}>
              {Math.abs(totalConteo - montoNum) < 0.01 ? '✓ Coincide' : `✗ Difiere ${money(totalConteo - montoNum)}`}
            </span>
          )}
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '.82rem' }}>
            <input type="checkbox" checked={verificado} onChange={(e) => setVerificado(e.target.checked)} disabled={!editable} /> Verificado
          </label>
        </div>
      </div>

      {/* Movimientos */}
      <div className="card" style={{ marginTop: '.6rem' }}>
        <div className="card-title">
          <span>Movimientos (salidas / entradas)</span>
          {!esNuevo && editable && <button className="btn btn-sm btn-primary" onClick={() => setMovModal('nuevo')}>+ Movimiento</button>}
        </div>
        {esNuevo ? (
          <p className="muted" style={{ margin: 0 }}>Creá el cuadre para empezar a cargar movimientos.</p>
        ) : !movs.length ? (
          <p className="muted" style={{ margin: 0 }}>Sin movimientos.</p>
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.8rem' }}>
              <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Beneficiario</th><th style={{ textAlign: 'right' }}>Monto</th><th>Vale</th><th style={{ textAlign: 'right' }}>Saldo</th>{editable && <th></th>}</tr></thead>
              <tbody>
                {movs.map((m) => (
                  <tr key={m.id} style={editable ? { cursor: 'pointer' } : undefined} onClick={editable ? () => setMovModal(m) : undefined}>
                    <td style={{ whiteSpace: 'nowrap' }}>{m.fecha ? date(m.fecha) : '—'}</td>
                    <td>{catLabel(m.categoria)}</td>
                    <td style={{ maxWidth: 260, whiteSpace: 'pre-wrap' }}>{m.descripcion || '—'}</td>
                    <td>{m.beneficiario || '—'}</td>
                    <td className="mono" style={{ textAlign: 'right', color: m.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)' }}>{m.tipo === 'entrada' ? '+' : '−'}{money(m.monto)}</td>
                    <td>{m.es_vale ? (m.pagado ? '✓ pagado' : '⏳ pendiente') : ''}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{money(m.saldo ?? 0)}</td>
                    {editable && <td style={{ textAlign: 'center' }}>✎</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="form-row" style={{ marginTop: '.5rem' }}>
        <label>Observaciones</label>
        <textarea className="input" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} disabled={!editable} />
      </div>

      {movModal && cuadre && (
        <MovModal
          cuadreId={cuadre.id}
          mov={movModal === 'nuevo' ? null : movModal}
          orden={movs.length}
          onClose={() => setMovModal(null)}
          onSaved={onMovSaved}
        />
      )}
    </Modal>
  );
}

function MovModal({ cuadreId, mov, orden, onClose, onSaved }: {
  cuadreId: string; mov: CuadreMovimiento | null; orden: number; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const esNuevo = !mov;
  const [fecha, setFecha] = useState(mov?.fecha ?? new Date().toISOString().slice(0, 10));
  const [tipo, setTipo] = useState<TipoMovCuadre>(mov?.tipo ?? 'salida');
  const [categoria, setCategoria] = useState<CategoriaCuadre | ''>(mov?.categoria ?? '');
  const [descripcion, setDescripcion] = useState(mov?.descripcion ?? '');
  const [beneficiario, setBeneficiario] = useState(mov?.beneficiario ?? '');
  const [monto, setMonto] = useState(mov?.monto ? String(mov.monto) : '');
  const [montoBs, setMontoBs] = useState(mov?.monto_bs ? String(mov.monto_bs) : '');
  const [esVale, setEsVale] = useState(mov?.es_vale ?? false);
  const [pagado, setPagado] = useState(mov?.pagado ?? true);
  const [nota, setNota] = useState(mov?.nota ?? '');
  const [saving, setSaving] = useState(false);

  function build(): MovCuadreInput {
    return { fecha, tipo, categoria: categoria || null, descripcion, beneficiario, monto: Number(monto) || 0, monto_bs: Number(montoBs) || 0, es_vale: esVale, pagado: esVale ? pagado : true, nota };
  }
  async function guardar() {
    if ((Number(monto) || 0) <= 0) { toast('Indicá el monto', 'error'); return; }
    setSaving(true);
    try {
      if (esNuevo) await agregarMovimiento(cuadreId, build(), orden);
      else await actualizarMovimiento(mov!.id, build());
      await onSaved();
    } catch (e) { toast(e instanceof Error ? e.message : 'Error', 'error'); setSaving(false); }
  }
  async function quitar() {
    if (!mov) return;
    setSaving(true);
    try { await eliminarMovimiento(mov.id); await onSaved(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Error', 'error'); setSaving(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      {!esNuevo && <button className="btn btn-danger" onClick={quitar} disabled={saving}>Eliminar</button>}
      <button className="btn btn-primary" onClick={guardar} disabled={saving}>{saving ? '…' : (esNuevo ? 'Agregar' : 'Guardar')}</button>
    </>
  );
  return (
    <Modal title={esNuevo ? 'Nuevo movimiento' : 'Movimiento'} size="md" onClose={onClose} footer={footer}>
      <div className="form-grid">
        <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        <div className="form-row">
          <label>Tipo</label>
          <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as TipoMovCuadre)}>
            <option value="salida">Salida (−)</option>
            <option value="entrada">Entrada (+)</option>
          </select>
        </div>
      </div>
      <div className="form-row">
        <label>Categoría</label>
        <select className="select" value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaCuadre)}>
          <option value="">— sin categoría —</option>
          {CATEGORIAS_CUADRE.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </div>
      <div className="form-row"><label>Descripción</label><input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Pago nómina, compra casiterita…" /></div>
      <div className="form-grid">
        <div className="form-row"><label>Beneficiario</label><input className="input" value={beneficiario} onChange={(e) => setBeneficiario(e.target.value)} placeholder="Nombre" /></div>
        <div className="form-row"><label>Monto (USD)</label><input className="input mono" type="number" min={0} step="any" value={monto} onChange={(e) => setMonto(e.target.value)} /></div>
        <div className="form-row"><label>Monto (Bs) opcional</label><input className="input mono" type="number" min={0} step="any" value={montoBs} onChange={(e) => setMontoBs(e.target.value)} /></div>
      </div>
      <div style={{ display: 'flex', gap: '1.2rem', alignItems: 'center', marginTop: '.3rem' }}>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '.85rem' }}>
          <input type="checkbox" checked={esVale} onChange={(e) => setEsVale(e.target.checked)} /> Es un vale (IOU)
        </label>
        {esVale && (
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '.85rem' }}>
            <input type="checkbox" checked={pagado} onChange={(e) => setPagado(e.target.checked)} /> Ya pagado
          </label>
        )}
      </div>
      <div className="form-row" style={{ marginTop: '.3rem' }}><label>Nota</label><input className="input" value={nota} onChange={(e) => setNota(e.target.value)} /></div>
    </Modal>
  );
}
