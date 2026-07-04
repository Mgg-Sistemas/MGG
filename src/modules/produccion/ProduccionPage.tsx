import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { dateTime, money, num } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import type { Almacen, Existencia, Producto, Produccion } from '@/shared/lib/types';
import { listProductos } from '@/modules/inventario/inventario.repository';
import { listAlmacenes, listExistencias } from '@/modules/inventario/almacenes.repository';
import { listProducciones, finalizarProduccion } from './produccion.repository';
import { getNombresHornosActivos } from './hornos.repository';
import { MaterialAProducirModal } from './MaterialAProducirModal';
import { ProduccionDetalle, duracionProd } from './ProduccionDetalle';
import { RecetasModal } from './RecetasModal';
import { GestionarHornosModal } from './GestionarHornosModal';

type Layout = 'kanban' | 'lista';
type Modal =
  | { kind: 'none' }
  | { kind: 'crear'; initialProductoId?: string }
  | { kind: 'ver'; id: string }
  | { kind: 'recetas' }
  | { kind: 'ver-receta'; id: string; productoId: string }
  | { kind: 'hornos' }
  | { kind: 'finalizar'; prod: Produccion };

export function ProduccionPage() {
  const { can, appUser } = usePermissions();
  const canWrite = can('produccion', 'escritura');
  const actor = appUser?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;

  const [producciones, setProducciones] = useState<Produccion[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [hornos, setHornos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [layout, setLayout] = useState<Layout>('kanban');
  const [modal, setModal] = useState<Modal>({ kind: 'none' });
  const [busqueda, setBusqueda] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'produccion' | 'finalizado'>('todos');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, pds, exs, alms, hrns] = await Promise.all([
        listProducciones(),
        listProductos(),
        listExistencias().catch(() => [] as Existencia[]),
        listAlmacenes().catch(() => [] as Almacen[]),
        getNombresHornosActivos().catch(() => [] as string[]),
      ]);
      setProducciones(prods);
      setProductos(pds);
      setExistencias(exs);
      setAlmacenes(alms);
      setHornos(hrns);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cargar fundición', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  // Realtime: fundición + sus insumos/almacenes/hornos (multiusuario en vivo).
  useRealtime(['produccion', 'produccion_materiales', 'hornos', 'productos', 'existencias', 'almacenes'], reload);

  // Filtros (solo aplican a la vista Lista).
  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return producciones.filter((p) => {
      if (filtroEstado !== 'todos' && p.estado !== filtroEstado) return false;
      if (q && !(`${p.producto_nombre} ${p.almacen_destino}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [producciones, busqueda, filtroEstado]);
  // El Kanban siempre muestra todo (sin filtros).
  const enProduccion = useMemo(() => producciones.filter((p) => p.estado === 'produccion'), [producciones]);
  const finalizados = useMemo(() => producciones.filter((p) => p.estado === 'finalizado'), [producciones]);
  // El Kanban solo muestra las 3 producciones finalizadas más recientes.
  const finalizadosKanban = useMemo(() => finalizados.slice(0, 3), [finalizados]);
  const almacenesList = useMemo(() => almacenes.map((a) => a.nombre), [almacenes]);

  async function handleFinalizar(prod: Produccion) {
    try {
      await finalizarProduccion(prod.id, actor, actorName);
      notify(`Fundición finalizada: ${prod.producto_nombre} (${num(prod.cantidad)} und) → entró a ${prod.almacen_destino}`, 'success', { link: '#/app/inventario' });
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo finalizar', 'error');
    } finally {
      setModal({ kind: 'none' });
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Fundición</h1>
          <p className="hint muted">Órdenes de fundición: consumen insumos del inventario y, al finalizar, el producto terminado entra como existencia.</p>
        </div>
        <div className="actions">
          <div className="view-toggle" role="tablist" aria-label="Vista de fundición">
            <button className={layout === 'kanban' ? 'active' : ''} onClick={() => setLayout('kanban')}>▦ Kanban</button>
            <button className={layout === 'lista' ? 'active' : ''} onClick={() => setLayout('lista')}>☰ Lista</button>
          </div>
          <button className="btn btn-ghost" onClick={() => setModal({ kind: 'recetas' })}>📋 Recetas</button>
          {canWrite && (
            <button className="btn btn-ghost" onClick={() => setModal({ kind: 'hornos' })}>🔥 Hornos</button>
          )}
          {canWrite && (
            <button className="btn btn-primary" onClick={() => setModal({ kind: 'crear' })}>🔥 Material a producir</button>
          )}
        </div>
      </div>

      {layout === 'lista' && (
        <div className="filterbar" style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
          <input
            className="input"
            type="search"
            placeholder="Buscar por producto o almacén…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            style={{ flex: '1 1 220px', minWidth: 180 }}
          />
          <select className="input" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value as typeof filtroEstado)} style={{ flex: '0 0 auto' }}>
            <option value="todos">Todos los estados</option>
            <option value="produccion">En fundición</option>
            <option value="finalizado">Finalizados</option>
          </select>
          {(busqueda || filtroEstado !== 'todos') && (
            <>
              <span className="muted" style={{ fontSize: '.8rem' }}>{num(filtradas.length)} resultado(s)</span>
              <button className="btn btn-sm btn-ghost" onClick={() => { setBusqueda(''); setFiltroEstado('todos'); }}>Limpiar</button>
            </>
          )}
        </div>
      )}

      {loading ? (
        <EmptyState message="Cargando fundición…" icon="◔" />
      ) : layout === 'kanban' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '1rem' }}>
          {/* En fundición */}
          <div>
            <div className="sidebar-section" style={{ paddingLeft: 0 }}>Productos en fundición · {num(enProduccion.length)}</div>
            {!enProduccion.length ? (
              <div className="card"><EmptyState message="Nada en fundición." icon="🔥" /></div>
            ) : (
              <div style={{ display: 'grid', gap: '.75rem' }}>
                {enProduccion.map((p) => (
                  <div key={p.id} className="card" style={{ margin: 0, padding: '1rem', borderTop: '3px solid var(--warning)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700 }}>{p.producto_nombre}</span>
                      {p.receta_num != null && <span className="badge">Receta #{num(p.receta_num)}</span>}
                    </div>
                    <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: '.3rem' }}>Total de material a producir</div>
                    <div className="mono" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--primary-3)' }}>{num(p.cantidad)}</div>
                    <div className="muted" style={{ fontSize: '.75rem' }}>Inicio: {dateTime(p.inicio_at)} · destino {p.almacen_destino}</div>
                    <div style={{ display: 'flex', gap: '.4rem', marginTop: '.6rem', flexWrap: 'wrap' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => setModal({ kind: 'ver', id: p.id })}>Ver</button>
                      {canWrite && <button className="btn btn-sm btn-primary" onClick={() => setModal({ kind: 'finalizar', prod: p })}>✓ Finalizar fundición</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Finalizados */}
          <div>
            <div className="sidebar-section" style={{ paddingLeft: 0 }}>Productos finalizados · {num(finalizados.length)}</div>
            {!finalizados.length ? (
              <div className="card"><EmptyState message="Sin producciones finalizadas." icon="✓" /></div>
            ) : (
              <div style={{ display: 'grid', gap: '.75rem' }}>
                {finalizados.length > finalizadosKanban.length && (
                  <div className="muted" style={{ fontSize: '.75rem' }}>
                    Mostrando las 3 más recientes · usá la vista <strong>☰ Lista</strong> para verlas todas.
                  </div>
                )}
                {finalizadosKanban.map((p) => (
                  <div key={p.id} className="card" style={{ margin: 0, padding: '1rem', borderTop: '3px solid var(--success)' }}>
                    <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase' }}>Producto finalizado</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700 }}>{p.producto_nombre}</span>
                      {p.receta_num != null && <span className="badge">Receta #{num(p.receta_num)}</span>}
                    </div>
                    <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: '.3rem' }}>Total de material producido</div>
                    <div className="mono" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--success)' }}>{num(p.cantidad)}</div>
                    <div className="muted" style={{ fontSize: '.75rem' }}>Duración: {duracionProd(p.inicio_at, p.fin_at)}{p.ganancia != null ? ` · ganancia ${money(p.ganancia)}` : ''}</div>
                    <div style={{ marginTop: '.6rem' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => setModal({ kind: 'ver', id: p.id })}>Ver</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Receta</th>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Cantidad</th>
                <th>Elaboración</th>
                <th>Finalización</th>
                <th>Duración</th>
                <th style={{ textAlign: 'right' }}>Costo unit.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!filtradas.length ? (
                <tr><td colSpan={9}><EmptyState message="Sin producciones." icon="🔥" /></td></tr>
              ) : filtradas.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.producto_nombre}</strong></td>
                  <td>{p.receta_num != null ? <span className="badge">#{num(p.receta_num)}</span> : '—'}</td>
                  <td><span className={`badge ${p.estado === 'finalizado' ? 'success' : 'warning'}`}>{p.estado === 'finalizado' ? 'Finalizado' : 'En fundición'}</span></td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(p.cantidad)}</td>
                  <td className="muted" style={{ fontSize: '.8rem' }}>{dateTime(p.inicio_at)}</td>
                  <td className="muted" style={{ fontSize: '.8rem' }}>{p.fin_at ? dateTime(p.fin_at) : '—'}</td>
                  <td className="mono">{duracionProd(p.inicio_at, p.fin_at)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(p.costo_unitario)}</td>
                  <td className="actions">
                    <button className="btn btn-sm btn-ghost" onClick={() => setModal({ kind: 'ver', id: p.id })}>Ver</button>
                    {canWrite && p.estado === 'produccion' && (
                      <button className="btn btn-sm btn-primary" onClick={() => setModal({ kind: 'finalizar', prod: p })}>Finalizar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal.kind === 'crear' && (
        <MaterialAProducirModal
          productos={productos}
          existencias={existencias}
          almacenesList={almacenesList}
          hornosList={hornos}
          actor={actor}
          actorName={actorName}
          initialProductoId={modal.initialProductoId}
          onClose={() => setModal({ kind: 'none' })}
          onCreated={() => { void reload(); }}
          onProductosChanged={reload}
          onHornosChanged={reload}
        />
      )}
      {modal.kind === 'hornos' && (
        <GestionarHornosModal
          actor={actor}
          onClose={() => setModal({ kind: 'none' })}
          onCambioAplicado={() => { void reload(); }}
        />
      )}
      {modal.kind === 'ver' && <ProduccionDetalle id={modal.id} defaultEmail={actor} onClose={() => setModal({ kind: 'none' })} />}
      {modal.kind === 'recetas' && (
        <RecetasModal
          onClose={() => setModal({ kind: 'none' })}
          onVer={(r) => setModal({ kind: 'ver-receta', id: r.produccion_id, productoId: r.producto_id })}
        />
      )}
      {modal.kind === 'ver-receta' && (
        <ProduccionDetalle
          id={modal.id}
          defaultEmail={actor}
          titulo="Detalle de receta"
          onEditar={canWrite ? () => setModal({ kind: 'crear', initialProductoId: modal.productoId }) : undefined}
          onClose={() => setModal({ kind: 'recetas' })}
        />
      )}
      {modal.kind === 'finalizar' && (
        <ConfirmDialog
          title="Finalizar fundición"
          message={`Se registrará la entrada de ${num(modal.prod.cantidad)} und de "${modal.prod.producto_nombre}" en ${modal.prod.almacen_destino} a costo ${money(modal.prod.costo_unitario)}/und. ¿Continuar?`}
          confirmText="Finalizar"
          onCancel={() => setModal({ kind: 'none' })}
          onConfirm={() => handleFinalizar(modal.prod)}
        />
      )}
    </div>
  );
}
