import { useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { notify } from '@/shared/lib/notify';
import { money } from '@/shared/lib/format';
import type { Almacen, MovimientoCaja, Producto } from '@/shared/lib/types';
import { conciliarConMineral } from './cajas.repository';
import { AlmacenPicker } from '@/modules/inventario/AlmacenPicker';

/** Registra la recepción del mineral que concilia una salida de dinero pendiente. */
export function ConciliarMineralModal({
  salida, productos, almacenesObj, actor, actorName, onClose, onSaved,
}: {
  salida: MovimientoCaja;
  productos: Producto[];
  almacenesObj: Almacen[];
  actor: string;
  actorName?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const activos = useMemo(() => productos.filter((p) => p.estado === 'activo'), [productos]);

  const [modo, setModo] = useState<'existente' | 'nuevo'>(activos.length ? 'existente' : 'nuevo');
  const [productoId, setProductoId] = useState(activos[0]?.id ?? '');
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [almacen, setAlmacen] = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [unidad, setUnidad] = useState<'KG' | 'G'>('KG');
  const [costoUnit, setCostoUnit] = useState('0');
  const [descripcion, setDescripcion] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cantNum = Number(cantidad) || 0;
  const costoNum = Number(costoUnit) || 0;
  const totalMineral = cantNum * costoNum;
  const montoAnticipo = Number(salida.monto) || 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (modo === 'existente' && !productoId) { setError('Elegí el mineral.'); return; }
    if (modo === 'nuevo' && !nombreNuevo.trim()) { setError('Escribí el nombre del mineral.'); return; }
    if (cantNum <= 0) { setError('El total entrante debe ser mayor que 0.'); return; }
    if (!almacen) { setError('Elegí la sede y el almacén destino.'); return; }
    setSaving(true);
    try {
      await conciliarConMineral({
        movId: salida.id,
        productoId: modo === 'existente' ? productoId : null,
        productoNuevo: modo === 'nuevo' ? { nombre: nombreNuevo.trim(), unidad } : null,
        almacen, cantidad: cantNum, unidad, costoUnit: costoNum,
        descripcion: descripcion.trim(), actor, actorName,
      });
      notify(`Mineral recibido y conciliado · entró ${cantNum} ${unidad} a ${almacen}`, 'success', { link: '#/app/inventario' });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conciliar.');
    } finally {
      setSaving(false);
    }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="conciliar-form" className="btn btn-primary" disabled={saving}>
        {saving ? 'Registrando…' : 'Registrar recepción'}
      </button>
    </>
  );

  return (
    <Modal title="Conciliar con recepción de mineral" size="lg" onClose={onClose} footer={footer}>
      <form id="conciliar-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <div className="card" style={{ padding: '.6rem .85rem', marginBottom: '.75rem', background: 'var(--bg-1)', borderLeft: '3px solid var(--primary)' }}>
          <div className="mono" style={{ fontSize: '.85rem' }}>
            Anticipo: <strong>{money(montoAnticipo)} {salida.moneda}</strong> → {salida.destino || '—'}<br />
            <span className="muted">El mineral recibido entra al inventario con su costo.</span>
          </div>
        </div>

        <div className="form-row">
          <label>Mineral recibido</label>
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.4rem' }}>
            <button type="button" className={`btn btn-sm ${modo === 'existente' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModo('existente')} disabled={!activos.length}>Existente</button>
            <button type="button" className={`btn btn-sm ${modo === 'nuevo' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModo('nuevo')}>Nuevo</button>
          </div>
          {modo === 'existente' ? (
            <select className="select" value={productoId} onChange={(e) => setProductoId(e.target.value)}>
              {!activos.length && <option value="">— sin productos —</option>}
              {activos.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.sku}</option>)}
            </select>
          ) : (
            <input className="input" value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value.toUpperCase())} placeholder="Nombre del mineral" />
          )}
        </div>

        <AlmacenPicker value={almacen} onChange={setAlmacen} almacenes={almacenesObj} />
        <div className="form-grid">
          <div className="form-row">
            <label>Unidad</label>
            <select className="select" value={unidad} onChange={(e) => setUnidad(e.target.value as 'KG' | 'G')}>
              <option value="KG">KG</option>
              <option value="G">G</option>
            </select>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Total de mineral entrante ({unidad})</label>
            <input className="input mono" type="number" min={0} step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
          </div>
          <div className="form-row">
            <label>Costo por {unidad} (USD)</label>
            <input className="input mono" type="number" min={0} step="0.0001" value={costoUnit} onChange={(e) => setCostoUnit(e.target.value)} />
            <small className="muted">Valor del mineral: <strong className="mono">{money(totalMineral)}</strong></small>
          </div>
        </div>

        <div className="form-row">
          <label>Descripción de la entrada</label>
          <input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ley, lote, observaciones…" />
        </div>
      </form>
    </Modal>
  );
}
