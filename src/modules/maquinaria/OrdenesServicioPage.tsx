import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useSession } from '@/modules/auth/authStore';
import { useRealtime } from '@/shared/lib/useRealtime';
import { EmptyState } from '@/shared/ui/EmptyState';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { num as fmtNum, date as fmtDate, statusBadge } from '@/shared/lib/format';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { listEquipos, type MaquinariaEquipo } from './maquinariaEquipos.repository';
import { ORDEN_ESTADOS, SERVICIOS, URGENCIAS, servicioPorId, etiquetaServicio, faltaCompra, faltaSalida, puedeBorrarOrden, type EstadoOrdenServicio } from './flota';
import { listOrdenesServicio, salidasDeOrdenes, comprasPorIds, eliminarTodasLasOrdenesPrueba, type OrdenServicio, type CompraResumen } from './flota.repository';
import { filtrarOrdenes, contarPorEstado, type FiltroOrdenes } from './flotaListados';
import { ordenServicioPdf, listadoFlotaPdf, type ListadoFlota } from './flotaPdf';
import { listadoFlotaExcel } from './flotaExcel';
import { AccionConEquipo } from './AccionConEquipo';
import { FlotaNav } from './FlotaNav';
import { FotosOrdenModal } from './FotosOrdenServicio';
import { contarFotosPorOrden, TABLA_OS_FOTOS } from './osFotos.repository';
import { OrdenServicioModal } from './OrdenServicioModal';
import { BorrarOrdenDialog } from './BorrarOrdenDialog';

type PestanaEstado = NonNullable<FiltroOrdenes['estado']>;
const PESTANAS: { id: PestanaEstado; label: string }[] = [
  { id: 'abiertas', label: 'Abiertas' },
  { id: 'abierta', label: ORDEN_ESTADOS.abierta.label },
  { id: 'repuestos', label: ORDEN_ESTADOS.repuestos.label },
  { id: 'en_proceso', label: ORDEN_ESTADOS.en_proceso.label },
  { id: 'realizada', label: ORDEN_ESTADOS.realizada.label },
  { id: 'anulada', label: ORDEN_ESTADOS.anulada.label },
  { id: 'todas', label: 'Todas' },
];
const ESTADO_SALIDA: Record<string, string> = { por_aprobar: 'Por aprobar', aprobada: 'Aprobada', ejecutada: 'Ejecutada', cancelada: 'Cancelada' };

/**
 * Submódulo «Órdenes de servicio»: todas las órdenes de todos los equipos, por estado,
 * con filtros, búsqueda sin acentos, «+ Nueva orden» y PDF/Excel del listado.
 */
export function OrdenesServicioPage() {
  const { can, isAdmin, appUser } = usePermissions();
  const { user } = useSession();
  const canWrite = can('maquinaria', 'escritura');
  const [editar, setEditar] = useState<OrdenServicio | null>(null);
  const [borrar, setBorrar] = useState<OrdenServicio | null>(null);
  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenServicio[]>([]);
  const [salidas, setSalidas] = useState<Map<string, { codigo: string; estado: string }>>(new Map());
  const [compras, setCompras] = useState<Map<string, CompraResumen>>(new Map());
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState<FiltroOrdenes>({ estado: 'abiertas' });
  const [nueva, setNueva] = useState(false);
  const [nFotos, setNFotos] = useState<Map<string, number>>(new Map());
  const [verFotos, setVerFotos] = useState<OrdenServicio | null>(null);
  const [limpiandoPruebas, setLimpiandoPruebas] = useState(false);
  const [confirmLimpiar, setConfirmLimpiar] = useState(false);

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
      toast(e instanceof Error ? e.message : 'No se pudieron cargar las órdenes', 'error');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_ordenes_servicio', 'maquinaria_equipos', 'solicitudes_salida', 'ordenes'], () => { void cargar(); });
  // Cuántas fotos tiene cada orden (botón «📷 n»), en vivo.
  const cargarFotos = useCallback(() => { contarFotosPorOrden().then(setNFotos).catch(() => {}); }, []);
  useEffect(() => { cargarFotos(); }, [cargarFotos]);
  useRealtime([TABLA_OS_FOTOS], cargarFotos);

  const porId = useMemo(() => new Map(equipos.map((e) => [e.id, e])), [equipos]);
  const sinEstado = useMemo(() => filtrarOrdenes(ordenes, porId, { ...f, estado: 'todas' }), [ordenes, porId, f]);
  const cuenta = useMemo(() => contarPorEstado(sinEstado), [sinEstado]);
  const lista = useMemo(() => filtrarOrdenes(ordenes, porId, f), [ordenes, porId, f]);
  const opcEquipos = useMemo(() => [{ value: '', label: 'Todos los equipos' }, ...[...equipos].sort((a, b) => a.equipo.localeCompare(b.equipo, 'es')).map((e) => ({ value: e.id, label: e.equipo }))], [equipos]);
  const set = (p: Partial<FiltroOrdenes>) => setF((x) => ({ ...x, ...p }));

  function listado(): ListadoFlota & { numeros: number[] } {
    const filtros = [
      `Estado: ${PESTANAS.find((p) => p.id === f.estado)?.label ?? 'Todas'}`,
      f.equipoId ? `Equipo: ${porId.get(f.equipoId)?.equipo}` : '',
      f.tipo ? `Servicio: ${servicioPorId(f.tipo)?.label}` : '',
      f.urgencia ? `Urgencia: ${f.urgencia}` : '',
      f.desde ? `Desde ${fmtDate(f.desde)}` : '', f.hasta ? `Hasta ${fmtDate(f.hasta)}` : '',
      f.q ? `Búsqueda: «${f.q}»` : '',
    ].filter(Boolean).join(' · ');
    return {
      titulo: 'ÓRDENES DE SERVICIO', subtitulo: filtros, archivo: `ordenes-de-servicio-${new Date().toISOString().slice(0, 10)}`,
      encabezados: ['Orden', 'Fecha', 'Equipo', 'Servicio', 'Urgencia', 'Estado', 'Responsable', 'Descripción', 'Repuestos', 'Salida', 'Compra'],
      anchos: [2.4, 2, 3.4, 3, 1.6, 2.4, 2.8, 5, 4.4, 2.4, 2.4],
      numeros: [],
      filas: lista.map((o) => {
        const sal = o.solicitud_salida_id ? salidas.get(o.solicitud_salida_id) : null;
        const cmp = o.orden_compra_id ? compras.get(o.orden_compra_id) : null;
        return [
          o.codigo, fmtDate(o.created_at), porId.get(o.equipo_id)?.equipo ?? '—', etiquetaServicio(o.tipo, o.trabajos),
          URGENCIAS.find((u) => u.id === o.urgencia)?.label ?? o.urgencia, ORDEN_ESTADOS[o.estado]?.label ?? o.estado,
          o.responsable ?? '', o.descripcion ?? '',
          o.repuestos.map((r) => `${fmtNum(r.cantidad)} ${r.unidad} ${r.nombre}`).join('; '),
          sal ? `${sal.codigo} (${ESTADO_SALIDA[sal.estado] ?? sal.estado})` : faltaSalida(o) ? 'Por solicitar' : '',
          cmp ? `${cmp.oc_codigo || cmp.codigo} (${statusBadge(cmp.estado).label})` : faltaCompra(o) ? 'Por solicitar' : '',
        ];
      }),
    };
  }

  async function exportar(tipo: 'pdf' | 'excel') {
    try { if (tipo === 'pdf') await listadoFlotaPdf(listado()); else await listadoFlotaExcel(listado()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo exportar', 'error'); }
  }

  async function pdfOrden(o: OrdenServicio) {
    const eq = porId.get(o.equipo_id);
    if (!eq) return;
    const cmp = o.orden_compra_id ? compras.get(o.orden_compra_id) : null;
    try {
      await ordenServicioPdf(o, eq, {
        salida: o.solicitud_salida_id ? (salidas.get(o.solicitud_salida_id) ?? null) : null,
        compra: cmp ? { codigo: cmp.oc_codigo || cmp.codigo, estado: statusBadge(cmp.estado).label } : null,
      });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  async function limpiarPruebas() {
    setLimpiandoPruebas(true);
    try {
      const n = await eliminarTodasLasOrdenesPrueba();
      toast(`Se eliminaron ${n} órdenes de servicio de prueba.`, 'success');
      await cargar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al limpiar', 'error');
    } finally {
      setLimpiandoPruebas(false);
      setConfirmLimpiar(false);
    }
  }

  return (
    <div className="flo">
      <FlotaNav />
      <div className="page-head">
        <div>
          <h1 className="flo-h1">🧾 Órdenes de servicio</h1>
          <p className="flo-sub">Todas las órdenes de todos los equipos · {cuenta.abiertas} abierta(s)</p>
        </div>
        <div className="actions">
          {canWrite && <button className="btn btn-primary" onClick={() => setNueva(true)}>+ Nueva orden</button>}
          {isAdmin && ordenes.length > 0 && (
            <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setConfirmLimpiar(true)} title="Eliminar órdenes de servicio de prueba">
              🗑️ Limpiar pruebas
            </button>
          )}
          <button className="btn btn-ghost" disabled={!lista.length} onClick={() => void exportar('pdf')}>↓ PDF</button>
          <button className="btn btn-ghost" disabled={!lista.length} onClick={() => void exportar('excel')}>↓ Excel</button>
        </div>
      </div>

      <nav className="flo-tabs flo-tabs-plano" role="tablist" aria-label="Estado de la orden">
        {PESTANAS.map((p) => (
          <button key={p.id} role="tab" aria-selected={f.estado === p.id} onClick={() => set({ estado: p.id })}>
            {p.label}<span className="n">{cuenta[p.id] ?? 0}</span>
          </button>
        ))}
      </nav>

      <div className="flo-filtros" style={{ marginTop: '.7rem' }}>
        <div className="fila">
          <input className="input flo-buscar" type="search" value={f.q ?? ''} onChange={(e) => set({ q: e.target.value })}
            placeholder="🔍 Buscar orden, equipo, repuesto, responsable…" aria-label="Buscar" />
          <div className="flo-filtro-equipo"><SearchSelect options={opcEquipos} value={f.equipoId ?? ''} onChange={(v) => set({ equipoId: v || undefined })} placeholder="Equipo…" /></div>
        </div>
        <div className="fila">
          <select className="select" value={f.tipo ?? ''} onChange={(e) => set({ tipo: e.target.value || undefined })} aria-label="Tipo de servicio">
            <option value="">Todos los servicios</option>
            {SERVICIOS.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
          </select>
          <select className="select" value={f.urgencia ?? ''} onChange={(e) => set({ urgencia: e.target.value || undefined })} aria-label="Urgencia">
            <option value="">Toda urgencia</option>
            {URGENCIAS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
          <label className="flo-fecha">Desde<input className="input" type="date" value={f.desde ?? ''} onChange={(e) => set({ desde: e.target.value || undefined })} /></label>
          <label className="flo-fecha">Hasta<input className="input" type="date" value={f.hasta ?? ''} onChange={(e) => set({ hasta: e.target.value || undefined })} /></label>
        </div>
      </div>

      {loading ? <EmptyState message="Cargando…" /> : !lista.length ? (
        <EmptyState message={ordenes.length ? 'Ninguna orden con estos filtros.' : 'Todavía no hay órdenes de servicio. Se crean desde el expediente del equipo o con «+ Nueva orden».'} icon="🧾" />
      ) : (
        <div className="flo-lista">
          {lista.map((o) => {
            const eq = porId.get(o.equipo_id);
            const s = servicioPorId(o.tipo);
            const est = ORDEN_ESTADOS[o.estado as EstadoOrdenServicio];
            const urg = URGENCIAS.find((u) => u.id === o.urgencia);
            const sal = o.solicitud_salida_id ? salidas.get(o.solicitud_salida_id) : null;
            const cmp = o.orden_compra_id ? compras.get(o.orden_compra_id) : null;
            return (
              <div key={o.id} className="flo-orden">
                <div className="flo-orden-head">
                  <div style={{ minWidth: 0 }}>
                    <h3>{s?.icon} {o.codigo}</h3>
                    <p>{etiquetaServicio(o.tipo, o.trabajos)} · {fmtDate(o.created_at)}{o.responsable ? ` · ${o.responsable}` : ''}</p>
                    <p><Link to={`/app/maquinaria/equipo/${o.equipo_id}`}><strong>{eq?.equipo ?? 'Equipo'}</strong></Link>{eq?.tipo ? ` · ${eq.tipo}` : ''}</p>
                  </div>
                  <div className="flo-chips-col">
                    {est && <span className={`flo-chip tone-${est.tono}`}>{est.icon} {est.label}</span>}
                    {urg && urg.id !== 'normal' && <span className={`flo-chip tone-${urg.tono}`}>{urg.label}</span>}
                  </div>
                </div>
                {o.descripcion && <p style={{ margin: 0, fontSize: '.84rem', color: 'var(--text)' }}>{o.descripcion}</p>}
                {o.repuestos.length > 0 && (
                  <div className="muted" style={{ fontSize: '.78rem' }}>
                    🔩 {o.repuestos.map((r) => `${fmtNum(r.cantidad)} ${r.unidad} ${r.nombre}${r.producto_id ? '' : ' (pieza nueva)'}`).join(' · ')}
                  </div>
                )}
                {(sal || cmp || faltaSalida(o) || faltaCompra(o)) && (
                  <div className="flo-meta">
                    {sal ? <span>📦 Salida {sal.codigo}: {ESTADO_SALIDA[sal.estado] ?? sal.estado}</span> : faltaSalida(o) ? <span className="warn">📦 Salida por solicitar</span> : null}
                    {cmp ? <span>🛒 {cmp.oc_codigo || cmp.codigo}: {statusBadge(cmp.estado).label}</span> : faltaCompra(o) ? <span className="warn">🛒 Compra por solicitar</span> : null}
                  </div>
                )}
                <div className="flo-orden-foot">
                  <Link className="btn btn-primary" to={`/app/maquinaria/equipo/${o.equipo_id}?tab=servicios`}>Abrir la orden</Link>
                  <button className="btn" onClick={() => setVerFotos(o)}>📷 Fotos{nFotos.get(o.id) ? ` (${nFotos.get(o.id)})` : ''}</button>
                  <button className="btn" onClick={() => void pdfOrden(o)}>📄 PDF</button>
                  {canWrite && eq && <button className="btn btn-ghost" onClick={() => setEditar(o)}>✎ Editar</button>}
                  {puedeBorrarOrden(o, { maquinaria: canWrite, admin: isAdmin }) && <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setBorrar(o)}>🗑 Borrar</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {nueva && <AccionConEquipo accion="orden" equipos={equipos} onClose={() => setNueva(false)} onDone={() => void cargar()} />}
      {editar && porId.get(editar.equipo_id) && (
        <OrdenServicioModal equipo={porId.get(editar.equipo_id) as MaquinariaEquipo} horometro={editar.horometro} kilometraje={editar.kilometraje} aviso={null}
          orden={editar} puedeSalidas={can('salidas', 'escritura')} puedePedidos={can('pedidos', 'escritura')}
          actor={{ email: user?.email ?? 'sistema', nombre: appUser?.nombre ?? null }}
          onClose={() => setEditar(null)} onCreated={() => void cargar()} />
      )}
      {borrar && (
        <BorrarOrdenDialog orden={borrar} equipo={porId.get(borrar.equipo_id)?.equipo}
          salida={borrar.solicitud_salida_id ? salidas.get(borrar.solicitud_salida_id)?.codigo ?? 'vinculada' : null}
          compra={borrar.orden_compra_id ? (() => { const c = compras.get(borrar.orden_compra_id as string); return c ? c.oc_codigo || c.codigo : 'vinculado'; })() : null}
          onClose={() => setBorrar(null)} onDone={() => void cargar()} />
      )}
      {verFotos && (
        <FotosOrdenModal ordenId={verFotos.id} codigo={verFotos.codigo} equipo={porId.get(verFotos.equipo_id)?.equipo}
          canWrite={canWrite} onClose={() => setVerFotos(null)} />
      )}
      {confirmLimpiar && (
        <ConfirmDialog
          title="Limpiar órdenes de servicio de prueba"
          message={`¿Estás seguro de eliminar las ${ordenes.length} órdenes de servicio de prueba? Se borrarán del sistema y se restaurará el estado de los equipos.`}
          confirmText={limpiandoPruebas ? 'Limpiando…' : 'Sí, eliminar pruebas'}
          danger
          onCancel={() => setConfirmLimpiar(false)}
          onConfirm={() => void limpiarPruebas()}
        />
      )}
    </div>
  );
}
