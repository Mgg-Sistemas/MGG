import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { notify } from '@/shared/lib/notify';
import { toast } from '@/shared/ui/Toast';
import { money, num } from '@/shared/lib/format';
import type { Almacen, Existencia, Producto } from '@/shared/lib/types';
import { crearSolicitudSalida } from './salidas.repository';
import { listCatalogoPedido, crearCatalogoPedido } from '@/modules/pedidos/pedidos.repository';
import { AlmacenPicker } from '@/modules/inventario/AlmacenPicker';

export function SalidaMaterialForm({
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

  const [almacen, setAlmacen] = useState('');
  // Productos que ESE almacén contiene (con existencia > 0).
  const productosEnAlmacen = useMemo(
    () => activos.filter((p) => (Number(exMap.get(`${p.id}|${almacen}`)?.stock) || 0) > 0),
    [activos, exMap, almacen],
  );
  const [productoId, setProductoId] = useState(productosEnAlmacen[0]?.id ?? '');
  // Al cambiar de almacén, si el producto elegido no está en ese almacén, reseteamos.
  useEffect(() => {
    if (!productosEnAlmacen.some((p) => p.id === productoId)) {
      setProductoId(productosEnAlmacen[0]?.id ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [almacen, productosEnAlmacen]);
  const [cantidad, setCantidad] = useState('1');
  const [motivo, setMotivo] = useState('');
  const [precio, setPrecio] = useState('0');
  const [fechaEntrega, setFechaEntrega] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Unidad solicitante: desplegable desde el catálogo compartido con OP + alta al
  // vuelo (lo que se agregue acá aparece en OP y viceversa).
  const [unidad, setUnidad] = useState('');
  const [unidadesSol, setUnidadesSol] = useState<string[]>([]);
  const [nuevaUnidad, setNuevaUnidad] = useState('');
  const [addingUnidad, setAddingUnidad] = useState(false);
  useEffect(() => {
    listCatalogoPedido('unidad_solicitante', true)
      .then((rows) => setUnidadesSol(rows.map((r) => r.nombre)))
      .catch(() => setUnidadesSol([]));
  }, []);
  async function handleAddUnidad() {
    const n = nuevaUnidad.trim();
    if (!n) { toast('Escribí el nombre de la unidad', 'error'); return; }
    const existente = unidadesSol.find((u) => u.toLowerCase() === n.toLowerCase());
    if (existente) { setUnidad(existente); setNuevaUnidad(''); toast(`La unidad "${existente}" ya existe — se seleccionó`, 'warning'); return; }
    setAddingUnidad(true);
    try {
      await crearCatalogoPedido('unidad_solicitante', n, actor);
      setUnidadesSol((prev) => [...prev, n].sort((a, b) => a.localeCompare(b, 'es')));
      setUnidad(n);
      setNuevaUnidad('');
      toast(`Unidad "${n}" agregada al catálogo`, 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo agregar la unidad', 'error'); }
    finally { setAddingUnidad(false); }
  }

  const producto = activos.find((p) => p.id === productoId) ?? null;
  const exSel = exMap.get(`${productoId}|${almacen}`);
  const stock = Number(exSel?.stock) || 0;
  const cantNum = Number(cantidad) || 0;
  const precioNum = Number(precio) || 0;
  const total = precioNum * cantNum;
  const excede = cantNum > stock;

  // No permite escribir una cantidad mayor a la disponible en el almacén:
  // la recortamos al stock al momento de cambiarla.
  function onCantidadChange(v: string) {
    const n = Number(v);
    if (Number.isFinite(n) && n > stock) { setCantidad(String(stock)); return; }
    setCantidad(v);
  }

  // Precarga el precio desde el inventario: precio de venta si existe, si no el
  // costo (PMP) del almacén, y como último recurso el precio global del producto.
  useEffect(() => {
    const costoAlmacen = Number(exSel?.costo_promedio) || 0;
    const precioInv = producto?.precio_venta ?? (costoAlmacen || producto?.precio || 0);
    setPrecio(String(precioInv ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productoId, almacen]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!productoId) { setError('Elegí el producto.'); return; }
    if (cantNum <= 0) { setError('La cantidad debe ser mayor que 0.'); return; }
    if (cantNum > stock) { setError(`No hay stock suficiente en ${almacen}. Disponible: ${num(stock)}.`); return; }
    if (!unidad.trim()) { setError('Indicá la unidad solicitante.'); return; }
    setSaving(true);
    try {
      await crearSolicitudSalida({
        scope: 'salida', tipo: 'material',
        productoId, productoNombre: producto?.nombre ?? null, almacenOrigen: almacen,
        cantidad: cantNum, destino: unidad.trim(), motivo: motivo.trim() || null,
        precioUnit: precioNum || null, fechaEntrega: fechaEntrega || null,
        solicitante: actorName || actor, actor, actorName,
      });
      notify(`Solicitud de salida creada: ${num(cantNum)} ${producto?.unidad ?? ''} de ${producto?.nombre} → ${unidad.trim()} · queda Por aprobar`, 'success', { link: '#/app/salidas' });
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
      <button type="submit" form="salida-mat-form" className="btn btn-primary" disabled={saving || excede || cantNum <= 0 || stock <= 0 || !unidad.trim()}>
        {saving ? 'Creando…' : 'Crear solicitud'}
      </button>
    </>
  );

  return (
    <Modal title="Nueva solicitud de salida de material" size="lg" onClose={onClose} footer={footer}>
      <form id="salida-mat-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <AlmacenPicker value={almacen} onChange={setAlmacen} almacenes={almacenesObj} sedeLabel="Sede origen" label="Almacén origen" />

        <div className="form-grid">
          <div className="form-row">
            <label>Producto del almacén</label>
            <select className="select" value={productoId} onChange={(e) => setProductoId(e.target.value)}>
              {!productosEnAlmacen.length && <option value="">— el almacén no tiene materiales —</option>}
              {productosEnAlmacen.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.sku}</option>)}
            </select>
            <small className="muted">Disponible: <strong className="mono">{num(stock)} {producto?.unidad ?? ''}</strong></small>
          </div>
          <div className="form-row">
            <label>Cantidad{producto?.unidad ? ` (${producto.unidad})` : ''}</label>
            <input className="input mono" type="number" min={1} max={stock || undefined} step="any" value={cantidad} onChange={(e) => onCantidadChange(e.target.value)} required />
            {excede && <small style={{ color: 'var(--danger)' }}>Máximo disponible: {num(stock)} {producto?.unidad ?? ''}.</small>}
          </div>
        </div>

        {/* Unidad solicitante (gerencia/área) — catálogo compartido con OP. */}
        <div className="form-row">
          <label>Unidad solicitante</label>
          <select className="select" value={unidad} onChange={(e) => setUnidad(e.target.value)}>
            <option value="">— elegí la unidad solicitante —</option>
            {unidadesSol.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <div style={{ display: 'flex', gap: '.4rem', marginTop: '.35rem' }}>
            <input className="input" value={nuevaUnidad} onChange={(e) => setNuevaUnidad(e.target.value)}
              placeholder="¿No está? Escribí una nueva (Gerencia, Taller, Mina…)"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleAddUnidad(); } }}
              style={{ flex: 1, fontSize: '.82rem' }} />
            <button type="button" className="btn btn-sm btn-ghost" onClick={handleAddUnidad} disabled={addingUnidad || !nuevaUnidad.trim()}>
              {addingUnidad ? '…' : '+ Añadir'}
            </button>
          </div>
          <small className="muted">Se comparte con el catálogo de OP: lo que agregues acá aparece allá y viceversa.</small>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Precio unitario (USD)</label>
            <input className="input mono" value={money(precioNum)} readOnly tabIndex={-1} title="Traído del inventario · no editable" />
            <small className="muted">Traído del inventario. No se modifica en la salida.</small>
          </div>
          <div className="form-row">
            <label>Precio total</label>
            <input className="input mono" value={money(total)} readOnly tabIndex={-1} />
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Motivo / detalle</label>
            <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo del despacho, referencia…" />
          </div>
          <div className="form-row">
            <label>Fecha de entrega</label>
            <input className="input" type="date" value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} />
            <small className="muted">Fecha en que se entregó al destino.</small>
          </div>
        </div>

        <div className="card" style={{ padding: '.6rem .85rem', borderLeft: '3px solid var(--primary)', background: 'var(--bg-1)', margin: 0 }}>
          <div className="mono" style={{ fontSize: '.85rem' }}>
            {num(stock)} → <strong>{num(Math.max(0, stock - cantNum))}</strong> {producto?.unidad ?? ''} en {almacen}
          </div>
        </div>
      </form>
    </Modal>
  );
}
