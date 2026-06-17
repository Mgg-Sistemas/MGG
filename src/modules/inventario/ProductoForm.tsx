import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { mismaTaxonomia } from '@/shared/lib/taxonomias';
import type { Almacen, Producto, RecetaFundicion } from '@/shared/lib/types';
import { RECETAS_FUNDICION } from '@/shared/lib/types';
import { AlmacenPicker } from './AlmacenPicker';
import {
  addCategoria,
  addUnidad,
  esUnidadLiquida,
  getCategorias,
  getUnidades,
  siguienteSku,
  type ProductoInput,
} from './inventario.repository';
import { listAlmacenes, crearAlmacen } from './almacenes.repository';

interface ProductoFormProps {
  producto: Producto | null; // null => crear
  productos?: Producto[];
  /** Si se crea desde DENTRO de un almacén, la ubicación viene fija y NO se puede cambiar
   *  (evita errores humanos: el producto entra justo en ese almacén/sub-almacén). */
  fixedAlmacen?: string | null;
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
}

function initialState(p: Producto | null, cats: string[], unids: string[], fixedAlmacen?: string | null): FormState {
  return {
    sku: p?.sku ?? '',
    nombre: p?.nombre ?? '',
    categoria: p?.categoria ?? cats[0] ?? '',
    unidad: p?.unidad ?? unids[0] ?? '',
    stock: String(p?.stock ?? 0),
    stock_min: String(p?.stock_min ?? 0),
    precio: String(p?.precio ?? 0),
    precio_venta: p?.precio_venta != null ? String(p.precio_venta) : '',
    // Al crear desde dentro de un almacén, la ubicación arranca (y queda) en ese almacén.
    almacen: p?.almacen ?? fixedAlmacen ?? 'General',
    estado: p?.estado ?? 'activo',
    restock_pct: p?.restock_pct != null ? String(p.restock_pct) : '',
    presentacion: p?.presentacion ?? '',
    unidades_empaque: p?.unidades_empaque != null ? String(p.unidades_empaque) : '',
    esReceta: !!p?.receta_fundicion,
    receta_fundicion: (p?.receta_fundicion ?? '') as RecetaFundicion | '',
  };
}

export function ProductoForm({ producto, productos = [], fixedAlmacen, onClose, onSubmit }: ProductoFormProps) {
  const isEdit = !!producto;
  // Ubicación fija: solo al CREAR desde dentro de un almacén concreto.
  const ubicacionFija = !isEdit && !!(fixedAlmacen && fixedAlmacen.trim());
  const [categorias, setCategorias] = useState<string[]>([]);
  const [unidades, setUnidades] = useState<string[]>([]);
  const [almacenesObj, setAlmacenesObj] = useState<Almacen[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCategorias(productos), getUnidades(productos), listAlmacenes().catch(() => [] as Almacen[])])
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
  }, [productos]);
  const [form, setForm] = useState<FormState>(() => initialState(producto, categorias, unidades, fixedAlmacen));
  // Sede del almacén fijo (para mostrar "Sede › Almacén" en el campo bloqueado).
  const sedeFija = useMemo(
    () => (ubicacionFija ? (almacenesObj.find((a) => a.nombre === fixedAlmacen)?.sede?.trim() || '') : ''),
    [ubicacionFija, almacenesObj, fixedAlmacen],
  );
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
    if (isEdit) {
      if (!producto) return;
      if (form.categoria !== producto.categoria) {
        setForm((prev) => ({ ...prev, sku: siguienteSku(prev.categoria, productos) }));
      } else {
        setForm((prev) => (prev.sku === producto.sku ? prev : { ...prev, sku: producto.sku }));
      }
      return;
    }
    setForm((prev) => ({ ...prev, sku: siguienteSku(prev.categoria, productos) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, form.categoria, productos, producto]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showReceta = useMemo(() => form.esReceta, [form.esReceta]);

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
      const creado = await crearAlmacen({ nombre });
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
    const restockRaw = form.restock_pct.trim();

    const payload: ProductoInput = {
      sku,
      nombre,
      categoria: form.categoria,
      unidad: form.unidad,
      stock: Number(form.stock) || 0,
      stock_min: Number(form.stock_min) || 0,
      precio: Number(form.precio) || 0,
      precio_venta: form.precio_venta.trim() === '' ? null : Math.max(0, Number(form.precio_venta)),
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
            <AlmacenPicker value={form.almacen} onChange={(v) => update('almacen', v)} almacenes={almacenesObj} />
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
            <label>{isEdit ? 'Stock total (todos los almacenes)' : 'Stock inicial'}</label>
            <input
              className="input mono"
              type="number"
              min={0}
              value={form.stock}
              onChange={(e) => update('stock', e.target.value)}
              required={!isEdit}
              disabled={isEdit}
            />
            <small className="muted" style={{ fontSize: '.72rem' }}>
              {isEdit
                ? 'El stock es por almacén. Ajustalo desde “Movimiento” (entrada/salida/ajuste) en cada almacén.'
                : 'Ingresa al almacén seleccionado arriba. Luego se ajusta por movimientos.'}
            </small>
          </div>
          <div className="form-row">
            <label>Stock mínimo</label>
            <input
              className="input mono"
              type="number"
              min={0}
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
              type="number"
              min={0}
              step="0.01"
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
              type="number"
              min={0}
              step="0.01"
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
          <div className="form-grid">
            <div className="form-row">
              <label>Presentación de compra (opcional)</label>
              <input
                className="input"
                value={form.presentacion}
                onChange={(e) => update('presentacion', e.target.value)}
                placeholder="Ej: Caja, Bulto, Paca…"
              />
              <small className="muted" style={{ fontSize: '.72rem' }}>
                Cómo se compra (por bulto/caja). El stock siempre se guarda en {form.unidad || 'unidades'}.
              </small>
            </div>
            <div className="form-row">
              <label>Unidades por bulto (sugerido)</label>
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
                Valor sugerido para el conversor de bultos al ingresar stock. Se puede ajustar en cada ingreso (el tamaño puede variar).
              </small>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
