import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { notify } from '@/shared/lib/notify';
import { toast } from '@/shared/ui/Toast';
import { money, num } from '@/shared/lib/format';
import type { Existencia, Producto, ItemSolicitudSalida } from '@/shared/lib/types';
import { crearSolicitudSalida } from './salidas.repository';
import { listCatalogoPedido, crearCatalogoPedido } from '@/modules/pedidos/pedidos.repository';

interface LineaUI { id: number; productoId: string; cantidad: string; almacen: string }

export function SalidaMaterialForm({
  productos, existencias, actor, actorName, onClose, onSaved,
}: {
  productos: Producto[];
  existencias: Existencia[];
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

  // Para un producto, el almacén con MÁS stock (de ahí se descuenta). null si no hay.
  const mejorAlmacen = (productoId: string): { almacen: string; stock: number } | null => {
    const exs = existencias
      .filter((e) => e.producto_id === productoId && (Number(e.stock) || 0) > 0)
      .sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0));
    const ex = exs[0];
    return ex ? { almacen: ex.almacen, stock: Number(ex.stock) || 0 } : null;
  };

  // Varias líneas de producto (como una OC). Cada una: producto + cantidad + almacén autoasignado.
  const [lineas, setLineas] = useState<LineaUI[]>([{ id: 1, productoId: '', cantidad: '1', almacen: '' }]);
  const [seq, setSeq] = useState(2);
  const setLinea = (id: number, patch: Partial<LineaUI>) => setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLinea = () => { setLineas((ls) => [...ls, { id: seq, productoId: '', cantidad: '1', almacen: '' }]); setSeq((s) => s + 1); };
  const quitarLinea = (id: number) => setLineas((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));

  // Al elegir el producto, se autoasigna el almacén con más stock.
  function elegirProducto(id: number, productoId: string) {
    const mej = mejorAlmacen(productoId);
    setLinea(id, { productoId, almacen: mej?.almacen ?? '', cantidad: '1' });
  }

  const [motivo, setMotivo] = useState('');
  const [fechaEntrega, setFechaEntrega] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Unidad solicitante: desplegable desde el catálogo compartido con OP + alta al vuelo.
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

  // Datos derivados por línea (producto, stock del almacén autoasignado, precio).
  const prodDe = (id: string) => activos.find((p) => p.id === id) ?? null;
  const stockDe = (l: LineaUI) => Number(exMap.get(`${l.productoId}|${l.almacen}`)?.stock) || 0;
  const precioDe = (l: LineaUI) => {
    const ex = exMap.get(`${l.productoId}|${l.almacen}`);
    const p = prodDe(l.productoId);
    return p?.precio_venta ?? (Number(ex?.costo_promedio) || p?.precio || 0);
  };
  const totalGeneral = useMemo(
    () => lineas.reduce((a, l) => a + precioDe(l) * (Number(l.cantidad) || 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lineas, exMap],
  );

  function onCantidadChange(l: LineaUI, v: string) {
    const stock = stockDe(l);
    const n = Number(v);
    if (Number.isFinite(n) && n > stock) { setLinea(l.id, { cantidad: String(stock) }); return; }
    setLinea(l.id, { cantidad: v });
  }

  const hayExcede = lineas.some((l) => (Number(l.cantidad) || 0) > stockDe(l));
  const algunaInvalida = lineas.some((l) => !l.productoId || !l.almacen || (Number(l.cantidad) || 0) <= 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!unidad.trim()) { setError('Indicá la unidad solicitante.'); return; }
    const items: ItemSolicitudSalida[] = [];
    for (const l of lineas) {
      const p = prodDe(l.productoId);
      const cant = Number(l.cantidad) || 0;
      if (!l.productoId) { setError('Elegí el material en cada renglón.'); return; }
      if (!l.almacen) { setError(`${p?.nombre ?? 'El material'} no tiene stock en ningún almacén.`); return; }
      if (cant <= 0) { setError('Cada material debe tener cantidad mayor que 0.'); return; }
      if (cant > stockDe(l)) { setError(`No hay stock suficiente de ${p?.nombre} en ${l.almacen}. Disponible: ${num(stockDe(l))}.`); return; }
      items.push({ producto_id: l.productoId, producto_nombre: p?.nombre ?? null, cantidad: cant, precio_unit: precioDe(l) || null, unidad: p?.unidad ?? null, almacen: l.almacen });
    }
    setSaving(true);
    try {
      await crearSolicitudSalida({
        scope: 'salida', tipo: 'material',
        items,
        destino: unidad.trim(), motivo: motivo.trim() || null,
        fechaEntrega: fechaEntrega || null,
        solicitante: actorName || actor, actor, actorName,
      });
      const detalle = items.length === 1 ? `${num(items[0].cantidad)} ${items[0].unidad ?? ''} de ${items[0].producto_nombre}` : `${items.length} materiales`;
      notify(`Solicitud de salida creada: ${detalle} → ${unidad.trim()} · queda Por aprobar`, 'success', { link: '#/app/salidas' });
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
      <button type="submit" form="salida-mat-form" className="btn btn-primary" disabled={saving || hayExcede || algunaInvalida || !unidad.trim()}>
        {saving ? 'Creando…' : 'Crear solicitud'}
      </button>
    </>
  );

  const opcionesProducto = activos.map((p) => ({ value: p.id, label: `${p.nombre} · ${p.sku}` }));

  return (
    <Modal title="Nueva solicitud de salida de material" size="lg" onClose={onClose} footer={footer}>
      <form id="salida-mat-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        {/* 1) Unidad solicitante (gerencia/área) — primero, como pediste. Catálogo compartido con OP. */}
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

        {/* 2) Materiales (varias líneas) — producto buscable; el almacén se asigna solo. */}
        <div className="form-row" style={{ marginBottom: '.3rem' }}><label>Materiales</label></div>
        {lineas.map((l, idx) => {
          const stock = stockDe(l);
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
                  <label>Producto</label>
                  <SearchSelect value={l.productoId} onChange={(id) => elegirProducto(l.id, id)}
                    options={opcionesProducto} placeholder="🔎 Buscá el material…" emptyText="Sin productos." />
                  <small className="muted">
                    {l.productoId
                      ? (l.almacen
                        ? <>📦 {l.almacen} · stock <strong className="mono">{num(stock)} {prod?.unidad ?? ''}</strong> · precio {money(precioDe(l))}</>
                        : <span style={{ color: 'var(--danger)' }}>Sin stock en ningún almacén</span>)
                      : 'Se descuenta del almacén con más stock.'}
                  </small>
                </div>
                <div className="form-row">
                  <label>Cantidad{prod?.unidad ? ` (${prod.unidad})` : ''}</label>
                  <input className="input mono" type="number" min={1} max={stock || undefined} step="any" value={l.cantidad} onChange={(e) => onCantidadChange(l, e.target.value)} required />
                  {excede && <small style={{ color: 'var(--danger)' }}>Máximo disponible: {num(stock)} {prod?.unidad ?? ''}.</small>}
                </div>
              </div>
            </div>
          );
        })}
        <button type="button" className="btn btn-sm btn-ghost" onClick={addLinea}>＋ Agregar material</button>

        {/* 3) Motivo y fecha */}
        <div className="form-grid" style={{ marginTop: '.8rem' }}>
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
            {lineas.length} material(es) · valor total estimado <strong>{money(totalGeneral)}</strong>
          </div>
        </div>
      </form>
    </Modal>
  );
}
