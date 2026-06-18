import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { notify } from '@/shared/lib/notify';
import { num } from '@/shared/lib/format';
import type { Almacen, Existencia, Producto, ItemSolicitudSalida, Chofer, Vehiculo } from '@/shared/lib/types';
import { crearSolicitudSalida } from './salidas.repository';
import { AlmacenPicker } from '@/modules/inventario/AlmacenPicker';
import { ChoferVehiculoPicker } from './ChoferVehiculoPicker';

interface LineaUI { id: number; productoId: string; cantidad: string; almacen: string; observacion: string }

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

  const [destino, setDestino] = useState('');

  // Para un producto, el almacén con MÁS stock distinto del destino (de ahí sale).
  const mejorOrigen = (productoId: string, excluir: string): { almacen: string; stock: number } | null => {
    const exs = existencias
      .filter((e) => e.producto_id === productoId && e.almacen !== excluir && (Number(e.stock) || 0) > 0)
      .sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0));
    const ex = exs[0];
    return ex ? { almacen: ex.almacen, stock: Number(ex.stock) || 0 } : null;
  };

  const [lineas, setLineas] = useState<LineaUI[]>([{ id: 1, productoId: '', cantidad: '1', almacen: '', observacion: '' }]);
  const [seq, setSeq] = useState(2);
  const setLinea = (id: number, patch: Partial<LineaUI>) => setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLinea = () => { setLineas((ls) => [...ls, { id: seq, productoId: '', cantidad: '1', almacen: '', observacion: '' }]); setSeq((s) => s + 1); };
  const quitarLinea = (id: number) => setLineas((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));

  function elegirProducto(id: number, productoId: string) {
    const mej = mejorOrigen(productoId, destino);
    setLinea(id, { productoId, almacen: mej?.almacen ?? '', cantidad: '1' });
  }

  // Al cambiar el destino, recalculamos el almacén origen de cada línea (no puede ser el destino).
  useEffect(() => {
    setLineas((ls) => ls.map((l) => (l.productoId ? { ...l, almacen: mejorOrigen(l.productoId, destino)?.almacen ?? '' } : l)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destino]);

  const [motivo, setMotivo] = useState('');
  const [notaOn, setNotaOn] = useState(false);
  const [notaTexto, setNotaTexto] = useState('');
  const [fechaEntrega, setFechaEntrega] = useState(() => new Date().toISOString().slice(0, 10));
  // Datos de la nota de salida en tránsito.
  const [chofer, setChofer] = useState<Chofer | null>(null);
  const [vehiculo, setVehiculo] = useState<Vehiculo | null>(null);
  const [dirDespacho, setDirDespacho] = useState('');
  const [dirDestino, setDirDestino] = useState('');
  const [consumoInterno, setConsumoInterno] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prodDe = (id: string) => activos.find((p) => p.id === id) ?? null;
  const stockDe = (l: LineaUI) => Number(exMap.get(`${l.productoId}|${l.almacen}`)?.stock) || 0;
  const precioDe = (l: LineaUI) => {
    const ex = exMap.get(`${l.productoId}|${l.almacen}`);
    const p = prodDe(l.productoId);
    return Number(ex?.costo_promedio) || p?.precio || 0;
  };

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
    if (!destino) { setError('Elegí la sede y el almacén de destino.'); return; }
    const items: ItemSolicitudSalida[] = [];
    for (const l of lineas) {
      const p = prodDe(l.productoId);
      const cant = Number(l.cantidad) || 0;
      if (!l.productoId) { setError('Elegí el material en cada renglón.'); return; }
      if (!l.almacen) { setError(`${p?.nombre ?? 'El material'} no tiene stock en otro almacén para trasladar.`); return; }
      if (l.almacen === destino) { setError(`${p?.nombre ?? 'El material'}: el origen no puede ser igual al destino.`); return; }
      if (cant <= 0) { setError('Cada material debe tener cantidad mayor que 0.'); return; }
      if (cant > stockDe(l)) { setError(`No hay stock suficiente de ${p?.nombre} en ${l.almacen}. Disponible: ${num(stockDe(l))}.`); return; }
      items.push({ producto_id: l.productoId, producto_nombre: p?.nombre ?? null, cantidad: cant, precio_unit: precioDe(l) || null, unidad: p?.unidad ?? null, almacen: l.almacen, observacion: l.observacion.trim() || null });
    }
    setSaving(true);
    try {
      await crearSolicitudSalida({
        scope: 'traslado', tipo: 'material',
        almacenDestino: destino, items,
        motivo: motivo.trim() || null,
        notaEntrega: notaOn ? (notaTexto.trim() || null) : null, fechaEntrega: fechaEntrega || null,
        chofer: chofer?.nombre ?? null, choferCedula: chofer?.cedula ?? null,
        vehiculo: vehiculo?.nombre ?? null, vehiculoPlaca: vehiculo?.placa ?? null,
        direccionDespacho: dirDespacho.trim() || null, direccionDestino: dirDestino.trim() || null,
        consumoInterno,
        solicitante: actorName || actor, actor, actorName,
      });
      const detalle = items.length === 1 ? `${num(items[0].cantidad)} ${items[0].unidad ?? ''} de ${items[0].producto_nombre}` : `${items.length} materiales`;
      notify(`Solicitud de traslado creada: ${detalle} → ${destino} · queda Por aprobar`, 'success', { link: '#/app/salidas' });
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
      <button type="submit" form="traslado-mat-form" className="btn btn-primary" disabled={saving || hayExcede || algunaInvalida || !destino}>
        {saving ? 'Creando…' : 'Crear solicitud'}
      </button>
    </>
  );

  const opcionesProducto = activos.map((p) => ({ value: p.id, label: `${p.nombre} · ${p.sku}` }));

  return (
    <Modal title="Nueva solicitud de traslado de material" size="lg" onClose={onClose} footer={footer}>
      <form id="traslado-mat-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        {/* Almacén destino (a dónde va). El origen se asigna solo: el almacén con más stock. */}
        <AlmacenPicker value={destino} onChange={setDestino} almacenes={almacenesObj} sedeLabel="Sede destino" label="Almacén destino" />

        {/* Materiales (varias líneas) — producto buscable; el origen se asigna solo. */}
        <div className="form-row" style={{ marginTop: '.6rem', marginBottom: '.3rem' }}><label>Materiales</label></div>
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
                  <label>Producto a trasladar</label>
                  <SearchSelect value={l.productoId} onChange={(id) => elegirProducto(l.id, id)}
                    options={opcionesProducto} placeholder="🔎 Buscá el material…" emptyText="Sin productos." />
                  <small className="muted">
                    {l.productoId
                      ? (l.almacen
                        ? <>Sale de 📦 {l.almacen} · stock <strong className="mono">{num(stock)} {prod?.unidad ?? ''}</strong></>
                        : <span style={{ color: 'var(--danger)' }}>Sin stock disponible para trasladar</span>)
                      : 'Sale del almacén con más stock (distinto del destino).'}
                  </small>
                </div>
                <div className="form-row">
                  <label>Cantidad{prod?.unidad ? ` (${prod.unidad})` : ''}</label>
                  <input className="input mono" type="number" min={1} max={stock || undefined} step="any" value={l.cantidad} onChange={(e) => onCantidadChange(l, e.target.value)} required />
                  {excede && <small style={{ color: 'var(--danger)' }}>Máximo disponible: {num(stock)} {prod?.unidad ?? ''}.</small>}
                  <small className="muted">Lleva el costo (PMP) del origen.</small>
                </div>
              </div>
              <div className="form-row" style={{ marginTop: '.4rem' }}>
                <label>Observación</label>
                <input className="input" value={l.observacion} onChange={(e) => setLinea(l.id, { observacion: e.target.value })}
                  placeholder="Ej.: serial / Nº, «será trasladado para reparación»…" />
              </div>
            </div>
          );
        })}
        <button type="button" className="btn btn-sm btn-ghost" onClick={addLinea}>＋ Agregar material</button>

        {/* Datos del despacho (nota de salida): chofer/responsable + vehículo + direcciones */}
        <div className="form-row" style={{ marginTop: '.8rem', marginBottom: '.3rem' }}><label>Datos del despacho</label></div>
        <ChoferVehiculoPicker chofer={chofer} vehiculo={vehiculo} onChofer={setChofer} onVehiculo={setVehiculo} actor={actor} />
        <div className="form-grid" style={{ marginTop: '.4rem' }}>
          <div className="form-row">
            <label>Origen — dirección de despacho</label>
            <input className="input" value={dirDespacho} onChange={(e) => setDirDespacho(e.target.value)} placeholder="Desde dónde sale (zona, galpón…)" />
          </div>
          <div className="form-row">
            <label>Destino — dirección</label>
            <input className="input" value={dirDestino} onChange={(e) => setDirDestino(e.target.value)} placeholder="A dónde va (sede, galpón, dirección)" />
          </div>
        </div>
        <div className="form-row" style={{ marginTop: '.45rem' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={consumoInterno} onChange={(e) => setConsumoInterno(e.target.checked)} />
            Consumo interno
          </label>
          <small className="muted">Marcalo si el material se queda dentro de la empresa. Se ve en la trazabilidad y en el detalle.</small>
        </div>

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
