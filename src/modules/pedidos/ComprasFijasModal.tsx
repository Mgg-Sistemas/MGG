/* ============================================================
   MGG · Compras FIJAS (12-11-2026, de Golden Touch) · tablero, editor e historial.
   Una tarjeta por compra fija (Mercado, Papelería, Carnes, Pollo…) con su
   frecuencia, la última vez y la próxima fecha en semáforo. «Generar» arma la
   solicitud precargada (o la compra directa) con las cantidades de la última vez.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { useRealtime } from '@/shared/lib/useRealtime';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { money } from '@/shared/lib/format';
import type { Producto, Proveedor } from '@/shared/lib/types';
import {
  FRECUENCIAS, entraPorCategoria, errorPlantilla, estadoFija, textoEstadoFija, textoFrecuencia,
  type CompraFija, type EstadoFija, type FrecuenciaFija, type ProductoFijo,
} from './comprasFijas';
import {
  MSG_FALTA_SQL_COMPRAS_FIJAS, eliminarCompraFija, guardarCompraFija, historialCompraFija, listComprasFijas,
  type CompraFijaEditable, type GeneradaFija,
} from './comprasFijas.repository';

const COLOR: Record<EstadoFija, string> = {
  vencida: 'danger', hoy: 'warning', pronto: 'warning', al_dia: 'success', pausada: 'muted', sugerida: 'info',
};
const fecha = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-VE') : '—');

const NUEVA: CompraFijaEditable = {
  nombre: '', icono: '🔁', frecuencia: 'mensual', cada_dias: null, proxima_fecha: hoyVenezuela(), activa: true,
  modo: 'solicitud', permite_cotizar: true, solicitante: '', unidad_solicitante: '', finalidad: '', urgente: false,
  proveedor_id: null, proveedor_nombre: null, categorias: [], productos: [], nota: '', orden: 0, sugerida: false,
};

export function ComprasFijasModal({ productos, proveedores, puedeEditar, onGenerarSolicitud, onGenerarDirecta, onClose }: {
  productos: Producto[];
  proveedores: Proveedor[];
  puedeEditar: boolean;
  onGenerarSolicitud: (c: CompraFija) => void;
  onGenerarDirecta: (c: CompraFija) => Promise<void>;
  onClose: () => void;
}) {
  const [lista, setLista] = useState<CompraFija[] | null>(null);
  const [disponible, setDisponible] = useState(true);
  const [editando, setEditando] = useState<{ id: string | null; datos: CompraFijaEditable } | null>(null);
  const [historial, setHistorial] = useState<{ c: CompraFija; filas: GeneradaFija[] | null } | null>(null);
  const [generando, setGenerando] = useState<string | null>(null);
  const hoy = hoyVenezuela();

  const cargar = useCallback(async () => {
    try {
      const r = await listComprasFijas();
      setLista(r.lista); setDisponible(r.disponible);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron leer las compras fijas', 'error');
      setLista([]);
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['compras_fijas'], () => { void cargar(); });

  async function directa(c: CompraFija) {
    setGenerando(c.id);
    try { await onGenerarDirecta(c); } finally { setGenerando(null); }
  }

  async function verHistorial(c: CompraFija) {
    setHistorial({ c, filas: null });
    try { setHistorial({ c, filas: await historialCompraFija(c.id) }); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo leer el historial', 'error'); setHistorial({ c, filas: [] }); }
  }

  if (editando) {
    return (
      <EditorCompraFija inicial={editando.datos} id={editando.id} productos={productos} proveedores={proveedores}
        onClose={() => setEditando(null)} onGuardada={() => { setEditando(null); void cargar(); }} />
    );
  }

  if (historial) {
    const filas = historial.filas;
    const total = (filas ?? []).reduce((a, f) => a + (f.total ?? 0), 0);
    return (
      <Modal title={`🕘 ${historial.c.icono} ${historial.c.nombre} · historial`} size="lg" onClose={() => setHistorial(null)}
        footer={<button className="btn btn-primary" onClick={() => setHistorial(null)}>← Volver</button>}>
        {filas === null ? <p className="muted">Cargando…</p> : !filas.length ? <p className="muted">Todavía no se ha generado.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Fecha</th><th>Código</th><th>Tipo</th><th>Estatus</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={`${f.tipo}-${f.id}`}>
                    <td>{fecha(f.fecha)}</td>
                    <td className="mono">{f.codigo ?? '—'}</td>
                    <td>{f.tipo === 'orden' ? 'Solicitud / OC' : 'Compra directa'}</td>
                    <td>{f.estado}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{f.total ? money(f.total) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr style={{ fontWeight: 700 }}><td colSpan={4} style={{ textAlign: 'right' }}>Total</td><td className="mono" style={{ textAlign: 'right' }}>{money(total)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal title="🔁 Compras fijas" size="xl" onClose={onClose}
      footer={<>
        {puedeEditar && disponible && <button className="btn btn-ghost" onClick={() => setEditando({ id: null, datos: { ...NUEVA, proxima_fecha: hoy } })}>＋ Nueva compra fija</button>}
        <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
      </>}>
      <p className="muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Las compras que se repiten. Cuando a una le llega la fecha, Compras recibe el aviso en la campana. «Generar» abre la solicitud
        con las cantidades de la última vez (se pueden cambiar) y desde ahí sigue el flujo normal.
      </p>
      {(lista ?? []).some((c) => c.sugerida) && (
        <div className="card" style={{ borderLeft: '3px solid var(--info, #3b82f6)', padding: '.6rem .9rem', fontSize: '.84rem' }}>
          💡 Las marcadas como <strong>Sugerencia</strong> son ejemplos: no avisan ni se generan hasta que Compras las
          configure. Toca <strong>⚙ Configurar</strong>, revisa la frecuencia, las categorías o productos y la próxima fecha, y guárdala.
        </div>
      )}
      {!disponible && <div className="card" style={{ borderLeft: '3px solid var(--warning)' }}>⚠ {MSG_FALTA_SQL_COMPRAS_FIJAS}</div>}
      {lista === null ? <p className="muted">Cargando…</p> : (
        <div style={{ display: 'grid', gap: '.8rem', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {lista.map((c) => {
            const est = estadoFija(c, hoy);
            const aCotizar = c.modo === 'solicitud' || c.permite_cotizar;
            const color = COLOR[est] === 'muted' ? 'border' : COLOR[est] === 'info' ? 'info, #3b82f6' : COLOR[est];
            if (c.sugerida) {
              return (
                <div key={c.id} className="card" style={{ borderLeft: `4px dashed var(--${color})`, margin: 0, opacity: 0.85 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', alignItems: 'baseline' }}>
                    <strong style={{ fontSize: '1.05rem' }}>{c.icono} {c.nombre}</strong>
                    <span className="badge info">💡 Sugerencia</span>
                  </div>
                  <div className="muted" style={{ fontSize: '.82rem', margin: '.3rem 0' }}>
                    {textoFrecuencia(c)} · {c.modo === 'compra_directa' ? 'Compra directa' : 'Solicitud de pedido → OC'}
                    <br /><strong>Por configurar:</strong> no avisa ni se genera hasta que Compras la revise y la guarde.
                  </div>
                  {puedeEditar && (
                    <button className="btn btn-primary btn-sm" onClick={() => {
                      const { id, ultima_ref_tipo: _a, ultima_ref_id: _b, ultima_codigo: _c, ultima_generada_en: _d, ...datos } = c;
                      void _a; void _b; void _c; void _d;
                      // Al configurarla se activa (se puede dejar pausada destildando «Activa»).
                      setEditando({ id, datos: { ...datos, activa: true, proxima_fecha: datos.proxima_fecha < hoy ? hoy : datos.proxima_fecha } });
                    }}>⚙ Configurar</button>
                  )}
                </div>
              );
            }
            return (
              <div key={c.id} className="card" style={{ borderLeft: `4px solid var(--${color})`, opacity: c.activa ? 1 : 0.65, margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', alignItems: 'baseline' }}>
                  <strong style={{ fontSize: '1.05rem' }}>{c.icono} {c.nombre}</strong>
                  <span className={`badge ${COLOR[est]}`}>{textoEstadoFija(c, hoy)}</span>
                </div>
                <div className="muted" style={{ fontSize: '.82rem', margin: '.3rem 0' }}>
                  {textoFrecuencia(c)} · {c.modo === 'compra_directa' ? 'Compra directa' : 'Solicitud de pedido → OC'}
                  <br />Próxima: <strong>{fecha(c.proxima_fecha)}</strong>
                  {c.ultima_codigo && <> · Última: <span className="mono">{c.ultima_codigo}</span> ({fecha(c.ultima_generada_en)})</>}
                  {c.proveedor_nombre && <><br />Proveedor: {c.proveedor_nombre}</>}
                </div>
                <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginTop: '.4rem' }}>
                  {puedeEditar && c.activa && c.modo === 'compra_directa' && (
                    <button className="btn btn-primary btn-sm" disabled={generando === c.id} onClick={() => void directa(c)}>
                      {generando === c.id ? 'Generando…' : '⚡ Compra directa'}
                    </button>
                  )}
                  {puedeEditar && c.activa && aCotizar && (
                    <button className={`btn btn-sm ${c.modo === 'solicitud' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => onGenerarSolicitud(c)}>
                      {c.modo === 'solicitud' ? '📝 Generar solicitud' : '📝 Mandar a cotizar'}
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => void verHistorial(c)}>🕘 Historial</button>
                  {puedeEditar && (
                    <button className="btn btn-ghost btn-sm" onClick={() => {
                      const { id, ultima_ref_tipo: _a, ultima_ref_id: _b, ultima_codigo: _c, ultima_generada_en: _d, ...datos } = c;
                      void _a; void _b; void _c; void _d;
                      setEditando({ id, datos });
                    }}>✎ Editar</button>
                  )}
                </div>
              </div>
            );
          })}
          {!lista.length && disponible && <p className="muted">Todavía no hay compras fijas.</p>}
        </div>
      )}
    </Modal>
  );
}

function EditorCompraFija({ inicial, id, productos, proveedores, onClose, onGuardada }: {
  inicial: CompraFijaEditable; id: string | null; productos: Producto[]; proveedores: Proveedor[];
  onClose: () => void; onGuardada: () => void;
}) {
  const [d, setD] = useState<CompraFijaEditable>(inicial);
  const [catTxt, setCatTxt] = useState(inicial.categorias.join(', '));
  const [prodSel, setProdSel] = useState('');
  const [guardando, setGuardando] = useState(false);
  const set = <K extends keyof CompraFijaEditable>(k: K, v: CompraFijaEditable[K]) => setD((x) => ({ ...x, [k]: v }));
  const categorias = useMemo(() => catTxt.split(',').map((x) => x.trim()).filter(Boolean), [catTxt]);
  const porCategoria = useMemo(
    () => productos.filter((p) => p.estado === 'activo' && entraPorCategoria(p.categoria, categorias)),
    [productos, categorias],
  );
  const opciones = useMemo(() => productos.filter((p) => p.estado === 'activo' && !d.productos.some((f) => f.producto_id === p.id))
    .map((p) => ({ value: p.id, label: `${p.sku} · ${p.nombre}` })), [productos, d.productos]);

  function agregarProducto(pid: string) {
    const p = productos.find((x) => x.id === pid);
    if (!p) return;
    const nuevo: ProductoFijo = { producto_id: p.id, sku: p.sku, nombre: p.nombre, unidad: p.unidad, cantidad: 1 };
    set('productos', [...d.productos, nuevo]);
    setProdSel('');
  }

  async function guardar() {
    const datos = { ...d, categorias };
    const mal = errorPlantilla(datos);
    if (mal) { toast(mal, 'error'); return; }
    setGuardando(true);
    try {
      await guardarCompraFija(id, datos);
      toast('Compra fija guardada.', 'success');
      onGuardada();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error');
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!id || !window.confirm(`¿Eliminar la compra fija «${d.nombre}»? Las solicitudes ya generadas no se tocan.`)) return;
    setGuardando(true);
    try { await eliminarCompraFija(id); onGuardada(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); setGuardando(false); }
  }

  return (
    <Modal title={id ? `✎ ${d.icono} ${d.nombre}` : '＋ Nueva compra fija'} size="lg" onClose={onClose}
      footer={<>
        {id && <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={() => void eliminar()} disabled={guardando}>🗑 Eliminar</button>}
        <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
      </>}>
      <div style={{ display: 'grid', gap: '.6rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className="form-row" style={{ margin: 0 }}>
          <label>Nombre *</label>
          <div style={{ display: 'flex', gap: '.3rem' }}>
            <input className="input" style={{ width: '3.2rem', textAlign: 'center' }} value={d.icono} maxLength={4} onChange={(e) => set('icono', e.target.value)} aria-label="Ícono" />
            <input className="input" value={d.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Papelería, Pollo…" />
          </div>
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label>Cada cuánto</label>
          <select className="select" value={d.frecuencia} onChange={(e) => set('frecuencia', e.target.value as FrecuenciaFija)}>
            {FRECUENCIAS.map((f) => <option key={f.valor} value={f.valor}>{f.etiqueta}</option>)}
          </select>
          {d.frecuencia === 'cada_dias' && (
            <input className="input" type="number" min={1} max={365} style={{ marginTop: '.3rem' }} placeholder="Días"
              value={d.cada_dias ?? ''} onChange={(e) => set('cada_dias', Number(e.target.value) || null)} />
          )}
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label>Próxima fecha</label>
          <input className="input" type="date" value={d.proxima_fecha} onChange={(e) => set('proxima_fecha', e.target.value)} />
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label>Cómo se compra</label>
          <select className="select" value={d.modo} onChange={(e) => set('modo', e.target.value as CompraFijaEditable['modo'])}>
            <option value="solicitud">Solicitud de pedido (cotización → OC)</option>
            <option value="compra_directa">Compra directa</option>
          </select>
          {d.modo === 'compra_directa' && (
            <label style={{ display: 'flex', gap: '.35rem', alignItems: 'center', fontSize: '.82rem', marginTop: '.3rem' }}>
              <input type="checkbox" checked={d.permite_cotizar} onChange={(e) => set('permite_cotizar', e.target.checked)} />
              También se puede mandar a cotizar
            </label>
          )}
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label>Solicitante</label>
          <input className="input" value={d.solicitante ?? ''} onChange={(e) => set('solicitante', e.target.value)} placeholder="COCINA, ADMINISTRACIÓN…" />
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label>Unidad solicitante</label>
          <input className="input" value={d.unidad_solicitante ?? ''} onChange={(e) => set('unidad_solicitante', e.target.value)} />
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label>Finalidad</label>
          <input className="input" value={d.finalidad ?? ''} onChange={(e) => set('finalidad', e.target.value)} placeholder="Para qué es" />
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label>Proveedor habitual</label>
          <select className="select" value={d.proveedor_id ?? ''} onChange={(e) => {
            const p = proveedores.find((x) => x.id === e.target.value);
            setD((x) => ({ ...x, proveedor_id: p?.id ?? null, proveedor_nombre: p?.razon_social ?? null }));
          }}>
            <option value="">— Ninguno —</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.razon_social}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '.6rem 0' }}>
        <label style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}>
          <input type="checkbox" checked={d.urgente} onChange={(e) => set('urgente', e.target.checked)} /> Sale marcada como urgente
        </label>
        <label style={{ display: 'flex', gap: '.35rem', alignItems: 'center' }}>
          <input type="checkbox" checked={d.activa} onChange={(e) => set('activa', e.target.checked)} /> Activa (avisa cuando toca)
        </label>
      </div>

      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <div className="form-row" style={{ margin: 0 }}>
          <label>Categorías que entran (separadas por coma; basta una parte: «papel» trae PAPELERIA)</label>
          <input className="input" value={catTxt} onChange={(e) => setCatTxt(e.target.value)} placeholder="papel, materiales de oficina" />
          <small className="muted">
            Entran {porCategoria.length} producto{porCategoria.length === 1 ? '' : 's'} por categoría
            {porCategoria.length > 0 && <>: {porCategoria.slice(0, 6).map((p) => p.nombre).join(', ')}{porCategoria.length > 6 ? '…' : ''}</>}
          </small>
        </div>
        <div className="form-row" style={{ margin: '.6rem 0 0' }}>
          <label>Productos fijos (además de los de las categorías)</label>
          <SearchSelect options={opciones} value={prodSel} onChange={(v) => { setProdSel(v); agregarProducto(v); }} placeholder="🔍 Agregar un producto…" />
          {d.productos.map((f, i) => (
            <div key={f.producto_id} style={{ display: 'flex', gap: '.4rem', alignItems: 'center', marginTop: '.35rem' }}>
              <span style={{ flex: 1 }}>{f.nombre} <span className="muted mono" style={{ fontSize: '.75rem' }}>{f.sku}</span></span>
              <input className="input" type="number" min={0} step="any" style={{ width: '6rem' }} value={f.cantidad || ''}
                aria-label={`Cantidad de ${f.nombre}`}
                onChange={(e) => set('productos', d.productos.map((x, j) => (j === i ? { ...x, cantidad: Number(e.target.value) || 0 } : x)))} />
              <span className="muted" style={{ width: '3.5rem' }}>{f.unidad}</span>
              <button className="btn btn-ghost btn-sm" aria-label={`Quitar ${f.nombre}`} onClick={() => set('productos', d.productos.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <small className="muted">La cantidad de aquí se usa solo la primera vez; después sale la de la última compra.</small>
        </div>
      </div>
      <div className="form-row" style={{ marginTop: '.6rem' }}>
        <label>Nota (va en la solicitud)</label>
        <input className="input" value={d.nota ?? ''} onChange={(e) => set('nota', e.target.value)} placeholder="Para qué es y quién lo pidió" />
      </div>
    </Modal>
  );
}
