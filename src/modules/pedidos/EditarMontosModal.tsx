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
export function EditarMontosModal({ title, moneda, rows, pagoExterno: pagoExternoInicial, pagoExternoDatos: pagoExternoDatosInicial, onSave, onClose }: {
  title: string;
  moneda: string;
  rows: { nombre: string; cantidad: number; gasto: number }[];
  /** Pago a externo (editable): estado y datos actuales de la persona externa que pagó. */
  pagoExterno?: boolean;
  pagoExternoDatos?: string | null;
  onSave: (gastos: number[], extra: { pagoExterno: boolean; pagoExternoDatos: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [gastos, setGastos] = useState<string[]>(rows.map((r) => (r.gasto ? String(r.gasto) : '')));
  const [pagoExterno, setPagoExterno] = useState(!!pagoExternoInicial);
  const [pagoExternoDatos, setPagoExternoDatos] = useState(pagoExternoDatosInicial ?? '');
  const [saving, setSaving] = useState(false);

  const total = useMemo(
    () => Math.round(gastos.reduce((a, g) => a + (Number(g) || 0), 0) * 100) / 100,
    [gastos],
  );

  async function guardar() {
    if (total <= 0) { toast('El total debe ser mayor que 0.', 'error'); return; }
    if (pagoExterno && !pagoExternoDatos.trim()) { toast('Ingresá los datos de la persona externa que pagó.', 'error'); return; }
    setSaving(true);
    try {
      await onSave(gastos.map((g) => Number(g) || 0), { pagoExterno, pagoExternoDatos });
      toast('Montos actualizados · sincronizado con Tesorería', 'success');
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo actualizar', 'error'); setSaving(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button className="btn btn-primary" onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : `Guardar · ${montoCaja(total, moneda)}`}</button>
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
                  <td className="mono" style={{ textAlign: 'right' }}>{montoCaja(cu, moneda)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ margin: '.5rem 0' }}>Nuevo total: <strong className="mono">{montoCaja(total, moneda)}</strong></div>

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
