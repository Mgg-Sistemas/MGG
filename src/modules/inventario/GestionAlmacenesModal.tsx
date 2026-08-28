/* ============================================================
   MGG · Inventario · Gestión de almacenes
   Un solo lugar para crear, renombrar, organizar (sede, secciones /
   subalmacenes) y cerrar almacenes. Antes esas acciones estaban
   repartidas en las tarjetas de la vista de almacenes (solo Depósito
   y la pestaña Subalmacenes) y el almacenista no las encontraba
   (pedido real: crear el almacén HCPC).
   Reglas de cierre (eliminar):
     · vacío (sin stock ni secciones): cualquier usuario con escritura,
       escribiendo el nombre exacto;
     · con stock: solo con permiso completo de Inventario, y el stock
       se TRASLADA primero a otro almacén (queda en el kardex);
     · con secciones: primero se eliminan o reasignan las secciones.
   El nombre del almacén es la llave textual del stock en 11 tablas:
   renombrar pasa SIEMPRE por `actualizarAlmacen` → RPC `rename_almacen`.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { bustCache } from '@/shared/lib/queryCache';
import { money, num } from '@/shared/lib/format';
import type { Almacen, Existencia } from '@/shared/lib/types';
import { actualizarAlmacen, crearAlmacen, eliminarAlmacen, listAlmacenes, listExistencias, renombrarSede, type AlmacenInput } from './almacenes.repository';
import type { Espacio } from './inventario.repository';
import { transferir } from './movimientos.repository';
import { AlmacenForm } from './AlmacenForm';
import { nombreSedeCorto, SIN_SEDE } from './stockPorAlmacen';

interface Props {
  /** Espacio de la página desde la que se abre: los almacenes nuevos nacen ahí. */
  espacio: Espacio;
  actor: string;
  actorName?: string | null;
  /** Permiso completo de Inventario: habilita cerrar almacenes con stock (moviéndolo). */
  canFull: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}

type Sub =
  | { kind: 'none' }
  | { kind: 'crear'; parentId?: string | null; sede?: string | null }
  | { kind: 'editar'; almacen: Almacen }
  | { kind: 'eliminar'; almacen: Almacen }
  | { kind: 'sede'; sede: string };

interface Stats { productos: number; unidades: number; valor: number; fantasmas: number }

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');

/** ids del almacén y toda su descendencia. */
function descendencia(rootId: string, almacenes: Almacen[]): Set<string> {
  const out = new Set<string>([rootId]);
  let crecio = true;
  while (crecio) {
    crecio = false;
    for (const a of almacenes) {
      if (a.parent_id && out.has(a.parent_id) && !out.has(a.id)) { out.add(a.id); crecio = true; }
    }
  }
  return out;
}

export function GestionAlmacenesModal({ espacio, actor, actorName, canFull, onClose, onChanged }: Props) {
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState<Sub>({ kind: 'none' });
  const [filtro, setFiltro] = useState('');

  async function cargar() {
    setLoading(true);
    try {
      const [a1, a2, ex] = await Promise.all([listAlmacenes('principal'), listAlmacenes('deposito'), listExistencias()]);
      setAlmacenes([...a1, ...a2]);
      setExistencias(ex);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron cargar los almacenes', 'error');
    } finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  async function despuesDeCambiar(msg: string) {
    bustCache(['almacenes', 'existencias', 'productos', 'movimientos']);
    notify(msg, 'success', { link: '#/app/inventario' });
    await cargar();
    await onChanged();
  }

  // Stock por almacén (productos con stock, unidades, valor) y filas fantasma (stock 0).
  const stats = useMemo(() => {
    const m = new Map<string, Stats>();
    for (const e of existencias) {
      const s = m.get(e.almacen) ?? { productos: 0, unidades: 0, valor: 0, fantasmas: 0 };
      const st = Number(e.stock) || 0;
      if (st > 0) { s.productos += 1; s.unidades += st; s.valor += st * (Number(e.costo_promedio) || 0); } else s.fantasmas += 1;
      m.set(e.almacen, s);
    }
    return m;
  }, [existencias]);
  const statsDe = (nombre: string): Stats => stats.get(nombre) ?? { productos: 0, unidades: 0, valor: 0, fantasmas: 0 };

  // Árbol: sede → almacenes raíz → secciones (subalmacenes), con filtro por texto.
  const q = normalizar(filtro);
  const coincide = (a: Almacen) => !q || normalizar(a.nombre).includes(q) || normalizar(a.ubicacion ?? '').includes(q) || normalizar(a.sede ?? '').includes(q);
  const hijosDe = (id: string) => almacenes.filter((a) => a.parent_id === id).sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'));
  const visibleConHijos = (a: Almacen): boolean => coincide(a) || hijosDe(a.id).some(visibleConHijos);
  const sedes = useMemo(() => {
    const raices = almacenes.filter((a) => !a.parent_id);
    const grupos = new Map<string, Almacen[]>();
    for (const a of raices) {
      const sede = (a.sede ?? '').trim() || SIN_SEDE;
      grupos.set(sede, [...(grupos.get(sede) ?? []), a]);
    }
    return [...grupos.entries()]
      .map(([sede, alms]) => ({ sede, alms: alms.sort((x, y) => x.nombre.localeCompare(y.nombre, 'es')) }))
      .sort((x, y) => (x.sede === SIN_SEDE ? 1 : 0) - (y.sede === SIN_SEDE ? 1 : 0) || x.sede.localeCompare(y.sede, 'es'));
  }, [almacenes]);

  function Fila({ a, nivel }: { a: Almacen; nivel: number }) {
    if (!visibleConHijos(a)) return null;
    const s = statsDe(a.nombre);
    const hijos = hijosDe(a.id);
    return (
      <>
        <tr>
          <td style={{ paddingLeft: `${0.6 + nivel * 1.4}rem` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
              <span className="muted">{nivel === 0 ? '▣' : '└'}</span>
              <strong>{a.nombre}</strong>
              {(a.espacio ?? 'principal') === 'deposito' && <span className="badge info" style={{ fontSize: '.6rem' }}>Depósito</span>}
              {hijos.length > 0 && <span className="badge" style={{ fontSize: '.6rem' }}>{hijos.length} sección(es)</span>}
            </div>
            {a.ubicacion && <div className="muted" style={{ fontSize: '.72rem' }}>{a.ubicacion}</div>}
          </td>
          <td className="mono" style={{ textAlign: 'right' }}>{s.productos ? num(s.productos) : <span className="dim">—</span>}</td>
          <td className="mono" style={{ textAlign: 'right' }}>{s.unidades ? num(s.unidades) : <span className="dim">—</span>}</td>
          <td className="mono" style={{ textAlign: 'right' }}>{s.valor ? money(s.valor) : <span className="dim">—</span>}</td>
          <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
            <button className="btn btn-sm btn-ghost" title="Agregar una sección (subalmacén) dentro de este almacén" onClick={() => setSub({ kind: 'crear', parentId: a.id })}>＋ Sección</button>
            <button className="btn btn-sm btn-ghost" title="Renombrar, cambiar ubicación, sede o almacén padre" onClick={() => setSub({ kind: 'editar', almacen: a })}>✎</button>
            <button className="btn btn-sm btn-ghost" title={s.productos ? 'Cerrar este almacén (hay que mover su stock)' : 'Eliminar este almacén vacío'} onClick={() => setSub({ kind: 'eliminar', almacen: a })} style={{ color: 'var(--danger)' }}>🗑</button>
          </td>
        </tr>
        {hijos.map((h) => <Fila key={h.id} a={h} nivel={nivel + 1} />)}
      </>
    );
  }

  const footer = (
    <>
      <button className="btn btn-primary" onClick={() => setSub({ kind: 'crear' })}>＋ Nuevo almacén</button>
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
    </>
  );

  return (
    <Modal title="Gestión de almacenes" size="lg" onClose={onClose} footer={footer}>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.82rem' }}>
        Acá se crean, renombran y organizan los almacenes y sus <strong>secciones</strong> (subalmacenes) de todas las sedes.
        Los almacenes nuevos nacen en <strong>{espacio === 'deposito' ? 'Depósito' : 'Inventario'}</strong>. Renombrar un almacén actualiza también su stock y su historial.
      </p>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.6rem', flexWrap: 'wrap' }}>
        <input className="input" placeholder="🔎 Buscar almacén, sección o sede…" value={filtro} onChange={(e) => setFiltro(e.target.value)} style={{ maxWidth: 320 }} />
        <span className="muted" style={{ fontSize: '.78rem' }}>{almacenes.length} almacén(es) · {sedes.length} sede(s)</span>
      </div>

      {loading ? <EmptyState message="Cargando almacenes…" icon="◔" /> : !almacenes.length ? (
        <EmptyState message="Todavía no hay almacenes. Creá el primero con «＋ Nuevo almacén»." icon="▣" />
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead>
              <tr>
                <th>Sede / almacén / sección</th>
                <th style={{ textAlign: 'right' }} title="Productos con stock">Productos</th>
                <th style={{ textAlign: 'right' }}>Unidades</th>
                <th style={{ textAlign: 'right' }} title="Σ stock × PMP del almacén">Valor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sedes.map(({ sede, alms }) => {
                const visibles = alms.filter(visibleConHijos);
                if (!visibles.length) return null;
                return (
                  <FragmentSede key={sede} sede={sede} onRenombrar={() => setSub({ kind: 'sede', sede })} onNuevo={() => setSub({ kind: 'crear', sede: sede === SIN_SEDE ? null : sede })}>
                    {visibles.map((a) => <Fila key={a.id} a={a} nivel={0} />)}
                  </FragmentSede>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sub.kind === 'crear' && (
        <AlmacenForm
          almacenes={almacenes}
          parentPreset={sub.parentId ?? null}
          sedePreset={sub.sede ?? null}
          onClose={() => setSub({ kind: 'none' })}
          onSubmit={async (data: AlmacenInput) => {
            await crearAlmacen({ ...data, espacio }, actor);
            await despuesDeCambiar(`Almacén creado: ${data.nombre}`);
          }}
        />
      )}
      {sub.kind === 'editar' && (
        <AlmacenForm
          almacen={sub.almacen}
          almacenes={almacenes}
          onClose={() => setSub({ kind: 'none' })}
          onSubmit={async (data: AlmacenInput) => {
            await actualizarAlmacen(sub.almacen.id, data);
            await despuesDeCambiar(`Almacén actualizado: ${data.nombre}`);
          }}
        />
      )}
      {sub.kind === 'sede' && (
        <RenombrarSedePanel
          sede={sub.sede}
          onClose={() => setSub({ kind: 'none' })}
          onSaved={async (nuevo) => { await despuesDeCambiar(`Sede renombrada a «${nuevo}»`); setSub({ kind: 'none' }); }}
        />
      )}
      {sub.kind === 'eliminar' && (
        <CerrarAlmacenPanel
          almacen={sub.almacen}
          almacenes={almacenes}
          existencias={existencias.filter((e) => e.almacen === sub.almacen.nombre)}
          canFull={canFull}
          actor={actor}
          actorName={actorName ?? null}
          onClose={() => setSub({ kind: 'none' })}
          onDone={async (msg) => { await despuesDeCambiar(msg); setSub({ kind: 'none' }); }}
        />
      )}
    </Modal>
  );
}

/** Cabecera de sede dentro de la tabla (con renombrar y «nuevo almacén en esta sede»). */
function FragmentSede({ sede, children, onRenombrar, onNuevo }: { sede: string; children: React.ReactNode; onRenombrar: () => void; onNuevo: () => void }) {
  return (
    <>
      <tr style={{ background: 'var(--bg-2)' }}>
        <td colSpan={5}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '.8rem', letterSpacing: '.06em', textTransform: 'uppercase' }}>🏭 {nombreSedeCorto(sede)}</strong>
            {sede !== SIN_SEDE && nombreSedeCorto(sede) !== sede && <span className="muted mono" style={{ fontSize: '.7rem' }}>{sede}</span>}
            <span style={{ flex: 1 }} />
            {sede !== SIN_SEDE && <button className="btn btn-sm btn-ghost" onClick={onRenombrar} title="Renombrar esta sede en todos sus almacenes">✎ Sede</button>}
            <button className="btn btn-sm btn-ghost" onClick={onNuevo}>＋ Almacén aquí</button>
          </div>
        </td>
      </tr>
      {children}
    </>
  );
}

function RenombrarSedePanel({ sede, onClose, onSaved }: { sede: string; onClose: () => void; onSaved: (nuevo: string) => Promise<void> }) {
  const [nombre, setNombre] = useState(sede);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function guardar() {
    const n = nombre.trim();
    if (!n) { setError('Escribí el nombre de la sede.'); return; }
    setSaving(true); setError(null);
    try { await renombrarSede(sede, n); await onSaved(n); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo renombrar'); setSaving(false); }
  }
  return (
    <Modal title={`Renombrar sede · ${sede}`} size="sm" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving}>{saving ? 'Guardando…' : 'Renombrar'}</button>
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      <p className="muted" style={{ marginTop: 0, fontSize: '.82rem' }}>Se aplica a todos los almacenes de esta sede. La sede es solo la etiqueta que los agrupa: el stock no se mueve.</p>
      <div className="form-row">
        <label>Nuevo nombre</label>
        <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value.toUpperCase())} autoFocus />
      </div>
    </Modal>
  );
}

/** Cierre de un almacén: vacío → eliminar; con stock → (solo permiso completo) mover a otro y eliminar. */
function CerrarAlmacenPanel({ almacen, almacenes, existencias, canFull, actor, actorName, onClose, onDone }: {
  almacen: Almacen; almacenes: Almacen[]; existencias: Existencia[]; canFull: boolean;
  actor: string; actorName: string | null; onClose: () => void; onDone: (msg: string) => Promise<void>;
}) {
  const hijos = almacenes.filter((a) => a.parent_id === almacen.id);
  const conStock = existencias.filter((e) => (Number(e.stock) || 0) > 0);
  const unidades = conStock.reduce((a, e) => a + (Number(e.stock) || 0), 0);
  const excluidos = descendencia(almacen.id, almacenes);
  const destinos = almacenes
    .filter((a) => !excluidos.has(a.id) && (a.espacio ?? 'principal') === (almacen.espacio ?? 'principal'))
    .sort((x, y) => (x.sede ?? '').localeCompare(y.sede ?? '') || x.nombre.localeCompare(y.nombre, 'es'));
  const [destino, setDestino] = useState('');
  const [texto, setTexto] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nombreOk = texto.trim() !== '' && normalizar(texto) === normalizar(almacen.nombre);
  const bloqueadoPorHijos = hijos.length > 0;
  const requiereMover = conStock.length > 0;
  const puede = !bloqueadoPorHijos && nombreOk && (!requiereMover || (canFull && !!destino));

  async function confirmar() {
    if (!puede) return;
    setError(null);
    try {
      if (requiereMover) {
        let i = 0;
        for (const e of conStock) {
          i += 1;
          setBusy(`Moviendo ${i}/${conStock.length} a ${destino}…`);
          await transferir({
            producto_id: e.producto_id, almacenOrigen: almacen.nombre, almacenDestino: destino,
            cantidad: Number(e.stock) || 0, actor, actor_name: actorName,
            detalle: `Cierre del almacén ${almacen.nombre}`,
          });
        }
      }
      setBusy('Eliminando almacén…');
      await eliminarAlmacen(almacen.id, almacen.nombre);
      await onDone(requiereMover
        ? `Almacén ${almacen.nombre} cerrado: ${conStock.length} producto(s) movidos a ${destino}`
        : `Almacén eliminado: ${almacen.nombre}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar el almacén');
      setBusy(null);
    }
  }

  return (
    <Modal title={requiereMover ? `Cerrar almacén · ${almacen.nombre}` : `Eliminar almacén · ${almacen.nombre}`} size="md" onClose={() => { if (!busy) onClose(); }} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={!!busy}>Cancelar</button>
        <button className="btn btn-danger" disabled={!puede || !!busy} onClick={() => void confirmar()}>
          {busy ?? (requiereMover ? 'Mover el stock y eliminar' : 'Eliminar definitivamente')}
        </button>
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}

      {bloqueadoPorHijos ? (
        <div className="card" style={{ borderColor: 'var(--warning)' }}>
          Este almacén tiene <strong>{hijos.length} sección(es)</strong>: {hijos.map((h) => h.nombre).join(', ')}.
          Eliminá o reasigná esas secciones primero (✎ en cada una → cambiar el almacén padre).
        </div>
      ) : requiereMover ? (
        <>
          <div className="card" style={{ borderColor: canFull ? 'var(--warning)' : 'var(--danger)', marginBottom: '.6rem', fontSize: '.85rem' }}>
            Este almacén tiene <strong>{conStock.length} producto(s)</strong> con <strong>{num(unidades)} unidades</strong> en stock.
            {canFull
              ? <> Para cerrarlo, el stock se <strong>traslada</strong> a otro almacén (cada producto queda en el kardex como transferencia) y después se elimina.</>
              : <> Solo un usuario con <strong>permiso completo de Inventario</strong> puede cerrarlo moviendo el stock. Pedíselo, o trasladá el stock desde Salidas → Traslados y volvé.</>}
          </div>
          {canFull && (
            <div className="form-row">
              <label>Mover todo el stock a</label>
              <select className="select" value={destino} onChange={(e) => setDestino(e.target.value)}>
                <option value="">— Elegí el almacén destino —</option>
                {destinos.map((a) => <option key={a.id} value={a.nombre}>{a.sede ? `${nombreSedeCorto(a.sede)} › ` : ''}{a.nombre}</option>)}
              </select>
            </div>
          )}
          <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto', marginBottom: '.6rem' }}>
            <table className="table" style={{ fontSize: '.78rem' }}>
              <thead><tr><th>Producto</th><th style={{ textAlign: 'right' }}>Stock</th><th style={{ textAlign: 'right' }}>PMP</th></tr></thead>
              <tbody>
                {conStock.map((e) => (
                  <tr key={e.producto_id}><td className="mono">{e.producto_id.slice(0, 8)}…</td><td className="mono" style={{ textAlign: 'right' }}>{num(e.stock)}</td><td className="mono" style={{ textAlign: 'right' }}>{money(e.costo_promedio)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p style={{ marginTop: 0, fontSize: '.85rem' }}>
          El almacén está vacío. Se elimina de la lista; su historial en el kardex se conserva con el nombre <strong>{almacen.nombre}</strong>. <strong>Esta acción no se puede deshacer.</strong>
        </p>
      )}

      {!bloqueadoPorHijos && (!requiereMover || canFull) && (
        <div className="form-row">
          <label>Para confirmar, escribí <strong>{almacen.nombre}</strong></label>
          <input className="input" value={texto} placeholder={almacen.nombre} onChange={(e) => setTexto(e.target.value)} disabled={!!busy} />
          {texto.trim() !== '' && !nombreOk && <small style={{ color: 'var(--danger)' }}>El nombre no coincide.</small>}
        </div>
      )}
    </Modal>
  );
}
