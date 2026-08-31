import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { mismaTaxonomia } from '@/shared/lib/taxonomias';
import { num } from '@/shared/lib/format';
import type { Almacen, Existencia, Producto, RecetaFundicion } from '@/shared/lib/types';
import { RECETAS_FUNDICION } from '@/shared/lib/types';
import { AlmacenSelectAgrupado } from './AlmacenPicker';
import {
  addCategoria,
  addUnidad,
  esUnidadLiquida,
  getCategorias,
  getUnidades,
  siguienteSkuGlobal,
  type ProductoInput,
  type Espacio,
} from './inventario.repository';
import { listAlmacenes, crearAlmacen } from './almacenes.repository';
import { useSectorizacion } from './useSectorizacion';
import { normalizarNombre, productosSimilares, type Duplicado } from './duplicados';

interface ProductoFormProps {
  producto: Producto | null; // null => crear
  productos?: Producto[];
  /** Espacio de inventario en el que se crea/edita el producto y sus almacenes. */
  espacio?: Espacio;
  /** Existencias por almacén, solo para mostrar dónde está el stock de un producto
   *  que ya existe cuando se detecta un posible duplicado. */
  existencias?: Existencia[];
  /** Al elegir «Usar este» sobre un producto que ya existe: en vez de crear un SKU
   *  nuevo, se abre el movimiento de ese producto para cargarle stock donde haga falta. */
  onUsarExistente?: (producto: Producto) => void;
  /** Si se crea desde DENTRO de un almacén, la ubicación viene fija y NO se puede cambiar
   *  (evita errores humanos: el producto entra justo en ese almacén/sub-almacén). */
  fixedAlmacen?: string | null;
  /** Almacén por defecto al crear (según el centro/scope actual): siembra el picker
   *  pero SÍ se puede cambiar. Evita que el producto caiga en el "General" invisible. */
  defaultAlmacen?: string | null;
  /** Si se crea parado en una sede/centro, limita el selector de almacén a ESA sede.
   *  Así "si estoy en Matanza se registra en Matanza, en La Esperanza en La Esperanza",
   *  y no se puede saltar por error a otra sede con nombre parecido. */
  soloSede?: string | null;
  onClose: () => void;
  onSubmit: (data: ProductoInput) => Promise<void>;
}

interface FormState {
  sku: string;
  nombre: string;
  categoria: string;
  unidad: string;
  stock: string;
  stock_min: string;
  precio: string;
  precio_venta: string;
  almacen: string;
  estado: 'activo' | 'inactivo';
  restock_pct: string;
  presentacion: string;
  unidades_empaque: string;
  esReceta: boolean;
  receta_fundicion: RecetaFundicion | '';
  // Detalle del producto (todos opcionales)
  nombre_busqueda: string;
  marca: string;
  modelo: string;
  fabricante: string;
  color: string;
  serial: string;
  numero: string;
  codigo: string;
  ubicacion_fisica: string;
  descripcion: string;
}

/** Parsea un número aceptando coma o punto como separador decimal (es-VE usa coma).
 *  Así un precio como "0,35" o "0.35" se interpreta igual y no se pierde. */
const parseDecimal = (s: number | string | null | undefined): number => {
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  const limpio = String(s ?? '').trim().replace(/\s+/g, '').replace(',', '.').replace(/[^0-9.]/g, '');
  return Number(limpio) || 0;
};

/** Redondea a 2 decimales (el inventario maneja precios/costos con 2 decimales). */
const round2 = (n: number | string | null | undefined) => Math.round((parseDecimal(n)) * 100) / 100;

function initialState(p: Producto | null, cats: string[], unids: string[], fixedAlmacen?: string | null, defaultAlmacen?: string | null): FormState {
  return {
    sku: p?.sku ?? '',
    nombre: p?.nombre ?? '',
    categoria: p?.categoria ?? cats[0] ?? '',
    unidad: p?.unidad ?? unids[0] ?? '',
    stock: String(p?.stock ?? 0),
    stock_min: String(p?.stock_min ?? 0),
    precio: String(round2(p?.precio ?? 0)),
    precio_venta: p?.precio_venta != null ? String(round2(p.precio_venta)) : '',
    // Al crear desde dentro de un almacén, la ubicación arranca (y queda) en ese almacén.
    // Si no hay almacén fijo, arranca en el del scope actual (defaultAlmacen) y NO en "General".
    almacen: p?.almacen ?? fixedAlmacen ?? defaultAlmacen ?? 'General',
    estado: p?.estado ?? 'activo',
    restock_pct: p?.restock_pct != null ? String(p.restock_pct) : '',
    presentacion: p?.presentacion ?? '',
    unidades_empaque: p?.unidades_empaque != null ? String(p.unidades_empaque) : '',
    esReceta: !!p?.receta_fundicion,
    receta_fundicion: (p?.receta_fundicion ?? '') as RecetaFundicion | '',
    nombre_busqueda: p?.nombre_busqueda ?? '',
    marca: p?.marca ?? '',
    modelo: p?.modelo ?? '',
    fabricante: p?.fabricante ?? '',
    color: p?.color ?? '',
    serial: p?.serial ?? '',
    numero: p?.numero ?? '',
    codigo: p?.codigo ?? '',
    ubicacion_fisica: p?.ubicacion_fisica ?? '',
    descripcion: p?.descripcion ?? '',
  };
}

export function ProductoForm({ producto, productos = [], existencias = [], onUsarExistente, espacio = 'principal', fixedAlmacen, defaultAlmacen, soloSede, onClose, onSubmit }: ProductoFormProps) {
  const isEdit = !!producto;
  // Ubicación fija: solo al CREAR desde dentro de un almacén concreto.
  const ubicacionFija = !isEdit && !!(fixedAlmacen && fixedAlmacen.trim());
  const [categorias, setCategorias] = useState<string[]>([]);
  const [unidades, setUnidades] = useState<string[]>([]);
  const [almacenesObj, setAlmacenesObj] = useState<Almacen[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCategorias(productos), getUnidades(productos), listAlmacenes(espacio).catch(() => [] as Almacen[])])
      .then(([cats, unids, almObj]) => {
        if (cancelled) return;
        setCategorias(cats);
        setUnidades(unids);
        setAlmacenesObj(almObj);
        // Defaults: categoría al primero; el almacén se elige por Sede → Almacén.
        setForm((prev) => ({
          ...prev,
          categoria: prev.categoria || (cats[0] ?? ''),
        }));
      })
      .catch(() => { /* defaults ya vienen del fallback en repo */ });
    return () => { cancelled = true; };
  }, [productos, espacio]);
  const [form, setForm] = useState<FormState>(() => initialState(producto, categorias, unidades, fixedAlmacen, defaultAlmacen));
  // Sede del almacén fijo (para mostrar "Sede › Almacén" en el campo bloqueado).
  const sedeFija = useMemo(
    () => (ubicacionFija ? (almacenesObj.find((a) => a.nombre === fixedAlmacen)?.sede?.trim() || '') : ''),
    [ubicacionFija, almacenesObj, fixedAlmacen],
  );
  // Sectorización: dar de alta un producto crea su existencia inicial, así que es
  // un movimiento más. Un almacenista solo puede crearlo en SUS almacenes.
  const sector = useSectorizacion();
  // Se cruza con el scope de la vista (`soloSede`): manda la intersección, la más chica.
  const sedesDelPicker = useMemo(() => {
    // Al EDITAR no se recorta: el producto ya está donde está, y dejarlo fuera de la
    // lista obligaba al almacenista a moverlo de sede para poder guardar un cambio de
    // nombre o de precio. La sectorización aplica al ALTA, que es cuando se decide
    // dónde nace la existencia.
    if (isEdit) return soloSede ? [soloSede] : undefined;
    if (soloSede && sector.sedes) return sector.sedes.includes(soloSede) ? [soloSede] : [];
    if (soloSede) return [soloSede];
    return sector.sedes ?? undefined;
  }, [isEdit, soloSede, sector.sedes]);

  // Anti-duplicados: mientras se escribe el nombre se buscan los productos que ya
  // existen y se parecen. No se impide crear —hay materiales legítimamente parecidos—,
  // se ofrece el existente: una harina que ya está en Matanzas no tiene por qué volver
  // a nacer para La Esperanza, porque eso parte el kardex y el costo promedio.
  // Se guarda PARA QUÉ NOMBRE se avisó, no un simple sí/no: con una bandera, el
  // usuario gastaba el aviso en el primer nombre que escribía y después podía crear
  // un duplicado real sin que nada lo frenara.
  const [avisadoPara, setAvisadoPara] = useState('');
  // Solo al CREAR: editando, el nombre ya es el del producto y avisaría de sí mismo.
  const similares = useMemo<Duplicado<Producto>[]>(
    () => (isEdit ? [] : productosSimilares(form.nombre, productos)),
    [isEdit, form.nombre, productos],
  );
  // Stock por almacén de los candidatos, para decidir de un vistazo si es «el mismo».
  const stockDe = useMemo(() => {
    const m = new Map<string, { almacen: string; stock: number }[]>();
    for (const e of existencias) {
      const st = Number(e.stock) || 0;
      if (st === 0) continue;
      const arr = m.get(e.producto_id) ?? [];
      arr.push({ almacen: e.almacen, stock: st });
      m.set(e.producto_id, arr);
    }
    return m;
  }, [existencias]);

  const [nuevaCat, setNuevaCat] = useState('');
  const [nuevaUnid, setNuevaUnid] = useState('');
  const [nuevoAlmacen, setNuevoAlmacen] = useState('');

  // El SKU se genera automático e incremental según la categoría.
  //  · Producto nuevo: siempre sigue a la categoría elegida.
  //  · Edición: si la categoría cambia respecto a la original, el SKU se
  //    regenera con el prefijo de la nueva categoría; si se vuelve a la
  //    categoría original, se restaura el SKU original del producto.
  useEffect(() => {
    if (!form.categoria) return;
    const cat = form.categoria;
    let cancel = false;
    // SKU correlativo GLOBAL (sobre todos los espacios) para no colisionar con el
    // índice único de `productos.sku` entre Inventario y Depósito.
    const aplicarSku = () => {
      siguienteSkuGlobal(cat)
        .then((sku) => { if (!cancel) setForm((prev) => (prev.categoria === cat ? { ...prev, sku } : prev)); })
        .catch(() => { /* si falla, el usuario puede escribir el SKU (editable en edición) */ });
    };
    if (isEdit) {
      if (!producto) return;
      if (cat !== producto.categoria) aplicarSku();
      else setForm((prev) => (prev.sku === producto.sku ? prev : { ...prev, sku: producto.sku }));
      return () => { cancel = true; };
    }
    aplicarSku();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, form.categoria, producto]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ingreso del stock inicial: por unidad o por bulto/caja (× unidades por bulto).
  const [stockModo, setStockModo] = useState<'unidad' | 'bulto'>('unidad');

  const showReceta = useMemo(() => form.esReceta, [form.esReceta]);
  // El stock siempre se guarda en UNIDADES. Si se ingresa por bulto, se multiplica
  // por las unidades por bulto (ej.: 2 cajas × 20 und = 40 und).
  const undPorBulto = Math.max(0, Number(form.unidades_empaque) || 0);
  const stockUnidades = stockModo === 'bulto'
    ? (Number(form.stock) || 0) * (undPorBulto || 1)
    : (Number(form.stock) || 0);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleAddCategoria() {
    const clean = nuevaCat.trim();
    if (!clean) { toast('Escribe un nombre para la categoría', 'error'); return; }
    // No permitir la misma categoría dos veces (ignora mayúsculas/minúsculas).
    const existente = categorias.find((c) => mismaTaxonomia(c, clean));
    if (existente) {
      setForm((prev) => ({ ...prev, categoria: existente }));
      setNuevaCat('');
      toast(`La categoría "${existente}" ya existe — se seleccionó`, 'warning');
      return;
    }
    try {
      const added = await addCategoria(clean);
      if (!added) { toast('No se pudo añadir la categoría', 'error'); return; }
      setCategorias((prev) => (prev.includes(added) ? prev : [...prev, added].sort((a, b) => a.localeCompare(b, 'es'))));
      setForm((prev) => ({ ...prev, categoria: added }));
      setNuevaCat('');
      toast(`Categoría "${added}" añadida`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo añadir la categoría', 'error');
    }
  }

  async function handleAddUnidad() {
    const clean = nuevaUnid.trim();
    if (!clean) { toast('Escribe un nombre para la unidad', 'error'); return; }
    // No permitir la misma medida dos veces (ignora mayúsculas/minúsculas: kg vs Kg.).
    const existente = unidades.find((u) => mismaTaxonomia(u, clean));
    if (existente) {
      setForm((prev) => ({ ...prev, unidad: existente }));
      setNuevaUnid('');
      toast(`La medida "${existente}" ya existe — se seleccionó`, 'warning');
      return;
    }
    try {
      const added = await addUnidad(clean);
      if (!added) { toast('No se pudo añadir la unidad', 'error'); return; }
      setUnidades((prev) => (prev.includes(added) ? prev : [...prev, added].sort((a, b) => a.localeCompare(b, 'es'))));
      setForm((prev) => ({ ...prev, unidad: added }));
      setNuevaUnid('');
      toast(`Unidad "${added}" añadida`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo añadir la unidad', 'error');
    }
  }

  async function handleAddAlmacen() {
    const nombre = nuevoAlmacen.trim();
    if (!nombre) { toast('Escribe un nombre para el almacén', 'error'); return; }
    try {
      const creado = await crearAlmacen({ nombre, espacio });
      setAlmacenesObj((prev) => (prev.some((a) => a.id === creado.id) ? prev : [...prev, creado]));
      setForm((prev) => ({ ...prev, almacen: creado.nombre }));
      setNuevoAlmacen('');
      toast(`Almacén "${creado.nombre}" añadido`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo añadir el almacén', 'error');
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const sku = form.sku.trim().toUpperCase();
    const nombre = form.nombre.trim().toUpperCase();
    if (!sku || !nombre) {
      setError('SKU y nombre son obligatorios.');
      return;
    }
    if (form.esReceta && !form.receta_fundicion) {
      setError('Seleccioná la receta de fundición o cambiá la respuesta a "No".');
      return;
    }
    // Stock por bulto: necesita "unidades por bulto" para convertir a unidades.
    if (stockModo === 'bulto' && (Number(form.stock) || 0) > 0 && undPorBulto <= 0) {
      setError('Indicá las “Unidades por caja/bulto” para convertir el stock a unidades.');
      return;
    }
    // Duplicado con el MISMO nombre: se frena una vez y se explica. Si el usuario
    // vuelve a apretar Crear, se respeta su decisión (puede haber materiales que de
    // verdad se llaman igual y se distinguen por medida o presentación).
    if (!isEdit && avisadoPara !== normalizarNombre(form.nombre) && similares.some((d) => d.nivel === 'exacto')) {
      setAvisadoPara(normalizarNombre(form.nombre));
      setError('Ya hay un producto con este mismo nombre (mirá la lista de arriba). Si es el mismo material, usalo en vez de duplicarlo. Si de verdad es otro, volvé a apretar «Crear».');
      return;
    }
    if (sector.sectorizado && !isEdit) {
      if (!sector.listo) { setError('Todavía se están cargando los almacenes. Probá de nuevo en un momento.'); return; }
      const bloqueo = sector.motivo(form.almacen.trim());
      if (bloqueo) { setError(bloqueo); return; }
    }
    const restockRaw = form.restock_pct.trim();

    const payload: ProductoInput = {
      sku,
      nombre,
      categoria: form.categoria,
      unidad: form.unidad,
      // El stock se guarda en unidades (si se ingresó por bulto, ya viene multiplicado).
      stock: stockUnidades,
      stock_min: Number(form.stock_min) || 0,
      precio: round2(form.precio),
      precio_venta: form.precio_venta.trim() === '' ? null : round2(Math.max(0, parseDecimal(form.precio_venta))),
      almacen: form.almacen.trim() || 'General',
      estado: form.estado,
      restock_pct: restockRaw === '' ? null : Math.max(0, Number(restockRaw)),
      // Unidades líquidas (litros) no usan bultos: no persistimos esos campos.
      presentacion: esUnidadLiquida(form.unidad) ? null : (form.presentacion.trim() || null),
      unidades_empaque: esUnidadLiquida(form.unidad)
        ? null
        : (form.unidades_empaque.trim() === '' ? null : Math.max(0, Number(form.unidades_empaque)) || null),
      receta_fundicion: form.esReceta && form.receta_fundicion ? (form.receta_fundicion as RecetaFundicion) : null,
      // Marcar receta no se des-marca al editar (lo añade el toggle o el alta desde fundición).
      es_receta: form.esReceta || (producto?.es_receta ?? false),
      es_producible: producto?.es_producible ?? false,
      // Detalle del producto: se guarda lo que se cargó (trim → null si vacío).
      nombre_busqueda: form.nombre_busqueda.trim() || null,
      marca: form.marca.trim() || null,
      modelo: form.modelo.trim() || null,
      fabricante: form.fabricante.trim() || null,
      color: form.color.trim() || null,
      serial: form.serial.trim() || null,
      numero: form.numero.trim() || null,
      codigo: form.codigo.trim() || null,
      ubicacion_fisica: form.ubicacion_fisica.trim() || null,
      descripcion: form.descripcion.trim() || null,
    };

    setSaving(true);
    try {
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el producto.');
    } finally {
      setSaving(false);
    }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
        Cancelar
      </button>
      <button type="submit" form="producto-form" className="btn btn-primary" disabled={saving}>
        {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear producto'}
      </button>
    </>
  );

  return (
    <Modal title={isEdit ? 'Editar producto' : 'Nuevo producto'} onClose={onClose} footer={footer}>
      <form id="producto-form" onSubmit={handleSubmit}>
        {error && (
          <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        <div className="form-grid">
          <div className="form-row">
            <label>SKU</label>
            <input
              className="input mono"
              value={form.sku}
              onChange={(e) => update('sku', e.target.value.toUpperCase())}
              required
              readOnly={!isEdit}
              title={!isEdit ? 'Se genera automáticamente según la categoría' : undefined}
            />
            {!isEdit && (
              <small className="muted" style={{ fontSize: '.72rem' }}>
                Generado automático e incremental según la categoría seleccionada.
              </small>
            )}
          </div>
          <div className="form-row">
            <label>Estado</label>
            <select
              className="select"
              value={form.estado}
              onChange={(e) => update('estado', e.target.value as 'activo' | 'inactivo')}
            >
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <label>Nombre del producto</label>
          <input
            className="input"
            value={form.nombre}
            onChange={(e) => update('nombre', e.target.value.toUpperCase())}
            required
          />
          {similares.length > 0 && (
            <div className="card" style={{ marginTop: '.5rem', padding: '.6rem .8rem', borderColor: 'var(--warning)', background: 'var(--bg-1)' }}>
              <div style={{ fontSize: '.86rem', fontWeight: 600, marginBottom: '.15rem' }}>
                ⚠️ {similares.length === 1 ? 'Ya existe un producto parecido' : `Ya existen ${similares.length} productos parecidos`}
              </div>
              <div className="muted" style={{ fontSize: '.76rem', marginBottom: '.45rem' }}>
                Que el mismo material esté en tu almacén <strong>y</strong> en el de la otra sede está bien: un
                producto lleva stock en varios almacenes a la vez. Lo que no hay que hacer es cargarlo dos veces.
                Si es este mismo material, usá <strong>«Usar este»</strong> y cargale stock en tu almacén; dos fichas
                del mismo producto parten el kardex y el costo promedio. Si de verdad es otro material, seguí y creálo.
              </div>
              <div className="table-wrap">
                <table className="table" style={{ fontSize: '.8rem' }}>
                  <thead><tr><th>SKU</th><th>Producto</th><th>Dónde tiene stock</th><th></th></tr></thead>
                  <tbody>
                    {similares.map(({ producto: sp, nivel }) => {
                      const ubic = stockDe.get(sp.id) ?? [];
                      return (
                        <tr key={sp.id}>
                          <td className="mono">{sp.sku}</td>
                          <td>
                            <strong>{sp.nombre}</strong>
                            {nivel === 'exacto' && <span className="badge" style={{ marginLeft: '.35rem', color: 'var(--danger)', borderColor: 'var(--danger)' }}>mismo nombre</span>}
                            <div className="muted" style={{ fontSize: '.72rem' }}>
                              {sp.categoria ?? '—'} · {sp.unidad ?? '—'}
                              {sp.estado !== 'activo' && (
                                <span className="badge" style={{ marginLeft: '.35rem', color: 'var(--warning)', borderColor: 'var(--warning)' }}>dado de baja</span>
                              )}
                            </div>
                          </td>
                          <td className="mono" style={{ fontSize: '.74rem' }}>
                            {ubic.length === 0
                              ? <span className="dim">sin stock en ningún almacén</span>
                              : ubic.map((u) => `${u.almacen}: ${num(u.stock)}`).join(' · ')}
                          </td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {/* Cargarle stock a una ficha dada de baja lo deja invisible en el
                                inventario y sin poder despacharse: hay que reactivarla primero
                                desde su detalle, así que acá no se ofrece el atajo. */}
                            {onUsarExistente && (sp.estado === 'activo' ? (
                              <button type="button" className="btn btn-sm" onClick={() => onUsarExistente(sp)}
                                title="Abrir el movimiento de este producto para cargarle stock en tu almacén">
                                Usar este
                              </button>
                            ) : (
                              <span className="dim" style={{ fontSize: '.72rem' }} title="Reactivalo desde su detalle en Inventario y después cargale stock">
                                reactivalo primero
                              </span>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Categoría</label>
            <select
              className="select"
              value={form.categoria}
              onChange={(e) => update('categoria', e.target.value)}
            >
              {categorias.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: '.4rem', marginTop: '.4rem' }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="Nueva categoría…"
                value={nuevaCat}
                onChange={(e) => setNuevaCat(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategoria(); } }}
                maxLength={40}
              />
              <button type="button" className="btn btn-sm btn-ghost" onClick={handleAddCategoria}>
                + Añadir
              </button>
            </div>
          </div>
          <div className="form-row">
            <label>Unidad</label>
            <SearchSelect
              options={unidades.map((u) => ({ value: u, label: u }))}
              value={form.unidad}
              onChange={(v) => update('unidad', v)}
              placeholder="Buscar unidad…"
            />
            <div style={{ display: 'flex', gap: '.4rem', marginTop: '.4rem' }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="Nueva unidad…"
                value={nuevaUnid}
                onChange={(e) => setNuevaUnid(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddUnidad(); } }}
                maxLength={20}
              />
              <button type="button" className="btn btn-sm btn-ghost" onClick={handleAddUnidad}>
                + Añadir
              </button>
            </div>
          </div>
        </div>

        <div className="form-row">
          <label>¿Este producto forma parte de una receta de fundición?</label>
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '.4rem' }}>
            <button
              type="button"
              className={`btn btn-sm ${form.esReceta ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => update('esReceta', true)}
            >
              Sí
            </button>
            <button
              type="button"
              className={`btn btn-sm ${!form.esReceta ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { update('esReceta', false); update('receta_fundicion', ''); }}
            >
              No
            </button>
          </div>
          {showReceta && (
            <select
              className="select"
              value={form.receta_fundicion}
              onChange={(e) => update('receta_fundicion', e.target.value as RecetaFundicion | '')}
            >
              <option value="">— elegí una receta —</option>
              {RECETAS_FUNDICION.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          )}
        </div>

        {ubicacionFija ? (
          // Creado desde dentro de un almacén: ubicación fija y NO editable (evita errores humanos).
          <div className="form-row">
            <label>📦 Ubicación (fija)</label>
            <input
              className="input"
              value={sedeFija ? `${sedeFija} › ${fixedAlmacen}` : (fixedAlmacen ?? '')}
              readOnly
              disabled
              title="El producto se crea en este almacén. No se puede cambiar para evitar errores."
            />
            <small className="muted" style={{ fontSize: '.72rem' }}>
              Se crea directo en <strong>{fixedAlmacen}</strong>. La ubicación no se puede modificar para evitar errores.
            </small>
          </div>
        ) : (
          <div className="form-row">
            <label>Almacén{soloSede ? ` · ${soloSede}` : ''}</label>
            {sedesDelPicker?.length === 0 && (
              <div className="card" style={{ marginBottom: '.4rem', padding: '.5rem .75rem', borderLeft: '3px solid var(--warning)', background: 'var(--bg-1)' }}>
                <span style={{ fontSize: '.84rem' }}>
                  🔒 Estás parado en <strong>{soloSede}</strong>, que no es una de tus sedes ({(sector.sedes ?? []).join(', ')}).
                  Cambiá de sede para crear el producto, o pedí el material por traslado.
                </span>
              </div>
            )}
            <AlmacenSelectAgrupado
              value={form.almacen}
              onChange={(v) => update('almacen', v)}
              almacenes={almacenesObj}
              soloSedes={sedesDelPicker ?? undefined}
              required
            />
            {!isEdit && (form.almacen ? (
              <div className="card" style={{ marginTop: '.5rem', padding: '.5rem .75rem', borderLeft: '3px solid var(--warning)', background: 'var(--bg-1)' }}>
                <span style={{ fontSize: '.84rem' }}>📦 Se creará en: <strong>{form.almacen}</strong>{soloSede ? <> ({soloSede})</> : null}. Verificá que sea el almacén correcto.</span>
              </div>
            ) : (
              <div className="card" style={{ marginTop: '.5rem', padding: '.5rem .75rem', borderLeft: '3px solid var(--danger)', background: 'var(--bg-1)' }}>
                <span style={{ fontSize: '.84rem' }}>⚠️ Elegí el <strong>almacén</strong> donde se crea el producto.</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: '.4rem', marginTop: '.4rem' }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="Nuevo almacén…"
                value={nuevoAlmacen}
                onChange={(e) => setNuevoAlmacen(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddAlmacen(); } }}
                maxLength={40}
              />
              <button type="button" className="btn btn-sm btn-ghost" onClick={handleAddAlmacen}>
                + Añadir
              </button>
            </div>
          </div>
        )}

        <div className="form-grid">
          <div className="form-row">
            <label>{isEdit ? `Stock total (todos los almacenes)${stockModo === 'bulto' ? ' (en cajas/bultos)' : ''}` : `Stock inicial${stockModo === 'bulto' ? ' (en cajas/bultos)' : ''}`}</label>
            {!esUnidadLiquida(form.unidad) && (
              <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.4rem' }}>
                <button type="button" className={`btn btn-sm ${stockModo === 'unidad' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setStockModo('unidad')}>Por {form.unidad || 'unidad'}</button>
                <button type="button" className={`btn btn-sm ${stockModo === 'bulto' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setStockModo('bulto')}>Por caja/bulto</button>
              </div>
            )}
            <input
              className="input mono"
              type="number"
              min={0}
              step="any"
              value={form.stock}
              onChange={(e) => update('stock', e.target.value)}
              required={!isEdit}
            />
            <small className="muted" style={{ fontSize: '.72rem' }}>
              {stockModo === 'bulto'
                ? (undPorBulto > 0
                  ? <><strong>{Number(form.stock) || 0}</strong> caja(s)/bulto(s) × {undPorBulto} {form.unidad || 'und'} = <strong className="mono">{stockUnidades} {form.unidad || 'und'}</strong> {isEdit ? 'de stock total.' : 'en stock.'}</>
                  : <span style={{ color: 'var(--warning)' }}>Indicá abajo las “Unidades por caja/bulto” para convertir a {form.unidad || 'unidades'}.</span>)
                : (isEdit
                  ? 'Stock total del producto. Para mover entre almacenes usá “Movimiento” (entrada/salida/ajuste).'
                  : 'Ingresa al almacén seleccionado arriba. Luego se ajusta por movimientos.')}
            </small>
          </div>
          <div className="form-row">
            <label>Stock mínimo</label>
            <input
              className="input mono"
              type="number"
              min={0}
              step="any"
              value={form.stock_min}
              onChange={(e) => update('stock_min', e.target.value)}
              required
            />
            <small className="muted" style={{ fontSize: '.72rem' }}>
              Línea roja. Por debajo de este nivel el producto entra en estado crítico.
            </small>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Precio unitario / costo (USD)</label>
            <input
              className="input mono"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={form.precio}
              onChange={(e) => update('precio', e.target.value)}
              required
            />
            <small className="muted" style={{ fontSize: '.72rem' }}>
              Costo. Al comprar/recibir se mantiene como precio promedio ponderado (PMP).
            </small>
          </div>
          <div className="form-row">
            <label>Posible precio de venta (USD, opcional)</label>
            <input
              className="input mono"
              type="text"
              inputMode="decimal"
              value={form.precio_venta}
              onChange={(e) => update('precio_venta', e.target.value)}
              placeholder="para calcular ganancia en fundición"
            />
            <small className="muted" style={{ fontSize: '.72rem' }}>
              Se usa para estimar la posible ganancia cuando el producto se produce.
            </small>
          </div>
          <div className="form-row">
            <label>Umbral reabastecimiento (% opcional)</label>
            <input
              className="input mono"
              type="number"
              min={0}
              max={500}
              step={5}
              value={form.restock_pct}
              onChange={(e) => update('restock_pct', e.target.value)}
              placeholder="vacío = usar política global"
            />
            <small className="muted" style={{ fontSize: '.72rem' }}>
              % sobre el stock mínimo. 150% alerta cuando aún tienes 1.5× el mínimo.
            </small>
          </div>
        </div>

        {!esUnidadLiquida(form.unidad) && (
          <div className="form-row">
            <label>Unidades por caja/bulto (opcional)</label>
            <input
              className="input mono"
              type="number"
              min={0}
              step="any"
              value={form.unidades_empaque}
              onChange={(e) => update('unidades_empaque', e.target.value)}
              placeholder="Ej: 24"
            />
            <small className="muted" style={{ fontSize: '.72rem' }}>
              Cuántas {form.unidad || 'unidades'} trae cada caja/bulto. Se usa para convertir el stock al ingresarlo por bulto (el stock siempre se guarda en {form.unidad || 'unidades'}).
            </small>
          </div>
        )}

        {/* ── Detalle del producto (identificación física, todo opcional) ── */}
        <details style={{ marginTop: '.6rem', border: '1px solid var(--border)', borderRadius: 8, padding: '.6rem .8rem' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '.9rem' }}>🔎 Detalle del producto (marca, serial, código…)</summary>
          <small className="muted" style={{ display: 'block', margin: '.35rem 0 .6rem', fontSize: '.74rem' }}>
            Datos opcionales para identificar mejor el artículo. Se ven al abrir el detalle del producto.
          </small>
          <div className="form-row">
            <label>Nombre de búsqueda / alias</label>
            <input className="input" value={form.nombre_busqueda} onChange={(e) => update('nombre_busqueda', e.target.value)}
              placeholder="Ej. CLORO (nombre corto para encontrarlo rápido)" />
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>Marca</label>
              <input className="input" value={form.marca} onChange={(e) => update('marca', e.target.value)} placeholder="Ej. Bosch" />
            </div>
            <div className="form-row">
              <label>Modelo</label>
              <input className="input" value={form.modelo} onChange={(e) => update('modelo', e.target.value)} placeholder="Ej. GSB 550" />
            </div>
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>Fabricante</label>
              <input className="input" value={form.fabricante} onChange={(e) => update('fabricante', e.target.value)} />
            </div>
            <div className="form-row">
              <label>Color</label>
              <input className="input" value={form.color} onChange={(e) => update('color', e.target.value)} />
            </div>
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>N°</label>
              <input className="input mono" value={form.numero} onChange={(e) => update('numero', e.target.value)} placeholder="N° de parte / activo" />
            </div>
            <div className="form-row">
              <label>Serial</label>
              <input className="input mono" value={form.serial} onChange={(e) => update('serial', e.target.value)} placeholder="Número de serie" />
            </div>
            <div className="form-row">
              <label>Código</label>
              <input className="input mono" value={form.codigo} onChange={(e) => update('codigo', e.target.value)} placeholder="Código interno / de barras" />
            </div>
          </div>
          <div className="form-row">
            <label>Ubicación física</label>
            <input className="input" value={form.ubicacion_fisica} onChange={(e) => update('ubicacion_fisica', e.target.value)} placeholder="Estante / pasillo / gaveta" />
          </div>
          <div className="form-row">
            <label>Descripción</label>
            <textarea className="input" rows={2} value={form.descripcion} onChange={(e) => update('descripcion', e.target.value)}
              placeholder="Descripción libre / características adicionales" />
          </div>
        </details>
      </form>
    </Modal>
  );
}
