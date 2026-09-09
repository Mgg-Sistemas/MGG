import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dateTime } from '@/shared/lib/format';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { AlmacenPicker } from '@/modules/inventario/AlmacenPicker';
import { createProducto, getUnidades, getCategorias, addCategoria, siguienteSku } from '@/modules/inventario/inventario.repository';
import { normalizarNombre, productosSimilares, type Duplicado } from '@/modules/inventario/duplicados';
import { crearOrden, ensureUnidadSolicitante, ultimaOrdenMercado, FINALIDAD_MERCADO } from './pedidos.repository';
import type { ItemOrden, Producto, Usuario } from '@/shared/lib/types';

/** Valores precargados (editables) de la Solicitud de Mercado. */
const UNIDAD_DEFAULT = 'COCINA';
const SOLICITANTE_DEFAULT = 'COCINA';

/** Quita acentos y pasa a minúsculas para comparar categorías de forma tolerante. */
const norm = (s: string) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Categorías que entran al mercado: lo que se va a comprar para la cocina.
 * Además de los víveres van las HORTALIZAS Y LEGUMBRES —el monte, los verdes—,
 * que se compran en el mismo mercado y hasta ahora quedaban fuera de la lista
 * aunque la cocina sí las consume.
 */
export const CATEGORIAS_MERCADO = ['viveres', 'hortalizas'];

/** ¿La categoría se compra en el mercado? Tolerante a acentos y a variantes. */
export function esCategoriaMercado(categoria?: string | null): boolean {
  const c = norm(categoria ?? '');
  return CATEGORIAS_MERCADO.some((k) => c.includes(k));
}

interface Props {
  productos: Producto[];
  usuario: Usuario | null;
  authEmail: string;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * SOLICITUD DE MERCADO (botón independiente en Pedidos). Trae TODOS los productos
 * de las categorías del mercado —«Víveres y Art. de Limpieza» y «Hortalizas y Legumbres»—
 * como checklist con cantidades editables,
 * precargada para COCINA y marcada como ORDEN URGENTE. Al aceptar crea una SP
 * (finalidad = reposición de mercado) que entra al flujo normal de Pedidos.
 */
export function SolicitudMercadoModal({ productos, usuario, authEmail, onClose, onCreated }: Props) {
  const email = usuario?.email ?? authEmail;
  const viveres = useMemo(
    () => productos.filter((p) => p.estado !== 'inactivo' && esCategoriaMercado(p.categoria)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [productos],
  );

  const [unidad, setUnidad] = useState(UNIDAD_DEFAULT);
  const [persona, setPersona] = useState(SOLICITANTE_DEFAULT);
  const [nota, setNota] = useState('');
  // sku → { check, cantidad(texto) }. Todos vienen marcados (traer todo) con cantidad 1;
  // luego se reemplaza por la cantidad SUGERIDA de la última compra de mercado (si la hubo).
  const [sel, setSel] = useState<Record<string, { check: boolean; cant: string }>>(() => {
    const init: Record<string, { check: boolean; cant: string }> = {};
    for (const p of viveres) init[p.sku] = { check: true, cant: '1' };
    return init;
  });
  const [guardando, setGuardando] = useState(false);
  // Info de la última compra de mercado, de donde salen las cantidades sugeridas.
  const [ultima, setUltima] = useState<{ codigo: string; fecha?: string | null } | null>(null);

  /* ── Agregados a mano ──
     La lista fija trae las categorías del mercado, pero la cocina también pide
     cosas que viven en otra categoría (una escoba, un repuesto del filtro de
     agua) o que todavía no existen en el inventario. Antes había que salir del
     modal, cargarlo en Inventario y volver a empezar. Estos «extras» se suman a
     la misma lista y se piden igual. */
  const [extras, setExtras] = useState<Producto[]>([]);
  const [agregarId, setAgregarId] = useState('');

  // Alta de un producto que no existe todavía.
  const [nuevoOpen, setNuevoOpen] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoCategoria, setNuevoCategoria] = useState('');
  const [nuevoUnidad, setNuevoUnidad] = useState('und');
  const [nuevoAlmacen, setNuevoAlmacen] = useState('');
  const [creandoNuevo, setCreandoNuevo] = useState(false);
  const [avisadoPara, setAvisadoPara] = useState<string | null>(null);
  const [medidas, setMedidas] = useState<string[]>([]);
  const [categoriasInv, setCategoriasInv] = useState<string[]>([]);
  useEffect(() => {
    getUnidades(productos).then(setMedidas).catch(() => { /* usa los defaults del repo */ });
    getCategorias(productos).then(setCategoriasInv).catch(() => setCategoriasInv([]));
  }, [productos]);

  /* El mismo detector de parecidos que usa el alta de Inventario. Acá hace falta
     igual: dos fichas del mismo víver parten el kardex y el costo promedio. */
  const similares = useMemo<Duplicado<Producto>[]>(
    () => (nuevoOpen ? productosSimilares(nuevoNombre, productos) : []),
    [nuevoOpen, nuevoNombre, productos],
  );

  /**
   * La lista que se pide: las categorías del mercado + lo agregado a mano, SIN repetir.
   * Un producto nuevo creado acá puede caer después en una categoría del mercado y
   * entrar por los dos lados; sin este filtro saldría dos veces en la tabla.
   */
  const lista = useMemo(() => {
    const vistos = new Set<string>();
    const out: Producto[] = [];
    for (const p of [...viveres, ...extras]) {
      if (vistos.has(p.id)) continue;
      vistos.add(p.id);
      out.push(p);
    }
    return out;
  }, [viveres, extras]);

  /** Lo que se puede agregar: cualquier producto activo que no esté ya en la lista. */
  const opcionesAgregar = useMemo(() => {
    const yaEsta = new Set(lista.map((p) => p.id));
    return productos
      .filter((p) => p.estado !== 'inactivo' && !yaEsta.has(p.id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .map((p) => ({ value: p.id, label: `${p.nombre} · ${p.sku}${p.categoria ? ` · ${p.categoria}` : ''}` }));
  }, [productos, lista]);

  /** Suma un producto del inventario a la lista, ya marcado y con cantidad 1. */
  function agregarDelInventario(id: string) {
    const p = productos.find((x) => x.id === id);
    setAgregarId('');
    if (!p) return;
    if (lista.some((x) => x.id === p.id)) { toast(`"${p.nombre}" ya está en la lista`, 'info'); return; }
    setExtras((xs) => [...xs, p]);
    setSel((m) => ({ ...m, [p.sku]: { check: true, cant: m[p.sku]?.cant ?? '1' } }));
    toast(`"${p.nombre}" agregado a la solicitud`, 'success');
  }

  /** Saca de la lista algo agregado a mano (lo fijo del mercado no se quita, se desmarca). */
  function quitarExtra(id: string) {
    setExtras((xs) => xs.filter((x) => x.id !== id));
  }

  async function crearProductoNuevo() {
    const nombre = nuevoNombre.trim().toUpperCase();
    if (!nombre) { toast('Escribí el nombre del producto', 'error'); return; }
    if (!nuevoCategoria.trim()) { toast('Elegí la categoría: define el código del producto', 'error'); return; }
    // Con parecidos, el primer clic avisa y el segundo crea. Avisa, no bloquea:
    // puede ser de verdad otro material y un aviso que no deja pasar estorba.
    if (similares.length && avisadoPara !== normalizarNombre(nombre)) {
      setAvisadoPara(normalizarNombre(nombre));
      toast(
        similares.some((d) => d.nivel === 'exacto')
          ? 'Ese producto ya existe con el mismo nombre. Mirá la lista de abajo: si es el mismo, usá «Usar este». Si de verdad es otro, tocá «Crear» de nuevo.'
          : `Hay ${similares.length} producto(s) parecido(s) en el inventario. Revisá la lista y, si igual es otro, tocá «Crear» de nuevo.`,
        'warning',
      );
      return;
    }
    setCreandoNuevo(true);
    try {
      const categoria = nuevoCategoria.trim().toUpperCase();
      if (categoria && !categoriasInv.some((c) => c.toLowerCase() === categoria.toLowerCase())) {
        try { await addCategoria(categoria, email); setCategoriasInv((prev) => [...prev, categoria]); } catch { /* duplicado o red: no bloquea */ }
      }
      const creado = await createProducto({
        sku: siguienteSku(categoria, productos),
        nombre,
        categoria,
        unidad: nuevoUnidad.trim() || 'und',
        stock: 0,
        stock_min: 0,
        precio: 0,
        // Sin fallback a «General»: ese almacén legado es donde los productos se pierden.
        almacen: nuevoAlmacen.trim(),
        estado: 'activo',
      });
      setExtras((xs) => [...xs, creado]);
      setSel((m) => ({ ...m, [creado.sku]: { check: true, cant: '1' } }));
      toast(`"${creado.nombre}" (${creado.sku}) creado y agregado`, 'success');
      setNuevoNombre(''); setNuevoOpen(false); setAvisadoPara(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo crear el producto', 'error');
    } finally {
      setCreandoNuevo(false);
    }
  }

  // Al abrir, trae la ÚLTIMA compra de mercado y precarga la cantidad de cada víver
  // que ya se compró antes (por SKU, con respaldo por productoId). El resto queda en 1.
  useEffect(() => {
    let vivo = true;
    ultimaOrdenMercado()
      .then((o) => {
        if (!vivo || !o) return;
        const porSku = new Map<string, number>();
        const porId = new Map<string, number>();
        for (const it of o.items ?? []) {
          const c = Number(it.cantidad) || 0;
          if (c <= 0) continue;
          if (it.sku) porSku.set(it.sku, c);
          if (it.productoId) porId.set(it.productoId, c);
        }
        setSel((m) => {
          const n = { ...m };
          for (const p of viveres) {
            const sug = porSku.get(p.sku) ?? porId.get(p.id);
            if (sug != null) n[p.sku] = { check: n[p.sku]?.check ?? true, cant: String(sug) };
          }
          return n;
        });
        setUltima({ codigo: o.codigo, fecha: o.created_at });
      })
      .catch(() => { /* sin sugerencias: quedan en 1 */ });
    return () => { vivo = false; };
  }, [viveres]);

  const marcados = lista.filter((p) => sel[p.sku]?.check).length;

  function toggle(sku: string) {
    setSel((m) => ({ ...m, [sku]: { check: !(m[sku]?.check ?? false), cant: m[sku]?.cant ?? '1' } }));
  }
  function setCant(sku: string, cant: string) {
    setSel((m) => ({ ...m, [sku]: { check: m[sku]?.check ?? true, cant } }));
  }
  function marcarTodos(v: boolean) {
    setSel((m) => {
      const n = { ...m };
      for (const p of lista) n[p.sku] = { check: v, cant: n[p.sku]?.cant ?? '1' };
      return n;
    });
  }

  async function crear() {
    const items: ItemOrden[] = [];
    for (const p of lista) {
      const s = sel[p.sku];
      if (!s?.check) continue;
      const cant = Number(String(s.cant ?? '').replace(',', '.'));
      if (!Number.isFinite(cant) || cant <= 0) { toast(`Indicá una cantidad válida para "${p.nombre}"`, 'error'); return; }
      items.push({ productoId: p.id, sku: p.sku, nombre: p.nombre, cantidad: Math.round(cant * 1000) / 1000, precio: 0, unidad: p.unidad, comprar: true });
    }
    if (!items.length) { toast('Marcá al menos un producto', 'error'); return; }
    if (!unidad.trim()) { toast('Indicá la unidad solicitante', 'error'); return; }

    setGuardando(true);
    try {
      try { await ensureUnidadSolicitante(unidad.trim(), email); } catch { /* ya existe */ }
      const saved = await crearOrden({
        proveedor_id: null,
        items,
        notas: nota.trim() || null,
        motivo: null,
        finalidad: FINALIDAD_MERCADO,
        clasificacion: ['Mercado'],
        solicitante_email: email,
        solicitante: unidad.trim(),
        ci_solicitante: persona.trim() || null,
        urgente: true,
      });
      notify(`Solicitud de MERCADO ${saved.codigo} · URGENTE enviada para aprobación`, 'success', { link: '#/app/pedidos', destino: 'admin' });
      toast(`Solicitud de mercado ${saved.codigo} creada`, 'success');
      onCreated();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo crear la solicitud', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title="🛒 Solicitud de Mercado"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => void crear()} disabled={guardando || !marcados}>
            {guardando ? 'Creando…' : `Crear solicitud${marcados ? ` (${marcados})` : ''}`}
          </button>
        </>
      }
    >
      <div className="card" style={{ margin: '0 0 .8rem', padding: '.6rem .85rem', borderColor: 'var(--danger)', background: 'rgba(239,68,68,.08)' }}>
        🚨 <strong>Se marca como ORDEN URGENTE.</strong> <span className="muted" style={{ fontSize: '.82rem' }}>Reposición de víveres y artículos de limpieza para la cocina.</span>
      </div>

      <div className="form-grid">
        <div className="form-row">
          <label>Unidad solicitante</label>
          <input className="input" value={unidad} onChange={(e) => setUnidad(e.target.value.toUpperCase())} />
        </div>
        <div className="form-row">
          <label>Solicitado por</label>
          <input className="input" value={persona} onChange={(e) => setPersona(e.target.value.toUpperCase())} />
        </div>
      </div>

      <div className="form-row">
        <label>Nota <span className="muted" style={{ fontWeight: 400 }}>(opcional)</span></label>
        <textarea className="textarea" value={nota} onChange={(e) => setNota(e.target.value)} rows={2}
          placeholder="Observación de la solicitud de mercado (opcional)…" />
      </div>

      <div className="form-row">
        <label>Víveres, Art. de Limpieza y Hortalizas <span className="muted" style={{ fontWeight: 400 }}>· marcá los que se piden e indicá la cantidad</span></label>
        {ultima && (
          <small className="muted" style={{ display: 'block', margin: '-.2rem 0 .5rem', fontSize: '.76rem' }}>
            🧾 Cantidades sugeridas de la última compra <strong className="mono">{ultima.codigo}</strong>{ultima.fecha ? <> · {dateTime(ultima.fecha)}</> : null} (editables).
          </small>
        )}
        {/* Agregar lo que no está en la lista fija: cualquier producto del inventario,
            o uno nuevo que todavía no existe. */}
        <div className="card" style={{ margin: '0 0 .6rem', padding: '.6rem .75rem', display: 'grid', gap: '.5rem' }}>
          <div>
            <div className="muted" style={{ fontSize: '.76rem', marginBottom: '.3rem' }}>
              ¿Falta algo? Agregá <strong>cualquier producto del inventario</strong>, aunque no sea de estas categorías.
            </div>
            <SearchSelect value={agregarId} onChange={agregarDelInventario} options={opcionesAgregar}
              placeholder="🔎 Buscá el producto por nombre, código o categoría…" sinPreseleccion
              emptyText="No queda ningún producto activo fuera de la lista." />
          </div>
          <div>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNuevoOpen((v) => !v)}>
              {nuevoOpen ? '× Cerrar' : '+ Producto nuevo (no existe en inventario)'}
            </button>
            {nuevoOpen && (
              <div className="card" style={{ padding: '.65rem', marginTop: '.4rem', display: 'grid', gap: '.5rem' }}>
                <div className="muted" style={{ fontSize: '.78rem' }}>
                  Datos mínimos. Se crea en el inventario y queda agregado a esta solicitud; el resto (stock, precio) se completa al recibirlo.
                </div>
                <input className="input" placeholder="Nombre del producto *" value={nuevoNombre}
                  onChange={(e) => setNuevoNombre(e.target.value.toUpperCase())} />

                {similares.length > 0 && (
                  <div className="card" style={{ padding: '.6rem .8rem', borderColor: 'var(--warning)', background: 'var(--bg-1)' }}>
                    <div style={{ fontSize: '.86rem', fontWeight: 600, marginBottom: '.15rem' }}>
                      ⚠️ {similares.length === 1 ? 'Ya existe un producto parecido' : `Ya existen ${similares.length} productos parecidos`}
                    </div>
                    <div className="muted" style={{ fontSize: '.76rem', marginBottom: '.45rem' }}>
                      Dos fichas del mismo víver parten el kardex y el costo promedio, y después nadie sabe cuál es el bueno.
                      Si es el mismo, usá <strong>«Usar este»</strong>. Si de verdad es otro, tocá <strong>«Crear»</strong> otra vez.
                    </div>
                    <div className="table-wrap">
                      <table className="table" style={{ fontSize: '.8rem' }}>
                        <thead><tr><th>SKU</th><th>Producto</th><th /></tr></thead>
                        <tbody>
                          {similares.map(({ producto: sp, nivel }) => (
                            <tr key={sp.id}>
                              <td className="mono">{sp.sku}</td>
                              <td>
                                <strong>{sp.nombre}</strong>
                                {nivel === 'exacto' && (
                                  <span className="badge" style={{ marginLeft: '.35rem', color: 'var(--danger)', borderColor: 'var(--danger)' }}>mismo nombre</span>
                                )}
                                <div className="muted" style={{ fontSize: '.72rem' }}>
                                  {sp.categoria ?? '—'} · {sp.unidad ?? '—'}
                                  {sp.estado !== 'activo' && (
                                    <span className="badge" style={{ marginLeft: '.35rem', color: 'var(--warning)', borderColor: 'var(--warning)' }}>dado de baja</span>
                                  )}
                                </div>
                              </td>
                              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                {sp.estado === 'activo' ? (
                                  <button type="button" className="btn btn-sm" onClick={() => { agregarDelInventario(sp.id); setNuevoNombre(''); setNuevoOpen(false); }}>
                                    Usar este
                                  </button>
                                ) : (
                                  <span className="dim" style={{ fontSize: '.72rem' }}>reactivar en Inventario</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="form-grid">
                  <div>
                    <input className="input" list="mercado-categorias" placeholder="Categoría * (elegí o escribí una nueva)"
                      value={nuevoCategoria} onChange={(e) => setNuevoCategoria(e.target.value.toUpperCase())} />
                    <small className="muted" style={{ fontSize: '.72rem' }}>Define el código: HORTALIZAS Y LEGUMBRES → HTL-007.</small>
                    <datalist id="mercado-categorias">
                      {categoriasInv.map((c) => <option key={c} value={c} />)}
                    </datalist>
                  </div>
                  <select className="select" value={nuevoUnidad} onChange={(e) => setNuevoUnidad(e.target.value)}>
                    {!medidas.includes(nuevoUnidad) && nuevoUnidad && <option value={nuevoUnidad}>{nuevoUnidad}</option>}
                    {medidas.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <AlmacenPicker value={nuevoAlmacen} onChange={setNuevoAlmacen} sedeLabel="Sede" label="Almacén destino" />
                <div>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => void crearProductoNuevo()}
                    disabled={creandoNuevo || !nuevoNombre.trim() || !nuevoCategoria.trim()}>
                    {creandoNuevo
                      ? 'Creando…'
                      : similares.length && avisadoPara !== normalizarNombre(nuevoNombre)
                        ? 'Crear igual (hay parecidos)'
                        : 'Crear y agregar'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {!lista.length ? (
          <EmptyState icon="◇" message="No hay productos activos en «Víveres y Art. de Limpieza» ni en «Hortalizas y Legumbres». Agregá alguno del inventario acá arriba, o cargalo primero en Inventario." />
        ) : (
          <>
            <div style={{ display: 'flex', gap: '.4rem', margin: '0 0 .4rem' }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => marcarTodos(true)}>✓ Marcar todos</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => marcarTodos(false)}>✕ Desmarcar todos</button>
              <span className="muted" style={{ marginLeft: 'auto', fontSize: '.8rem', alignSelf: 'center' }}>{marcados} de {lista.length}</span>
            </div>
            <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
              <table className="table" style={{ fontSize: '.85rem' }}>
                <thead><tr>
                  <th style={{ width: 34 }}>✓</th>
                  <th>Producto</th>
                  <th style={{ textAlign: 'right' }}>Stock</th>
                  <th style={{ width: 150, textAlign: 'right' }}>Cantidad a pedir</th>
                </tr></thead>
                <tbody>
                  {lista.map((p) => {
                    const s = sel[p.sku] ?? { check: true, cant: '1' };
                    const agregado = extras.some((x) => x.id === p.id);
                    return (
                      <tr key={p.id} style={{ background: s.check ? 'rgba(255,138,0,.08)' : undefined }}>
                        <td><input type="checkbox" checked={s.check} onChange={() => toggle(p.sku)} /></td>
                        <td>
                          <strong>{p.nombre}</strong>
                          {agregado && (
                            <button type="button" className="btn btn-sm btn-ghost" style={{ marginLeft: '.35rem', padding: '0 .3rem', fontSize: '.7rem' }}
                              onClick={() => quitarExtra(p.id)} title="Quitar de la solicitud">✕</button>
                          )}
                          <div className="muted mono" style={{ fontSize: '.72rem' }}>
                            {p.sku}{agregado ? ' · agregado' : ''}
                          </div>
                        </td>
                        <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{p.stock} {p.unidad}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center' }}>
                            <input className="input mono" type="number" min={0} step="any" disabled={!s.check}
                              style={{ width: 84, textAlign: 'right', fontWeight: 700 }}
                              value={s.cant} onChange={(e) => setCant(p.sku, e.target.value)} />
                            <span className="muted" style={{ fontSize: '.72rem', minWidth: 34, textAlign: 'left' }}>{p.unidad}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <p className="hint muted" style={{ fontSize: '.78rem', marginTop: '.5rem' }}>
        Se crea una <strong>Solicitud de Pedido</strong> (finalidad: {FINALIDAD_MERCADO}) sin monto; el precio lo fija el proveedor al cotizar. Entra al módulo de Pedidos para aprobación.
      </p>
    </Modal>
  );
}
