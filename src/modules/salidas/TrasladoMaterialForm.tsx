import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { notify } from '@/shared/lib/notify';
import { num } from '@/shared/lib/format';
import type { Almacen, Existencia, Producto, ItemSolicitudSalida } from '@/shared/lib/types';
import { crearSolicitudSalida } from './salidas.repository';
import { AlmacenPicker } from '@/modules/inventario/AlmacenPicker';

interface LineaUI { id: number; productoId: string; cantidad: string }

export function TrasladoMaterialForm({
  productos, existencias, almacenesObj, actor, actorName, onClose, onSaved,
}: {
  productos: Producto[];
  existencias: Existencia[];
  almacenesObj: Almacen[];
  actor: string;
  actorName?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const activos = useMemo(() => productos.filter((p) => p.estado === 'activo'), [productos]);
  const exMap = useMemo(() => {
    const m = new Map<string, Existencia>();
    existencias.forEach((e) => m.set(`${e.producto_id}|${e.almacen}`, e));
    return m;
  }, [existencias]);

  const [origen, setOrigen] = useState('');
  const [destino, setDestino] = useState('');
  const productosEnOrigen = useMemo(
    () => activos.filter((p) => (Number(exMap.get(`${p.id}|${origen}`)?.stock) || 0) > 0),
    [activos, exMap, origen],
  );

  const [lineas, setLineas] = useState<LineaUI[]>([{ id: 1, productoId: '', cantidad: '1' }]);
  const [seq, setSeq] = useState(2);
  const setLinea = (id: number, patch: Partial<LineaUI>) => setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLinea = () => { setLineas((ls) => [...ls, { id: seq, productoId: productosEnOrigen[0]?.id ?? '', cantidad: '1' }]); setSeq((s) => s + 1); };
  const quitarLinea = (id: number) => setLineas((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));
  useEffect(() => {
    setLineas((ls) => ls.map((l) => ({ ...l, productoId: productosEnOrigen.some((p) => p.id === l.productoId) ? l.productoId : (productosEnOrigen[0]?.id ?? '') })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origen, productosEnOrigen.length]);

  const [motivo, setMotivo] = useState('');
  const [notaOn, setNotaOn] = useState(false);
  const [notaTexto, setNotaTexto] = useState('');
  const [fechaEntrega, setFechaEntrega] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prodDe = (id: string) => activos.find((p) => p.id === id) ?? null;
  const stockDe = (id: string) => Number(exMap.get(`${id}|${origen}`)?.stock) || 0;
  const precioDe = (id: string) => {
    const ex = exMap.get(`${id}|${origen}`);
    const p = prodDe(id);
    return Number(ex?.costo_promedio) || p?.precio || 0;
  };

  function onCantidadChange(id: string, lineId: number, v: string) {
    const stock = stockDe(id);
    const n = Number(v);
    if (Number.isFinite(n) && n > stock) { setLinea(lineId, { cantidad: String(stock) }); return; }
    setLinea(lineId, { cantidad: v });
  }

  const mismoAlmacen = !!origen && origen === destino;
  const hayExcede = lineas.some((l) => (Number(l.cantidad) || 0) > stockDe(l.productoId));
  const algunaInvalida = lineas.some((l) => !l.productoId || (Number(l.cantidad) || 0) <= 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!origen) { setError('Elegí la sede y el almacén de origen.'); return; }
    if (!destino) { setError('Elegí la sede y el almacén de destino.'); return; }
    if (origen === destino) { setError('El almacén origen y destino deben ser distintos.'); return; }
    const items: ItemSolicitudSalida[] = [];
    for (const l of lineas) {
      const p = prodDe(l.productoId);
      const cant = Number(l.cantidad) || 0;
      if (!l.productoId) { setError('Elegí el material en cada renglón.'); return; }
      if (cant <= 0) { setError('Cada material debe tener cantidad mayor que 0.'); return; }
      if (cant > stockDe(l.productoId)) { setError(`No hay stock suficiente de ${p?.nombre} en ${origen}. Disponible: ${num(stockDe(l.productoId))}.`); return; }
      items.push({ producto_id: l.productoId, producto_nombre: p?.nombre ?? null, cantidad: cant, precio_unit: precioDe(l.productoId) || null, unidad: p?.unidad ?? null });
    }
    setSaving(true);
    try {
      await crearSolicitudSalida({
        scope: 'traslado', tipo: 'material',
        almacenOrigen: origen, almacenDestino: destino, items,
        motivo: motivo.trim() || null,
        notaEntrega: notaOn ? (notaTexto.trim() || null) : null, fechaEntrega: fechaEntrega || null,
        solicitante: actorName || actor, actor, actorName,
      });
      const detalle = items.length === 1 ? `${num(items[0].cantidad)} ${items[0].unidad ?? ''} de ${items[0].producto_nombre}` : `${items.length} materiales`;
      notify(`Solicitud de traslado creada: ${detalle} · ${origen} → ${destino} · queda Por aprobar`, 'success', { link: '#/app/salidas' });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la solicitud.');
    } finally {
      setSaving(false);
    }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="traslado-mat-form" className="btn btn-primary" disabled={saving || hayExcede || algunaInvalida || !origen || !destino || mismoAlmacen}>
        {saving ? 'Creando…' : 'Crear solicitud'}
      </button>
    </>
  );

  return (
    <Modal title="Nueva solicitud de traslado de material" size="lg" onClose={onClose} footer={footer}>
      <form id="traslado-mat-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        {/* Almacenes origen y destino (uno para todo el traslado) */}
        <AlmacenPicker value={origen} onChange={setOrigen} almacenes={almacenesObj} sedeLabel="Sede origen" label="Almacén origen" />
        <div style={{ marginTop: '.6rem' }}>
          <AlmacenPicker value={destino} onChange={setDestino} almacenes={almacenesObj} sedeLabel="Sede destino" label="Almacén destino" />
          {mismoAlmacen && <small style={{ color: 'var(--danger)' }}>El destino no puede ser igual al origen.</small>}
        </div>

        {/* Materiales (varias líneas) */}
        <div className="form-row" style={{ marginTop: '.6rem', marginBottom: '.3rem' }}><label>Materiales</label></div>
        {lineas.map((l, idx) => {
          const stock = stockDe(l.productoId);
          const prod = prodDe(l.productoId);
          const cant = Number(l.cantidad) || 0;
          const excede = cant > stock;
          return (
            <div key={l.id} className="card" style={{ margin: '0 0 .6rem', padding: '.7rem .85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
                <strong className="muted" style={{ fontSize: '.78rem' }}>Material #{idx + 1}</strong>
                {lineas.length > 1 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => quitarLinea(l.id)} title="Quitar material">✕</button>}
              </div>
              <div className="form-grid">
                <div className="form-row">
                  <label>Producto del almacén origen</label>
                  <select className="select" value={l.productoId} onChange={(e) => setLinea(l.id, { productoId: e.target.value })}>
                    <option value="">{productosEnOrigen.length ? '— elegí el material —' : '— el almacén no tiene materiales —'}</option>
                    {productosEnOrigen.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.sku}</option>)}
                  </select>
                  <small className="muted">Disponible: <strong className="mono">{num(stock)} {prod?.unidad ?? ''}</strong></small>
                </div>
                <div className="form-row">
                  <label>Cantidad{prod?.unidad ? ` (${prod.unidad})` : ''}</label>
                  <input className="input mono" type="number" min={1} max={stock || undefined} step="any" value={l.cantidad} onChange={(e) => onCantidadChange(l.productoId, l.id, e.target.value)} required />
                  {excede && <small style={{ color: 'var(--danger)' }}>Máximo disponible: {num(stock)} {prod?.unidad ?? ''}.</small>}
                  <small className="muted">Lleva el costo (PMP) del origen.</small>
                </div>
              </div>
            </div>
          );
        })}
        <button type="button" className="btn btn-sm btn-ghost" onClick={addLinea} disabled={!origen}>＋ Agregar material</button>

        {/* Motivo, fecha y nota */}
        <div className="form-grid" style={{ marginTop: '.8rem' }}>
          <div className="form-row">
            <label>Motivo / detalle</label>
            <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo del traslado…" />
          </div>
          <div className="form-row">
            <label>Fecha de entrega</label>
            <input className="input" type="date" value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} />
            <small className="muted">Fecha en que se entregó al almacén destino.</small>
          </div>
        </div>

        <div className="form-row" style={{ marginTop: '.25rem' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={notaOn} onChange={(e) => setNotaOn(e.target.checked)} />
            Nota de entrega
          </label>
          {notaOn && (
            <textarea className="input" rows={2} value={notaTexto} onChange={(e) => setNotaTexto(e.target.value)}
              placeholder="Escribí el motivo / detalle de la nota de entrega…" style={{ marginTop: '.4rem' }} />
          )}
          {notaOn && <small className="muted">Este texto se imprime en el PDF del traslado como “Nota de entrega”.</small>}
        </div>
      </form>
    </Modal>
  );
}
