/* ============================================================
   MGG · Compras · Agregar un producto a una cotización / OC ya armada
   Hasta que el Gerente General aprueba, a la cotización aceptada (y a la
   OC) se le pueden sumar productos: uno que ya está en el inventario o
   uno nuevo, que nace en el inventario con su SKU de categoría (igual
   que en «Nueva solicitud»). El almacén no se elige acá: se define al
   recibir la mercancía.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { money } from '@/shared/lib/format';
import type { Producto } from '@/shared/lib/types';
import { opcionesCategoria } from '@/modules/inventario/opcionesCategoria';
import { addCategoria, createProducto, getCategorias, getUnidades, siguienteSkuLibre } from '@/modules/inventario/inventario.repository';
import { normalizarNombre, productosSimilares } from '@/modules/inventario/duplicados';
import { listProductosActivos } from './pedidos.repository';

interface Props {
  /** SKUs que ya están en la tabla (no se ofrecen de nuevo). */
  skusPresentes: Set<string>;
  /** Catálogo ya cargado por el padre; si no viene, se lee acá. */
  productos?: Producto[];
  actorEmail: string;
  /** Se llama con el producto elegido o recién creado. */
  onAgregar: (p: Producto) => void;
  /** Texto de ayuda debajo del bloque. */
  hint?: string;
}

export function AgregarProductoCompra({ skusPresentes, productos: productosProp, actorEmail, onAgregar, hint }: Props) {
  const [cargados, setCargados] = useState<Producto[]>([]);
  const [creados, setCreados] = useState<Producto[]>([]);
  useEffect(() => {
    if (productosProp?.length) return;
    listProductosActivos().then(setCargados).catch(() => setCargados([]));
  }, [productosProp]);
  const catalogo = useMemo(
    () => [...(productosProp?.length ? productosProp : cargados), ...creados],
    [productosProp, cargados, creados],
  );

  const [sel, setSel] = useState('');
  const disponibles = useMemo(
    () => catalogo.filter((p) => p.estado === 'activo' && !skusPresentes.has(p.sku)),
    [catalogo, skusPresentes],
  );

  function agregarExistente(p: Producto) {
    onAgregar(p);
    setSel('');
    toast(`"${p.nombre}" (${p.sku}) agregado`, 'success');
  }

  // ── Producto nuevo (no existe en inventario) ──
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [categoria, setCategoria] = useState('');
  const [unidad, setUnidad] = useState('UNIDAD');
  const [medidas, setMedidas] = useState<string[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [avisadoPara, setAvisadoPara] = useState('');
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    getUnidades(catalogo).then(setMedidas).catch(() => { /* usa defaults del repo */ });
    getCategorias(catalogo).then(setCategorias).catch(() => setCategorias([]));
  }, [abierto, catalogo]);
  const opcionesCat = useMemo(() => opcionesCategoria(categorias, catalogo), [categorias, catalogo]);
  const similares = useMemo(
    () => (abierto ? productosSimilares(nombre, catalogo) : []),
    [abierto, nombre, catalogo],
  );

  async function crear() {
    const n = nombre.trim().toUpperCase();
    if (!n) { toast('Escribí el nombre del producto', 'error'); return; }
    const cat = categoria.trim().toUpperCase();
    if (!cat) { toast('Elegí la categoría: define el código del producto', 'error'); return; }
    // Si hay parecidos, el primer clic avisa y el segundo crea (mismo criterio que la solicitud).
    if (similares.length && avisadoPara !== normalizarNombre(n)) {
      setAvisadoPara(normalizarNombre(n));
      toast(`Hay ${similares.length} producto(s) parecido(s) en el inventario. Si es el mismo usá «Usar este»; si es otro, tocá «Crear» de nuevo.`, 'warning');
      return;
    }
    setCreando(true);
    try {
      if (!categorias.some((c) => c.toLowerCase() === cat.toLowerCase())) {
        try { await addCategoria(cat, actorEmail); setCategorias((prev) => [...prev, cat]); } catch { /* duplicado/red: no bloquea */ }
      }
      const sku = await siguienteSkuLibre(cat, catalogo);
      const creado = await createProducto({
        sku, nombre: n, categoria: cat, unidad: unidad.trim() || 'und',
        stock: 0, stock_min: 0, precio: 0, almacen: '', estado: 'activo',
      });
      setCreados((prev) => [...prev, creado]);
      onAgregar(creado);
      toast(`Producto "${creado.nombre}" (${creado.sku}) creado en inventario y agregado`, 'success');
      setNombre(''); setCategoria(''); setAvisadoPara(''); setAbierto(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo crear el producto', 'error');
    } finally {
      setCreando(false);
    }
  }

  return (
    <div className="form-row" style={{ marginTop: '.5rem' }}>
      <label>Agregar producto</label>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px' }}>
          <SearchSelect value={sel} onChange={setSel}
            options={disponibles.map((p) => ({ value: p.id, label: `${p.nombre} · ${p.sku}${Number(p.precio) > 0 ? ` · ${money(Number(p.precio))}` : ''}` }))}
            placeholder="Buscar producto del inventario…" emptyText="Sin productos disponibles." />
        </div>
        <button type="button" className="btn btn-ghost" disabled={!sel}
          onClick={() => { const p = catalogo.find((x) => x.id === sel); if (p) agregarExistente(p); }}>＋ Agregar</button>
        <button type="button" className="btn btn-ghost" onClick={() => setAbierto((v) => !v)}>
          {abierto ? '× Cerrar' : '+ Producto nuevo'}
        </button>
      </div>
      {abierto && (
        <div className="card" style={{ padding: '.65rem', marginTop: '.4rem', display: 'grid', gap: '.5rem' }}>
          <div className="muted" style={{ fontSize: '.78rem' }}>
            No existe en el inventario: se crea con su código de categoría y queda en esta compra. El almacén se define al recibirlo.
          </div>
          <input className="input" placeholder="Nombre del producto *" value={nombre}
            onChange={(e) => setNombre(e.target.value.toUpperCase())} />
          {similares.length > 0 && (
            <div className="card" style={{ padding: '.5rem .7rem', borderColor: 'var(--warning)' }}>
              <div style={{ fontSize: '.84rem', fontWeight: 600, marginBottom: '.3rem' }}>
                ⚠️ {similares.length === 1 ? 'Ya existe un producto parecido' : `Ya existen ${similares.length} productos parecidos`}
              </div>
              {similares.map(({ producto: sp }) => (
                <div key={sp.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', alignItems: 'center', fontSize: '.8rem', padding: '.15rem 0' }}>
                  <span><span className="mono">{sp.sku}</span> · <strong>{sp.nombre}</strong> <span className="muted">{sp.categoria ?? ''}</span></span>
                  {sp.estado === 'activo' && !skusPresentes.has(sp.sku) && (
                    <button type="button" className="btn btn-sm" onClick={() => { agregarExistente(sp); setNombre(''); setAbierto(false); }}>Usar este</button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="form-grid">
            <SearchSelect allowCreate options={opcionesCat} value={categoria}
              onChange={(v) => setCategoria(v.toUpperCase())}
              placeholder="Categoría * (define el código: PLOMERIA → PLO-044)"
              emptyText="Ninguna categoría coincide" />
            <select className="select" value={unidad} onChange={(e) => setUnidad(e.target.value)}>
              {!medidas.includes(unidad) && unidad && <option value={unidad}>{unidad}</option>}
              {medidas.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => { void crear(); }}
              disabled={creando || !nombre.trim() || !categoria.trim()}>
              {creando ? 'Creando…' : similares.length && avisadoPara !== normalizarNombre(nombre) ? 'Crear igual (hay parecidos)' : 'Crear y agregar'}
            </button>
          </div>
        </div>
      )}
      {hint && <small className="hint muted">{hint}</small>}
    </div>
  );
}
