import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { money, num } from '@/shared/lib/format';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { useRealtime } from '@/shared/lib/useRealtime';
import { ConfirmDialog, Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import type { Almacen, Existencia, Orden, Producto } from '@/shared/lib/types';
import {
  addCategoria,
  addUnidad,
  contarProductosPorCategoria,
  contarProductosPorUnidad,
  createProducto,
  eliminarCategoria,
  eliminarUnidad,
  findBySku,
  getCategorias,
  getUnidadesRaw,
  listProductos,
  listRecepcionesPendientes,
  renombrarCategoria,
  renombrarUnidad,
  setEstadoProducto,
  updateProducto,
  type ProductoInput,
} from './inventario.repository';
import { contarProduccionEnProceso } from '@/modules/produccion/produccion.repository';
import { GestionarCategoriasModal } from '@/shared/ui/GestionarCategoriasModal';
import {
  registrarMovimiento,
  transferir,
  consolidarProductoEnAlmacen,
  type MovimientoInput,
} from './movimientos.repository';
import { DEFAULT_POLICY, decorate, type ProductoDecorado } from './restock';
import { ProductosTable } from './ProductosTable';
import { ProductoForm } from './ProductoForm';
import { ProductoDetail } from './ProductoDetail';
import { MovimientoForm } from './MovimientoForm';
import { AlertasStock } from './AlertasStock';
import { RecepcionesPendientes } from './RecepcionesPendientes';
import { ExportInventarioModal } from './ExportInventarioModal';
import { ResumenInventarioModal } from './ResumenInventarioModal';
import { ImportarExcelModal } from './ImportarExcelModal';
import { analizarExcel, descargarPlantillaExcel, type AnalisisImport } from './inventarioBulk';
import { InventarioFilterbar, type FilterValues } from './InventarioFilterbar';
import { AlmacenesView, SedesView, hijosDe, raices, type AlmacenLayout } from './AlmacenesView';
import { ConsumoChartModal } from '@/shared/ui/ConsumoChartModal';
import { AlmacenKanban } from './AlmacenKanban';
// Los generadores de PDF/Excel de almacén se importan dinámicamente (al generar) para no cargar jsPDF/xlsx al abrir.
import { AlmacenForm } from './AlmacenForm';
import {
  listAlmacenes,
  listExistencias,
  agruparValores,
  movStatsDeAlmacen,
  consumoDeAlmacen,
  consumoPorProductoEnAlmacen,
  crearAlmacen,
  actualizarAlmacen,
  eliminarAlmacen,
  renombrarSede,
  nombreCortoAlmacen,
  type AlmacenInput,
  type AlmacenValor,
  type ConsumoProducto,
} from './almacenes.repository';

interface UiState extends FilterValues {
  view: 'productos' | 'recepciones' | 'almacenes';
  almacenLayout: AlmacenLayout;
}

const INITIAL_UI: UiState = {
  view: 'productos',
  almacenLayout: 'kanban',
  filterText: '',
  filterCat: '',
  filterClass: '',
  filterStock: '',
  filterEstado: 'activo',
  filterFundicion: '',
  filterAlmacen: '',
};

/** Predicado de filtros compartido por inventario general y el detalle de almacén. */
function coincideFiltros(p: ProductoDecorado, ui: UiState): boolean {
  const q = ui.filterText.trim().toLowerCase();
  if (ui.filterEstado && p.estado !== ui.filterEstado) return false;
  if (ui.filterCat && p.categoria !== ui.filterCat) return false;
  if (ui.filterClass && p._klass !== ui.filterClass) return false;
  if (ui.filterFundicion === 'si' && !p.receta_fundicion) return false;
  if (ui.filterFundicion === 'no' && p.receta_fundicion) return false;
  if (ui.filterFundicion === 'en_proceso' && !p.en_fundicion) return false;
  if (ui.filterStock === 'critico' && !p._critical) return false;
  if (ui.filterStock === 'restock' && !(p._needsRestock && !p._critical)) return false;
  if (ui.filterStock === 'ok' && p._needsRestock) return false;
  if (ui.filterStock === 'sin_mov' && (p.stock ?? 0) > 0) return false;
  if (q) {
    // Búsqueda por PALABRAS sobre el nombre + todos los datos del «Detalle del producto»
    // (alias, marca, modelo, fabricante, color, serial, N°, código, presentación,
    // descripción, ubicación, categoría, unidad). Cada palabra debe aparecer en algún
    // dato, en cualquier orden: así "clavo media pulgada" cruza el nombre con la medida
    // anotada en el detalle/alias/descripción.
    const haystack = [
      p.sku, p.nombre, p.nombre_busqueda, p.marca, p.modelo, p.fabricante,
      p.color, p.codigo, p.serial, p.numero, p.presentacion, p.descripcion,
      p.ubicacion_fisica, p.categoria, p.unidad,
    ].filter(Boolean).map((s) => String(s).toLowerCase()).join(' ');
    const tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.every((t) => haystack.includes(t))) return false;
  }
  return true;
}

type ModalState =
  | { kind: 'none' }
  | { kind: 'crear' }
  | { kind: 'editar'; producto: Producto }
  | { kind: 'detalle'; producto: Producto }
  | { kind: 'movimiento'; producto: Producto }
  | { kind: 'confirmToggle'; producto: Producto }
  | { kind: 'export' }
  | { kind: 'import'; analisis: AnalisisImport }
  | { kind: 'almacenCrear'; parentId?: string | null; sede?: string | null }
  | { kind: 'almacenEditar'; almacen: Almacen }
  | { kind: 'almacenEliminar'; almacen: Almacen }
  | { kind: 'sedeEditar'; sede: string }
  | { kind: 'resumen' };

export function InventarioPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('inventario', 'escritura');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [recepciones, setRecepciones] = useState<Orden[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [almacenSel, setAlmacenSel] = useState<string | null>(null);
  const [sedeSel, setSedeSel] = useState<string | null>(null);
  // Almacén padre cuyo nivel de subalmacenes estamos viendo (drill-down dentro de la sede).
  const [almacenNavId, setAlmacenNavId] = useState<string | null>(null);
  const [consumoAlmacen, setConsumoAlmacen] = useState<string | null>(null);
  const [reporteAlmacen, setReporteAlmacen] = useState<string | null>(null);
  const [movStats, setMovStats] = useState<Map<string, { entradas: number; salidas: number }>>(new Map());
  const [consumo, setConsumo] = useState<Map<string, ConsumoProducto>>(new Map());
  const [detalleLayout, setDetalleLayout] = useState<'kanban' | 'lista'>('lista');
  const [enProduccion, setEnProduccion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ui, setUi] = useState<UiState>(INITIAL_UI);
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [gestionCatsOpen, setGestionCatsOpen] = useState(false);
  const [conteoCats, setConteoCats] = useState<Record<string, number>>({});
  const [unidadesGestion, setUnidadesGestion] = useState<string[]>([]);
  const [conteoMedidas, setConteoMedidas] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!gestionCatsOpen) return;
    contarProductosPorCategoria().then(setConteoCats).catch(() => setConteoCats({}));
    contarProductosPorUnidad().then(setConteoMedidas).catch(() => setConteoMedidas({}));
    getUnidadesRaw(productos).then(setUnidadesGestion).catch(() => setUnidadesGestion([]));
  }, [gestionCatsOpen, productos]);

  // Realtime multiusuario: el stock y las recepciones se reflejan al instante.
  useRealtime(['productos', 'movimientos', 'almacenes', 'ordenes'], () => { void reload(); });

  async function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const analisis = await analizarExcel(file);
      setModal({ kind: 'import', analisis });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo leer el archivo', 'error');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [prods, ords, alms, exs, nEnProduccion] = await Promise.all([
        listProductos(),
        listRecepcionesPendientes().catch(() => [] as Orden[]),
        listAlmacenes().catch(() => [] as Almacen[]),
        listExistencias().catch(() => [] as Existencia[]),
        contarProduccionEnProceso().catch(() => 0),
      ]);
      setProductos(prods);
      setRecepciones(ords);
      setAlmacenes(alms);
      setExistencias(exs);
      setEnProduccion(nEnProduccion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el inventario.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // Carga única al montar. La recarga se dispara tras cada mutación exitosa.
  }, []);

  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const id = searchParams.get('detalle');
    if (!id || !productos.length) return;
    const p = productos.find((x) => x.id === id);
    if (p) {
      setModal({ kind: 'detalle', producto: p });
      const next = new URLSearchParams(searchParams);
      next.delete('detalle');
      setSearchParams(next, { replace: true });
    }
  }, [productos, searchParams, setSearchParams]);

  const decorated = useMemo<ProductoDecorado[]>(
    () => decorate(productos, DEFAULT_POLICY),
    [productos],
  );

  // Valor por almacén (desde existencias: stock × costo propio del almacén).
  const valoresAlm = useMemo<Record<string, AlmacenValor>>(() => agruparValores(existencias), [existencias]);

  // Nombres de un almacén + TODOS sus subalmacenes (descendientes), para el roll-up:
  // un almacén "contiene" lo suyo y lo de sus subalmacenes.
  const descendientesDe = useCallback((nombre: string): string[] => {
    const root = almacenes.find((a) => a.nombre === nombre);
    if (!root) return [nombre];
    const out = [root.nombre];
    const stack = [root.id];
    while (stack.length) {
      const pid = stack.pop()!;
      for (const h of almacenes) if ((h.parent_id ?? null) === pid) { out.push(h.nombre); stack.push(h.id); }
    }
    return out;
  }, [almacenes]);

  // Valor/conteo ROLL-UP por almacén (incluye sus subalmacenes) para las tarjetas:
  // así un almacén padre no aparece en $0 cuando el stock está en sus subalmacenes.
  const valoresRollup = useMemo<Record<string, AlmacenValor>>(() => {
    const out: Record<string, AlmacenValor> = {};
    for (const a of almacenes) {
      const nombres = new Set(descendientesDe(a.nombre));
      let valor = 0, items = 0, unidades = 0;
      for (const e of existencias) {
        if (!nombres.has(e.almacen)) continue;
        const st = Number(e.stock) || 0;
        valor += st * (Number(e.costo_promedio) || 0);
        items += 1;
        unidades += st;
      }
      out[a.nombre] = { valor, items, unidades };
    }
    return out;
  }, [almacenes, existencias, descendientesDe]);

  // Existencias agrupadas por producto (para pasarlas al formulario de movimiento).
  const existMap = useMemo(() => {
    const m = new Map<string, Existencia[]>();
    existencias.forEach((e) => {
      const arr = m.get(e.producto_id) ?? [];
      arr.push(e);
      m.set(e.producto_id, arr);
    });
    return m;
  }, [existencias]);

  // Detalle de almacén: "productos virtuales" = producto con el stock y costo
  // (PMP) propios del almacén seleccionado, decorados y filtrados como inventario.
  // Roll-up de un almacén (incluye sus subalmacenes): cada producto con su stock sumado
  // y costo = promedio ponderado en ese almacén. Lo usan el detalle de almacén y el
  // filtro "por almacén" de la vista general.
  const rollupAlmacen = useCallback((nombre: string): ProductoDecorado[] => {
    const prodMap = new Map(productos.map((p) => [p.id, p]));
    const nombres = new Set(descendientesDe(nombre));
    const agg = new Map<string, { stock: number; valor: number }>();
    for (const e of existencias) {
      if (!nombres.has(e.almacen)) continue;
      const cur = agg.get(e.producto_id) ?? { stock: 0, valor: 0 };
      const st = Number(e.stock) || 0;
      cur.stock += st;
      cur.valor += st * (Number(e.costo_promedio) || 0);
      agg.set(e.producto_id, cur);
    }
    const virtuales = [...agg.entries()]
      .map(([pid, v]) => {
        const p = prodMap.get(pid);
        const costo = v.stock > 0 ? v.valor / v.stock : 0;
        return p ? ({ ...p, stock: v.stock, precio: costo, almacen: nombre } as Producto) : null;
      })
      .filter((p): p is Producto => p !== null);
    return decorate(virtuales, DEFAULT_POLICY);
  }, [productos, existencias, descendientesDe]);

  const almacenRows = useMemo<ProductoDecorado[]>(
    () => (almacenSel ? rollupAlmacen(almacenSel).filter((p) => coincideFiltros(p, ui)) : []),
    [almacenSel, rollupAlmacen, ui],
  );

  // Lista de la vista general. Si hay filtro por almacén, las filas son las de ese
  // almacén (stock/PMP propios); si no, el catálogo global. Luego aplica los demás filtros.
  const filtered = useMemo<ProductoDecorado[]>(() => {
    const base = ui.filterAlmacen ? rollupAlmacen(ui.filterAlmacen) : decorated;
    return base.filter((p) => coincideFiltros(p, ui));
  }, [decorated, rollupAlmacen, ui]);

  // Nombres de almacén para el filtro de la vista general (catálogo activo + los que
  // tengan existencias, por si hay nombres legados fuera del catálogo).
  const almacenNombres = useMemo<string[]>(() => {
    const s = new Set<string>();
    almacenes.filter((a) => a.estado === 'activo').forEach((a) => s.add(a.nombre));
    existencias.forEach((e) => { if (e.almacen) s.add(e.almacen); });
    return Array.from(s).sort((x, y) => x.localeCompare(y, 'es'));
  }, [almacenes, existencias]);

  // Filas (con stock/PMP propios del almacén) de CUALQUIER almacén por nombre, sin
  // tener que entrar a su detalle. Lo usa el reporte por almacén desde la lista.
  const rowsDeAlmacen = useCallback((nombre: string): ProductoDecorado[] => {
    const prodMap = new Map(productos.map((p) => [p.id, p]));
    const virtuales = existencias
      .filter((e) => e.almacen === nombre)
      .map((e) => {
        const p = prodMap.get(e.producto_id);
        return p ? ({ ...p, stock: e.stock, precio: e.costo_promedio, almacen: nombre } as Producto) : null;
      })
      .filter((p): p is Producto => p !== null);
    return decorate(virtuales, DEFAULT_POLICY);
  }, [existencias, productos]);

  // Al entrar al detalle de un almacén, cargamos entradas/salidas y consumo de ESE almacén.
  useEffect(() => {
    if (!almacenSel) { setMovStats(new Map()); setConsumo(new Map()); return; }
    let cancelled = false;
    // Ambas consultas son independientes: en paralelo para abrir el detalle más rápido.
    Promise.all([
      movStatsDeAlmacen(almacenSel).catch(() => new Map()),
      consumoDeAlmacen(almacenSel).catch(() => new Map()),
    ]).then(([m, c]) => {
      if (cancelled) return;
      setMovStats(m);
      setConsumo(c);
    });
    return () => { cancelled = true; };
  }, [almacenSel, existencias]);

  const [categorias, setCategorias] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    getCategorias(productos)
      .then((cs) => { if (!cancelled) setCategorias(cs); })
      .catch(() => { /* defaults via repo */ });
    return () => { cancelled = true; };
  }, [productos]);

  const kpis = useMemo(() => {
    const activos = decorated.filter((p) => p.estado === 'activo');
    const valorTotal = activos.reduce((a, p) => a + p._valor, 0);
    const stockTotal = activos.reduce((a, p) => a + (p.stock ?? 0), 0);
    const promedio = activos.length ? stockTotal / activos.length : 0;
    const criticos = activos.filter((p) => p._critical).length;
    const enFundicion = activos.filter((p) => p.en_fundicion).length;
    return {
      total: activos.length,
      valor: valorTotal,
      promedio,
      criticos,
      enFundicion,
    };
  }, [decorated]);

  const productoActor = appUser?.email ?? user?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;

  // ─── handlers ───
  const openVer = useCallback((id: string) => {
    setProductos((curr) => {
      const p = curr.find((x) => x.id === id);
      if (p) setModal({ kind: 'detalle', producto: p });
      return curr;
    });
  }, []);

  const openEditar = useCallback((id: string) => {
    setProductos((curr) => {
      const p = curr.find((x) => x.id === id);
      if (p) setModal({ kind: 'editar', producto: p });
      return curr;
    });
  }, []);

  const openMovimiento = useCallback((id: string) => {
    setProductos((curr) => {
      const p = curr.find((x) => x.id === id);
      if (p) setModal({ kind: 'movimiento', producto: p });
      return curr;
    });
  }, []);

  const askToggleEstado = useCallback((id: string) => {
    setProductos((curr) => {
      const p = curr.find((x) => x.id === id);
      if (p) setModal({ kind: 'confirmToggle', producto: p });
      return curr;
    });
  }, []);

  async function handleCreateOrUpdate(data: ProductoInput) {
    if (modal.kind === 'crear') {
      const dup = await findBySku(data.sku);
      if (dup) throw new Error('Ya existe un producto con ese SKU.');
      const stockInicial = data.stock;
      const created = await createProducto({ ...data, stock: 0 });
      if (stockInicial > 0) {
        await registrarMovimiento({
          producto_id: created.id,
          tipo: 'creacion',
          delta: stockInicial,
          almacen: data.almacen,
          actor: productoActor,
          actor_name: actorName,
          detalle: `Stock inicial al dar de alta el producto · almacén ${data.almacen}`,
          // Costo inicial: fija la línea base del PMP del almacén y queda en la traza.
          precio_unitario: data.precio,
        });
      }
      notify(`Producto creado: ${data.sku} · ${data.nombre}`, 'success', { link: '#/app/inventario' });
      await reload();
      return;
    }
    if (modal.kind === 'editar') {
      const previo = modal.producto;
      const dup = await findBySku(data.sku);
      if (dup && dup.id !== previo.id) throw new Error('Ya existe otro producto con ese SKU.');
      // El stock es por almacén (existencias); no se edita desde aquí.
      // Se ajusta vía "Movimiento" (entrada/salida/ajuste) en cada almacén.
      const rest: Partial<ProductoInput> = { ...data };
      delete (rest as Partial<ProductoInput>).stock;
      // Un producto = una ubicación: si cambió el almacén "hogar", relocaliza TODO
      // el stock disperso a ese almacén (queda una sola existencia con el total).
      // IMPORTANTE: la consolidación va PRIMERO porque dispara recomputeProductoAgg
      // (recalcula `precio` desde las existencias); guardamos el producto DESPUÉS para
      // que el precio/datos que escribió el usuario prevalezcan (si no, se perdían y
      // había que guardar dos veces).
      const almacenPrevio = (previo.almacen || 'General').trim();
      const almacenNuevo = (data.almacen || 'General').trim();
      let movidos = 0;
      if (almacenNuevo && almacenNuevo !== almacenPrevio) {
        movidos = await consolidarProductoEnAlmacen(previo.id, almacenNuevo, productoActor, actorName);
      }
      await updateProducto(previo.id, rest);
      if (movidos > 0) notify(`Stock consolidado en ${almacenNuevo} (1 sola ubicación)`, 'success', { link: '#/app/inventario' });
      notify(`Producto actualizado: ${data.sku} · ${data.nombre}`, 'success', { link: '#/app/inventario' });
      await reload();
    }
  }

  async function handleRegistrarMovimiento(input: MovimientoInput, transfer?: { almacenDestino: string }) {
    if (transfer) {
      await transferir({
        producto_id: input.producto_id,
        almacenOrigen: input.almacen || 'General',
        almacenDestino: transfer.almacenDestino,
        cantidad: Math.abs(input.delta),
        actor: input.actor,
        actor_name: input.actor_name,
        detalle: input.detalle,
      });
      notify(`Transferencia: ${input.almacen} → ${transfer.almacenDestino}`, 'success', { link: '#/app/inventario' });
    } else {
      await registrarMovimiento(input);
      notify(`Movimiento de inventario registrado (${input.tipo})`, 'success', { link: '#/app/inventario' });
    }
    await reload();
  }

  async function handleToggleEstado(p: Producto) {
    const nuevo = p.estado === 'activo' ? 'inactivo' : 'activo';
    try {
      await setEstadoProducto(p.id, nuevo);
      notify(`Producto ${nuevo === 'activo' ? 'activado' : 'desactivado'}: ${p.sku}`, 'success', { link: '#/app/inventario' });
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo cambiar el estado', 'error');
    } finally {
      setModal({ kind: 'none' });
    }
  }

  // ─── almacenes ───
  function setFilter2(key: keyof FilterValues, value: string) {
    setUi((prev) => ({ ...prev, [key]: value }) as UiState);
  }

  async function handleCrearAlmacen(data: AlmacenInput) {
    await crearAlmacen(data, productoActor);
    notify(`Almacén creado: ${data.nombre}`, 'success', { link: '#/app/inventario' });
    await reload();
  }

  async function handleEditarAlmacen(id: string, data: AlmacenInput) {
    await actualizarAlmacen(id, data);
    notify(`Almacén actualizado: ${data.nombre}`, 'success', { link: '#/app/inventario' });
    await reload();
  }

  async function handleEliminarAlmacen(a: Almacen) {
    try {
      await eliminarAlmacen(a.id, a.nombre);
      notify(`Almacén eliminado: ${a.nombre}`, 'success', { link: '#/app/inventario' });
      if (almacenSel === a.nombre) setAlmacenSel(null);
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo eliminar el almacén', 'error');
    } finally {
      setModal({ kind: 'none' });
    }
  }

  // ─── render ───
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Inventario</h1>
          <p>
            Catálogo de productos. <span className="muted">Política ABC · A 120% · B 100% · C 80% del stock mínimo</span>
          </p>
        </div>
        <div className="actions">
          <button
            className={`btn ${ui.view === 'productos' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setUi((prev) => ({ ...prev, view: 'productos' }))}
          >
            Inventario general
          </button>
          <button
            className={`btn ${ui.view === 'almacenes' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { setAlmacenSel(null); setUi((prev) => ({ ...prev, view: 'almacenes' })); }}
          >
            ▣ Almacenes
          </button>
          <button
            className={`btn ${ui.view === 'recepciones' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setUi((prev) => ({ ...prev, view: 'recepciones' }))}
          >
            Recepciones {recepciones.length > 0 && <span className="badge warning" style={{ marginLeft: '.35rem' }}>{recepciones.length}</span>}
          </button>
          {canWrite && (
            <button
              className="btn btn-ghost"
              onClick={() => setGestionCatsOpen(true)}
              title="Gestionar categorías y medidas (renombrar, depurar, eliminar)"
            >
              ⚙ Categorías
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={() => { void descargarPlantillaExcel(); }}
            title="Descargar plantilla de carga masiva"
          >
            ↓ Plantilla
          </button>
          {canWrite && (
            <>
              <button
                className="btn btn-ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                title="Importar productos desde un Excel"
              >
                {importing ? 'Importando…' : '↑ Importar Excel'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={handleFileImport}
              />
            </>
          )}
          <button className="btn btn-ghost" onClick={() => setModal({ kind: 'resumen' })} title="Resumen de inventario: almacenes, productos nuevos, salidas y traslados">
            📊 Resumen
          </button>
          <button className="btn btn-ghost" onClick={() => setModal({ kind: 'export' })} title="Exportar inventario filtrado">
            ↓ Exportar
          </button>
          {canWrite && (
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setModal({ kind: 'crear' })}>
              + Nuevo producto
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '1rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* KPIs y alertas: SOLO en inventario general (no en almacenes ni recepciones). */}
      {ui.view === 'productos' && (
      <>
      <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
        <div className="kpi">
          <div className="icon">⬢</div>
          <div className="label">Productos activos</div>
          <div className="value">{num(kpis.total)}</div>
          <div className="delta">SKUs en catálogo</div>
        </div>
        <div className="kpi">
          <div className="icon">$</div>
          <div className="label">Valor del inventario</div>
          <div className="value">{money(kpis.valor)}</div>
          <div className="delta">stock × precio</div>
        </div>
        <div className="kpi">
          <div className="icon">⚠</div>
          <div className="label">En estado crítico</div>
          <div className="value">{num(kpis.criticos)}</div>
          <div className={kpis.criticos > 0 ? 'delta down' : 'delta'}>
            {kpis.criticos > 0 ? 'requieren atención' : 'todo en orden'}
          </div>
        </div>
        <a
          className="kpi"
          href="#/app/produccion"
          style={{ cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}
          title="Ver órdenes de fundición en curso"
        >
          <div className="icon">🔥</div>
          <div className="label">En fundición</div>
          <div className="value">{num(enProduccion)}</div>
          <div className={enProduccion > 0 ? 'delta down' : 'delta'}>
            {enProduccion > 0 ? `${num(enProduccion)} en curso` : 'ninguno en proceso'}
          </div>
        </a>
      </div>

      <AlertasStock productos={decorated} onVerProducto={openVer} />
      </>
      )}

      {ui.view === 'recepciones' ? (
        <RecepcionesPendientes ordenes={recepciones} almacenes={almacenes} actor={productoActor} actorName={actorName} onRecibida={reload} />
      ) : ui.view === 'almacenes' ? (
        almacenSel ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '.75rem', flexWrap: 'wrap' }}>
              <button className="btn btn-ghost" onClick={() => setAlmacenSel(null)}>← Volver a almacenes</button>
              <h2 style={{ margin: 0 }}>▣ {almacenSel}</h2>
              <span className="muted mono">{money(almacenRows.reduce((s, p) => s + (Number(p.stock) || 0) * (Number(p.precio) || 0), 0))} · {num(almacenRows.length)} producto(s){descendientesDe(almacenSel).length > 1 ? ' · incluye subalmacenes' : ''}</span>
              <div style={{ display: 'flex', gap: '.4rem', marginLeft: 'auto' }}>
                <button className="btn btn-primary btn-sm" onClick={() => setConsumoAlmacen(almacenSel)} title="Gráfica de consumo por producto de este almacén">📊 Consumo</button>
                <button className="btn btn-ghost btn-sm" disabled={!almacenRows.length}
                  onClick={() => import('./almacenExport').then(({ descargarAlmacenExcel }) => descargarAlmacenExcel(almacenSel, almacenRows)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el Excel', 'error'))}>↓ Excel</button>
                <button className="btn btn-ghost btn-sm" disabled={!almacenRows.length}
                  onClick={() => import('./almacenExport').then(({ descargarAlmacenPdf }) => descargarAlmacenPdf(almacenSel, almacenRows)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))}>↓ PDF</button>
              </div>
            </div>
            <div className="view-toggle" role="tablist" aria-label="Vista del almacén" style={{ marginBottom: '.75rem', marginLeft: 0 }}>
              <button className={detalleLayout === 'kanban' ? 'active' : ''} onClick={() => setDetalleLayout('kanban')}>▦ Kanban</button>
              <button className={detalleLayout === 'lista' ? 'active' : ''} onClick={() => setDetalleLayout('lista')}>☰ Lista</button>
            </div>
            <InventarioFilterbar values={ui} categorias={categorias} onChange={setFilter2} />
            {loading ? (
              <EmptyState message="Cargando productos…" icon="◔" />
            ) : detalleLayout === 'kanban' ? (
              <AlmacenKanban rows={almacenRows} consumo={consumo} onView={openVer} />
            ) : (
              <ProductosTable
                rows={almacenRows}
                onView={openVer}
                onEdit={openEditar}
                onMovimiento={openMovimiento}
                onToggleEstado={askToggleEstado}
                canWrite={canWrite}
                movStats={movStats}
              />
            )}
          </>
        ) : !sedeSel ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.85rem', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>📍 Sedes</h2>
              <span className="muted" style={{ fontSize: '.85rem' }}>Elegí una sede para ver sus almacenes.</span>
              <button
                className="btn btn-ghost"
                style={{ marginLeft: 'auto' }}
                title="Descargar un PDF de todo el inventario, por almacenes y subalmacenes"
                onClick={() => import('./almacenExport').then(({ descargarReporteAlmacenesPdf }) => descargarReporteAlmacenesPdf()).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el reporte', 'error'))}
              >
                📄 Reporte general (PDF)
              </button>
              {canWrite && (
                <button className="btn btn-primary" style={{ padding: '.7rem 1.3rem', fontSize: '1.02rem', fontWeight: 700 }} onClick={() => setModal({ kind: 'almacenCrear' })}>
                  + Agregar almacén
                </button>
              )}
            </div>
            {loading ? (
              <EmptyState message="Cargando almacenes…" icon="◔" />
            ) : (
              <SedesView almacenes={almacenes} valores={valoresAlm} canWrite={canWrite}
                onSelectSede={(s) => { setSedeSel(s); setAlmacenNavId(null); }}
                onEditarSede={(s) => setModal({ kind: 'sedeEditar', sede: s })} />
            )}
          </>
        ) : (() => {
          const sedeAlmacenes = almacenes.filter((a) => (a.sede?.trim() || 'Sin sede') === sedeSel);
          // Si la sede tiene un único almacén padre (ej. "Los Pinos"), se salta ese
          // nivel redundante y se muestran directo sus subalmacenes.
          const roots = raices(sedeAlmacenes);
          // Se salta el almacén raíz único (nivel redundante) SOLO si ese almacén no tiene
          // productos propios. Si los tiene (ej. "General" con 250 productos), NO se salta,
          // para que el usuario pueda verlo y entrar a sus productos.
          const rootPropios = roots.length === 1 ? (valoresAlm[roots[0].nombre]?.items ?? 0) : 0;
          const autoPadre = !almacenNavId && roots.length === 1 && hijosDe(roots[0].id, sedeAlmacenes).length > 0 && rootPropios === 0 ? roots[0] : null;
          const nivelParentId = almacenNavId ?? (autoPadre ? autoPadre.id : null);
          const padre = almacenNavId ? almacenes.find((a) => a.id === almacenNavId) ?? null : null;
          // Contenedor donde se agregaría: el padre que estamos viendo (manual o auto).
          const contenedor = padre ?? autoPadre;
          return (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.85rem', flexWrap: 'wrap' }}>
              {padre ? (
                <>
                  <button className="btn btn-ghost" onClick={() => setAlmacenNavId(null)}>← Volver a {sedeSel}</button>
                  <h2 style={{ margin: 0 }}>▣ {nombreCortoAlmacen(padre, almacenes)}</h2>
                </>
              ) : (
                <>
                  <button className="btn btn-ghost" onClick={() => setSedeSel(null)}>← Volver a sedes</button>
                  <h2 style={{ margin: 0 }}>📍 {sedeSel}</h2>
                </>
              )}
              <div className="view-toggle" role="tablist" aria-label="Vista de almacenes" style={{ marginLeft: '.5rem' }}>
                <button
                  className={ui.almacenLayout === 'kanban' ? 'active' : ''}
                  onClick={() => setUi((prev) => ({ ...prev, almacenLayout: 'kanban' }))}
                >
                  ▦ Kanban
                </button>
                <button
                  className={ui.almacenLayout === 'lista' ? 'active' : ''}
                  onClick={() => setUi((prev) => ({ ...prev, almacenLayout: 'lista' }))}
                >
                  ☰ Lista
                </button>
              </div>
              {canWrite && (
                <button className="btn btn-primary" style={{ marginLeft: 'auto', padding: '.7rem 1.3rem', fontSize: '1.02rem', fontWeight: 700 }}
                  onClick={() => setModal(contenedor ? { kind: 'almacenCrear', parentId: contenedor.id } : { kind: 'almacenCrear', sede: sedeSel })}>
                  + Agregar subalmacén
                </button>
              )}
            </div>
            {loading ? (
              <EmptyState message="Cargando almacenes…" icon="◔" />
            ) : (
              <AlmacenesView
                almacenes={sedeAlmacenes}
                valores={valoresRollup}
                layout={ui.almacenLayout}
                canWrite={canWrite}
                parentId={nivelParentId}
                onSelect={setAlmacenSel}
                onDrill={(a) => setAlmacenNavId(a.id)}
                onConsumo={setConsumoAlmacen}
                onReporte={setReporteAlmacen}
                onEditar={(a) => setModal({ kind: 'almacenEditar', almacen: a })}
                onEliminar={(a) => setModal({ kind: 'almacenEliminar', almacen: a })}
                onAgregarSub={(a) => setModal({ kind: 'almacenCrear', parentId: a.id })}
              />
            )}
          </>
          );
        })()
      ) : (
        <>
          <InventarioFilterbar values={ui} categorias={categorias} almacenes={almacenNombres} onChange={setFilter2} />
          {loading ? (
            <EmptyState message="Cargando productos…" icon="◔" />
          ) : (
            <ProductosTable
              rows={filtered}
              onView={openVer}
              onEdit={openEditar}
              onMovimiento={openMovimiento}
              onToggleEstado={askToggleEstado}
              canWrite={canWrite}
            />
          )}
        </>
      )}

      {/* Modales */}
      {modal.kind === 'resumen' && (
        <ResumenInventarioModal
          productos={productos}
          existencias={existencias}
          almacenes={almacenes}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}
      {modal.kind === 'crear' && (
        <ProductoForm
          producto={null}
          productos={productos}
          /* Dentro de un almacén/sub-almacén: el nuevo producto entra ahí y la ubicación queda fija. */
          fixedAlmacen={ui.view === 'almacenes' ? almacenSel : null}
          onClose={() => setModal({ kind: 'none' })}
          onSubmit={handleCreateOrUpdate}
        />
      )}
      {modal.kind === 'editar' && (
        <ProductoForm
          producto={modal.producto}
          productos={productos}
          onClose={() => setModal({ kind: 'none' })}
          onSubmit={handleCreateOrUpdate}
        />
      )}
      {modal.kind === 'detalle' && (
        <ProductoDetail
          producto={modal.producto}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}
      {modal.kind === 'movimiento' && (
        <MovimientoForm
          producto={modal.producto}
          existencias={existMap.get(modal.producto.id) ?? []}
          almacenesList={almacenes.map((a) => a.nombre)}
          fixedAlmacen={ui.view === 'almacenes' ? almacenSel : null}
          actorEmail={productoActor}
          actorName={actorName}
          onClose={() => setModal({ kind: 'none' })}
          onSubmit={handleRegistrarMovimiento}
        />
      )}
      {modal.kind === 'confirmToggle' && modal.producto.estado === 'activo' && (
        // Borrado (desactivación): destructivo → exige escribir el nombre del producto.
        <EliminarProductoDialog
          producto={modal.producto}
          onCancel={() => setModal({ kind: 'none' })}
          onConfirm={() => handleToggleEstado(modal.producto)}
        />
      )}
      {modal.kind === 'confirmToggle' && modal.producto.estado !== 'activo' && (
        <ConfirmDialog
          title="Activar producto"
          message={`¿Confirmas activar "${modal.producto.nombre}" (${modal.producto.sku})?`}
          confirmText="Activar"
          onCancel={() => setModal({ kind: 'none' })}
          onConfirm={() => handleToggleEstado(modal.producto)}
        />
      )}
      {/* Consumo por producto de un almacén — disponible desde la tarjeta y desde el detalle. */}
      {consumoAlmacen && (
        <ConsumoChartModal
          title={`Consumo · ${consumoAlmacen}`}
          subtitle="Consumo de productos de este almacén (salidas y consumo de fundición). La gráfica muestra cada producto; el valor en $ usa el costo del movimiento."
          cargar={async (desde, hasta) => {
            const items = await consumoPorProductoEnAlmacen(consumoAlmacen, desde, hasta);
            return items.map((x) => ({ id: x.producto_id, label: x.nombre, sub: x.sku, unidad: x.unidad, cantidad: x.cantidad, valor: x.valor }));
          }}
          onClose={() => setConsumoAlmacen(null)}
        />
      )}
      {reporteAlmacen && (() => {
        const rows = rowsDeAlmacen(reporteAlmacen);
        const valor = rows.reduce((a, p) => a + ((p as ProductoDecorado)._valor ?? (Number(p.stock) || 0) * (Number(p.precio) || 0)), 0);
        return (
          <Modal
            title={`📄 Reporte · ${reporteAlmacen}`}
            size="sm"
            onClose={() => setReporteAlmacen(null)}
            footer={
              <>
                <button className="btn btn-ghost" onClick={() => setReporteAlmacen(null)}>Cerrar</button>
                <button className="btn btn-ghost" disabled={!rows.length}
                  onClick={() => import('./almacenExport').then(({ descargarAlmacenExcel }) => descargarAlmacenExcel(reporteAlmacen, rows)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el Excel', 'error'))}>↓ Excel</button>
                <button className="btn btn-primary" disabled={!rows.length}
                  onClick={() => import('./almacenExport').then(({ descargarAlmacenPdf }) => descargarAlmacenPdf(reporteAlmacen, rows)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))}>↓ PDF</button>
              </>
            }
          >
            {!rows.length ? (
              <p className="muted" style={{ margin: 0 }}>Este almacén no tiene productos con existencia. Si tiene subalmacenes, generá el reporte de cada uno.</p>
            ) : (
              <p style={{ margin: 0 }}>
                <strong>{num(rows.length)}</strong> producto(s) · valor total <strong className="mono">{money(valor)}</strong>.<br />
                <span className="muted" style={{ fontSize: '.84rem' }}>Elegí el formato. El PDF se abre en vista previa con botón de descarga.</span>
              </p>
            )}
          </Modal>
        );
      })()}
      {modal.kind === 'export' && (
        <ExportInventarioModal
          productos={productos}
          onClose={() => setModal({ kind: 'none' })}
        />
      )}
      {modal.kind === 'import' && (
        <ImportarExcelModal
          analisis={modal.analisis}
          onClose={() => setModal({ kind: 'none' })}
          onImportado={() => { void reload(); }}
        />
      )}
      {modal.kind === 'almacenCrear' && (
        <AlmacenForm
          almacenes={almacenes}
          parentPreset={modal.parentId ?? null}
          sedePreset={modal.sede ?? null}
          onClose={() => setModal({ kind: 'none' })}
          onSubmit={handleCrearAlmacen}
        />
      )}
      {modal.kind === 'almacenEditar' && (
        <AlmacenForm
          almacen={modal.almacen}
          almacenes={almacenes}
          onClose={() => setModal({ kind: 'none' })}
          onSubmit={(data) => handleEditarAlmacen(modal.almacen.id, data)}
        />
      )}
      {modal.kind === 'almacenEliminar' && (
        <EliminarAlmacenDialog
          almacen={modal.almacen}
          onCancel={() => setModal({ kind: 'none' })}
          onConfirm={() => handleEliminarAlmacen(modal.almacen)}
        />
      )}
      {modal.kind === 'sedeEditar' && (
        <SedeRenameModal
          sede={modal.sede}
          onClose={() => setModal({ kind: 'none' })}
          onSaved={async () => { setModal({ kind: 'none' }); setSedeSel(null); await reload(); }}
        />
      )}

      {gestionCatsOpen && (
        <GestionarCategoriasModal
          titulo="Categorías y medidas de inventario"
          onClose={() => setGestionCatsOpen(false)}
          modos={[
            {
              key: 'categorias',
              label: 'Categorías',
              categorias,
              conteoUso: conteoCats,
              entidadLabel: 'producto',
              terminoSingular: 'categoría',
              onRenombrar: (o, n) => renombrarCategoria(o, n, productoActor),
              onEliminar: (n) => eliminarCategoria(n),
              onAgregar: (n) => addCategoria(n, productoActor),
              onCambioAplicado: async () => {
                await reload();
                setCategorias(await getCategorias(productos));
                setConteoCats(await contarProductosPorCategoria());
              },
            },
            {
              key: 'medidas',
              label: 'Medidas',
              categorias: unidadesGestion,
              conteoUso: conteoMedidas,
              entidadLabel: 'producto',
              terminoSingular: 'medida',
              onRenombrar: (o, n) => renombrarUnidad(o, n, productoActor),
              onEliminar: (n) => eliminarUnidad(n),
              onAgregar: (n) => addUnidad(n, productoActor),
              onCambioAplicado: async () => {
                await reload();
                setUnidadesGestion(await getUnidadesRaw(productos));
                setConteoMedidas(await contarProductosPorUnidad());
              },
            },
          ]}
        />
      )}
    </div>
  );
}

/* ───────── Eliminar almacén: confirmación escribiendo el nombre ───────── */
const DIACRITICOS = /[̀-ͯ]/g; // marcas diacríticas combinantes
function normalizarTexto(s: string): string {
  return (s || '').normalize('NFD').replace(DIACRITICOS, '').trim().toLowerCase().replace(/\s+/g, ' ');
}
/** Palabra a escribir para confirmar: el nombre sin el prefijo genérico
 *  (ej. "Almacén de Víveres" → "Víveres"; si no hay prefijo, el nombre completo). */
function palabraClaveAlmacen(nombre: string): string {
  const m = (nombre || '').trim().match(/^(?:almac[eé]n|dep[oó]sito|bodega)\s+(?:de\s+)?(.+)$/i);
  return (m ? m[1] : nombre || '').trim();
}

function EliminarAlmacenDialog({ almacen, onCancel, onConfirm }: {
  almacen: Almacen; onCancel: () => void; onConfirm: () => void;
}) {
  const clave = palabraClaveAlmacen(almacen.nombre);
  const [texto, setTexto] = useState('');
  const ok = texto.trim() !== '' && normalizarTexto(texto) === normalizarTexto(clave);
  return (
    <Modal title="Eliminar almacén" size="md" onClose={onCancel} footer={
      <>
        <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-danger" disabled={!ok} onClick={() => { if (ok) onConfirm(); }}>
          Eliminar definitivamente
        </button>
      </>
    }>
      <p style={{ marginTop: 0 }}>
        ¿Seguro que deseas borrar el almacén <strong>«{almacen.nombre}»</strong>? Solo se puede si no tiene
        productos asignados. <strong>Esta acción no se puede deshacer.</strong>
      </p>
      <div className="form-row">
        <label>Para confirmar, escribí <strong>{clave}</strong></label>
        <input
          className="input"
          autoFocus
          value={texto}
          placeholder={clave}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && ok) onConfirm(); }}
        />
        {texto.trim() !== '' && !ok && (
          <small className="muted" style={{ color: 'var(--danger)' }}>El nombre no coincide.</small>
        )}
      </div>
    </Modal>
  );
}

/* ───────── Renombrar sede (se aplica a todos los almacenes de esa sede) ───────── */
function SedeRenameModal({ sede, onClose, onSaved }: {
  sede: string; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  // La tarjeta «Sin sede» agrupa los almacenes con sede nula: renombrarla les asigna una sede.
  const esSinSede = sede === 'Sin sede';
  const actual = esSinSede ? null : sede;
  const [nombre, setNombre] = useState(esSinSede ? '' : sede);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    const n = nombre.trim();
    if (!n) { setError('Escribí el nombre de la sede.'); return; }
    setError(null); setSaving(true);
    try {
      await renombrarSede(actual, n);
      toast(esSinSede ? `Almacenes sin sede asignados a «${n}»` : `Sede renombrada a «${n}»`, 'success');
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal title={esSinSede ? 'Asignar sede' : `Renombrar sede · ${sede}`} size="md" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
      <p className="muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        {esSinSede
          ? 'Se asignará esta sede a todos los almacenes que hoy no tienen una.'
          : 'El nuevo nombre se aplica a todos los almacenes de esta sede.'}
      </p>
      <div className="form-row">
        <label>Nombre de la sede</label>
        <input className="input" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value.toUpperCase())}
          placeholder="Ej.: MATANZAS, LOS PINOS…" onKeyDown={(e) => { if (e.key === 'Enter') void guardar(); }} />
      </div>
    </Modal>
  );
}

/* ───────── Borrar producto: confirmación escribiendo el nombre ───────── */
function EliminarProductoDialog({ producto, onCancel, onConfirm }: {
  producto: Producto; onCancel: () => void; onConfirm: () => void;
}) {
  const [texto, setTexto] = useState('');
  const ok = texto.trim() !== '' && normalizarTexto(texto) === normalizarTexto(producto.nombre);
  return (
    <Modal title="Borrar producto" size="md" onClose={onCancel} footer={
      <>
        <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-danger" disabled={!ok} onClick={() => { if (ok) onConfirm(); }}>
          Borrar producto
        </button>
      </>
    }>
      <p style={{ marginTop: 0 }}>
        ¿Seguro que deseas borrar el producto <strong>«{producto.nombre}»</strong> ({producto.sku})?
        Quedará <strong>inactivo</strong> y dejará de aparecer en el inventario activo (su historial se conserva).
      </p>
      <div className="form-row">
        <label>Para confirmar, escribí el nombre del producto: <strong>{producto.nombre}</strong></label>
        <input
          className="input"
          autoFocus
          value={texto}
          placeholder={producto.nombre}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && ok) onConfirm(); }}
        />
        {texto.trim() !== '' && !ok && (
          <small className="muted" style={{ color: 'var(--danger)' }}>El nombre no coincide.</small>
        )}
      </div>
    </Modal>
  );
}
