/* ============================================================
   MGG · Inventario · Productos dados de baja

   Un producto inactivo NO EXISTE para el sistema: no sale en el
   inventario, ni en los almacenes, ni en el buscador global, ni se
   puede pedir, mover o consumir. Vive solo acá hasta que alguien
   lo reactive, y entonces vuelve a existir en todos lados.

   Cada baja queda firmada: cuándo fue y quién la hizo. Las bajas
   viejas, anteriores a que el sistema lo anotara, se muestran
   como «sin registro» en vez de inventar una fecha.
   ============================================================ */
import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { dateTime } from '@/shared/lib/format';
import type { Producto } from '@/shared/lib/types';
import { setEstadoProducto } from './inventario.repository';
import { FILTRO_VACIO, inactivosFiltrados, opcionesDe, type FiltroInactivos } from './productosInactivos';

interface Props {
  productos: Producto[];
  canWrite: boolean;
  onClose: () => void;
  /** Se avisa al padre cuando un producto volvió a existir, para recargar. */
  onReactivado: () => void | Promise<void>;
}

export function ProductosInactivosModal({ productos, canWrite, onClose, onReactivado }: Props) {
  const [f, setF] = useState<FiltroInactivos>(FILTRO_VACIO);
  const [activando, setActivando] = useState<string | null>(null);

  const set = (k: keyof FiltroInactivos, v: string) => setF((prev) => ({ ...prev, [k]: v }));

  const inactivos = useMemo(() => productos.filter((p) => p.estado === 'inactivo'), [productos]);
  const visibles = useMemo(() => inactivosFiltrados(productos, f), [productos, f]);
  const categorias = useMemo(() => opcionesDe(productos, 'categoria'), [productos]);
  const unidades = useMemo(() => opcionesDe(productos, 'unidad'), [productos]);
  const almacenes = useMemo(() => opcionesDe(productos, 'almacen'), [productos]);
  const responsables = useMemo(() => opcionesDe(productos, 'desactivado_por'), [productos]);
  const hayFiltro = JSON.stringify(f) !== JSON.stringify(FILTRO_VACIO);

  async function reactivar(p: Producto) {
    setActivando(p.id);
    try {
      await setEstadoProducto(p.id, 'activo');
      toast(`"${p.nombre}" volvió al inventario`, 'success');
      await onReactivado();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo reactivar el producto.', 'error');
    } finally {
      setActivando(null);
    }
  }

  return (
    <Modal title="Productos dados de baja" size="xl" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0, fontSize: '.86rem' }}>
        Mientras un producto esté dado de baja <strong>no existe</strong> para el sistema: no aparece en el
        inventario, ni en los almacenes, ni en el buscador, y no se puede pedir ni mover. Reactivalo para
        devolverlo a la circulación.
      </p>

      <div className="filterbar" style={{ marginBottom: '.75rem' }}>
        <input
          className="search"
          placeholder="Buscar en todo: nombre, código, marca, modelo, motivo de la baja…"
          value={f.texto}
          onChange={(e) => set('texto', e.target.value)}
        />
        <select className="select" style={{ maxWidth: 170 }} value={f.categoria} onChange={(e) => set('categoria', e.target.value)}>
          <option value="">Todas las categorías</option>
          {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 140 }} value={f.unidad} onChange={(e) => set('unidad', e.target.value)}>
          <option value="">Todas las unidades</option>
          {unidades.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 190 }} value={f.almacen} onChange={(e) => set('almacen', e.target.value)}>
          <option value="">Todos los almacenes</option>
          {almacenes.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 210 }} value={f.porQuien} onChange={(e) => set('porQuien', e.target.value)} title="Quién dio de baja el producto">
          <option value="">Dado de baja por cualquiera</option>
          {responsables.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input className="input" style={{ maxWidth: 150 }} type="date" value={f.desde} onChange={(e) => set('desde', e.target.value)} title="Baja desde" />
        <input className="input" style={{ maxWidth: 150 }} type="date" value={f.hasta} onChange={(e) => set('hasta', e.target.value)} title="Baja hasta" />
        {hayFiltro && (
          <button className="btn btn-ghost btn-sm" onClick={() => setF(FILTRO_VACIO)}>Limpiar filtros</button>
        )}
      </div>

      <div className="muted" style={{ fontSize: '.82rem', marginBottom: '.5rem' }}>
        {visibles.length} de {inactivos.length} producto{inactivos.length === 1 ? '' : 's'} dado{inactivos.length === 1 ? '' : 's'} de baja
      </div>

      {!visibles.length ? (
        <div className="empty" style={{ padding: '2rem', textAlign: 'center' }}>
          {inactivos.length ? 'Ningún producto dado de baja coincide con esos filtros.' : 'No hay productos dados de baja.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Producto</th>
                <th>Categoría</th>
                <th>Unidad</th>
                <th>Último almacén</th>
                <th>Dado de baja</th>
                <th>Por</th>
                <th>Motivo</th>
                <th style={{ textAlign: 'right' }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id}>
                  <td><code>{p.sku}</code></td>
                  <td>
                    <strong>{p.nombre}</strong>
                    {p.marca && <div className="muted" style={{ fontSize: '.76rem' }}>{p.marca}{p.modelo ? ` · ${p.modelo}` : ''}</div>}
                  </td>
                  <td>{p.categoria}</td>
                  <td>{p.unidad}</td>
                  <td>{p.almacen || <span className="muted">sin ubicación</span>}</td>
                  <td>{p.desactivado_en ? dateTime(p.desactivado_en) : <span className="muted">sin registro</span>}</td>
                  <td>{p.desactivado_por || <span className="muted">sin registro</span>}</td>
                  <td style={{ maxWidth: 240 }}>{p.desactivado_motivo || <span className="muted">—</span>}</td>
                  <td style={{ textAlign: 'right' }}>
                    {canWrite ? (
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={activando === p.id}
                        onClick={() => void reactivar(p)}
                        title="Devolver el producto al inventario"
                      >
                        {activando === p.id ? 'Activando…' : '↻ Reactivar'}
                      </button>
                    ) : (
                      <span className="muted" style={{ fontSize: '.78rem' }}>sin permiso</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
