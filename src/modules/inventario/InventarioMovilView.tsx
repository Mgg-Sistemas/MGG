/* ============================================================
   MGG · Inventario · Vista de teléfono (06-10-2026)

   Traída del «Depósito Mina» de Golden Touch y adaptada a MGG: en vez de un
   depósito fijo, se elige el ALMACÉN (solo los de las sedes del usuario) y
   ahí, con botones grandes:
   · «Producto nuevo»: nombre, categoría, unidad y cuánto llegó. El SKU lo pone
     el sistema y el producto nace en el almacén elegido.
   · «Entrada»: se busca un producto y se le suma lo que llegó, con su motivo.
   Escribe en las MISMAS tablas que el módulo de PC (createProducto +
   registrarMovimiento), así que aparece al instante en Inventario y en la
   vista del almacén (realtime). Editar, desactivar, salidas y traslados
   siguen siendo de la PC.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { toast } from '@/shared/ui/Toast';
import { num } from '@/shared/lib/format';
import { AtajosTelefono } from '@/shared/ui/AtajosTelefono';
import { RUTA_INVENTARIO_TELEFONO } from '@/modules/usuarios/permisos.repository';
import type { Almacen, Existencia, Producto } from '@/shared/lib/types';
import { createProducto, findBySku, getCategorias, getUnidades, listProductos, siguienteSkuGlobal } from './inventario.repository';
import { crearExistenciaInicial, listAlmacenes, listExistencias, nombreCortoAlmacen } from './almacenes.repository';
import { registrarMovimiento } from './movimientos.repository';
import { MOTIVO_MINIMO } from './motivoMovimiento';
import { productosSimilares } from './duplicados';
import { useSectorizacion } from './useSectorizacion';

/** Cuántos productos se listan sin buscar: en el teléfono no se recorre el inventario entero. */
const SIN_BUSCAR = 15;
const CLAVE_ALMACEN = 'mgg.inventario.telefono.almacen';

const sinAcentos = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const leerAlmacen = () => { try { return localStorage.getItem(CLAVE_ALMACEN) ?? ''; } catch { return ''; } };
const guardarAlmacen = (a: string) => { try { localStorage.setItem(CLAVE_ALMACEN, a); } catch { /* opcional */ } };

type Paso = 'inicio' | 'nuevo' | 'entrada';
interface ProductoEnAlmacen { producto: Producto; stock: number }

export function InventarioMovilView() {
  const { user } = useSession();
  const { can, appUser, soloTelefono } = usePermissions();
  const canWrite = can('inventario', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre?.trim() || user?.email || null;
  const sector = useSectorizacion();
  const [params] = useSearchParams();

  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [unidades, setUnidades] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [almacen, setAlmacen] = useState<string>(() => params.get('almacen') ?? leerAlmacen());
  const [paso, setPaso] = useState<Paso>('inicio');
  const [elegido, setElegido] = useState<Producto | null>(null);
  const [busca, setBusca] = useState('');

  const reload = useCallback(async () => {
    const [als, ps, exs] = await Promise.all([listAlmacenes('principal'), listProductos(), listExistencias()]);
    setAlmacenes(als);
    setProductos(ps.filter((p) => p.estado === 'activo'));
    setExistencias(exs);
    const [cats, uds] = await Promise.all([getCategorias(ps), getUnidades(ps)]);
    setCategorias(cats);
    setUnidades(uds);
  }, []);

  useEffect(() => {
    let cancel = false;
    reload().catch((e) => { if (!cancel) toast(e instanceof Error ? e.message : 'No se pudo cargar', 'error'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reload]);
  useRealtime(['productos', 'existencias', 'almacenes'], () => { void reload().catch(() => {}); });

  // Solo los almacenes de las sedes del usuario (los sectorizados no ven los ajenos).
  const misAlmacenes = useMemo(() => {
    const sedes = sector.sedes;
    return almacenes
      .filter((a) => a.estado === 'activo')
      .filter((a) => !sedes || (a.sede && sedes.some((s) => s.toUpperCase() === String(a.sede).toUpperCase())))
      .sort((a, b) => String(a.sede ?? '').localeCompare(String(b.sede ?? ''), 'es') || a.nombre.localeCompare(b.nombre, 'es'));
  }, [almacenes, sector.sedes]);

  // Si el almacén recordado ya no le corresponde (o no existe), se elige de nuevo.
  useEffect(() => {
    if (loading) return;
    if (almacen && !misAlmacenes.some((a) => a.nombre === almacen)) setAlmacen(misAlmacenes.length === 1 ? misAlmacenes[0].nombre : '');
    else if (!almacen && misAlmacenes.length === 1) setAlmacen(misAlmacenes[0].nombre);
  }, [loading, almacen, misAlmacenes]);

  function elegirAlmacen(nombre: string) {
    setAlmacen(nombre); guardarAlmacen(nombre); setPaso('inicio'); setElegido(null); setBusca('');
  }

  // Lo que hay en el almacén elegido (stock propio de ese almacén).
  const enAlmacen = useMemo<ProductoEnAlmacen[]>(() => {
    if (!almacen) return [];
    const porId = new Map(productos.map((p) => [p.id, p]));
    const out: ProductoEnAlmacen[] = [];
    for (const e of existencias) {
      if (e.almacen !== almacen) continue;
      const p = porId.get(e.producto_id);
      if (p) out.push({ producto: p, stock: Number(e.stock) || 0 });
    }
    return out.sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre, 'es'));
  }, [almacen, productos, existencias]);

  // Para «Entrada» se puede buscar en TODO el catálogo: algo que existe en otra
  // sede también puede llegar a esta (entra con existencia nueva en este almacén).
  const fuente = paso === 'entrada' ? productos.map((p) => ({ producto: p, stock: enAlmacen.find((x) => x.producto.id === p.id)?.stock ?? 0 })) : enAlmacen;
  const lista = useMemo(() => {
    const q = sinAcentos(busca.trim());
    if (!q) return fuente.slice(0, SIN_BUSCAR);
    return fuente.filter(({ producto: p }) => sinAcentos(`${p.nombre} ${p.sku} ${p.categoria}`).includes(q)).slice(0, 60);
  }, [fuente, busca]);

  function volver() { setPaso('inicio'); setElegido(null); }
  const almacenObj = misAlmacenes.find((a) => a.nombre === almacen) ?? null;
  const puedeAqui = canWrite && !!almacen && sector.puedeMover(almacen);

  return (
    <div className="surtidor">
      <header className="surt-head">
        <div>
          <h1>📦 Inventario</h1>
          <div className="muted" style={{ fontSize: '.85rem' }}>{actorName ?? actor}</div>
        </div>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          {!soloTelefono && <Link to="/app/inventario" className="btn btn-ghost">🖥 Módulo completo</Link>}
        </div>
      </header>
      <AtajosTelefono actual={RUTA_INVENTARIO_TELEFONO} />

      {loading && <p className="muted">Cargando…</p>}
      {!loading && !misAlmacenes.length && <p className="muted">No tenés almacenes asignados. Pedile a un administrador que te asigne una sede.</p>}

      {!loading && misAlmacenes.length > 0 && (
        <>
          <div className="surt-rotulo">Almacén</div>
          <div className="surt-tanques" role="tablist" aria-label="Almacén">
            {misAlmacenes.map((a) => (
              <button key={a.id} type="button" role="tab" aria-selected={a.nombre === almacen}
                className={`surt-tanque${a.nombre === almacen ? ' sel' : ''}`} onClick={() => elegirAlmacen(a.nombre)}>
                <div className="nombre">{nombreCortoAlmacen(a, almacenes)}</div>
                {a.sede && <div className="saldo" style={{ fontSize: '.75rem' }}>{a.sede}</div>}
              </button>
            ))}
          </div>
        </>
      )}

      {!loading && almacen && !canWrite && (
        <div className="card" style={{ margin: '.75rem 0', borderLeft: '3px solid var(--warning)' }}>
          👁 Tu rol solo puede ver. Para cargar productos hace falta escritura en Inventario.
        </div>
      )}

      {!loading && almacen && paso === 'inicio' && puedeAqui && (
        <div className="surt-acciones">
          <button type="button" className="surt-btn primario" onClick={() => setPaso('nuevo')}>
            <span className="icono" aria-hidden>＋</span>
            <span>Producto nuevo</span>
            <small>Algo que todavía no está en el inventario</small>
          </button>
          <button type="button" className="surt-btn entrada" style={{ gridColumn: '1 / -1' }}
            onClick={() => { setElegido(null); setBusca(''); setPaso('entrada'); }}>
            <span className="icono" aria-hidden>⬇</span>
            <span>Entrada</span>
            <small>Llegó más de un producto que ya existe</small>
          </button>
        </div>
      )}

      {paso === 'nuevo' && almacenObj && (
        <FormNuevo almacen={almacenObj.nombre} productos={productos} categorias={categorias} unidades={unidades}
          actor={actor} actorName={actorName}
          onUsarExistente={(p) => { setElegido(p); setPaso('entrada'); }}
          onCancel={volver}
          onSaved={async () => { volver(); await reload().catch(() => {}); }} />
      )}

      {paso === 'entrada' && elegido && almacenObj && (
        <FormEntrada producto={elegido} almacen={almacenObj.nombre}
          stockAqui={enAlmacen.find((x) => x.producto.id === elegido.id)?.stock ?? 0}
          actor={actor} actorName={actorName}
          onCancel={() => setElegido(null)}
          onSaved={async () => { volver(); await reload().catch(() => {}); }} />
      )}

      {almacen && (paso === 'inicio' || (paso === 'entrada' && !elegido)) && (
        <section className="surt-lista">
          {paso === 'entrada' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '.5rem 0' }}>
              <strong style={{ fontSize: '1.1rem' }}>⬇ ¿A qué producto le llegó?</strong>
              <button type="button" className="btn btn-ghost" onClick={volver}>Cancelar</button>
            </div>
          )}
          <input className="input surt-input" type="search" name="inv-buscar" placeholder="🔍 Buscar producto…"
            value={busca} onChange={(e) => setBusca(e.target.value)} autoComplete="off" />
          <h2>
            {busca.trim()
              ? `${lista.length} encontrado(s)`
              : paso === 'entrada'
                ? 'Buscá el producto por nombre o código'
                : `En ${almacen} (${enAlmacen.length})${enAlmacen.length > SIN_BUSCAR ? ` · se ven ${SIN_BUSCAR}, buscá para ver el resto` : ''}`}
          </h2>
          {!loading && paso === 'inicio' && !enAlmacen.length && <p className="muted">Este almacén no tiene productos todavía. Cargá el primero con «Producto nuevo».</p>}
          {lista.map(({ producto: p, stock }) => (
            <button key={p.id} type="button" className="surt-mov"
              onClick={() => { if (puedeAqui) { setElegido(p); setPaso('entrada'); } }}
              disabled={!puedeAqui}>
              <span className="icono" aria-hidden>📦</span>
              <span style={{ minWidth: 0 }}>
                <div className="titulo">{p.nombre}</div>
                <div className="sub">{p.sku} · {p.categoria}</div>
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1.1rem', textAlign: 'right' }}>
                {num(stock)} <small style={{ fontWeight: 600 }}>{p.unidad}</small>
              </span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

function FormNuevo({ almacen, productos, categorias, unidades, actor, actorName, onUsarExistente, onCancel, onSaved }: {
  almacen: string; productos: Producto[]; categorias: string[]; unidades: string[]; actor: string; actorName: string | null;
  onUsarExistente: (p: Producto) => void; onCancel: () => void; onSaved: () => Promise<void>;
}) {
  const [nombre, setNombre] = useState('');
  const [categoria, setCategoria] = useState('');
  const [unidad, setUnidad] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState('');
  const [guardando, setGuardando] = useState(false);

  // Antes de crear uno nuevo: ¿ya existe algo con ese nombre? Duplicar fichas es
  // lo que más ensucia el inventario; mejor sumarle la entrada al que ya está.
  const parecidos = useMemo(
    () => (nombre.trim().length >= 3 ? productosSimilares(nombre, productos, { limite: 3 }) : []),
    [nombre, productos],
  );

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const n = nombre.trim().toUpperCase();
    const cant = Number(cantidad.replace(',', '.')) || 0;
    const precio = Math.max(0, Number(costo.replace(',', '.')) || 0);
    if (!n) return toast('Escribí el nombre del producto.', 'error');
    if (!categoria) return toast('Elegí la categoría.', 'error');
    if (!unidad) return toast('Elegí la unidad (kg, und, saco…).', 'error');
    if (cant < 0) return toast('La cantidad no puede ser negativa.', 'error');
    setGuardando(true);
    try {
      const sku = await siguienteSkuGlobal(categoria);
      if (await findBySku(sku)) throw new Error('El código del producto chocó con otro. Tocá «Guardar» de nuevo.');
      const creado = await createProducto({
        sku, nombre: n, categoria, unidad, stock: 0, stock_min: 0, precio, almacen, estado: 'activo', espacio: 'principal',
      });
      if (cant > 0) {
        await registrarMovimiento({
          producto_id: creado.id, tipo: 'creacion', delta: cant, almacen,
          actor, actor_name: actorName,
          detalle: `Stock inicial al dar de alta el producto · almacén ${almacen} (teléfono)`,
          precio_unitario: precio,
        });
      } else {
        // Sin stock: igual se ancla al almacén, si no queda invisible en la vista por sede.
        await crearExistenciaInicial(creado.id, almacen, precio);
      }
      toast(`Cargado en ${almacen}: ${sku} · ${n}`, 'success');
      await onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo guardar', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="surt-form" onSubmit={(e) => void guardar(e)}>
      <div className="surt-form-titulo"><span className="icono" aria-hidden>＋</span><strong>Producto nuevo · {almacen}</strong></div>
      <div className="surt-campo">
        <label htmlFor="inv-nombre">Nombre</label>
        <input id="inv-nombre" className="input surt-input" value={nombre} onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej.: MANGUERA 2 PULGADAS" autoComplete="off" autoFocus />
        {parecidos.length > 0 && (
          <div className="card" style={{ marginTop: '.4rem', padding: '.5rem .7rem', borderLeft: '3px solid var(--warning)' }}>
            <div style={{ fontSize: '.85rem', marginBottom: '.3rem' }}>⚠ ¿Es alguno de estos? Si ya existe, cargale una entrada en vez de crearlo:</div>
            {parecidos.map((d) => (
              <button key={d.producto.id} type="button" className="btn btn-sm btn-ghost" style={{ display: 'block', width: '100%', textAlign: 'left' }}
                onClick={() => onUsarExistente(d.producto as Producto)}>
                ⬇ {d.producto.nombre} <span className="muted">· {(d.producto as Producto).sku}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="surt-grid2">
        <div className="surt-campo">
          <label htmlFor="inv-categoria">Categoría</label>
          <select id="inv-categoria" className="input surt-input" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Elegir…</option>
            {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="surt-campo">
          <label htmlFor="inv-unidad">Unidad</label>
          <select id="inv-unidad" className="input surt-input" value={unidad} onChange={(e) => setUnidad(e.target.value)}>
            <option value="">Elegir…</option>
            {unidades.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>
      <div className="surt-campo">
        <label htmlFor="inv-cantidad">¿Cuánto hay?</label>
        <input id="inv-cantidad" className="input surt-litros" inputMode="decimal" value={cantidad}
          onChange={(e) => setCantidad(e.target.value)} placeholder="0" />
        <small className="muted">Lo que entra hoy al almacén. Si no llegó nada todavía, dejalo en 0.</small>
      </div>
      <div className="surt-campo">
        <label htmlFor="inv-costo">Costo c/u (USD)</label>
        <input id="inv-costo" className="input surt-input" inputMode="decimal" value={costo}
          onChange={(e) => setCosto(e.target.value)} placeholder="Opcional" />
      </div>
      <button type="submit" className="btn btn-primary surt-guardar" disabled={guardando}>{guardando ? 'Guardando…' : '✓ Guardar producto'}</button>
      <button type="button" className="btn btn-ghost btn-grande" onClick={onCancel} disabled={guardando}>Cancelar</button>
    </form>
  );
}

function FormEntrada({ producto, almacen, stockAqui, actor, actorName, onCancel, onSaved }: {
  producto: Producto; almacen: string; stockAqui: number; actor: string; actorName: string | null;
  onCancel: () => void; onSaved: () => Promise<void>;
}) {
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [costo, setCosto] = useState('');
  const [guardando, setGuardando] = useState(false);
  const cant = Number(cantidad.replace(',', '.')) || 0;
  const MOTIVOS = ['Llegó del proveedor', 'Devolución de material', 'Conteo físico (sobrante)'];

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (cant <= 0) return toast('Escribí cuánto llegó.', 'error');
    // El motivo es obligatorio en toda entrada manual (lo exige el sistema).
    if (motivo.trim().length < MOTIVO_MINIMO) return toast(`Escribí el motivo de la entrada (mínimo ${MOTIVO_MINIMO} letras).`, 'error');
    const precio = Number(costo.replace(',', '.')) || 0;
    setGuardando(true);
    try {
      await registrarMovimiento({
        producto_id: producto.id, tipo: 'entrada', delta: cant, almacen,
        actor, actor_name: actorName,
        detalle: `${motivo.trim()} · ${almacen} (teléfono)`,
        ...(precio > 0 ? { precio_unitario: precio } : {}),
      });
      toast(`Entrada: +${num(cant)} ${producto.unidad} de ${producto.nombre}`, 'success');
      await onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo guardar', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="surt-form" onSubmit={(e) => void guardar(e)}>
      <div className="surt-form-titulo"><span className="icono" aria-hidden>⬇</span><strong>Entrada · {producto.nombre}</strong></div>
      <div className="muted">{producto.sku} · en {almacen} hay {num(stockAqui)} {producto.unidad}</div>
      <div className="surt-campo">
        <label htmlFor="inv-entrada-cant">¿Cuánto llegó? ({producto.unidad})</label>
        <input id="inv-entrada-cant" className="input surt-litros" inputMode="decimal" value={cantidad}
          onChange={(e) => setCantidad(e.target.value)} placeholder="0" autoFocus />
        {cant > 0 && <small className="muted">Queda en {num(stockAqui + cant)} {producto.unidad}.</small>}
      </div>
      <div className="surt-campo">
        <label htmlFor="inv-entrada-motivo">Motivo</label>
        <input id="inv-entrada-motivo" className="input surt-input" value={motivo} onChange={(e) => setMotivo(e.target.value)}
          placeholder="De dónde vino, quién lo trajo…" autoComplete="off" />
        <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginTop: '.35rem' }}>
          {MOTIVOS.map((m) => <button key={m} type="button" className="btn btn-sm btn-ghost" onClick={() => setMotivo(m)}>{m}</button>)}
        </div>
      </div>
      <div className="surt-campo">
        <label htmlFor="inv-entrada-costo">Costo c/u (USD)</label>
        <input id="inv-entrada-costo" className="input surt-input" inputMode="decimal" value={costo}
          onChange={(e) => setCosto(e.target.value)} placeholder="Opcional: si se sabe, ajusta el costo promedio" />
      </div>
      <button type="submit" className="btn btn-primary surt-guardar" disabled={guardando || cant <= 0}>{guardando ? 'Guardando…' : '✓ Guardar entrada'}</button>
      <button type="button" className="btn btn-ghost btn-grande" onClick={onCancel} disabled={guardando}>← Otro producto</button>
    </form>
  );
}
