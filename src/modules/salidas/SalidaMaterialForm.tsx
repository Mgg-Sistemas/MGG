import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { notify } from '@/shared/lib/notify';
import { toast } from '@/shared/ui/Toast';
import { money, num } from '@/shared/lib/format';
import { enterAvanzaCampo } from '@/shared/lib/navegacionEnter';
import type { Almacen, Existencia, Producto, ItemSolicitudSalida, Chofer, Vehiculo } from '@/shared/lib/types';
import { crearSolicitudSalida } from './salidas.repository';
import { listCatalogoPedido, crearCatalogoPedido } from '@/modules/pedidos/pedidos.repository';
import { ChoferVehiculoPicker } from './ChoferVehiculoPicker';
import { ClientePicker } from './ClientePicker';
import type { Cliente } from '@/modules/ventas/clientes.repository';
import { listAlmacenes } from '@/modules/inventario/almacenes.repository';
import { listCentrosAcopio } from './cajas.repository';
import { planEntregaPorPrioridad, stockTotal, type CandidatoAlmacen, type AsignacionSalida } from './asignacionPrioridad';

interface LineaUI { id: number; productoId: string; cantidad: string; precio: string; almacen: string }

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

  const [almacenesObj, setAlmacenesObj] = useState<Almacen[]>([]);

  // Almacén → sede, para ordenar por prioridad (Los Pinos → Matanzas → resto).
  const sedePorAlmacen = useMemo(() => {
    const m = new Map<string, string | null>();
    almacenesObj.forEach((a) => m.set(a.nombre, a.sede ?? null));
    return m;
  }, [almacenesObj]);

  // Candidatos de un producto: todos sus almacenes con stock, con su sede y costo.
  const candidatosDe = (productoId: string): CandidatoAlmacen[] =>
    existencias
      .filter((e) => e.producto_id === productoId && (Number(e.stock) || 0) > 0)
      .map((e) => ({ almacen: e.almacen, sede: sedePorAlmacen.get(e.almacen) ?? null, stock: Number(e.stock) || 0, costo: Number(e.costo_promedio) || 0 }));

  // Varias líneas de producto (como una OC). Cada una: producto + cantidad. El/los almacén(es) se resuelven por prioridad.
  const [lineas, setLineas] = useState<LineaUI[]>([{ id: 1, productoId: '', cantidad: '1', precio: '', almacen: '' }]);
  const [seq, setSeq] = useState(2);
  const setLinea = (id: number, patch: Partial<LineaUI>) => setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLinea = () => { setLineas((ls) => [...ls, { id: seq, productoId: '', cantidad: '1', precio: '', almacen: '' }]); setSeq((s) => s + 1); };
  const quitarLinea = (id: number) => setLineas((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));

  // Al elegir el producto: cantidad 1 y precio por defecto = costo del almacén de mayor prioridad.
  function elegirProducto(id: number, productoId: string) {
    const primer = planEntregaPorPrioridad(candidatosDe(productoId), 1).tramos[0];
    const p = activos.find((x) => x.id === productoId);
    const costo = primer?.costo || p?.precio || 0;
    // Al cambiar de producto, el almacén vuelve a "Automático" (prioridad).
    setLinea(id, { productoId, cantidad: '1', precio: costo ? String(costo) : '', almacen: '' });
  }

  const [motivo, setMotivo] = useState('');
  const [fechaEntrega, setFechaEntrega] = useState(() => new Date().toISOString().slice(0, 10));
  // Datos de la nota de salida en tránsito.
  const [chofer, setChofer] = useState<Chofer | null>(null);
  const [vehiculo, setVehiculo] = useState<Vehiculo | null>(null);
  const [consumoInterno, setConsumoInterno] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sede/centro de acopio destino (almacenes padre + centros de acopio).
  const [sedeDestino, setSedeDestino] = useState('');
  const [sedePrincipales, setSedePrincipales] = useState<string[]>([]);
  const [sedeCentros, setSedeCentros] = useState<string[]>([]);
  useEffect(() => {
    Promise.all([listAlmacenes().catch(() => []), listCentrosAcopio().catch(() => [])])
      .then(([alms, centros]) => {
        setAlmacenesObj(alms);
        // Solo almacenes PADRE (principales con subalmacenes); se excluyen los top-level sin hijos.
        const conHijos = new Set(alms.filter((a) => a.parent_id).map((a) => a.parent_id));
        setSedePrincipales(alms.filter((a) => !a.parent_id && a.estado === 'activo' && conHijos.has(a.id)).map((a) => a.nombre));
        setSedeCentros(centros.map((c) => c.nombre));
      })
      .catch(() => { /* sin sedes: el campo queda vacío */ });
  }, []);

  // Salida a CLIENTE: genera una cuenta por cobrar (monto = valor del material, editable).
  const [esCliente, setEsCliente] = useState(false);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [cxcMonto, setCxcMonto] = useState('');

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

  // Datos derivados por línea. El stock disponible es el TOTAL de todos los almacenes del producto;
  // el reparto real (de qué almacén sale cada unidad) lo decide la prioridad (Los Pinos → Matanzas → resto).
  const prodDe = (id: string) => activos.find((p) => p.id === id) ?? null;
  // Almacenes donde el producto tiene stock (para el selector "Almacén de origen").
  const almacenesConStock = (productoId: string): CandidatoAlmacen[] =>
    candidatosDe(productoId).sort((a, b) => (Number(b.stock) || 0) - (Number(a.stock) || 0));
  // Candidato del almacén ELEGIDO manualmente (si el usuario escogió uno).
  const candElegido = (l: LineaUI) => (l.almacen ? candidatosDe(l.productoId).find((c) => c.almacen === l.almacen) ?? null : null);
  // Stock disponible: del almacén elegido (si hay) o el TOTAL de todos (automático por prioridad).
  const stockDe = (l: LineaUI) => (l.almacen ? (candElegido(l)?.stock ?? 0) : stockTotal(candidatosDe(l.productoId)));
  // Plan de reparto: del almacén elegido (un tramo) o cascada por prioridad (Los Pinos → Matanzas → resto).
  const planDe = (l: LineaUI): { tramos: AsignacionSalida[]; faltante: number } => {
    const cant = Number(l.cantidad) || 0;
    if (l.almacen) {
      const c = candElegido(l);
      const disp = Number(c?.stock) || 0;
      const toma = Math.min(cant, disp);
      return {
        tramos: toma > 0 ? [{ almacen: l.almacen, cantidad: toma, stock: disp, costo: Number(c?.costo) || 0 }] : [],
        faltante: Math.max(0, cant - disp),
      };
    }
    return planEntregaPorPrioridad(candidatosDe(l.productoId), cant);
  };
  // Costo por defecto del renglón (almacén elegido o el de mayor prioridad) para placeholder del precio.
  const costoInvDe = (l: LineaUI) => (l.almacen ? candElegido(l)?.costo : planEntregaPorPrioridad(candidatosDe(l.productoId), 1).tramos[0]?.costo) || prodDe(l.productoId)?.precio || 0;
  // Precio efectivo del renglón: el que el usuario editó; si está vacío, el costo del almacén prioritario.
  const precioDe = (l: LineaUI) => (Number(l.precio) > 0 ? Number(l.precio) : costoInvDe(l));
  const totalGeneral = useMemo(
    () => lineas.reduce((a, l) => a + precioDe(l) * (Number(l.cantidad) || 0), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lineas, exMap, sedePorAlmacen],
  );

  function onCantidadChange(l: LineaUI, v: string) {
    const stock = stockDe(l);
    const n = Number(v);
    if (Number.isFinite(n) && n > stock) { setLinea(l.id, { cantidad: String(stock) }); return; }
    setLinea(l.id, { cantidad: v });
  }

  const hayExcede = lineas.some((l) => (Number(l.cantidad) || 0) > stockDe(l));
  const algunaInvalida = lineas.some((l) => !l.productoId || stockDe(l) <= 0 || (Number(l.cantidad) || 0) <= 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Enter en el último campo usa requestSubmit(), que ignora el botón deshabilitado:
    // sin esta guarda, dos Enter seguidos crearían dos solicitudes.
    if (saving) return;
    setError(null);
    if (!unidad.trim()) { setError('Indicá la unidad solicitante.'); return; }
    if (esCliente && !cliente) { setError('Elegí (o agregá) el cliente para la cuenta por cobrar.'); return; }
    const montoCxc = esCliente ? (Number(cxcMonto) || totalGeneral) : 0;
    if (esCliente && montoCxc <= 0) { setError('El monto de la cuenta por cobrar debe ser mayor que 0.'); return; }
    const items: ItemSolicitudSalida[] = [];
    for (const l of lineas) {
      const p = prodDe(l.productoId);
      const cant = Number(l.cantidad) || 0;
      if (!l.productoId) { setError('Elegí el material en cada renglón.'); return; }
      if (stockDe(l) <= 0) { setError(`${p?.nombre ?? 'El material'} no tiene stock en ningún almacén.`); return; }
      if (cant <= 0) { setError('Cada material debe tener cantidad mayor que 0.'); return; }
      const { tramos, faltante } = planDe(l);
      if (faltante > 0) { setError(`No hay stock suficiente de ${p?.nombre}. Disponible: ${num(stockDe(l))}.`); return; }
      // Una línea puede salir de VARIOS almacenes (cascada por prioridad): un ítem por tramo.
      // Si el usuario editó el precio, ese precio manda; si no, cada tramo usa el costo de su almacén.
      const precioEditado = Number(l.precio) > 0 ? Number(l.precio) : null;
      for (const t of tramos) {
        items.push({ producto_id: l.productoId, producto_nombre: p?.nombre ?? null, cantidad: t.cantidad, precio_unit: precioEditado ?? t.costo ?? null, unidad: p?.unidad ?? null, almacen: t.almacen, observacion: null });
      }
    }
    setSaving(true);
    try {
      await crearSolicitudSalida({
        scope: 'salida', tipo: 'material',
        items,
        destino: unidad.trim(), motivo: motivo.trim() || null,
        fechaEntrega: fechaEntrega || null,
        chofer: chofer?.nombre ?? null, choferCedula: chofer?.cedula ?? null,
        vehiculo: vehiculo?.nombre ?? null, vehiculoPlaca: vehiculo?.placa ?? null,
        sedeDestino: sedeDestino || null,
        clienteId: esCliente ? cliente?.id ?? null : null,
        clienteNombre: esCliente ? cliente?.nombre ?? null : null,
        cxcMonto: esCliente ? montoCxc : null,
        cxcMoneda: esCliente ? 'USD' : null,
        consumoInterno,
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
      <form id="salida-mat-form" onSubmit={handleSubmit} onKeyDown={enterAvanzaCampo({ enviando: saving })}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        {/* 0) ¿Es para un CLIENTE? — visible desde el inicio. Genera cuenta por cobrar. */}
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
                <small className="muted">Sugerido: valor del material <strong>{money(totalGeneral)}</strong>. Podés editarlo (precio de venta). El cliente lo paga luego en dinero o en producto desde Tesorería.</small>
              </div>
            </div>
          )}
        </div>

        {/* 1) Unidad solicitante (gerencia/área) — primero, como pediste. Catálogo compartido con OP. */}
        <div className="form-row">
          <label>Unidad solicitante</label>
          <select className="select" value={unidad} onChange={(e) => setUnidad(e.target.value)}>
            <option value="">— elegí la unidad solicitante —</option>
            {unidadesSol.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          {/* Alta inline: acá Enter significa "añadir", no "siguiente campo" → fuera del recorrido. */}
          <div data-enter-omitir="" style={{ display: 'flex', gap: '.4rem', marginTop: '.35rem' }}>
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

        {/* 1b) Sede / centro de acopio destino (almacenes padre + centros de acopio). */}
        <div className="form-row">
          <label>Sede destino</label>
          <select className="select" value={sedeDestino} onChange={(e) => setSedeDestino(e.target.value)}>
            <option value="">— elegí la sede destino (opcional) —</option>
            {sedePrincipales.length > 0 && (
              <optgroup label="Almacenes / sedes">
                {sedePrincipales.map((s) => <option key={`a-${s}`} value={s}>{s}</option>)}
              </optgroup>
            )}
            {sedeCentros.length > 0 && (
              <optgroup label="Centros de acopio">
                {sedeCentros.map((c) => <option key={`c-${c}`} value={c}>{c}</option>)}
              </optgroup>
            )}
          </select>
          <small className="muted">A dónde va el material (almacén padre o centro de acopio, ej. La Esperanza).</small>
        </div>

        {/* 2) Materiales (varias líneas) — producto buscable; el almacén se asigna solo. */}
        <div className="form-row" style={{ marginBottom: '.3rem' }}><label>Materiales</label></div>
        {lineas.map((l, idx) => {
          const stock = stockDe(l);
          const prod = prodDe(l.productoId);
          const cant = Number(l.cantidad) || 0;
          const excede = cant > stock;
          const { tramos } = planDe(l);
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
                    options={opcionesProducto} placeholder="🔎 Buscá el material…" emptyText="Sin productos." sinPreseleccion />
                  <small className="muted">
                    {l.productoId
                      ? (stock > 0
                        ? <>📦 Sale de <strong>{tramos.map((t) => `${t.almacen} (${num(t.cantidad)})`).join(' + ') || '—'}</strong> · disponible {l.almacen ? 'en este almacén' : 'total'} <strong className="mono">{num(stock)} {prod?.unidad ?? ''}</strong></>
                        : <span style={{ color: 'var(--danger)' }}>Sin stock en {l.almacen ? 'ese almacén' : 'ningún almacén'}</span>)
                      : 'Se descuenta por prioridad: Los Pinos primero, luego Matanzas.'}
                  </small>
                  {l.productoId && (
                    <select className="select" style={{ marginTop: '.35rem', fontSize: '.82rem' }} value={l.almacen}
                      onChange={(e) => setLinea(l.id, { almacen: e.target.value })}>
                      <option value="">📦 Automático (por prioridad)</option>
                      {almacenesConStock(l.productoId).map((c) => (
                        <option key={c.almacen} value={c.almacen}>{c.almacen} · {num(c.stock)} {prod?.unidad ?? ''}</option>
                      ))}
                    </select>
                  )}
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
                    placeholder={l.productoId ? String(costoInvDe(l)) : '0'} />
                  <small className="muted">Editable. Al ejecutar la salida actualiza el costo del producto en Inventario · subtotal {money(precioDe(l) * (Number(l.cantidad) || 0))}</small>
                </div>
              </div>
            </div>
          );
        })}
        <button type="button" className="btn btn-sm btn-ghost" onClick={addLinea}>＋ Agregar material</button>

        {/* 3) Datos del despacho (nota de salida): chofer/responsable + vehículo + direcciones */}
        <div className="form-row" style={{ marginTop: '.8rem', marginBottom: '.3rem' }}><label>Datos del despacho</label></div>
        <ChoferVehiculoPicker chofer={chofer} vehiculo={vehiculo} onChofer={setChofer} onVehiculo={setVehiculo} actor={actor} />
        <div className="form-row" style={{ marginTop: '.45rem' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.45rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={consumoInterno} onChange={(e) => setConsumoInterno(e.target.checked)} />
            Consumo interno
          </label>
          <small className="muted">Marcalo si el material se queda dentro de la empresa (no es venta ni entrega a terceros). Se ve en la trazabilidad y en el detalle.</small>
        </div>

        {/* 4) Motivo y fecha */}
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
