import { useEffect, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { money, num } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  listPerdidaEsmeralda, crearFilaPerdida, eliminarFilaPerdida,
  type FilaPerdida, type EstiloPerdida,
} from './esmeraldaPerdida.repository';

/** Estilo de fila según el rol del concepto en el reporte. */
function trStyle(estilo: string): React.CSSProperties {
  if (estilo === 'total') return { fontWeight: 700, background: 'var(--bg-1)' };
  if (estilo === 'destacado') return { fontWeight: 800, background: 'rgba(239,68,68,.10)', color: 'var(--danger)' };
  if (estilo === 'header') return { fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' };
  return {};
}
const cellMoney = (v: number | null) => (v == null ? '' : money(v));
const cellNum = (v: number | null) => (v == null ? '' : num(v));
/** Lee un input numérico: vacío → null, si no Number. */
const toNum = (s: string): number | null => (s.trim() === '' ? null : Number(s));
/** yyyy-mm-dd (input date) → dd-mm-aaaa (formato de las filas del Excel). */
const isoADMY = (iso: string): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}-${m}-${y}` : iso;
};

/**
 * Vista «CUENTA DE PERDIDA CON ALI» — réplica fiel de la hoja del Excel.
 * Ledger de la deuda con Alí: cada envío sube la deuda; los Kg recibidos (valorizados)
 * la abonan; la última fila refleja la pérdida total en efectivo.
 */
export function CuentaPerdidaAliView({ centro = 'LA ESMERALDA ALI', canWrite = false, onVolver }: { centro?: string; canWrite?: boolean; onVolver?: () => void }) {
  const [filas, setFilas] = useState<FilaPerdida[]>([]);
  const [loading, setLoading] = useState(true);
  const [agregar, setAgregar] = useState(false);

  const recargar = () => listPerdidaEsmeralda('cuenta').then(setFilas);
  useEffect(() => {
    let cancel = false;
    recargar()
      .catch((e) => toast(e instanceof Error ? e.message : 'Error', 'error'))
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, []);
  useRealtime(['acopio_esmeralda_perdida'], recargar);

  // Cabecera (fórmulas de la hoja): total enviado, Kg recibidos, abono, deuda total.
  const totalEnviado = filas.reduce((a, f) => a + (f.v1 ?? 0), 0);
  const totalKg = filas.reduce((a, f) => a + (f.v2 ?? 0), 0);
  const totalAbono = filas.reduce((a, f) => a + (f.v4 ?? 0), 0);
  const deudaTotal = totalEnviado - totalAbono;

  async function borrar(f: FilaPerdida) {
    if (!window.confirm(`¿Eliminar la fila «${f.descripcion || f.etiqueta}»?`)) return;
    try { await eliminarFilaPerdida(f.id); toast('Fila eliminada', 'success'); await recargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>📉 Cuenta de Pérdida con Alí · {centro}</h1>
          <p className="hint muted">Deuda con el comercializador Alí: cada efectivo enviado sube la deuda; los Kg de casiterita recibidos (valorizados a $/Kg) la abonan. El saldo final es la pérdida reflejada en efectivo.</p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          {canWrite && <button className="btn btn-primary" onClick={() => setAgregar(true)}>+ Agregar movimiento</button>}
          {onVolver && <button className="btn btn-ghost" onClick={onVolver}>← Volver a Acopio</button>}
        </div>
      </div>

      {/* Tarjetas resumen (fórmulas de la cabecera de la hoja) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        <div className="card" style={{ borderColor: 'var(--primary)' }}>
          <div className="card-title"><span>💵 Total enviado</span></div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary-3)' }} className="mono">{money(totalEnviado)}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>Σ montos de factura / efectivo enviado</div>
        </div>
        <div className="card" style={{ borderColor: 'var(--success)' }}>
          <div className="card-title"><span>⚖ Kg recibidos</span></div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--success)' }} className="mono">{num(totalKg)} Kg</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>casiterita recibida en recepción #46</div>
        </div>
        <div className="card">
          <div className="card-title"><span>↩ Abono (Kg valorizados)</span></div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700 }} className="mono">{money(totalAbono)}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>Kg recibidos × $/Kg</div>
        </div>
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <div className="card-title"><span>🔻 Deuda total (pérdida)</span></div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--danger)' }} className="mono">{money(deudaTotal)}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>total enviado − abono</div>
        </div>
      </div>

      {loading ? (
        <EmptyState message="Cargando…" icon="⏳" />
      ) : filas.length === 0 ? (
        <EmptyState message="No hay filas en la cuenta de pérdida." />
      ) : (
        <div className="card">
          <div className="card-title" style={{ marginBottom: '.6rem' }}><span>ALI · CA LA ESMERALDA</span></div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.86rem' }}>
              <thead>
                <tr>
                  <th>Fecha</th><th>Descripción</th>
                  <th style={{ textAlign: 'right' }}>Monto factura</th>
                  <th style={{ textAlign: 'right' }}>Kg entregados</th>
                  <th style={{ textAlign: 'right' }}>$ por Kg</th>
                  <th style={{ textAlign: 'right' }}>Abono</th>
                  <th style={{ textAlign: 'right' }}>Total deuda</th>
                  {canWrite && <th />}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id} style={trStyle(f.estilo)}>
                    <td style={{ whiteSpace: 'nowrap' }}>{f.etiqueta}</td>
                    <td style={{ whiteSpace: 'pre-line', minWidth: 240 }}>{f.descripcion}</td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{cellMoney(f.v1)}</td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{cellNum(f.v2)}</td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{cellMoney(f.v3)}</td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{cellMoney(f.v4)}</td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{cellMoney(f.v5)}</td>
                    {canWrite && (
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-sm btn-ghost" title="Eliminar fila" onClick={() => borrar(f)}>🗑</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {agregar && (
        <AgregarCuentaModal
          deudaPrevia={filas.length ? (filas[filas.length - 1].v5 ?? 0) : 0}
          onClose={() => setAgregar(false)}
          onSaved={async () => { setAgregar(false); await recargar(); }}
        />
      )}
    </div>
  );
}

/** Formulario para una fila de la CUENTA DE PERDIDA (campos de esa hoja).
 *  Abono = Kg × $/Kg (autocalculado, editable). Total deuda = deuda previa + monto − abono. */
function AgregarCuentaModal({ deudaPrevia, onClose, onSaved }: {
  deudaPrevia: number; onClose: () => void; onSaved: () => void;
}) {
  const [fecha, setFecha] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState('');
  const [kg, setKg] = useState('');
  const [precio, setPrecio] = useState('');
  const [abono, setAbono] = useState('');
  const [destacar, setDestacar] = useState(false);
  const [busy, setBusy] = useState(false);

  // Abono sugerido = Kg × $/Kg (si el usuario no lo escribió a mano).
  const abonoCalc = (Number(kg) || 0) * (Number(precio) || 0);
  const abonoFinal = abono.trim() !== '' ? Number(abono) : abonoCalc;
  const totalDeuda = deudaPrevia + (Number(monto) || 0) - (abonoFinal || 0);

  async function guardar() {
    if (!fecha.trim() && !descripcion.trim()) { toast('Indicá al menos la fecha o la descripción.', 'error'); return; }
    setBusy(true);
    try {
      await crearFilaPerdida({
        seccion: 'cuenta',
        etiqueta: isoADMY(fecha.trim()) || '—',
        descripcion: descripcion.trim() || null,
        v1: toNum(monto),
        v2: toNum(kg),
        v3: toNum(precio),
        v4: abono.trim() !== '' ? Number(abono) : (abonoCalc || null),
        v5: totalDeuda,
        estilo: destacar ? 'destacado' : 'normal',
      });
      toast('Movimiento agregado', 'success');
      onSaved();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="➕ Nuevo movimiento · Cuenta de Pérdida" size="md" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : 'Guardar'}</button>
      </>}>
      <div className="form-grid">
        <div className="form-row">
          <label>Fecha</label>
          <input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <div className="form-row" style={{ gridColumn: '1 / -1' }}>
          <label>Descripción</label>
          <input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej.: ENVIADO CASH A CENTRO DE ACOPIO" />
        </div>
        <div className="form-row">
          <label>Monto factura ($)</label>
          <input className="input mono" type="number" step="any" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
        </div>
        <div className="form-row">
          <label>Kg entregados</label>
          <input className="input mono" type="number" step="any" value={kg} onChange={(e) => setKg(e.target.value)} placeholder="0" />
        </div>
        <div className="form-row">
          <label>$ por Kg</label>
          <input className="input mono" type="number" step="any" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="0.00" />
        </div>
        <div className="form-row">
          <label>Abono ($) <span className="muted" style={{ textTransform: 'none' }}>· auto = Kg × $/Kg</span></label>
          <input className="input mono" type="number" step="any" value={abono} onChange={(e) => setAbono(e.target.value)} placeholder={abonoCalc ? abonoCalc.toFixed(2) : '0.00'} />
        </div>
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontSize: '.85rem', marginBottom: '.6rem' }}>
        <input type="checkbox" checked={destacar} onChange={(e) => setDestacar(e.target.checked)} />
        Marcar como fila destacada (pérdida total)
      </label>
      <div className="card" style={{ background: 'var(--bg-1)' }}>
        <div className="mono" style={{ fontSize: '.9rem' }}>
          Abono aplicado: <strong>{money(abonoFinal || 0)}</strong> · Total deuda resultante: <strong style={{ color: totalDeuda < 0 ? 'var(--success)' : 'var(--danger)' }}>{money(totalDeuda)}</strong>
        </div>
        <div className="muted" style={{ fontSize: '.72rem', marginTop: '.2rem' }}>Total deuda = deuda previa ({money(deudaPrevia)}) + monto − abono.</div>
      </div>
    </Modal>
  );
}

/**
 * Vista «CUADRO RESUMEN DEL VALOR DE LA PÉRDIDA TOTAL» — réplica fiel de la hoja.
 * Total enviado − compras de casiterita y gastos = saldo que no devolvió Alí;
 * más el mineral que no llegó y el contaminado con hierro = valor total de la pérdida.
 */
export function CuadroResumenPerdidaView({ centro = 'LA ESMERALDA ALI', canWrite = false, onVolver }: { centro?: string; canWrite?: boolean; onVolver?: () => void }) {
  const [filas, setFilas] = useState<FilaPerdida[]>([]);
  const [loading, setLoading] = useState(true);
  const [agregar, setAgregar] = useState(false);

  const recargar = () => listPerdidaEsmeralda('cuadro').then(setFilas);
  useEffect(() => {
    let cancel = false;
    recargar()
      .catch((e) => toast(e instanceof Error ? e.message : 'Error', 'error'))
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, []);
  useRealtime(['acopio_esmeralda_perdida'], recargar);

  // Cifras clave (de la hoja): saldo que no devolvió Alí y valor total de la pérdida.
  const saldoNoDevuelto = filas.find((f) => f.etiqueta.startsWith('SALDO DE CAJA QUE NO DEVOLVIO'))?.v4 ?? 0;
  const valorTotal = filas.find((f) => f.etiqueta.startsWith('VALOR TOTAL'))?.v4 ?? 0;

  async function borrar(f: FilaPerdida) {
    if (!window.confirm(`¿Eliminar la fila «${f.etiqueta}»?`)) return;
    try { await eliminarFilaPerdida(f.id); toast('Fila eliminada', 'success'); await recargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🧾 Cuadro Resumen del Valor de la Pérdida Total · {centro}</h1>
          <p className="hint muted">Descompone la pérdida: del total enviado se restan las compras de casiterita y los gastos; el saldo que no devolvió Alí más el mineral faltante y el contaminado con hierro dan el valor total de la pérdida.</p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          {canWrite && <button className="btn btn-primary" onClick={() => setAgregar(true)}>+ Agregar movimiento</button>}
          {onVolver && <button className="btn btn-ghost" onClick={onVolver}>← Volver a Acopio</button>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <div className="card-title"><span>💰 Saldo que no devolvió Alí</span></div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--danger)' }} className="mono">{money(saldoNoDevuelto)}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>total enviado − compras y gastos</div>
        </div>
        <div className="card" style={{ borderColor: 'var(--danger)', background: 'rgba(239,68,68,.06)' }}>
          <div className="card-title"><span>🔻 Valor total de la pérdida</span></div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--danger)' }} className="mono">{money(valorTotal)}</div>
          <div className="muted" style={{ fontSize: '.72rem' }}>efectivo + Kg que no aparecieron + Kg con hierro</div>
        </div>
      </div>

      {loading ? (
        <EmptyState message="Cargando…" icon="⏳" />
      ) : filas.length === 0 ? (
        <EmptyState message="No hay filas en el cuadro resumen." />
      ) : (
        <div className="card">
          <div className="card-title" style={{ marginBottom: '.6rem' }}><span>CUADRO RESUMEN DEL VALOR DE LA PÉRDIDA TOTAL</span></div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.86rem' }}>
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th style={{ textAlign: 'right' }}>Cantidad</th>
                  <th style={{ textAlign: 'right' }}>$ / Kg</th>
                  <th style={{ textAlign: 'right' }}>Subtotal</th>
                  <th style={{ textAlign: 'right' }}>Monto</th>
                  {canWrite && <th />}
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id} style={trStyle(f.estilo)}>
                    <td style={{ minWidth: 280 }}>{f.etiqueta}</td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{cellNum(f.v1)}</td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{cellMoney(f.v2)}</td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{cellMoney(f.v3)}</td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{cellMoney(f.v4)}</td>
                    {canWrite && (
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-sm btn-ghost" title="Eliminar fila" onClick={() => borrar(f)}>🗑</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {agregar && (
        <AgregarCuadroModal
          onClose={() => setAgregar(false)}
          onSaved={async () => { setAgregar(false); await recargar(); }}
        />
      )}
    </div>
  );
}

/** Formulario para una fila del CUADRO RESUMEN (campos de esa hoja).
 *  Subtotal = Cantidad × $/Kg (autocalculado, editable). El «Monto» (columna F) es opcional. */
function AgregarCuadroModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [concepto, setConcepto] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [precio, setPrecio] = useState('');
  const [subtotal, setSubtotal] = useState('');
  const [montoF, setMontoF] = useState('');
  const [estilo, setEstilo] = useState<EstiloPerdida>('normal');
  const [busy, setBusy] = useState(false);

  const subtotalCalc = (Number(cantidad) || 0) * (Number(precio) || 0);

  async function guardar() {
    if (!concepto.trim()) { toast('Indicá el concepto.', 'error'); return; }
    setBusy(true);
    try {
      await crearFilaPerdida({
        seccion: 'cuadro',
        etiqueta: concepto.trim(),
        v1: toNum(cantidad),
        v2: toNum(precio),
        v3: subtotal.trim() !== '' ? Number(subtotal) : (subtotalCalc || null),
        v4: toNum(montoF),
        estilo,
      });
      toast('Movimiento agregado', 'success');
      onSaved();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="➕ Nuevo movimiento · Cuadro Resumen" size="md" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={busy} onClick={guardar}>{busy ? 'Guardando…' : 'Guardar'}</button>
      </>}>
      <div className="form-grid">
        <div className="form-row" style={{ gridColumn: '1 / -1' }}>
          <label>Concepto</label>
          <input className="input" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Ej.: COMPRAS DE CASITERITA" />
        </div>
        <div className="form-row">
          <label>Cantidad (Kg)</label>
          <input className="input mono" type="number" step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="0" />
        </div>
        <div className="form-row">
          <label>$ por Kg</label>
          <input className="input mono" type="number" step="any" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="0.00" />
        </div>
        <div className="form-row">
          <label>Subtotal ($) <span className="muted" style={{ textTransform: 'none' }}>· auto = Cant × $/Kg</span></label>
          <input className="input mono" type="number" step="any" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} placeholder={subtotalCalc ? subtotalCalc.toFixed(2) : '0.00'} />
        </div>
        <div className="form-row">
          <label>Monto ($) <span className="muted" style={{ textTransform: 'none' }}>· opcional</span></label>
          <input className="input mono" type="number" step="any" value={montoF} onChange={(e) => setMontoF(e.target.value)} placeholder="0.00" />
        </div>
        <div className="form-row" style={{ gridColumn: '1 / -1' }}>
          <label>Tipo de fila</label>
          <select className="select" value={estilo} onChange={(e) => setEstilo(e.target.value as EstiloPerdida)}>
            <option value="normal">Normal</option>
            <option value="total">Total (subtotal/acumulado)</option>
            <option value="header">Encabezado (ej. «MENOS:»)</option>
            <option value="destacado">Destacado (resultado de pérdida)</option>
          </select>
        </div>
      </div>
    </Modal>
  );
}
