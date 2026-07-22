import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { num, dosDecimales } from '@/shared/lib/format';

function montoCaja(n: number, moneda: string): string {
  const v = Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return moneda === 'USD' ? `$ ${v}` : `${moneda} ${v}`;
}

/**
 * Edita los MONTOS (precio por renglón) de una compra/servicio directo ya finalizado.
 * La cantidad no cambia. Al guardar, el módulo correspondiente reajusta Tesorería
 * (y el inventario en compras). `onSave` recibe los nuevos gastos por renglón.
 */
export function EditarMontosModal({ title, moneda, editarMoneda, rows, pagoExterno: pagoExternoInicial, pagoExternoDatos: pagoExternoDatosInicial, nota: notaInicial, iva: ivaInicial, igtf: igtfInicial, descuento = 0, onSave, onClose }: {
  title: string;
  moneda: string;
  /** Si true, muestra un selector Bs/$ para cambiar la moneda (se devuelve en onSave). */
  editarMoneda?: boolean;
  rows: { nombre: string; cantidad: number; gasto: number }[];
  /** Pago a externo (editable): estado y datos actuales de la persona externa que pagó. */
  pagoExterno?: boolean;
  pagoExternoDatos?: string | null;
  /** Nota / motivo (editable): si se pasa (aunque sea ''), se muestra el campo. */
  nota?: string | null;
  /** Monto de IVA (solo compras en Bs): si se pasa, se muestra editable y entra al total. */
  iva?: number | null;
  /** Monto de IGTF: si se pasa (aunque sea 0), se muestra editable y entra al total. */
  igtf?: number | null;
  /** Descuento ya aplicado (se conserva): resta en el total mostrado. */
  descuento?: number;
  onSave: (gastos: number[], extra: { pagoExterno: boolean; pagoExternoDatos: string; nota: string; moneda: string; iva: number; igtf: number }) => Promise<void>;
  onClose: () => void;
}) {
  const [gastos, setGastos] = useState<string[]>(rows.map((r) => (r.gasto ? String(r.gasto) : '')));
  const mostrarIva = ivaInicial !== undefined && ivaInicial !== null;
  const [ivaStr, setIvaStr] = useState(ivaInicial ? String(ivaInicial) : '');
  const mostrarIgtf = igtfInicial !== undefined && igtfInicial !== null;
  const [igtfStr, setIgtfStr] = useState(igtfInicial ? String(igtfInicial) : '');
  const [monedaSel, setMonedaSel] = useState<'USD' | 'Bs'>(moneda === 'Bs' ? 'Bs' : 'USD');
  const monedaMostrada = editarMoneda ? monedaSel : moneda;
  const [pagoExterno, setPagoExterno] = useState(!!pagoExternoInicial);
  const [pagoExternoDatos, setPagoExternoDatos] = useState(pagoExternoDatosInicial ?? '');
  const [nota, setNota] = useState(notaInicial ?? '');
  const mostrarNota = notaInicial !== undefined;
  const [saving, setSaving] = useState(false);

  const subtotal = useMemo(
    () => Math.round(gastos.reduce((a, g) => a + (Number(g) || 0), 0) * 100) / 100,
    [gastos],
  );
  const iva = mostrarIva ? Math.round(Math.max(0, Number(ivaStr) || 0) * 100) / 100 : 0;
  const igtf = mostrarIgtf ? Math.round(Math.max(0, Number(igtfStr) || 0) * 100) / 100 : 0;
  // Mismo cálculo que el repositorio: subtotal − descuento + IVA + IGTF.
  const total = Math.round((subtotal - descuento + iva + igtf) * 100) / 100;

  async function guardar() {
    if (total <= 0) { toast('El total debe ser mayor que 0.', 'error'); return; }
    if (pagoExterno && !pagoExternoDatos.trim()) { toast('Ingresá los datos de la persona externa que pagó.', 'error'); return; }
    setSaving(true);
    try {
      await onSave(gastos.map((g) => Number(g) || 0), { pagoExterno, pagoExternoDatos, nota, moneda: monedaMostrada, iva, igtf });
      toast('Montos actualizados · sincronizado con Tesorería', 'success');
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo actualizar', 'error'); setSaving(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button className="btn btn-primary" onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : `Guardar · ${montoCaja(total, monedaMostrada)}`}</button>
    </>
  );

  return (
    <Modal title={title} size="md" onClose={onClose} footer={footer}>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.84rem' }}>
        Corregí el monto por renglón. El cambio <strong>reajusta el egreso en Tesorería</strong> (saldo + Libro Mayor) y, en compras, el <strong>costo del inventario</strong>. La cantidad no cambia.
      </p>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Detalle</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ width: 160 }}>Monto</th><th style={{ textAlign: 'right' }}>Costo unit.</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const g = Number(gastos[i]) || 0;
              const cu = r.cantidad > 0 && g > 0 ? g / r.cantidad : 0;
              return (
                <tr key={i}>
                  <td>{r.nombre}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(r.cantidad)}</td>
                  <td><input className="input mono" type="number" min={0} step="any" value={gastos[i]} onChange={(e) => setGastos((prev) => prev.map((x, k) => (k === i ? dosDecimales(e.target.value) : x)))} placeholder="0,00" /></td>
                  <td className="mono" style={{ textAlign: 'right' }}>{montoCaja(cu, monedaMostrada)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* IVA ajustable (solo compras en Bs). Entra al total y recalcula la retención. */}
      {mostrarIva && (
        <div className="form-row">
          <label>IVA ({monedaMostrada}) <span className="muted" style={{ fontWeight: 400 }}>· ajustable</span></label>
          <input className="input mono" type="number" min={0} step="any" value={ivaStr}
            onChange={(e) => setIvaStr(dosDecimales(e.target.value))} placeholder="0,00" />
          <small className="muted">Se suma al total y <strong>reajusta el egreso en Tesorería</strong>. Si la compra tiene retención de IVA, el monto retenido se recalcula solo.</small>
        </div>
      )}
      {/* IGTF ajustable. Entra al total y reajusta el egreso en Tesorería. */}
      {mostrarIgtf && (
        <div className="form-row">
          <label>IGTF ({monedaMostrada}) <span className="muted" style={{ fontWeight: 400 }}>· ajustable</span></label>
          <input className="input mono" type="number" min={0} step="any" value={igtfStr}
            onChange={(e) => setIgtfStr(dosDecimales(e.target.value))} placeholder="0,00" />
          <small className="muted">Impuesto a grandes transacciones financieras. Se suma al total y <strong>reajusta el egreso en Tesorería</strong>.</small>
        </div>
      )}

      <div className="card" style={{ margin: '.5rem 0' }}>
        {(mostrarIva || (mostrarIgtf && igtf > 0) || descuento > 0) && (
          <div style={{ fontSize: '.84rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Subtotal</span><span className="mono">{montoCaja(subtotal, monedaMostrada)}</span></div>
            {descuento > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Descuento</span><span className="mono">− {montoCaja(descuento, monedaMostrada)}</span></div>}
            {mostrarIva && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">IVA</span><span className="mono">+ {montoCaja(iva, monedaMostrada)}</span></div>}
            {mostrarIgtf && igtf > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">IGTF</span><span className="mono">+ {montoCaja(igtf, monedaMostrada)}</span></div>}
          </div>
        )}
        <div style={{ marginTop: (mostrarIva || (mostrarIgtf && igtf > 0) || descuento > 0) ? '.35rem' : 0 }}>Nuevo total: <strong className="mono">{montoCaja(total, monedaMostrada)}</strong></div>
      </div>

      {/* Moneda del servicio: editable acá (Bs / $). */}
      {editarMoneda && (
        <div className="form-row">
          <label>Moneda</label>
          <div className="view-toggle" role="tablist" style={{ margin: 0 }}>
            <button type="button" className={monedaSel === 'USD' ? 'active' : ''} onClick={() => setMonedaSel('USD')}>$ Dólares</button>
            <button type="button" className={monedaSel === 'Bs' ? 'active' : ''} onClick={() => setMonedaSel('Bs')}>Bs Bolívares</button>
          </div>
        </div>
      )}

      {/* Nota / motivo: editable acá (aparece en el detalle, en Tesorería y en el PDF). */}
      {mostrarNota && (
        <div className="form-row">
          <label>Nota / motivo <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
          <textarea className="input" rows={2} value={nota} onChange={(e) => setNota(e.target.value)}
            placeholder="Motivo o detalle del servicio…" />
          <small className="muted">Aparece en el detalle, en Tesorería y en el PDF.</small>
        </div>
      )}

      {/* Pago a externo: editable acá (lo pagó una persona externa; hay que reintegrarle). */}
      <div className="form-row" style={{ borderTop: '1px solid var(--border,#3a3a3a)', paddingTop: '.7rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={pagoExterno} onChange={(e) => setPagoExterno(e.target.checked)} />
          <span>💳 Pago a externo <span className="muted" style={{ fontWeight: 400 }}>(lo pagó otra persona; hay que reintegrarle)</span></span>
        </label>
        {pagoExterno && (
          <div style={{ marginTop: '.5rem' }}>
            <label>Datos de la persona externa que pagó <span style={{ color: 'var(--danger)' }}>*</span></label>
            <textarea className="input" rows={2} value={pagoExternoDatos} onChange={(e) => setPagoExternoDatos(e.target.value)}
              placeholder="Nombre, C.I. / RIF, teléfono, y cómo reintegrarle (cuenta / pago móvil)…" />
            <small className="muted">Aparece en el detalle, en el PDF y en Tesorería.</small>
          </div>
        )}
      </div>
    </Modal>
  );
}
