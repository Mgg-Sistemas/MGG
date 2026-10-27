import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRealtime } from '@/shared/lib/useRealtime';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { num as fmtNum } from '@/shared/lib/format';
import { norm } from '@/shared/lib/texto';
import { listEquipos, type MaquinariaEquipo } from './maquinariaEquipos.repository';
import { lecturasVigentesPorEquipo, type LecturaVigente } from './flota.repository';
import { avisoServicio, avisoMasUrgente } from './flota';
import {
  coincideRepuesto, coincideProducto, estadoStock, ESTADO_STOCK, textoEquivalencias, textoCada, sistemaDe,
  equiposPorServicio, necesidadesProximoServicio,
  type ProductoRepuesto, type RepuestoEquipo, type EquipoPorServicio,
} from './repuestosEquipo';
import { listRepuestosTodos, productosParaFicha } from './repuestosEquipo.repository';
import { listadoFlotaPdf, type ListadoFlota } from './flotaPdf';
import { listadoFlotaExcel } from './flotaExcel';
import { FlotaNav } from './FlotaNav';

type Vista = 'buscar' | 'comprar';

const errMsg = (e: unknown, def: string) => (e instanceof Error ? e.message : (e as { message?: string })?.message || def);

/**
 * Submódulo «Repuestos por equipo» (14/10/2026):
 *  · Buscar: «¿para qué equipo sirve?» — por número de parte, equivalencia, especificación
 *    (15W-40, 23.5R25) o nombre; dice qué equipos lo llevan y cuánto hay en inventario.
 *    Sin búsqueda, muestra qué equipos ya tienen su ficha cargada.
 *  · Qué comprar: los equipos con el servicio vencido o próximo (por su contador) y la
 *    suma de lo que piden sus fichas, contra el stock. La compra se pide con la orden
 *    de servicio de cada equipo (la orden manda a Pedidos lo que falte).
 */
export function RepuestosPorEquipoPage() {
  const [sp, setSp] = useSearchParams();
  const vista: Vista = sp.get('vista') === 'comprar' ? 'comprar' : 'buscar';
  const setVista = (v: Vista) => setSp((p) => { const n = new URLSearchParams(p); n.set('vista', v); return n; }, { replace: true });
  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [renglones, setRenglones] = useState<RepuestoEquipo[]>([]);
  const [productos, setProductos] = useState<Map<string, ProductoRepuesto>>(new Map());
  const [lecturas, setLecturas] = useState<Map<string, LecturaVigente>>(new Map());
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(sp.get('q') ?? '');

  const cargar = useCallback(async () => {
    try {
      const [es, rs, ps, ls] = await Promise.all([
        listEquipos(), listRepuestosTodos(), productosParaFicha(),
        lecturasVigentesPorEquipo().catch(() => new Map<string, LecturaVigente>()),
      ]);
      setEquipos(es); setRenglones(rs); setProductos(ps); setLecturas(ls);
    } catch (e) { toast(errMsg(e, 'No se pudo cargar'), 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_repuestos_equipo', 'maquinaria_equipos', 'productos', 'maquinaria_lecturas'], () => { void cargar(); });

  const porId = useMemo(() => new Map(equipos.map((e) => [e.id, e])), [equipos]);
  const activos = useMemo(() => equipos.filter((e) => e.activo), [equipos]);

  /* ───────── Buscar ───────── */
  const hallados = useMemo(() => {
    if (norm(q).length < 2) return [];
    return renglones.filter((r) => {
      const e = porId.get(r.equipo_id);
      const p = r.producto_id ? productos.get(r.producto_id) : null;
      return coincideRepuesto(r, q, [p?.nombre, e?.equipo, e?.marca, e?.modelo, e?.serial, e?.placa]);
    }).sort((a, b) => (porId.get(a.equipo_id)?.equipo ?? '').localeCompare(porId.get(b.equipo_id)?.equipo ?? '', 'es'));
  }, [q, renglones, porId, productos]);
  // Productos del inventario que coinciden y no están en ninguna ficha: hay que asignarlos.
  const sueltos = useMemo(() => {
    if (norm(q).length < 3) return [];
    const enFichas = new Set(renglones.map((r) => r.producto_id).filter(Boolean));
    return [...productos.values()].filter((p) => !enFichas.has(p.id) && coincideProducto(p, q)).slice(0, 30);
  }, [q, renglones, productos]);
  const conFicha = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of renglones) c.set(r.equipo_id, (c.get(r.equipo_id) ?? 0) + 1);
    return c;
  }, [renglones]);

  /* ───────── Qué comprar ───────── */
  const porServicio = useMemo<EquipoPorServicio[]>(() => equiposPorServicio(activos.map((e) => {
    const l = lecturas.get(e.id);
    return {
      id: e.id, equipo: e.equipo,
      aviso: avisoMasUrgente(
        avisoServicio(e.mantenimiento_cada_hrs, l?.horometro ?? null, e.mantenimiento_base_hrs, 'h'),
        avisoServicio(e.mantenimiento_cada_km, l?.kilometraje ?? null, e.mantenimiento_base_km, 'km'),
      ),
    };
  })), [activos, lecturas]);
  const necesidades = useMemo(() => necesidadesProximoServicio(porServicio, renglones, productos), [porServicio, renglones, productos]);
  const sinFichaPorServicio = porServicio.filter((e) => !conFicha.get(e.id));

  function listadoBusqueda(): ListadoFlota & { numeros: number[] } {
    return {
      titulo: 'REPUESTOS POR EQUIPO', subtitulo: `Búsqueda: «${q}» · ${hallados.length} coincidencia(s)`,
      archivo: `repuestos-por-equipo-${new Date().toISOString().slice(0, 10)}`,
      encabezados: ['Equipo', 'Marca / modelo', 'Sistema', 'Tipo', 'N° de parte', 'Equivalencias', 'Especificación', 'Cant.', 'Und', 'Producto del inventario', 'Stock'],
      anchos: [2, 2.2, 1.3, 2.2, 1.6, 2.8, 1.6, .7, .7, 3, .8], numeros: [7, 10],
      filas: hallados.map((r) => {
        const e = porId.get(r.equipo_id);
        const p = r.producto_id ? productos.get(r.producto_id) : null;
        return [e?.equipo ?? '—', [e?.marca, e?.modelo].filter(Boolean).join(' '), sistemaDe(r.sistema).label, r.tipo, r.numero_parte ?? '',
          textoEquivalencias(r.equivalencias), r.especificacion ?? '', r.cantidad, r.unidad, p?.nombre ?? 'No está en el inventario', p ? p.stock : null];
      }),
    };
  }
  function listadoCompra(): ListadoFlota & { numeros: number[] } {
    return {
      titulo: 'QUÉ COMPRAR PARA EL PRÓXIMO SERVICIO',
      subtitulo: `${porServicio.length} equipo(s) con el servicio vencido o próximo: ${porServicio.map((e) => e.equipo).join(', ') || '—'}`,
      archivo: `que-comprar-proximo-servicio-${new Date().toISOString().slice(0, 10)}`,
      encabezados: ['Repuesto', 'N° de parte / especificación', 'Hace falta', 'Und', 'En inventario', 'Falta comprar', 'Equipos'],
      anchos: [4, 3, 1.1, .8, 1.2, 1.2, 4], numeros: [2, 4, 5],
      filas: [
        ...necesidades.porProducto.map((n) => [n.producto.nombre, n.producto.sku ?? '', n.cantidad, n.producto.unidad, n.stock, n.faltante, n.equipos.join(', ')]),
        ...necesidades.sinProducto.map(({ equipo, renglon: r }) => [`${r.tipo} (no está en el inventario)`,
          [r.numero_parte, textoEquivalencias(r.equivalencias), r.especificacion].filter(Boolean).join(' · '), r.cantidad, r.unidad, 0, r.cantidad, equipo]),
      ],
    };
  }
  async function exportar(l: ListadoFlota & { numeros: number[] }, como: 'pdf' | 'excel') {
    try { if (como === 'pdf') await listadoFlotaPdf(l); else await listadoFlotaExcel(l); }
    catch (e) { toast(errMsg(e, 'No se pudo exportar'), 'error'); }
  }

  const sinFicha = activos.filter((e) => !conFicha.get(e.id));

  return (
    <div className="flo">
      <FlotaNav />
      <div className="page-head">
        <div>
          <h1 className="flo-h1">🔩 Repuestos por equipo</h1>
          <p className="flo-sub">Qué lleva cada equipo (filtros, aceites, cauchos), para qué equipo sirve cada pieza y qué comprar para el próximo servicio</p>
        </div>
        <div className="actions">
          {vista === 'buscar'
            ? <><button className="btn btn-ghost" disabled={!hallados.length} onClick={() => void exportar(listadoBusqueda(), 'pdf')}>↓ PDF</button>
              <button className="btn btn-ghost" disabled={!hallados.length} onClick={() => void exportar(listadoBusqueda(), 'excel')}>↓ Excel</button></>
            : <><button className="btn btn-ghost" disabled={!necesidades.porProducto.length && !necesidades.sinProducto.length} onClick={() => void exportar(listadoCompra(), 'pdf')}>↓ PDF</button>
              <button className="btn btn-ghost" disabled={!necesidades.porProducto.length && !necesidades.sinProducto.length} onClick={() => void exportar(listadoCompra(), 'excel')}>↓ Excel</button></>}
        </div>
      </div>

      <nav className="flo-tabs" role="tablist" aria-label="Vistas">
        <button role="tab" aria-selected={vista === 'buscar'} onClick={() => setVista('buscar')}>🔍 ¿Para qué equipo sirve?</button>
        <button role="tab" aria-selected={vista === 'comprar'} onClick={() => setVista('comprar')}>🛒 Qué comprar para el próximo servicio{porServicio.length ? <span className="n">{porServicio.length}</span> : null}</button>
      </nav>

      {loading ? <EmptyState message="Cargando…" /> : vista === 'buscar' ? (
        <div className="flo-panel" style={{ marginTop: '.8rem' }}>
          <div className="flo-filtros">
            <div className="fila">
              <input className="input flo-buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
                placeholder="🔍 Número de parte, equivalencia, 15W-40, 23.5R25, filtro de aceite…" aria-label="Buscar repuesto" />
            </div>
          </div>

          {norm(q).length < 2 ? (
            <div className="flo-sec">
              <div className="flo-sec-head"><h3>📋 Fichas cargadas</h3><span className="muted" style={{ fontSize: '.76rem' }}>{activos.length - sinFicha.length} de {activos.length} equipos activos</span></div>
              <div className="flo-hist">
                {[...activos].sort((a, b) => Number(!!conFicha.get(a.id)) - Number(!!conFicha.get(b.id)) || a.equipo.localeCompare(b.equipo, 'es')).map((e) => (
                  <div key={e.id}>
                    <span>{conFicha.get(e.id) ? '✅' : '⚪'}</span>
                    <div style={{ minWidth: 0 }}>
                      <strong>{e.equipo}</strong>
                      <small>{[e.marca, e.modelo, e.serial ? `Serial ${e.serial}` : null].filter(Boolean).join(' · ') || '—'}</small>
                    </div>
                    <Link className="btn btn-sm btn-ghost" to={`/app/maquinaria/equipo/${e.id}?tab=repuestos`}>{conFicha.get(e.id) ? `${conFicha.get(e.id)} repuesto(s)` : 'Cargar ficha'}</Link>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="flo-sec">
                <div className="flo-sec-head"><h3>🚜 Equipos que lo llevan</h3><span className="muted" style={{ fontSize: '.76rem' }}>{new Set(hallados.map((r) => r.equipo_id)).size} equipo(s) · {hallados.length} renglón(es)</span></div>
                {hallados.length ? (
                  <ul className="flo-parts flo-rep-list">
                    {hallados.map((r) => {
                      const e = porId.get(r.equipo_id);
                      const p = r.producto_id ? productos.get(r.producto_id) ?? null : null;
                      const st = ESTADO_STOCK[estadoStock(r.cantidad, p)];
                      return (
                        <li key={r.id}>
                          <div className="flo-rep-main">
                            <strong><Link to={`/app/maquinaria/equipo/${r.equipo_id}?tab=repuestos`}>{e?.equipo ?? 'Equipo'}</Link> · {sistemaDe(r.sistema).icon} {r.tipo}{r.numero_parte && <span className="mono"> · {r.numero_parte}</span>}</strong>
                            <span className="mono flo-rep-cant">{fmtNum(r.cantidad)} {r.unidad}</span>
                            <small>{[e?.marca, e?.modelo].filter(Boolean).join(' ')}{r.equivalencias.length ? <> · Equivalencias: <span className="mono">{textoEquivalencias(r.equivalencias)}</span></> : null}</small>
                            {(r.especificacion || textoCada(r)) && <small>{[r.especificacion, textoCada(r) ? `cada ${textoCada(r)}` : null].filter(Boolean).join(' · ')}</small>}
                          </div>
                          <span className="src"><span className={`flo-chip tone-${st.tono}`}>{st.icon} {p ? `${p.nombre} · ${fmtNum(p.stock)} ${p.unidad}` : st.label}</span></span>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>Ninguna ficha tiene ese repuesto. Revisa el número o carga la ficha del equipo.</p>}
              </div>
              {sueltos.length > 0 && (
                <div className="flo-sec">
                  <div className="flo-sec-head"><h3>📦 En el inventario, sin equipo asignado</h3><span className="muted" style={{ fontSize: '.76rem' }}>{sueltos.length}</span></div>
                  <p className="muted" style={{ fontSize: '.78rem', margin: '0 0 .4rem' }}>Coinciden con la búsqueda pero no están en ninguna ficha. Enlázalos desde la pestaña «Repuestos» del equipo que los usa.</p>
                  <div className="flo-hist">
                    {sueltos.map((p) => (
                      <div key={p.id}><span>📦</span><div style={{ minWidth: 0 }}><strong>{p.nombre}</strong><small>{[p.sku, p.categoria].filter(Boolean).join(' · ')}</small></div><span className="mono">{fmtNum(p.stock)} {p.unidad}</span></div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="flo-panel" style={{ marginTop: '.8rem' }}>
          <div className="aviso info sm"><span className="aviso-icono">🛒</span><div>
            Equipos con el servicio <strong>vencido o próximo</strong> según su contador, y la suma de lo que piden sus fichas (los repuestos marcados «en cada servicio»), contra el inventario. Para pedir la compra, abre la <strong>orden de servicio</strong> del equipo con «📋 Cargar de la ficha»: lo que no haya en el inventario se manda a Pedidos.
          </div></div>

          <div className="flo-sec">
            <div className="flo-sec-head"><h3>🚜 Equipos por servicio</h3><span className="muted" style={{ fontSize: '.76rem' }}>{porServicio.length}</span></div>
            {porServicio.length ? (
              <div className="flo-hist">
                {porServicio.map((e) => (
                  <div key={e.id}>
                    <span>{e.aviso!.nivel === 'vencido' ? '🔴' : '🟡'}</span>
                    <div style={{ minWidth: 0 }}>
                      <strong>{e.equipo}</strong>
                      <small>{e.aviso!.nivel === 'vencido' ? `Vencido por ${fmtNum(Math.abs(e.aviso!.restante))} ${e.aviso!.unidad}` : `Faltan ${fmtNum(e.aviso!.restante)} ${e.aviso!.unidad}`} · {conFicha.get(e.id) ? `${conFicha.get(e.id)} repuesto(s) en la ficha` : 'sin ficha de repuestos'}</small>
                    </div>
                    <Link className="btn btn-sm btn-ghost" to={`/app/maquinaria/equipo/${e.id}?tab=${conFicha.get(e.id) ? 'servicios' : 'repuestos'}`}>{conFicha.get(e.id) ? 'Orden de servicio' : 'Cargar ficha'}</Link>
                  </div>
                ))}
              </div>
            ) : <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>Ningún equipo tiene el servicio vencido o próximo.</p>}
            {sinFichaPorServicio.length > 0 && <p className="muted" style={{ fontSize: '.76rem', margin: '.5rem 0 0' }}>⚠️ {sinFichaPorServicio.length} de ellos no tienen ficha de repuestos: no entran en la suma.</p>}
          </div>

          <div className="flo-sec">
            <div className="flo-sec-head"><h3>📦 Lo que piden las fichas</h3><span className="muted" style={{ fontSize: '.76rem' }}>{necesidades.porProducto.filter((n) => n.faltante > 0).length} por comprar</span></div>
            {necesidades.porProducto.length ? (
              <ul className="flo-parts flo-rep-list">
                {necesidades.porProducto.map((n) => (
                  <li key={n.producto.id}>
                    <div className="flo-rep-main">
                      <strong>{n.producto.nombre}</strong>
                      <span className="mono flo-rep-cant">{fmtNum(n.cantidad)} {n.producto.unidad}</span>
                      <small>{n.equipos.join(', ')}</small>
                    </div>
                    <span className="src">
                      <span className={`flo-chip tone-${n.faltante > 0 ? (n.stock > 0 ? 'warning' : 'danger') : 'success'}`}>
                        {n.faltante > 0 ? `🛒 Falta comprar ${fmtNum(n.faltante)} ${n.producto.unidad}` : '🟢 Alcanza'} · hay {fmtNum(n.stock)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>Nada enlazado al inventario para estos equipos.</p>}
          </div>

          {necesidades.sinProducto.length > 0 && (
            <div className="flo-sec">
              <div className="flo-sec-head"><h3>⚪ No están en el inventario</h3><span className="muted" style={{ fontSize: '.76rem' }}>{necesidades.sinProducto.length}</span></div>
              <div className="flo-hist">
                {necesidades.sinProducto.map(({ equipo, renglon: r }) => (
                  <div key={r.id}>
                    <span>{sistemaDe(r.sistema).icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <strong>{r.tipo}{r.numero_parte ? ` · ${r.numero_parte}` : ''}</strong>
                      <small>{[equipo, r.especificacion, textoEquivalencias(r.equivalencias)].filter(Boolean).join(' · ')}</small>
                    </div>
                    <span className="mono">{fmtNum(r.cantidad)} {r.unidad}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
