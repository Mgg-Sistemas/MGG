import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { notify } from '@/shared/lib/notify';
import { money, num } from '@/shared/lib/format';
import { enterAvanzaCampo } from '@/shared/lib/navegacionEnter';
import type { Almacen, Existencia, Producto, ItemSolicitudSalida, Chofer, Vehiculo } from '@/shared/lib/types';
import { crearSolicitudSalida } from './salidas.repository';
import { nombreCortoAlmacen } from '@/modules/inventario/almacenes.repository';
import { ChoferVehiculoPicker } from './ChoferVehiculoPicker';
import { ClientePicker } from './ClientePicker';
import type { Cliente } from '@/modules/ventas/clientes.repository';

interface LineaUI { id: number; productoId: string; cantidad: string; almacen: string; precio: string }

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

  // Destino: SOLO almacenes PADRE (raíz, sin parent_id), agrupado por sede.
  // Se ocultan los subalmacenes para no ensuciar la lista: el material se traslada al
  // almacén principal de cada sede (Los Pinos, La Esperanza, El Burro, …).
  const destinosPorSede = useMemo(() => {
    const activos = almacenesObj.filter((a) => a.estado === 'activo' && !a.parent_id);
    const grupos = new Map<string, { nombre: string; label: string }[]>();
    activos
      .map((a) => ({ nombre: a.nombre, sede: a.sede?.trim() || 'Sin sede', label: nombreCortoAlmacen(a, almacenesObj) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'))
      .forEach((a) => {
        const arr = grupos.get(a.sede) ?? [];
        arr.push({ nombre: a.nombre, label: a.label });
        grupos.set(a.sede, arr);
      });
    return Array.from(grupos.entries()).sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [almacenesObj]);

  // Para un producto, el almacén con MÁS stock distinto del destino (de ahí sale).
  const mejorOrigen = (productoId: string, excluir: string): { almacen: string; stock: number } | null => {
    const exs = existencias
      .filter((e) => e.producto_id === productoId && e.almacen !== excluir && (Number(e.stock) || 0) > 0)
      .sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0));
    const ex = exs[0];
    return ex ? { almacen: ex.almacen, stock: Number(ex.stock) || 0 } : null;
  };

  const [lineas, setLineas] = useState<LineaUI[]>([{ id: 1, productoId: '', cantidad: '1', almacen: '', precio: '' }]);
  const [seq, setSeq] = useState(2);
  const setLinea = (id: number, patch: Partial<LineaUI>) => setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLinea = () => { setLineas((ls) => [...ls, { id: seq, productoId: '', cantidad: '1', almacen: '', precio: '' }]); setSeq((s) => s + 1); };
  const quitarLinea = (id: number) => setLineas((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));

  // Costo/PMP del origen (valor por defecto y placeholder del precio editable).
  const costoOrigenDe = (productoId: string, almacen: string) => {
    const ex = exMap.get(`${productoId}|${almacen}`);
    const p = activos.find((x) => x.id === productoId);
    return Number(ex?.costo_promedio) || p?.precio || 0;
  };

  function elegirProducto(id: number, productoId: string) {
    const mej = mejorOrigen(productoId, destino);
    const almacen = mej?.almacen ?? '';
    const costo = costoOrigenDe(productoId, almacen);
    setLinea(id, { productoId, almacen, cantidad: '1', precio: costo ? String(costo) : '' });
  }

  // Al cambiar el destino, recalculamos el almacén origen de cada línea (no puede ser el destino)
  // y reajustamos el precio por defecto al costo de ese nuevo origen (si el usuario no lo tocó).
  useEffect(() => {
    setLineas((ls) => ls.map((l) => {
      if (!l.productoId) return l;
      const almacen = mejorOrigen(l.productoId, destino)?.almacen ?? '';
      return { ...l, almacen, precio: almacen ? String(costoOrigenDe(l.productoId, almacen)) : '' };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destino]);

  const [motivo, setMotivo] = useState('');
  const [fechaEntrega, setFechaEntrega] = useState(() => new Date().toISOString().slice(0, 10));
  // Datos de la nota de salida en tránsito.
  const [chofer, setChofer] = useState<Chofer | null>(null);
  const [vehiculo, setVehiculo] = useState<Vehiculo | null>(null);
  const [dirDespacho, setDirDespacho] = useState('');
  const [dirDestino, setDirDestino] = useState('');
  const [consumoInterno, setConsumoInterno] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Traslado a CLIENTE: genera una cuenta por cobrar (monto = valor del material, editable).
  const [esCliente, setEsCliente] = useState(false);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [cxcMonto, setCxcMonto] = useState('');

  const prodDe = (id: string) => activos.find((p) => p.id === id) ?? null;
  const stockDe = (l: LineaUI) => Number(exMap.get(`${l.productoId}|${l.almacen}`)?.stock) || 0;
  // Precio efectivo del renglón: el que el usuario editó; si está vacío, el costo del origen.
  const precioDe = (l: LineaUI) => (Number(l.precio) > 0 ? Number(l.precio) : costoOrigenDe(l.productoId, l.almacen));
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
    // Enter en el último campo usa requestSubmit(), que ignora el botón deshabilitado:
    // sin esta guarda, dos Enter seguidos crearían dos solicitudes.
    if (saving) return;
    setError(null);
    if (!destino) { setError('Elegí la sede y el almacén de destino.'); return; }
    if (esCliente && !cliente) { setError('Elegí (o agregá) el cliente para la cuenta por cobrar.'); return; }
    const montoCxc = esCliente ? (Number(cxcMonto) || totalGeneral) : 0;
    if (esCliente && montoCxc <= 0) { setError('El monto de la cuenta por cobrar debe ser mayor que 0.'); return; }
    const items: ItemSolicitudSalida[] = [];
    for (const l of lineas) {
      const p = prodDe(l.productoId);
      const cant = Number(l.cantidad) || 0;
      if (!l.productoId) { setError('Elegí el material en cada renglón.'); return; }
      if (!l.almacen) { setError(`${p?.nombre ?? 'El material'} no tiene stock en otro almacén para trasladar.`); return; }
      if (l.almacen === destino) { setError(`${p?.nombre ?? 'El material'}: el origen no puede ser igual al destino.`); return; }
      if (cant <= 0) { setError('Cada material debe tener cantidad mayor que 0.'); return; }
      if (cant > stockDe(l)) { setError(`No hay stock suficiente de ${p?.nombre} en ${l.almacen}. Disponible: ${num(stockDe(l))}.`); return; }
      items.push({ producto_id: l.productoId, producto_nombre: p?.nombre ?? null, cantidad: cant, precio_unit: precioDe(l) || null, unidad: p?.unidad ?? null, almacen: l.almacen, observacion: null });
    }
    setSaving(true);
    try {
      await crearSolicitudSalida({
        scope: 'traslado', tipo: 'material',
        almacenDestino: destino, items,
        motivo: motivo.trim() || null,
        notaEntrega: null, fechaEntrega: fechaEntrega || null,
        chofer: chofer?.nombre ?? null, choferCedula: chofer?.cedula ?? null,
        vehiculo: vehiculo?.nombre ?? null, vehiculoPlaca: vehiculo?.placa ?? null,
        direccionDespacho: dirDespacho.trim() || null, direccionDestino: dirDestino.trim() || null,
        clienteId: esCliente ? cliente?.id ?? null : null,
        clienteNombre: esCliente ? cliente?.nombre ?? null : null,
        cxcMonto: esCliente ? montoCxc : null,
        cxcMoneda: esCliente ? 'USD' : null,
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
      <form id="traslado-mat-form" onSubmit={handleSubmit} onKeyDown={enterAvanzaCampo({ enviando: saving })}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        {/* ¿Es para un CLIENTE? — visible desde el inicio. Genera cuenta por cobrar. */}
        <div className="card" style={{ padding: '.6rem .85rem', margin: '0 0 .8rem', borderLeft: '3px solid var(--warning)' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer', fontWeight: 600 }}>
            <input type="checkbox" checked={esCliente} onChange={(e) => { setEsCliente(e.target.checked); if (e.target.checked && !cxcMonto) setCxcMonto(totalGeneral ? String(Math.round(totalGeneral * 100) / 100) : ''); }} />
            🧾 Cliente (se le crea una cuenta por cobrar)
          </label>
          {esCliente && (
            <div style={{ marginTop: '.6rem' }}>
              <ClientePicker value={cliente} onChange={setCliente} actor={actor} actorName={actorName} />
              <div className="form-row" style={{ marginTop: '.5rem' }}>
                <label>Monto de la cuenta por cobrar (USD)</label>
                <input className="input mono" type="number" min={0} step="any" value={cxcMonto}
                  onChange={(e) => setCxcMonto(e.target.value)} placeholder={String(Math.round(totalGeneral * 100) / 100)} />
                <small className="muted">Sugerido: valor del material <strong>{money(totalGeneral)}</strong>. Podés editarlo. El cliente lo paga luego en dinero o en producto desde Tesorería.</small>
              </div>
            </div>
          )}
        </div>

        {/* Almacén destino (a dónde va). CUALQUIER almacén, agrupado por sede. El origen se asigna solo: el almacén con más stock. */}
        <div className="form-row">
          <label>Almacén destino</label>
          <select className="select" value={destino} onChange={(e) => setDestino(e.target.value)}>
            <option value="">— elegí el almacén destino —</option>
            {destinosPorSede.map(([sede, alms]) => (
              <optgroup key={sede} label={sede}>
                {alms.map((a) => <option key={a.nombre} value={a.nombre}>{a.label}</option>)}
              </optgroup>
            ))}
          </select>
          <small className="muted">Elegí exactamente a qué almacén (o subalmacén) va el material.</small>
        </div>

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
                    options={opcionesProducto} placeholder="🔎 Buscá el material…" emptyText="Sin productos." sinPreseleccion />
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
                  <input className="input mono" type="number" min={0} max={stock || undefined} step="any" value={l.cantidad} onChange={(e) => onCantidadChange(l, e.target.value)} required />
                  {excede && <small style={{ color: 'var(--danger)' }}>Máximo disponible: {num(stock)} {prod?.unidad ?? ''}.</small>}
                </div>
                <div className="form-row">
                  <label>Precio unit. (costo)</label>
                  <input className="input mono" type="number" min={0} step="any" value={l.precio}
                    onChange={(e) => setLinea(l.id, { precio: e.target.value })}
                    placeholder={l.productoId ? String(costoOrigenDe(l.productoId, l.almacen)) : '0'} />
                  <small className="muted">Costo/PMP del origen. Si lo editás, ese costo viaja al destino y actualiza el producto en Inventario · subtotal {money(precioDe(l) * (Number(l.cantidad) || 0))}</small>
                </div>
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

      </form>
    </Modal>
  );
}
