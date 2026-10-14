import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useSession } from '@/modules/auth/authStore';
import { useRealtime } from '@/shared/lib/useRealtime';
import { EmptyState } from '@/shared/ui/EmptyState';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { num as fmtNum, date as fmtDate, statusBadge } from '@/shared/lib/format';
import type { Producto } from '@/shared/lib/types';
import { listEquipos, type MaquinariaEquipo } from './maquinariaEquipos.repository';
import { COLUMNAS_COMPRA, puedeReemplazarPieza } from './flota';
import { listOrdenesServicio, salidasDeOrdenes, comprasPorIds, lecturasVigentesPorEquipo, type OrdenServicio, type CompraResumen, type LecturaVigente } from './flota.repository';
import {
  COLUMNAS_SALIDA, columnaSalidaDeOrden, columnaCompraDeOrden, ordenesConRepuestos, piezasNuevasPendientes, coincideTexto,
} from './flotaListados';
import { infoServicio, ESTADOS_SERVICIO } from './flotaMantenimiento';
import {
  buscarCompatibles, faltantesProximoServicio, proximoServicioNominal, estadoStock, ESTADOS_STOCK, detalleRepuesto, textoCada, sistemaDe,
  type RepuestoEquipo, type NecesidadServicio, type EquipoProximo,
} from './repuestosEquipo';
import { listRepuestosEquipo, productosDeFichas, solicitarCompraFaltantes } from './repuestosEquipo.repository';
import { listadoFlotaPdf, type ListadoFlota } from './flotaPdf';
import { listadoFlotaExcel } from './flotaExcel';
import { ReemplazarPiezaModal } from './ReemplazarPiezaModal';
import { FlotaNav } from './FlotaNav';

const ESTADO_SALIDA: Record<string, string> = { por_aprobar: 'Por aprobar', aprobada: 'Aprobada', ejecutada: 'Entregada', cancelada: 'Cancelada' };

/**
 * Submódulo «Repuestos y compras»: el buscador «¿para qué equipo sirve?» y «qué comprar para
 * el próximo servicio» (14/10/2026, sobre la ficha de repuestos de cada equipo), y el seguimiento
 * de lo que las órdenes de servicio pidieron al inventario (solicitudes de salida) y a compras
 * (solicitudes de pedido). Las tarjetas se mueven en Salidas y en Pedidos; aquí se sigue su avance.
 */
export function RepuestosComprasPage() {
  const { can, appUser } = usePermissions();
  const { user } = useSession();
  const canWrite = can('maquinaria', 'escritura');
  const canPedidos = can('pedidos', 'escritura');
  const actor = { email: user?.email ?? 'sistema', nombre: appUser?.nombre ?? null };
  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenServicio[]>([]);
  const [salidas, setSalidas] = useState<Map<string, { codigo: string; estado: string }>>(new Map());
  const [compras, setCompras] = useState<Map<string, CompraResumen>>(new Map());
  const [fichas, setFichas] = useState<RepuestoEquipo[]>([]);
  const [productos, setProductos] = useState<Map<string, Producto>>(new Map());
  const [lecturas, setLecturas] = useState<Map<string, LecturaVigente>>(new Map());
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [qComp, setQComp] = useState('');
  const [reemplazo, setReemplazo] = useState<{ orden: OrdenServicio; indice: number } | null>(null);
  const [confirmPedir, setConfirmPedir] = useState(false);
  const [pidiendo, setPidiendo] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [eqs, ords, fs, lecs] = await Promise.all([
        listEquipos(), listOrdenesServicio(),
        listRepuestosEquipo().catch(() => [] as RepuestoEquipo[]),
        lecturasVigentesPorEquipo().catch(() => new Map<string, LecturaVigente>()),
      ]);
      setEquipos(eqs);
      setOrdenes(ords);
      setFichas(fs);
      setLecturas(lecs);
      const [sals, cmps, prods] = await Promise.all([
        salidasDeOrdenes(ords).catch(() => new Map<string, { codigo: string; estado: string }>()),
        comprasPorIds(ords.map((o) => o.orden_compra_id ?? '')).catch(() => new Map<string, CompraResumen>()),
        productosDeFichas(fs).catch(() => new Map<string, Producto>()),
      ]);
      setSalidas(sals);
      setCompras(cmps);
      setProductos(prods);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cargar', 'error');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_ordenes_servicio', 'solicitudes_salida', 'ordenes', 'maquinaria_equipos', 'maquinaria_repuestos_equipo', 'maquinaria_lecturas'], () => { void cargar(); });

  const porId = useMemo(() => new Map(equipos.map((e) => [e.id, e])), [equipos]);
  const conRepuestos = useMemo(() => ordenesConRepuestos(ordenes).filter((o) => {
    const e = porId.get(o.equipo_id);
    return coincideTexto([o.codigo, e?.equipo, ...o.repuestos.map((r) => r.nombre)], q);
  }), [ordenes, porId, q]);
  const pendientes = useMemo(() => piezasNuevasPendientes(conRepuestos), [conRepuestos]);

  // ¿Para qué equipo sirve?
  const compatibles = useMemo(() => buscarCompatibles(fichas, qComp, productos), [fichas, qComp, productos]);

  // Qué comprar para el próximo servicio: equipos vencidos o próximos y lo que toca de su ficha.
  const proximos = useMemo(() => equipos
    .filter((e) => e.activo !== false)
    .map((e) => {
      const v = lecturas.get(e.id);
      const info = infoServicio(e, v?.horometro ?? null, v?.kilometraje ?? null);
      return { e, info };
    })
    .filter((x) => x.info.estado === 'vencido' || x.info.estado === 'proximo'), [equipos, lecturas]);
  const equiposProximos = useMemo<EquipoProximo[]>(() => proximos.map(({ e, info }) => ({
    id: e.id, equipo: e.equipo,
    proximoH: proximoServicioNominal(e.mantenimiento_cada_hrs, info.horometro, e.mantenimiento_base_hrs),
    proximoK: proximoServicioNominal(e.mantenimiento_cada_km, info.km, e.mantenimiento_base_km),
  })), [proximos]);
  const necesidades = useMemo(() => faltantesProximoServicio(equiposProximos, fichas, productos), [equiposProximos, fichas, productos]);
  const faltan = necesidades.filter((n) => n.faltante > 0);
  const equiposConFicha = useMemo(() => new Set(fichas.map((f) => f.equipo_id)), [fichas]);
  const proximosSinFicha = proximos.filter((x) => !equiposConFicha.has(x.e.id));

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
  const listadoFaltantes = (): ListadoFlota & { numeros: number[] } => ({
    titulo: 'QUÉ COMPRAR PARA EL PRÓXIMO SERVICIO', subtitulo: `${proximos.length} equipo(s) vencidos o próximos · ${new Date().toLocaleDateString('es-VE')}`,
    archivo: `que-comprar-proximo-servicio-${new Date().toISOString().slice(0, 10)}`,
    encabezados: ['Repuesto', 'Detalle', 'Unidad', 'Necesario', 'En stock', 'Falta', 'Equipos'],
    anchos: [3.4, 3.4, 1.2, 1.4, 1.4, 1.4, 4],
    numeros: [3, 4, 5],
    filas: necesidades.map((n) => [n.nombre, n.detalle, n.unidad, n.necesario, n.stock, n.faltante, n.equipos.map((e) => `${e.equipo} (${fmtNum(e.cantidad)})`).join(', ')]),
  });

  async function exportar(tipo: 'pdf' | 'excel', cual: 'ordenes' | 'faltantes' = 'ordenes') {
    try {
      const l = cual === 'ordenes' ? listado() : listadoFaltantes();
      if (tipo === 'pdf') await listadoFlotaPdf(l); else await listadoFlotaExcel(l);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo exportar', 'error'); }
  }

  async function pedirFaltantes() {
    setConfirmPedir(false);
    setPidiendo(true);
    try {
      const codigo = await solicitarCompraFaltantes(faltan, actor);
      toast(`🛒 Solicitud de pedido ${codigo} creada con ${faltan.length} renglón(es). Síguela en Pedidos.`, 'success');
      void cargar();
    } catch (e) {
      toast(e instanceof Error ? e.message : (e as { message?: string })?.message || 'No se pudo crear la solicitud', 'error');
    } finally { setPidiendo(false); }
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

  const necesidadFila = (n: NecesidadServicio) => (
    <div key={n.clave} className="flo-necesidad">
      <span aria-hidden="true">{n.faltante > 0 ? '🔴' : '🟢'}</span>
      <div style={{ minWidth: 0 }}>
        <strong>{n.nombre}{n.sku ? <span className="muted" style={{ fontWeight: 400 }}> · {n.sku}</span> : <span className="muted" style={{ fontWeight: 400 }}> · no está en el inventario</span>}</strong>
        {n.detalle && <small>{n.detalle}</small>}
        <small>Necesario {fmtNum(n.necesario)} {n.unidad} · en stock {n.stock == null ? '—' : `${fmtNum(n.stock)} ${n.unidad}`} · {n.equipos.map((e) => <Link key={e.equipo_id} to={`/app/maquinaria/equipo/${e.equipo_id}?tab=repuestos`}>{e.equipo} ({fmtNum(e.cantidad)})</Link>).reduce<ReactNode[]>((acc, x, i) => (i ? [...acc, ', ', x] : [x]), [])}</small>
      </div>
      <span className={`falta mono ${n.faltante > 0 ? 'si' : 'no'}`}>{n.faltante > 0 ? `falta ${fmtNum(n.faltante)} ${n.unidad}` : 'cubierto'}</span>
    </div>
  );

  return (
    <div className="flo">
      <FlotaNav />
      <div className="page-head">
        <div>
          <h1 className="flo-h1">🛒 Repuestos y compras</h1>
          <p className="flo-sub">Qué repuesto sirve para qué equipo, qué comprar para el próximo servicio y el avance de lo que pidieron las órdenes</p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" disabled={!conRepuestos.length} onClick={() => void exportar('pdf')}>↓ PDF</button>
          <button className="btn btn-ghost" disabled={!conRepuestos.length} onClick={() => void exportar('excel')}>↓ Excel</button>
        </div>
      </div>

      <div className="flo-sec">
        <div className="flo-sec-head"><h3>🔎 ¿Para qué equipo sirve?</h3><span className="muted" style={{ fontSize: '.76rem' }}>{fichas.length} renglón(es) en {equiposConFicha.size} ficha(s)</span></div>
        <input className="input flo-buscar" type="search" value={qComp} onChange={(e) => setQComp(e.target.value)} placeholder="🔍 Número de parte, equivalencia o especificación: P553771, 15W-40, 23.5R25…" aria-label="Buscar repuesto compatible" style={{ marginBottom: '.5rem' }} />
        {!fichas.length ? (
          <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>Todavía no hay fichas de repuestos. Se cargan en el expediente de cada equipo, pestaña <strong>Repuestos</strong>.</p>
        ) : !qComp.trim() ? (
          <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>Escribe el número original, el de una marca equivalente, la especificación o el nombre del producto: busca en todas las fichas, aunque el producto no esté enlazado al inventario.</p>
        ) : compatibles.length ? (
          <div className="flo-hist">
            {compatibles.map((r) => {
              const e = porId.get(r.equipo_id);
              const p = r.producto_id ? productos.get(r.producto_id) : null;
              const st = estadoStock(r, p);
              return (
                <div key={r.id}>
                  <span title={ESTADOS_STOCK[st.estado].label}>{ESTADOS_STOCK[st.estado].icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <strong><Link to={`/app/maquinaria/equipo/${r.equipo_id}?tab=repuestos`}>{e?.equipo ?? 'Equipo'}</Link> · {sistemaDe(r.sistema).icon} {r.tipo} · <span className="mono">{fmtNum(r.cantidad)} {r.unidad}</span></strong>
                    <small>{detalleRepuesto(r) || 'sin número de parte'} · {textoCada(r, fmtNum)}</small>
                    <small>{p ? `${p.nombre} (${p.sku}) · ${st.stock ? `${fmtNum(st.stock)} ${p.unidad} en stock` : 'sin stock'}` : 'No está en el inventario: se pide por número de parte'}</small>
                  </div>
                  <span />
                </div>
              );
            })}
          </div>
        ) : <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>Ningún equipo tiene «{qComp}» en su ficha.</p>}
      </div>

      <div className="flo-sec" style={{ marginTop: '.8rem' }}>
        <div className="flo-sec-head">
          <h3>🛒 Qué comprar para el próximo servicio</h3>
          <span style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-ghost" disabled={!necesidades.length} onClick={() => void exportar('pdf', 'faltantes')}>↓ PDF</button>
            <button className="btn btn-sm btn-ghost" disabled={!necesidades.length} onClick={() => void exportar('excel', 'faltantes')}>↓ Excel</button>
            {canPedidos && <button className="btn btn-sm btn-primary" disabled={!faltan.length || pidiendo} onClick={() => setConfirmPedir(true)}>{pidiendo ? 'Creando…' : `🛒 Crear solicitud de pedido (${faltan.length})`}</button>}
          </span>
        </div>
        <p className="muted" style={{ fontSize: '.8rem', margin: '0 0 .5rem' }}>
          {proximos.length
            ? <>Equipos vencidos o próximos: {proximos.map(({ e, info }, i) => <span key={e.id}>{i ? ', ' : ''}<Link to={`/app/maquinaria/equipo/${e.id}?tab=repuestos`}>{e.equipo}</Link> {ESTADOS_SERVICIO[info.estado].icon}{info.aviso ? ` ${info.aviso.restante <= 0 ? `vencido ${fmtNum(Math.abs(info.aviso.restante))}` : `faltan ${fmtNum(info.aviso.restante)}`} ${info.aviso.unidad}` : ''}</span>)}. Se suma lo que toca de su ficha y se le resta el stock.</>
            : 'Ningún equipo está vencido ni próximo a servicio ahora mismo (regla del Servicio de Mantenimiento).'}
          {proximosSinFicha.length > 0 && <> <strong>Sin ficha de repuestos:</strong> {proximosSinFicha.map((x) => x.e.equipo).join(', ')} (no entran en el cálculo).</>}
        </p>
        {loading ? <EmptyState message="Cargando…" /> : necesidades.length ? (
          <div>{necesidades.map(necesidadFila)}</div>
        ) : <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>Nada que comprar por ahora.</p>}
      </div>

      <div className="flo-filtros" style={{ marginTop: '.8rem' }}>
        <div className="fila">
          <input className="input flo-buscar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Buscar orden, equipo o repuesto pedido…" aria-label="Buscar" />
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
      {confirmPedir && (
        <ConfirmDialog title="Crear solicitud de pedido" confirmText="Crear solicitud" success
          message={<>Se crea en <strong>Pedidos</strong> una solicitud de pedido con los <strong>{faltan.length}</strong> faltantes del próximo servicio (unidad MANTENIMIENTO DE MAQUINARIA). Las piezas que no están en el inventario se dan de alta en REPUESTOS con stock 0.</>}
          preview={<ul className="flo-parts">{faltan.map((n) => <li key={n.clave}><span>{n.nombre}<small className="muted"> · {n.equipos.map((e) => e.equipo).join(', ')}</small></span><strong className="mono">{fmtNum(n.faltante)} {n.unidad}</strong></li>)}</ul>}
          onCancel={() => setConfirmPedir(false)} onConfirm={() => void pedirFaltantes()} />
      )}
    </div>
  );
}
