/* ============================================================
   MGG · Inventario · Histórico de recepciones

   Responde «qué se recibió, quién lo recibió y a qué almacén entró», que hasta
   ahora solo se podía contestar consultando la base a mano: el kardex del
   producto muestra la entrada pero no lleva a la orden, y el Histórico de
   Pedidos lista órdenes, no recepciones.

   No hay tabla de recepciones — se reconstruyen agrupando los movimientos, que
   ya traen la asociación (`ref_id`, `ref_codigo`, `proveedor_id`).
   ============================================================ */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { dateTime, money, num } from '@/shared/lib/format';
import type { Producto } from '@/shared/lib/types';
import { listMovimientosRecepcion } from './movimientos.repository';
import {
  filtrarRecepciones, recepcionesDesdeMovimientos,
  type Recepcion,
} from './recepcionesHistorico';

/** Hace `n` días, en ISO corto. */
function hace(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
const hoyISO = () => new Date().toISOString().slice(0, 10);

export function RecepcionesHistorialModal({ productos, onClose }: {
  productos: Producto[];
  onClose: () => void;
}) {
  const [desde, setDesde] = useState(hace(30));
  const [hasta, setHasta] = useState(hoyISO());
  const [almacen, setAlmacen] = useState('');
  const [texto, setTexto] = useState('');
  const [recs, setRecs] = useState<Recepcion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [abierta, setAbierta] = useState<string | null>(null);

  const prodPorId = useMemo(
    () => new Map(productos.map((p) => [p.id, p] as const)),
    [productos],
  );

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const movs = await listMovimientosRecepcion(desde, hasta);
      setRecs(recepcionesDesdeMovimientos(movs as never));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron cargar las recepciones', 'error');
      setRecs([]);
    } finally { setCargando(false); }
  }, [desde, hasta]);

  useEffect(() => { void cargar(); }, [cargar]);

  // El filtro por fecha va en la consulta (acota lo que baja); el resto se
  // aplica sobre lo ya traído, que es instantáneo y no vuelve a la red.
  const filtradas = useMemo(
    () => filtrarRecepciones(recs, { almacen: almacen || null, texto: texto || null }),
    [recs, almacen, texto],
  );

  const totalUnidades = useMemo(
    () => filtradas.reduce((a, r) => a + r.unidades, 0),
    [filtradas],
  );

  const almacenesConRecepcion = useMemo(() => {
    const s = new Set(recs.map((r) => r.almacen).filter((x): x is string => !!x));
    return [...s].sort((a, b) => a.localeCompare(b, 'es'));
  }, [recs]);

  return (
    <Modal title="Recepciones · histórico" size="lg" onClose={onClose} footer={
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
    }>
      {/* Filtros. El rango por defecto son 30 días: el histórico completo no se
          trae porque `movimientos` se corta en 1.000 filas sin avisar. */}
      <div className="filterbar" style={{ flexWrap: 'wrap', gap: '.5rem', marginBottom: '.7rem' }}>
        <div className="form-row" style={{ margin: 0 }}>
          <label style={{ fontSize: '.72rem' }}>Desde</label>
          <input className="input" type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label style={{ fontSize: '.72rem' }}>Hasta</label>
          <input className="input" type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <div className="form-row" style={{ margin: 0 }}>
          <label style={{ fontSize: '.72rem' }}>Almacén</label>
          <select className="select" value={almacen} onChange={(e) => setAlmacen(e.target.value)}>
            <option value="">Todos</option>
            {almacenesConRecepcion.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="form-row" style={{ margin: 0, flex: 1, minWidth: 180 }}>
          <label style={{ fontSize: '.72rem' }}>Buscar</label>
          <input className="input" value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder="Código, quién recibió, material…" />
        </div>
      </div>

      {cargando ? (
        <EmptyState message="Cargando recepciones…" icon="◔" />
      ) : !filtradas.length ? (
        <EmptyState message="Sin recepciones en este rango." icon="📦" />
      ) : (
        <>
          <div className="muted" style={{ fontSize: '.78rem', marginBottom: '.5rem' }}>
            {filtradas.length} recepci{filtradas.length === 1 ? 'ón' : 'ones'} · {num(totalUnidades)} unidades
          </div>
          <div className="table-wrap" style={{ maxHeight: '52vh', overflowY: 'auto' }}>
            <table className="table" style={{ fontSize: '.83rem' }}>
              <thead><tr>
                <th>Recepción</th>
                <th>Cuándo</th>
                <th>Recibió</th>
                <th>Almacén</th>
                <th style={{ textAlign: 'right' }}>Ítems</th>
                <th style={{ textAlign: 'right' }}>Unidades</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
              </tr></thead>
              <tbody>
                {filtradas.map((r) => {
                  const clave = `${r.ref_id}-${r.at}`;
                  const abierto = abierta === clave;
                  return (
                    // La key va en el Fragment: la fila y su detalle son DOS <tr>
                    // del mismo elemento de la lista.
                    <Fragment key={clave}>
                      <tr className="row-selectable" style={{ cursor: 'pointer' }}
                        onClick={() => setAbierta(abierto ? null : clave)}
                        title="Ver los materiales de esta recepción">
                        <td className="mono">
                          {abierto ? '▾' : '▸'} {r.codigo}
                          {r.ref_tipo === 'compra_directa' && <span className="muted" style={{ fontSize: '.72rem' }}> · directa</span>}
                        </td>
                        <td className="muted" style={{ fontSize: '.78rem' }}>{dateTime(r.at)}</td>
                        <td>{r.actor_name ?? r.actor ?? '—'}</td>
                        {/* Las recepciones anteriores al 08/09/2026 no guardaban el
                            almacén: se dice que falta, no se adivina del detalle. */}
                        <td>{r.almacen ?? <span className="dim">sin registrar</span>}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>{r.items.length}</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(r.unidades)}</td>
                        <td className="mono" style={{ textAlign: 'right' }}>
                          {r.valor == null ? <span className="dim">—</span> : money(r.valor)}
                        </td>
                      </tr>
                      {abierto && (
                        <tr>
                          <td colSpan={7} style={{ paddingTop: 0 }}>
                            <table className="table" style={{ fontSize: '.78rem', margin: '.2rem 0 .5rem' }}>
                              <tbody>
                                {r.items.map((it) => {
                                  const p = prodPorId.get(it.producto_id);
                                  return (
                                    <tr key={it.producto_id}>
                                      <td>
                                        {p ? p.nombre : it.producto_id}
                                        {p && <span className="dim mono" style={{ fontSize: '.72rem' }}> · {p.sku}</span>}
                                      </td>
                                      <td className="mono" style={{ textAlign: 'right', width: 110 }}>
                                        {num(it.cantidad)} {p?.unidad?.toLowerCase() ?? ''}
                                      </td>
                                      <td className="mono" style={{ textAlign: 'right', width: 110 }}>
                                        {it.precio == null ? <span className="dim">sin costo</span> : money(it.precio)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
