import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { num as fmtNum, date as fmtDate, statusBadge } from '@/shared/lib/format';
import { listEquipos, type MaquinariaEquipo } from './maquinariaEquipos.repository';
import { COLUMNAS_COMPRA, puedeReemplazarPieza } from './flota';
import { listOrdenesServicio, salidasDeOrdenes, comprasPorIds, type OrdenServicio, type CompraResumen } from './flota.repository';
import {
  COLUMNAS_SALIDA, columnaSalidaDeOrden, columnaCompraDeOrden, ordenesConRepuestos, piezasNuevasPendientes, coincideTexto,
} from './flotaListados';
import { listadoFlotaPdf, type ListadoFlota } from './flotaPdf';
import { listadoFlotaExcel } from './flotaExcel';
import { ReemplazarPiezaModal } from './ReemplazarPiezaModal';
import { FlotaNav } from './FlotaNav';

const ESTADO_SALIDA: Record<string, string> = { por_aprobar: 'Por aprobar', aprobada: 'Aprobada', ejecutada: 'Entregada', cancelada: 'Cancelada' };

/**
 * Submódulo «Repuestos y compras» (solo lectura): lo que las órdenes de servicio pidieron
 * al inventario (solicitudes de salida) y a compras (solicitudes de pedido), y las piezas
 * nuevas que Compras todavía tiene que dar de alta. Las tarjetas se mueven en Salidas y
 * en Pedidos; aquí solo se sigue su avance.
 */
export function RepuestosComprasPage() {
  const { can } = usePermissions();
  const canWrite = can('maquinaria', 'escritura');
  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenServicio[]>([]);
  const [salidas, setSalidas] = useState<Map<string, { codigo: string; estado: string }>>(new Map());
  const [compras, setCompras] = useState<Map<string, CompraResumen>>(new Map());
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [reemplazo, setReemplazo] = useState<{ orden: OrdenServicio; indice: number } | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [eqs, ords] = await Promise.all([listEquipos(), listOrdenesServicio()]);
      setEquipos(eqs);
      setOrdenes(ords);
      const [sals, cmps] = await Promise.all([
        salidasDeOrdenes(ords).catch(() => new Map<string, { codigo: string; estado: string }>()),
        comprasPorIds(ords.map((o) => o.orden_compra_id ?? '')).catch(() => new Map<string, CompraResumen>()),
      ]);
      setSalidas(sals);
      setCompras(cmps);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cargar', 'error');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_ordenes_servicio', 'solicitudes_salida', 'ordenes', 'maquinaria_equipos'], () => { void cargar(); });

  const porId = useMemo(() => new Map(equipos.map((e) => [e.id, e])), [equipos]);
  const conRepuestos = useMemo(() => ordenesConRepuestos(ordenes).filter((o) => {
    const e = porId.get(o.equipo_id);
    return coincideTexto([o.codigo, e?.equipo, ...o.repuestos.map((r) => r.nombre)], q);
  }), [ordenes, porId, q]);
  const pendientes = useMemo(() => piezasNuevasPendientes(conRepuestos), [conRepuestos]);

  const tableroSalidas = useMemo(() => COLUMNAS_SALIDA.map((c) => ({
    ...c, ordenes: conRepuestos.filter((o) => columnaSalidaDeOrden(o, o.solicitud_salida_id ? salidas.get(o.solicitud_salida_id)?.estado : null) === c.id),
  })), [conRepuestos, salidas]);
  const columnasCompra = useMemo(() => [{ id: 'por_solicitar', label: 'Por solicitar', icon: '⚠️', tono: 'warning' }, ...COLUMNAS_COMPRA], []);
  const tableroCompras = useMemo(() => columnasCompra.map((c) => ({
    ...c, ordenes: conRepuestos.filter((o) => columnaCompraDeOrden(o, o.orden_compra_id ? compras.get(o.orden_compra_id)?.estado : null) === c.id),
  })), [conRepuestos, compras, columnasCompra]);

  const listado = (): ListadoFlota & { numeros: number[] } => ({
    titulo: 'REPUESTOS DE ÓRDENES DE SERVICIO', subtitulo: q ? `Búsqueda: «${q}»` : 'Todas las órdenes con repuestos',
    archivo: `repuestos-ordenes-servicio-${new Date().toISOString().slice(0, 10)}`,
    encabezados: ['Orden', 'Fecha', 'Equipo', 'Repuesto', 'Cant.', 'Unidad', 'Del inventario', 'A compra', 'Salida', 'Compra', 'Pieza nueva'],
    anchos: [2.4, 2, 3.2, 4.4, 1.2, 1.4, 1.8, 1.6, 2.6, 2.8, 2.6],
    numeros: [4, 6, 7],
    filas: conRepuestos.flatMap((o) => {
      const sal = o.solicitud_salida_id ? salidas.get(o.solicitud_salida_id) : null;
      const cmp = o.orden_compra_id ? compras.get(o.orden_compra_id) : null;
      return o.repuestos.map((r) => [
        o.codigo, fmtDate(o.created_at), porId.get(o.equipo_id)?.equipo ?? '—', r.nombre, r.cantidad, r.unidad, r.desde_inventario, r.a_comprar,
        r.desde_inventario > 0 ? (sal ? `${sal.codigo} (${ESTADO_SALIDA[sal.estado] ?? sal.estado})` : 'Por solicitar') : '',
        r.a_comprar > 0 ? (cmp ? `${cmp.oc_codigo || cmp.codigo} (${statusBadge(cmp.estado).label})` : 'Por solicitar') : '',
        r.producto_id ? '' : o.compras_notificada_at ? `Compras notificada ${fmtDate(o.compras_notificada_at)}` : 'Sin avisar',
      ]);
    }),
  });

  async function exportar(tipo: 'pdf' | 'excel') {
    try { if (tipo === 'pdf') await listadoFlotaPdf(listado()); else await listadoFlotaExcel(listado()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo exportar', 'error'); }
  }

  const tarjeta = (o: OrdenServicio, cual: 'salida' | 'compra') => {
    const eq = porId.get(o.equipo_id);
    const sal = o.solicitud_salida_id ? salidas.get(o.solicitud_salida_id) : null;
    const cmp = o.orden_compra_id ? compras.get(o.orden_compra_id) : null;
    const lineas = o.repuestos.filter((r) => (cual === 'salida' ? r.producto_id && r.desde_inventario > 0 : r.a_comprar > 0));
    return (
      <Link key={o.id} to={`/app/maquinaria/equipo/${o.equipo_id}?tab=servicios`} className="flo-kcard" style={{ textDecoration: 'none' }}>
        <div className="fila"><strong>{o.codigo}</strong><span>{fmtDate(o.created_at)}</span></div>
        <div>{eq?.equipo ?? 'Equipo'}</div>
        {lineas.slice(0, 4).map((r, i) => <div key={i}>{fmtNum(cual === 'salida' ? r.desde_inventario : r.a_comprar)} {r.unidad} · {r.nombre}{r.producto_id ? '' : ' (nueva)'}</div>)}
        {lineas.length > 4 && <div>+{lineas.length - 4} más</div>}
        {cual === 'salida' && sal && <div className="fila"><span>📦 {sal.codigo}</span></div>}
        {cual === 'compra' && cmp && <div className="fila"><span>🛒 {cmp.oc_codigo || cmp.codigo}</span><span className="mono">{cmp.total ? `${fmtNum(cmp.total)} ${cmp.total_moneda ?? ''}` : ''}</span></div>}
      </Link>
    );
  };

  return (
    <div className="flo">
      <FlotaNav />
      <div className="page-head">
        <div>
          <h1 className="flo-h1">🛒 Repuestos y compras</h1>
          <p className="flo-sub">Lo que las órdenes de servicio pidieron al inventario y a compras · solo lectura</p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" disabled={!conRepuestos.length} onClick={() => void exportar('pdf')}>↓ PDF</button>
          <button className="btn btn-ghost" disabled={!conRepuestos.length} onClick={() => void exportar('excel')}>↓ Excel</button>
        </div>
      </div>

      <div className="flo-filtros">
        <div className="fila">
          <input className="input flo-buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Buscar orden, equipo o repuesto…" aria-label="Buscar" />
        </div>
      </div>

      <div className="flo-sec">
        <div className="flo-sec-head"><h3>🔩 Piezas nuevas pendientes de Compras</h3><span className="muted" style={{ fontSize: '.76rem' }}>{pendientes.length}</span></div>
        {loading ? <EmptyState message="Cargando…" /> : pendientes.length ? (
          <div className="flo-hist">
            {pendientes.map(({ orden: o, pieza, indice }) => (
              <div key={`${o.id}-${indice}`}>
                <span>🔩</span>
                <div style={{ minWidth: 0 }}>
                  <strong>{fmtNum(pieza.cantidad)} {pieza.unidad} · {pieza.nombre}</strong>
                  <small><Link to={`/app/maquinaria/equipo/${o.equipo_id}?tab=servicios`}>{o.codigo}</Link> · {porId.get(o.equipo_id)?.equipo ?? 'Equipo'} · {o.compras_notificada_at ? `Compras notificada ${fmtDate(o.compras_notificada_at)}` : 'todavía sin avisar a Compras'}</small>
                </div>
                {canWrite && puedeReemplazarPieza(o, indice)
                  ? <button className="btn btn-sm" onClick={() => setReemplazo({ orden: o, indice })}>🔁 Ya existe</button>
                  : <span />}
              </div>
            ))}
          </div>
        ) : <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>No hay piezas nuevas pendientes.</p>}
      </div>

      <div className="flo-sec" style={{ marginTop: '.8rem' }}>
        <div className="flo-sec-head"><h3>📦 Salidas de inventario</h3><Link className="btn btn-sm btn-ghost" to="/app/salidas">Ir a Salidas</Link></div>
        <div className="flo-kanban">
          {tableroSalidas.map((c) => (
            <div key={c.id} className={`flo-kcol tone-${c.tono}`}>
              <header><span>{c.icon} {c.label}</span><span>{c.ordenes.length}</span></header>
              {c.ordenes.length ? c.ordenes.map((o) => tarjeta(o, 'salida')) : <div className="vacio">Nada aquí</div>}
            </div>
          ))}
        </div>
      </div>

      <div className="flo-sec" style={{ marginTop: '.8rem' }}>
        <div className="flo-sec-head"><h3>🛒 Compras</h3><Link className="btn btn-sm btn-ghost" to="/app/pedidos">Ir a Pedidos</Link></div>
        <div className="flo-kanban">
          {tableroCompras.map((c) => (
            <div key={c.id} className={`flo-kcol tone-${c.tono}`}>
              <header><span>{c.icon} {c.label}</span><span>{c.ordenes.length}</span></header>
              {c.ordenes.length ? c.ordenes.map((o) => tarjeta(o, 'compra')) : <div className="vacio">Nada aquí</div>}
            </div>
          ))}
        </div>
      </div>

      {reemplazo && <ReemplazarPiezaModal orden={reemplazo.orden} indice={reemplazo.indice} onClose={() => setReemplazo(null)} onDone={() => void cargar()} />}
    </div>
  );
}
