import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { money, num } from '@/shared/lib/format';
import type { Existencia, Producto } from '@/shared/lib/types';
import { getUnidades, updateProducto } from '@/modules/inventario/inventario.repository';
import { AlmacenPicker, AlmacenSelectAgrupado } from '@/modules/inventario/AlmacenPicker';
import { crearProduccion, crearProductoProducible, crearInsumoReceta, getUltimaReceta, type MaterialInput, type ProduccionTipo } from './produccion.repository';
import { crearHorno } from './hornos.repository';
import { ColadaCampos } from './ColadaCampos';
import { coladaDatosVacios, crearColada, proximaColadaNum } from './colada.repository';
import type { ColadaDatos } from '@/shared/lib/types';

interface RecetaBase {
  rendimiento: number;
  /** Nº de la receta base (última fundición del producto). */
  numero: number;
  items: Record<string, { cantidad: number; almacen: string }>;
}

interface MaterialAProducirModalProps {
  /** Fundición (default) o refinación de material: cambia rótulos, categoría del producto y el tipo de orden. */
  tipo?: ProduccionTipo;
  productos: Producto[];
  existencias: Existencia[];
  almacenesList: string[];
  /** Nombres de hornos ACTIVOS para el desplegable. */
  hornosList: string[];
  actor: string;
  actorName?: string | null;
  /** Preselecciona un producto producible (ej. "Editar receta"). */
  initialProductoId?: string;
  onClose: () => void;
  onCreated: () => void;
  /** Recarga productos/existencias tras dar de alta un insumo inline. */
  onProductosChanged: () => Promise<void> | void;
  /** Recarga el catálogo de hornos tras un alta inline. */
  onHornosChanged?: () => Promise<void> | void;
}

interface MatRow { checked: boolean; cantidad: string; almacen: string }

export function MaterialAProducirModal({
  tipo = 'fundicion', productos, existencias, almacenesList, hornosList, actor, actorName, initialProductoId, onClose, onCreated, onProductosChanged, onHornosChanged,
}: MaterialAProducirModalProps) {
  // Rótulos según el tipo (fundición / refinación).
  const esRef = tipo === 'refinacion';
  const esColada = tipo === 'fundicion';
  const L = {
    verbo: esRef ? 'refinar' : 'producir',
    proceso: esRef ? 'refinación' : 'fundición',
    tituloModal: esRef ? 'Material a refinar' : '🔥 Iniciar colada',
    iniciar: esRef ? 'Iniciar refinación' : 'Iniciar colada',
    categoria: esRef ? 'REFINACIÓN' : 'FUNDICIÓN',
  };

  // Colada (solo fundición): correlativo global + fecha + detalle del formato MGG-FR-001.
  const [coladaNum, setColadaNum] = useState('');
  const [coladaFecha, setColadaFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [coladaDatos, setColadaDatos] = useState<ColadaDatos>(() => coladaDatosVacios());
  useEffect(() => {
    if (!esColada) return;
    let cancel = false;
    proximaColadaNum().then((n) => { if (!cancel) setColadaNum((v) => v || String(n)); }).catch(() => { /* editable */ });
    return () => { cancel = true; };
  }, [esColada]);
  const producibles = useMemo(() => productos.filter((p) => p.es_producible), [productos]);
  const materiales = useMemo(
    () => productos.filter((p) => p.es_receta && p.estado === 'activo'),
    [productos],
  );
  const almacenes = almacenesList.length ? almacenesList : ['General'];

  // Existencia por (producto, almacén).
  const exMap = useMemo(() => {
    const m = new Map<string, Existencia>();
    existencias.forEach((e) => m.set(`${e.producto_id}|${e.almacen}`, e));
    return m;
  }, [existencias]);
  const exStock = (pid: string, alm: string) => Number(exMap.get(`${pid}|${alm}`)?.stock) || 0;
  const exCosto = (pid: string, alm: string) => Number(exMap.get(`${pid}|${alm}`)?.costo_promedio) || 0;

  // "Qué producir" (preselecciona initialProductoId si vino, ej. "Editar receta").
  const preselect = initialProductoId && producibles.some((p) => p.id === initialProductoId) ? initialProductoId : '';
  const [modoOutput, setModoOutput] = useState<'existente' | 'nuevo'>(producibles.length ? 'existente' : 'nuevo');
  const [productoSelId, setProductoSelId] = useState(preselect || producibles[0]?.id || '');
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [unidadNuevo, setUnidadNuevo] = useState('und');

  // Unidades buscables (catálogo del inventario + estándares Und/Kg/Ton), sin repetir.
  const [unidadesCat, setUnidadesCat] = useState<string[]>(['und', 'kg', 'ton']);
  useEffect(() => {
    let cancel = false;
    getUnidades(productos).then((u) => { if (!cancel) setUnidadesCat(u); }).catch(() => { /* defaults */ });
    return () => { cancel = true; };
  }, [productos]);
  const opcionesUnidad = useMemo(() => {
    const vistos = new Set<string>();
    const out: string[] = [];
    for (const u of [...unidadesCat, 'und', 'kg', 'ton']) {
      const k = u.trim().toLowerCase();
      if (!k || vistos.has(k)) continue;
      vistos.add(k);
      out.push(u);
    }
    return out.sort((a, b) => a.localeCompare(b, 'es')).map((u) => ({ value: u, label: u }));
  }, [unidadesCat]);

  const [cantidad, setCantidad] = useState('1');
  const [almacenDestino, setAlmacenDestino] = useState('');
  // Horno a utilizar: selección desde el catálogo (+ alta inline de uno nuevo).
  const [horno, setHorno] = useState(hornosList[0] ?? '');
  const [hornoAddOpen, setHornoAddOpen] = useState(false);
  const [hornoNuevo, setHornoNuevo] = useState('');
  const [hornoSaving, setHornoSaving] = useState(false);
  const [manoObra, setManoObra] = useState('0');
  const [costosIndirectos, setCostosIndirectos] = useState('0');
  const [margen, setMargen] = useState('30'); // margen bruto % sobre el precio de venta

  // Checklist de materiales
  const [rows, setRows] = useState<Record<string, MatRow>>(() =>
    Object.fromEntries(materiales.map((m) => [m.id, { checked: false, cantidad: '1', almacen: m.almacen || almacenes[0] }])),
  );
  const setRow = (id: string, patch: Partial<MatRow>) =>
    setRows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { checked: false, cantidad: '1', almacen: almacenes[0] }), ...patch } }));

  // Receta del producto existente: insumos usados en su última fundición.
  const [recetaBase, setRecetaBase] = useState<RecetaBase | null>(null);
  const [recetaLoading, setRecetaLoading] = useState(false);
  const prevRecetaIds = useRef<string[]>([]);

  // Alta de insumo: buscar uno del inventario y marcarlo receta, o crear uno nuevo.
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<'buscar' | 'crear'>('buscar');
  const [busqueda, setBusqueda] = useState('');
  const [nuevo, setNuevo] = useState({ nombre: '', unidad: 'und', almacen: almacenes[0], stock: '0', costo: '0' });
  const [addSaving, setAddSaving] = useState(false);

  // Productos del inventario que aún NO son receta (candidatos a marcar como insumo).
  const candidatos = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos
      .filter((p) => p.estado === 'activo' && !p.es_receta && !p.es_producible)
      .filter((p) => !q || p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .slice(0, 30);
  }, [productos, busqueda]);

  async function marcarComoReceta(p: Producto) {
    setAddSaving(true);
    try {
      await updateProducto(p.id, { es_receta: true });
      toast(`"${p.nombre}" marcado como receta (insumo)`, 'success');
      await onProductosChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo marcar el producto', 'error');
    } finally {
      setAddSaving(false);
    }
  }

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cantidadNum = Number(cantidad) || 0;
  const productoSel = producibles.find((p) => p.id === productoSelId) ?? null;
  // Nº de receta que tendrá ESTA fundición (la última + 1; o 1 si no hay previa / es nuevo).
  const recetaNumActual = modoOutput === 'nuevo' ? 1 : (recetaBase ? recetaBase.numero + 1 : 1);

  // Al elegir un producto EXISTENTE, cargar su receta (insumos de la última
  // fundición). En modo "nuevo" no hay receta previa.
  useEffect(() => {
    if (modoOutput !== 'existente' || !productoSelId) { setRecetaBase(null); return; }
    let cancel = false;
    setRecetaLoading(true);
    getUltimaReceta(productoSelId, tipo)
      .then((r) => {
        if (cancel) return;
        if (!r || !r.items.length) { setRecetaBase(null); return; }
        const items: RecetaBase['items'] = {};
        r.items.forEach((it) => { items[it.producto_id] = { cantidad: it.cantidad, almacen: it.almacen }; });
        setRecetaBase({ rendimiento: r.rendimiento || 1, numero: r.numero || 1, items });
      })
      .catch(() => { if (!cancel) setRecetaBase(null); })
      .finally(() => { if (!cancel) setRecetaLoading(false); });
    return () => { cancel = true; };
  }, [modoOutput, productoSelId, tipo]);

  // En modo "nuevo" no hay receta previa: la checklist arranca sin tildar nada.
  useEffect(() => {
    if (modoOutput !== 'nuevo') return;
    setRows((prev) => Object.fromEntries(
      Object.entries(prev).map(([id, r]) => [id, { ...r, checked: false }]),
    ));
    prevRecetaIds.current = [];
  }, [modoOutput]);

  // Aplicar la receta a la checklist y escalar cantidades según lo que se va a
  // producir: cantidad_insumo = base × (cantidad ÷ rendimiento de la receta).
  useEffect(() => {
    setRows((prev) => {
      const next = { ...prev };
      // Limpiar insumos de la receta anterior que ya no aplican.
      for (const pid of prevRecetaIds.current) {
        if ((!recetaBase || !recetaBase.items[pid]) && next[pid]) next[pid] = { ...next[pid], checked: false };
      }
      if (recetaBase) {
        const factor = recetaBase.rendimiento > 0 ? cantidadNum / recetaBase.rendimiento : 1;
        for (const [pid, base] of Object.entries(recetaBase.items)) {
          const scaled = Math.round(base.cantidad * factor * 1000) / 1000;
          next[pid] = { checked: true, cantidad: String(scaled), almacen: base.almacen };
        }
      }
      return next;
    });
    prevRecetaIds.current = recetaBase ? Object.keys(recetaBase.items) : [];
  }, [recetaBase, cantidadNum]);

  // Costos: CTM → CP → costo unitario. El posible precio de venta se MARCA solo
  // = costo unitario de fundición (no editable por el usuario).
  const seleccion = materiales
    .map((m) => ({ m, row: rows[m.id] }))
    .filter((x) => x.row?.checked && (Number(x.row.cantidad) || 0) > 0);
  const ctm = seleccion.reduce((a, { m, row }) => a + (Number(row.cantidad) || 0) * exCosto(m.id, row.almacen), 0);
  const cp = ctm + (Number(manoObra) || 0) + (Number(costosIndirectos) || 0);
  const costoUnit = cantidadNum > 0 ? cp / cantidadNum : 0;
  // Margen BRUTO sobre el precio de venta: PV = costo unitario / (1 - margen%).
  // Se acota el margen a [0, 95%] para evitar divisiones por ~0.
  const margenPct = Math.min(0.95, Math.max(0, (Number(margen) || 0) / 100));
  const posiblePrecioVenta = Math.round((costoUnit / (1 - margenPct)) * 100) / 100;
  const gananciaUnit = Math.round((posiblePrecioVenta - costoUnit) * 100) / 100;
  const gananciaTotal = Math.round(gananciaUnit * cantidadNum * 100) / 100;

  async function handleAddHorno() {
    const nombre = hornoNuevo.trim();
    if (!nombre) { toast('Escribí el nombre del horno', 'error'); return; }
    setHornoSaving(true);
    try {
      const creado = await crearHorno(nombre, actor);
      toast(`Horno "${creado.nombre}" agregado`, 'success');
      setHorno(creado.nombre);          // seleccionar el recién creado
      setHornoNuevo('');
      setHornoAddOpen(false);
      await onHornosChanged?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo agregar el horno', 'error');
    } finally {
      setHornoSaving(false);
    }
  }

  async function handleAddInsumo() {
    if (!nuevo.nombre.trim()) { toast('Escribe el nombre del insumo', 'error'); return; }
    setAddSaving(true);
    try {
      await crearInsumoReceta({
        nombre: nuevo.nombre,
        unidad: nuevo.unidad,
        almacen: nuevo.almacen,
        stock: Number(nuevo.stock) || 0,
        costo: Number(nuevo.costo) || 0,
        actor,
        actor_name: actorName,
      });
      toast(`Insumo "${nuevo.nombre}" agregado al inventario (receta SÍ)`, 'success');
      setNuevo({ nombre: '', unidad: 'und', almacen: almacenes[0], stock: '0', costo: '0' });
      setAddOpen(false);
      await onProductosChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo agregar el insumo', 'error');
    } finally {
      setAddSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (cantidadNum <= 0) { setError('La cantidad a producir debe ser mayor que 0.'); return; }
    if (!almacenDestino) { setError('Elegí el almacén destino.'); return; }
    if (modoOutput === 'existente' && !productoSelId) { setError('Elegí el producto a producir.'); return; }
    if (modoOutput === 'nuevo' && !nombreNuevo.trim()) { setError('Escribí el nombre del producto a producir.'); return; }
    if (!seleccion.length) { setError('Seleccioná al menos un material con cantidad.'); return; }

    for (const { m, row } of seleccion) {
      const cant = Number(row.cantidad) || 0;
      const stock = exStock(m.id, row.almacen);
      if (cant > stock) {
        setError(`"${m.nombre}" en ${row.almacen}: pedís ${num(cant)} pero hay ${num(stock)}.`);
        return;
      }
    }

    setSaving(true);
    try {
      let productoId = productoSelId;
      let productoNombre = productoSel?.nombre ?? '';
      if (modoOutput === 'nuevo') {
        const creado = await crearProductoProducible({
          nombre: nombreNuevo,
          unidad: unidadNuevo,
          precioVenta: posiblePrecioVenta,
          categoria: L.categoria,
        });
        productoId = creado.id;
        productoNombre = creado.nombre;
      }

      const matInput: MaterialInput[] = seleccion.map(({ m, row }) => ({
        producto_id: m.id,
        material_nombre: m.nombre,
        almacen: row.almacen,
        cantidad: Number(row.cantidad) || 0,
      }));

      const prod = await crearProduccion({
        producto_id: productoId,
        producto_nombre: productoNombre,
        cantidad: cantidadNum,
        almacen_destino: almacenDestino,
        horno: horno || null,
        mano_obra: Number(manoObra) || 0,
        costos_indirectos: Number(costosIndirectos) || 0,
        precio_venta: posiblePrecioVenta,
        materiales: matInput,
        tipo,
        actor,
        actor_name: actorName,
      });

      // Fundición ⇒ guarda el reporte de colada (MGG-FR-001) vinculado a la orden.
      if (esColada) {
        try {
          const nColada = Number(coladaNum) || (await proximaColadaNum());
          await crearColada({
            produccionId: prod.id,
            coladaNum: nColada,
            fecha: coladaFecha,
            datos: { ...coladaDatos, destino_almacen: coladaDatos.destino_almacen || almacenDestino },
            actor,
          });
        } catch (errColada) {
          toast(errColada instanceof Error ? `Fundición creada, pero el reporte de colada falló: ${errColada.message}` : 'Fundición creada, pero no se pudo guardar el reporte de colada', 'warning');
        }
      }

      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : `No se pudo iniciar la ${L.proceso}.`);
    } finally {
      setSaving(false);
    }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="prod-form" className="btn btn-primary" disabled={saving}>
        {saving ? 'Iniciando…' : L.iniciar}
      </button>
    </>
  );

  return (
    <Modal title={L.tituloModal} size="lg" onClose={onClose} footer={footer}>
      <form
        id="prod-form"
        onSubmit={handleSubmit}
        onKeyDown={(e) => {
          // Evitar que Enter en un input (cantidades, buscador de insumos, margen…)
          // dispare el submit y cierre el modal mientras se cargan los insumos.
          const tag = (e.target as HTMLElement).tagName;
          if (e.key === 'Enter' && tag !== 'TEXTAREA') e.preventDefault();
        }}
      >
        {error && (
          <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Colada (solo fundición): identificación + materias primas + proceso + carga */}
        {esColada && (
          <ColadaCampos
            coladaNum={coladaNum} setColadaNum={setColadaNum}
            fecha={coladaFecha} setFecha={setColadaFecha}
            datos={coladaDatos} setDatos={setColadaDatos}
          />
        )}

        {/* Posible precio de venta — automático (margen bruto sobre CP) */}
        <div className="card" style={{ padding: '.7rem .9rem', marginBottom: '.85rem', borderLeft: '3px solid var(--primary)', background: 'var(--bg-1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>Posible precio de venta (automático)</div>
              <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary-3)' }}>{money(posiblePrecioVenta)}</div>
              <div className="muted" style={{ fontSize: '.72rem' }}>= costo unitario ÷ (1 − margen). Posible ganancia: <strong style={{ color: gananciaTotal >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(gananciaTotal)}</strong> ({money(gananciaUnit)}/und)</div>
            </div>
            <div style={{ minWidth: 120 }}>
              <label className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: '.2rem' }}>Margen bruto (%)</label>
              <input className="input mono" type="number" min={0} max={95} step="1" value={margen} onChange={(e) => setMargen(e.target.value)} style={{ width: 110 }} />
            </div>
          </div>
        </div>

        {/* Qué producir */}
        <div className="form-row">
          <label>Producto a producir</label>
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.4rem' }}>
            <button type="button" className={`btn btn-sm ${modoOutput === 'existente' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModoOutput('existente')} disabled={!producibles.length}>
              Existente
            </button>
            <button type="button" className={`btn btn-sm ${modoOutput === 'nuevo' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setModoOutput('nuevo')}>
              Nuevo
            </button>
          </div>
          {modoOutput === 'existente' ? (
            <SearchSelect value={productoSelId} onChange={setProductoSelId}
              options={producibles.map((p) => ({ value: p.id, label: `${p.nombre}${p.precio_venta != null ? ` · venta ${money(p.precio_venta)}` : ''}` }))}
              placeholder="🔎 Buscá el producto…" emptyText="Sin productos." />
          ) : (
            <div className="form-grid">
              <input className="input" placeholder="Nombre del producto a producir" value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value.toUpperCase())} />
              <SearchSelect options={opcionesUnidad} value={unidadNuevo} onChange={setUnidadNuevo} placeholder="Unidad…" />
            </div>
          )}
          {modoOutput === 'nuevo' && (
            <small className="muted" style={{ fontSize: '.72rem' }}>Se guarda en el catálogo para próximas producciones.</small>
          )}
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Cantidad a producir</label>
            <input className="input mono" type="number" min={1} step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
          </div>
          <div className="form-row">
            <AlmacenPicker value={almacenDestino} onChange={setAlmacenDestino} sedeLabel="Sede destino" label="Almacén destino" />
          </div>
        </div>

        {/* Horno a utilizar */}
        <div className="form-row">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ margin: 0 }}>Horno a utilizar</label>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setHornoAddOpen((v) => !v)}>+ Horno nuevo</button>
          </div>
          <select className="select" value={horno} onChange={(e) => setHorno(e.target.value)}>
            {!hornosList.length && <option value="">— Sin hornos: agregá uno →</option>}
            {hornosList.map((h) => <option key={h} value={h}>{h}</option>)}
            {/* Si el seleccionado no está en la lista activa (recién creado), lo mostramos igual. */}
            {horno && !hornosList.includes(horno) && <option value={horno}>{horno}</option>}
          </select>
          {hornoAddOpen && (
            <div className="card" style={{ padding: '.6rem', marginTop: '.4rem', display: 'flex', gap: '.5rem' }}>
              <input
                className="input"
                placeholder="Nombre del horno (ej. Horno 3)"
                value={hornoNuevo}
                onChange={(e) => setHornoNuevo(e.target.value)}
                style={{ flex: 1 }}
              />
              <button type="button" className="btn btn-sm btn-primary" onClick={handleAddHorno} disabled={hornoSaving}>
                {hornoSaving ? 'Agregando…' : 'Agregar y usar'}
              </button>
            </div>
          )}
        </div>

        {/* Materiales */}
        <div className="form-row">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ margin: 0 }}>Materiales a utilizar (receta)</label>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAddOpen((v) => !v)}>+ Nuevo insumo</button>
          </div>

          <div className="muted" style={{ fontSize: '.78rem', padding: '.25rem 0', display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
            <span className="badge" style={{ background: 'var(--primary)', color: '#1a1205', fontWeight: 700 }}>Receta #{num(recetaNumActual)}</span>
            {modoOutput === 'existente' ? (
              recetaLoading ? (
                <span>Cargando receta del producto…</span>
              ) : recetaBase ? (
                <span>basada en <strong>Receta #{num(recetaBase.numero)}</strong> · base para <strong>{num(recetaBase.rendimiento)}</strong> und → escaladas a <strong>{num(cantidadNum)}</strong> und. Podés ajustar o agregar insumos.</span>
              ) : (
                <span>Primera receta de este producto. Se guardará para {num(cantidadNum)} und.</span>
              )
            ) : (
              <span>Producto nuevo. Se guardará como su primera receta ({num(cantidadNum)} und).</span>
            )}
          </div>

          {addOpen && (
            <div className="card" style={{ padding: '.65rem', margin: '.4rem 0', display: 'grid', gap: '.5rem' }}>
              <div style={{ display: 'flex', gap: '.4rem' }}>
                <button type="button" className={`btn btn-sm ${addMode === 'buscar' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setAddMode('buscar')}>Buscar en inventario</button>
                <button type="button" className={`btn btn-sm ${addMode === 'crear' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setAddMode('crear')}>Crear nuevo</button>
              </div>

              {addMode === 'buscar' ? (
                <div style={{ display: 'grid', gap: '.4rem' }}>
                  <input className="input" placeholder="Buscar producto por nombre o SKU…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} autoFocus />
                  <div className="table-wrap" style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {!candidatos.length ? (
                      <div className="muted" style={{ fontSize: '.8rem', padding: '.5rem' }}>
                        {busqueda ? 'Sin coincidencias.' : 'No hay productos disponibles para marcar como insumo.'}
                      </div>
                    ) : (
                      <table className="table" style={{ fontSize: '.82rem' }}>
                        <tbody>
                          {candidatos.map((p) => (
                            <tr key={p.id}>
                              <td><strong>{p.nombre}</strong> <span className="muted mono" style={{ fontSize: '.7rem' }}>{p.sku}</span></td>
                              <td className="muted" style={{ fontSize: '.75rem' }}>{p.categoria}</td>
                              <td style={{ textAlign: 'right' }}>
                                <button type="button" className="btn btn-sm btn-ghost" onClick={() => marcarComoReceta(p)} disabled={addSaving}>+ Usar como insumo</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '.4rem' }}>
                  <div className="form-grid">
                    <input className="input" placeholder="Nombre del insumo" value={nuevo.nombre} onChange={(e) => setNuevo((p) => ({ ...p, nombre: e.target.value.toUpperCase() }))} />
                    <SearchSelect options={opcionesUnidad} value={nuevo.unidad} onChange={(v) => setNuevo((p) => ({ ...p, unidad: v }))} placeholder="Unidad…" />
                  </div>
                  <div className="form-grid">
                    <AlmacenSelectAgrupado value={nuevo.almacen} onChange={(v) => setNuevo((p) => ({ ...p, almacen: v }))} extraNombres={almacenes} />
                    <input className="input mono" type="number" min={0} placeholder="Stock inicial" value={nuevo.stock} onChange={(e) => setNuevo((p) => ({ ...p, stock: e.target.value }))} />
                    <input className="input mono" type="number" min={0} step="0.01" placeholder="Costo unit." value={nuevo.costo} onChange={(e) => setNuevo((p) => ({ ...p, costo: e.target.value }))} />
                  </div>
                  <div>
                    <button type="button" className="btn btn-sm btn-primary" onClick={handleAddInsumo} disabled={addSaving}>
                      {addSaving ? 'Agregando…' : 'Crear e incluir (receta SÍ)'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!materiales.length ? (
            <div className="muted" style={{ fontSize: '.82rem', padding: '.5rem 0' }}>
              No hay insumos marcados como receta. Agregá uno con “+ Nuevo insumo”.
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
              <table className="table" style={{ fontSize: '.82rem' }}>
                <thead>
                  <tr>
                    <th></th>
                    <th>Insumo</th>
                    <th>Almacén</th>
                    <th style={{ textAlign: 'right' }}>Disp.</th>
                    <th style={{ textAlign: 'right' }}>Cantidad</th>
                    <th style={{ textAlign: 'right' }}>Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {materiales.map((m) => {
                    const row = rows[m.id] ?? { checked: false, cantidad: '1', almacen: m.almacen || almacenes[0] };
                    const disp = exStock(m.id, row.almacen);
                    const cant = Number(row.cantidad) || 0;
                    const exceso = row.checked && cant > disp;
                    return (
                      <tr key={m.id} style={exceso ? { background: 'rgba(239,79,94,0.08)' } : undefined}>
                        <td><input type="checkbox" checked={row.checked} onChange={(e) => setRow(m.id, { checked: e.target.checked })} /></td>
                        <td><strong>{m.nombre}</strong><div className="muted mono" style={{ fontSize: '.7rem' }}>{m.sku}</div></td>
                        <td>
                          <AlmacenSelectAgrupado value={row.almacen} onChange={(v) => setRow(m.id, { almacen: v })} extraNombres={almacenes} style={{ minWidth: 110 }} />
                        </td>
                        <td className="mono" style={{ textAlign: 'right', color: exceso ? 'var(--danger)' : undefined }}>{num(disp)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <input className="input mono" type="number" min={0} step="any" style={{ width: 90, textAlign: 'right' }}
                            value={row.cantidad} onChange={(e) => setRow(m.id, { cantidad: e.target.value })} disabled={!row.checked} />
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>{money(exCosto(m.id, row.almacen))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Costos extra */}
        <div className="form-grid">
          <div className="form-row">
            <label>Mano de obra (USD)</label>
            <input className="input mono" type="number" min={0} step="0.01" value={manoObra} onChange={(e) => setManoObra(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Costos indirectos (USD)</label>
            <input className="input mono" type="number" min={0} step="0.01" value={costosIndirectos} onChange={(e) => setCostosIndirectos(e.target.value)} />
          </div>
        </div>

        {/* Resumen */}
        <div className="card" style={{ padding: '.7rem .9rem', borderLeft: '3px solid var(--primary)', background: 'var(--bg-1)', margin: 0 }}>
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>Resumen de costos (fórmulas)</div>
          <div className="mono" style={{ fontSize: '.85rem', lineHeight: 1.7 }}>
            <strong>CTM</strong> = Σ (cantidad × costo material) = <strong>{money(ctm)}</strong><br />
            <strong>CP</strong> = CTM + mano de obra ({money(Number(manoObra) || 0)}) + indirectos ({money(Number(costosIndirectos) || 0)}) = <strong>{money(cp)}</strong><br />
            <strong>Costo unitario</strong> = CP ÷ {num(cantidadNum)} und = <strong style={{ color: 'var(--primary-3)' }}>{money(costoUnit)}</strong><br />
            <strong>Precio de venta</strong> = costo unitario ÷ (1 − {num(Math.round(margenPct * 100))}%) = <strong style={{ color: 'var(--primary-3)' }}>{money(posiblePrecioVenta)}</strong><br />
            <strong>Posible ganancia</strong> = (precio venta − costo unitario) × {num(cantidadNum)} = <strong style={{ color: gananciaTotal >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(gananciaTotal)}</strong>
          </div>
        </div>
      </form>
    </Modal>
  );
}
