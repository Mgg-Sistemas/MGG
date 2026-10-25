import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useSession } from '@/modules/auth/authStore';
import { useRealtime } from '@/shared/lib/useRealtime';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { VistaPrevia, Dato } from '@/shared/ui/VistaPrevia';
import { toast } from '@/shared/ui/Toast';
import { num as fmtNum, date as fmtDate, dateTime } from '@/shared/lib/format';
import { statusBadge } from '@/shared/lib/format';
import {
  getEquipo, eliminarEquipo, reiniciarMantenimientoDeEquipo, type MaquinariaEquipo,
} from './maquinariaEquipos.repository';
import { addMantenimiento } from './maquinariaMant.repository';
import {
  ESTADOS_EQUIPO, ORDEN_ESTADOS, ORDEN_FLUJO, COLUMNAS_COMPRA, URGENCIAS, estadoEfectivo, avisoServicio, avisoMasUrgente,
  accionesEquipo, servicioPorId, siguientesEstadosOrden, columnaCompra, compraAbierta, ordenAbierta,
  faltaSalida, faltaCompra, etiquetaOrigenLectura, ultimoLavado, diasDesde, textoHace, puedeReemplazarPieza, etiquetaServicio,
  puedeBorrarOrden,
  type AccionEquipo, type EstadoOrdenServicio, type TonoFlota, type AvisoServicio,
} from './flota';
import {
  listOrdenesServicio, listEventosEstado, comprasDeEquipo, salidasDeOrdenes, fotosDeEquipos,
  lecturaVigenteEquipo, listLecturasEquipo, ultimoSurtidoEquipo,
  avanzarOrdenServicio, solicitarSalidaDeOrden, solicitarCompraDeOrden,
  listLavados, eliminarLavado, eliminarLectura,
  type LavadoEquipo,
  type OrdenServicio, type EventoEstado, type CompraEquipo, type FotoEquipo,
  type LecturaVigente, type LecturaMedidor, type UltimoSurtido,
} from './flota.repository';
import { fichaEquipoPdf, ordenServicioPdf, listadoFlotaPdf, type ListadoFlota } from './flotaPdf';
import { listadoFlotaExcel } from './flotaExcel';
import type { Producto } from '@/shared/lib/types';
import { agruparPorSistema, estadoStock, ESTADOS_STOCK, nombreRepuesto, detalleRepuesto, textoCada, sistemaDe, type RepuestoEquipo } from './repuestosEquipo';
import { listRepuestosEquipo, productosDeFichas, eliminarRepuestoEquipo } from './repuestosEquipo.repository';
import { RepuestoEquipoModal } from './RepuestoEquipoModal';
import { CopiarRepuestosModal } from './CopiarRepuestosModal';
import { EstadoEquipoModal, type ModoEstado } from './EstadoEquipoModal';
import { OrdenServicioModal } from './OrdenServicioModal';
import { PedirCompraModal } from './PedirCompraModal';
import { BitacoraModal } from './BitacoraModal';
import { DocumentosEquipoModal } from './DocumentosEquipoModal';
import { subirFotosEquipo, eliminarFotoEquipo, hacerPortadaFoto, cambiarEncuadreFoto } from './fotosEquipo.repository';
import { MAX_FOTOS_EQUIPO, avisoCupoFotos, cupoFotos } from './fotosEquipo';
import { EquipoMovimientosModal } from './EquipoMovimientosModal';
import { EquipoFormModal } from './EquipoFormModal';
import { LavadoModal } from './LavadoModal';
import { LecturaModal } from './LecturaModal';
import { ReemplazarPiezaModal } from './ReemplazarPiezaModal';
import { FotosOrden, FotosOrdenModal } from './FotosOrdenServicio';
import { EstadoDetalleModal } from './EstadoDetalleModal';
import { BorrarOrdenDialog } from './BorrarOrdenDialog';
import { SeguimientoCompraModal } from './SeguimientoCompraModal';
import { NombreUsuario } from '@/shared/ui/NombreUsuario';

type Tab = 'resumen' | 'servicios' | 'repuestos' | 'compras' | 'contador' | 'lavados' | 'fotos' | 'ficha';
const TABS: { id: Tab; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'servicios', label: 'Servicios' },
  { id: 'repuestos', label: 'Repuestos' },
  { id: 'compras', label: 'Compras' },
  { id: 'contador', label: 'Contador' },
  { id: 'lavados', label: 'Lavados' },
  { id: 'fotos', label: 'Fotos y documentos' },
  { id: 'ficha', label: 'Ficha' },
];

const ESTADO_SALIDA: Record<string, string> = { por_aprobar: 'Por aprobar', aprobada: 'Aprobada', ejecutada: 'Ejecutada', cancelada: 'Cancelada' };

function Chip({ tono, children, lg }: { tono: TonoFlota; children: ReactNode; lg?: boolean }) {
  return <span className={`flo-chip tone-${tono}${lg ? ' lg' : ''}`}>{children}</span>;
}

const errMsg = (e: unknown, def: string) => (e instanceof Error ? e.message : (e as { message?: string })?.message || def);

/**
 * Expediente del equipo: placa de identificación, aviso de estado con la acción que
 * lo resuelve, signos vitales, «Opciones» (solo lo que el usuario puede)
 * y pestañas. Reutiliza los modales de siempre (bitácora, documentos, ficha, consumos).
 */
export function EquipoExpedientePage() {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const { can, appUser, isAdmin } = usePermissions();
  const { user } = useSession();
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;
  const perm = {
    maquinaria: can('maquinaria', 'escritura'),
    combustible: can('combustible', 'escritura'),
    salidas: can('salidas', 'escritura'),
    pedidos: can('pedidos', 'escritura'),
    admin: isAdmin,
  };
  const tab = (TABS.some((t) => t.id === sp.get('tab')) ? sp.get('tab') : 'resumen') as Tab;
  const setTab = (t: Tab) => setSp((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });

  const [eq, setEq] = useState<MaquinariaEquipo | null>(null);
  const [loading, setLoading] = useState(true);
  const [horometro, setHorometro] = useState<number | null>(null);
  const [km, setKm] = useState<number | null>(null);
  const [vigente, setVigente] = useState<LecturaVigente | null>(null);
  const [lecturas, setLecturas] = useState<LecturaMedidor[]>([]);
  const [ultimoSurtido, setUltimoSurtido] = useState<UltimoSurtido | null>(null);
  const [lecturaOpen, setLecturaOpen] = useState(false);
  const [ordenes, setOrdenes] = useState<OrdenServicio[]>([]);
  const [eventos, setEventos] = useState<EventoEstado[]>([]);
  const [compras, setCompras] = useState<CompraEquipo[]>([]);
  const [salidas, setSalidas] = useState<Map<string, { codigo: string; estado: string }>>(new Map());
  const [fotos, setFotos] = useState<FotoEquipo[]>([]);
  const [lavados, setLavados] = useState<LavadoEquipo[]>([]);
  // Ficha de repuestos y consumibles del equipo (14/10/2026) con el stock de los productos vinculados.
  const [fichaRep, setFichaRep] = useState<RepuestoEquipo[]>([]);
  const [productosRep, setProductosRep] = useState<Map<string, Producto>>(new Map());
  const [nuevoRep, setNuevoRep] = useState(false);
  const [editarRep, setEditarRep] = useState<RepuestoEquipo | null>(null);
  const [borrarRep, setBorrarRep] = useState<RepuestoEquipo | null>(null);
  const [copiarRep, setCopiarRep] = useState(false);

  const [modoEstado, setModoEstado] = useState<ModoEstado | null>(null);
  const [nuevaOrden, setNuevaOrden] = useState(false);
  const [bitacora, setBitacora] = useState(false);
  const [documentos, setDocumentos] = useState(false);
  const [movimientos, setMovimientos] = useState(false);
  const [editar, setEditar] = useState(false);
  const [confirmMantt, setConfirmMantt] = useState(false);
  const [borrar, setBorrar] = useState(false);
  const [cerrar, setCerrar] = useState<{ orden: OrdenServicio; estado: EstadoOrdenServicio } | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [lavadoOpen, setLavadoOpen] = useState(false);
  const [borrarLavado, setBorrarLavado] = useState<LavadoEquipo | null>(null);
  const [reemplazo, setReemplazo] = useState<{ orden: OrdenServicio; indice: number } | null>(null);
  const [detalleEstado, setDetalleEstado] = useState(false);
  const [editarOrden, setEditarOrden] = useState<OrdenServicio | null>(null);
  // «Pedir compra» de una orden con piezas que no están en el inventario (se elige su categoría).
  const [pedirCompra, setPedirCompra] = useState<OrdenServicio | null>(null);
  const [borrarOrden, setBorrarOrden] = useState<OrdenServicio | null>(null);
  const [editarLavado, setEditarLavado] = useState<LavadoEquipo | null>(null);
  const [editarLectura, setEditarLectura] = useState<string | null>(null);
  const [borrarLectura, setBorrarLectura] = useState<LecturaMedidor | null>(null);
  // «Ver compra»: seguimiento de la compra aquí mismo (no hace falta permiso de Pedidos).
  const [verCompra, setVerCompra] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const e = await getEquipo(id);
      setEq(e);
      if (!e) return;
      const vinc = (e.combustible_equipo ?? '').trim();
      // Contador vigente UNIFICADO (Combustible, Maquinaria y bitácora): el mismo que usa el surtidor.
      const [vig, lecs, surt, ords, evs, fts, lavs, reps] = await Promise.all([
        lecturaVigenteEquipo(e.id).catch(() => null),
        listLecturasEquipo(e.id).catch(() => [] as LecturaMedidor[]),
        ultimoSurtidoEquipo(vinc).catch(() => null),
        listOrdenesServicio(e.id).catch(() => [] as OrdenServicio[]),
        listEventosEstado(e.id).catch(() => [] as EventoEstado[]),
        fotosDeEquipos(e.id).catch(() => [] as FotoEquipo[]),
        listLavados(e.id).catch(() => [] as LavadoEquipo[]),
        listRepuestosEquipo(e.id).catch(() => [] as RepuestoEquipo[]),
      ]);
      setVigente(vig);
      setHorometro(vig?.horometro ?? null);
      setKm(vig?.kilometraje ?? null);
      setLecturas(lecs);
      setUltimoSurtido(surt);
      setOrdenes(ords);
      setEventos(evs);
      setFotos(fts);
      setLavados(lavs);
      setFichaRep(reps);
      const [cps, sals, prods] = await Promise.all([
        comprasDeEquipo(e.id, ords).catch(() => [] as CompraEquipo[]),
        salidasDeOrdenes(ords).catch(() => new Map<string, { codigo: string; estado: string }>()),
        productosDeFichas(reps).catch(() => new Map<string, Producto>()),
      ]);
      setCompras(cps);
      setSalidas(sals);
      setProductosRep(prods);
    } catch (err) {
      toast(errMsg(err, 'No se pudo cargar el equipo'), 'error');
    } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { setLoading(true); void cargar(); }, [cargar]);
  useRealtime([
    'maquinaria_equipos', 'maquinaria_ordenes_servicio', 'maquinaria_estado_eventos', 'maquinaria_mantenimientos',
    'maquinaria_documentos', 'maquinaria_fotos', 'maquinaria_lavados', 'maquinaria_lecturas', 'maquinaria_repuestos_equipo', 'ordenes', 'solicitudes_salida', 'combustible_tanque_movimientos',
  ], () => { void cargar(); });

  // Fotos del equipo (16-10-2026): subir (cámara o galería), eliminar y elegir la portada.
  const [subiendoFotos, setSubiendoFotos] = useState(0);
  const [borrarFoto, setBorrarFoto] = useState<FotoEquipo | null>(null);
  const portadaInputRef = useRef<HTMLInputElement>(null);
  const subirFotos = useCallback(async (files: File[]) => {
    if (!eq || !files.length) return;
    const { tomar, descartadas } = cupoFotos(fotos.length, files);
    const aviso = avisoCupoFotos(descartadas);
    if (aviso) toast(aviso, 'warning');
    if (!tomar.length) return;
    setSubiendoFotos(tomar.length);
    try {
      const r = await subirFotosEquipo(eq.id, tomar, actor);
      if (r.subidas) toast(r.subidas === 1 ? 'Foto subida' : `${r.subidas} fotos subidas`, 'success');
      if (r.fallos.length) toast(`No se pudieron subir ${r.fallos.length} foto(s): ${r.fallos.join('; ')}`, 'error');
      await cargar();
    } finally { setSubiendoFotos(0); }
  }, [eq, fotos.length, actor, cargar]);
  // Encuadre de la foto en la portada: «cubrir» (recorta para llenar) o «completa» (se ve entera).
  const alternarEncuadre = useCallback((f: FotoEquipo) => {
    const nuevo = f.encuadre === 'completa' ? 'cubrir' : 'completa';
    void cambiarEncuadreFoto(f.id, nuevo)
      .then(() => { toast(nuevo === 'completa' ? 'La foto se muestra completa' : 'La foto llena la portada (recortada)', 'success'); void cargar(); })
      .catch((e) => toast(errMsg(e, 'No se pudo cambiar el encuadre'), 'error'));
  }, [cargar]);
  const elegirPortada = useCallback((f: FotoEquipo) => {
    if (!eq) return;
    void hacerPortadaFoto(eq.id, f.id)
      .then(() => { toast('Esa foto ahora es la portada', 'success'); void cargar(); })
      .catch((e) => toast(errMsg(e, 'No se pudo cambiar la portada'), 'error'));
  }, [eq, cargar]);

  const estado = eq ? estadoEfectivo(eq) : 'operativa';
  const avisoH = eq ? avisoServicio(eq.mantenimiento_cada_hrs, horometro, eq.mantenimiento_base_hrs, 'h') : null;
  const avisoK = eq ? avisoServicio(eq.mantenimiento_cada_km, km, eq.mantenimiento_base_km, 'km') : null;
  const aviso = avisoMasUrgente(avisoH, avisoK);
  const acciones = useMemo(
    () => accionesEquipo({ maquinaria: perm.maquinaria, combustible: perm.combustible }, estado, { avisoServicio: !!aviso && aviso.nivel !== 'ok' }),
    [perm.maquinaria, perm.combustible, estado, aviso],
  );
  const puede = (a: AccionEquipo) => acciones.includes(a);
  const abiertas = ordenes.filter((o) => ordenAbierta(o.estado));
  const comprasAbiertas = compras.filter((c) => compraAbierta(c.estado));
  const cuenta: Partial<Record<Tab, number>> = { servicios: abiertas.length, repuestos: fichaRep.length, compras: comprasAbiertas.length, lavados: lavados.length, fotos: fotos.length };
  const lavado = ultimoLavado(lavados);

  if (loading && !eq) return <EmptyState message="Cargando expediente…" />;
  if (!eq) {
    return (
      <div className="flo">
        <Link className="flo-volver" to="/app/maquinaria">← Catálogo</Link>
        <EmptyState message="Equipo no encontrado (puede que lo hayan eliminado)." icon="🚜" />
      </div>
    );
  }

  const st = ESTADOS_EQUIPO[estado];
  const foto = fotos[0]?.url ?? null;

  async function pdfFicha() {
    if (!eq) return;
    try {
      await fichaEquipoPdf(eq, {
        horometro, km, restantesHrs: avisoH?.restante ?? null, restantesKm: avisoK?.restante ?? null,
        ultimoSurtido: ultimoSurtido ? `${fmtDate(ultimoSurtido.fecha)} · ${fmtNum(ultimoSurtido.litros)} L${ultimoSurtido.tanque ? ` · ${ultimoSurtido.tanque}` : ''}` : null,
      }, ordenes, fotos, lavados, fichaRep);
    } catch (e) { toast(errMsg(e, 'No se pudo generar la ficha'), 'error'); }
  }

  /** La ficha de repuestos del equipo como listado (PDF / Excel) para el mecánico o para pedir cotización. */
  function listadoRepuestos(): ListadoFlota & { numeros: number[] } {
    if (!eq) throw new Error('Sin equipo');
    return {
      titulo: `FICHA DE REPUESTOS · ${eq.equipo}`,
      subtitulo: [eq.marca, eq.modelo, eq.serial ? `Serial ${eq.serial}` : '', eq.placa ? `Placa ${eq.placa}` : ''].filter(Boolean).join(' · ') || 'Repuestos y consumibles',
      archivo: `ficha-repuestos-${eq.equipo}-${new Date().toISOString().slice(0, 10)}`,
      encabezados: ['Sistema', 'Repuesto', 'N° de parte', 'Equivalencias', 'Especificación', 'Cant.', 'Unidad', 'Cada', 'Producto', 'Stock', 'Nota'],
      anchos: [1.8, 2.8, 2.2, 3.2, 2.6, 1, 1.2, 2, 3, 1.4, 2.6],
      numeros: [5, 9],
      filas: agruparPorSistema(fichaRep).flatMap((g) => g.items.map((r) => {
        const p = r.producto_id ? productosRep.get(r.producto_id) : null;
        return [g.sistema.label, r.tipo, r.numero_parte, r.equivalencias, r.especificacion, r.cantidad, r.unidad, textoCada(r, fmtNum), p ? `${p.nombre} (${p.sku})` : 'No está en el inventario', p ? Math.max(0, Number(p.stock) || 0) : null, r.nota];
      })),
    };
  }
  async function exportarRepuestos(tipo: 'pdf' | 'excel') {
    try { if (tipo === 'pdf') await listadoFlotaPdf(listadoRepuestos()); else await listadoFlotaExcel(listadoRepuestos()); }
    catch (e) { toast(errMsg(e, 'No se pudo exportar la ficha de repuestos'), 'error'); }
  }

  async function pdfOrden(o: OrdenServicio) {
    if (!eq) return;
    const compra = o.orden_compra_id ? compras.find((c) => c.id === o.orden_compra_id) : null;
    try {
      await ordenServicioPdf(o, eq, {
        salida: o.solicitud_salida_id ? (salidas.get(o.solicitud_salida_id) ?? null) : null,
        compra: compra ? { codigo: compra.oc_codigo || compra.codigo, estado: statusBadge(compra.estado).label } : null,
      });
    } catch (e) { toast(errMsg(e, 'No se pudo generar el PDF'), 'error'); }
  }

  async function iniciar(o: OrdenServicio) {
    setTrabajando(o.id);
    try { await avanzarOrdenServicio(o.id, 'en_proceso'); toast(`${o.codigo}: trabajo iniciado.`, 'success'); await cargar(); }
    catch (e) { toast(errMsg(e, 'No se pudo avanzar la orden'), 'error'); }
    finally { setTrabajando(null); }
  }

  async function pedir(o: OrdenServicio, que: 'salida' | 'compra') {
    if (!eq) return;
    if (que === 'compra' && o.repuestos.some((r) => !r.producto_id && r.a_comprar > 0)) { setPedirCompra(o); return; }
    setTrabajando(o.id);
    try {
      const codigo = que === 'salida'
        ? await solicitarSalidaDeOrden(o, eq.equipo, { email: actor, nombre: actorName })
        : await solicitarCompraDeOrden(o, [], { email: actor, nombre: actorName });
      toast(`${o.codigo}: ${que === 'salida' ? 'salida' : 'solicitud de pedido'} ${codigo} creada.`, 'success');
      await cargar();
    } catch (e) { toast(errMsg(e, 'No se pudo crear la solicitud'), 'error'); }
    finally { setTrabajando(null); }
  }


  async function manttHecho() {
    if (!eq) return;
    try {
      const { horas, km: k } = await reiniciarMantenimientoDeEquipo(eq.id);
      if (horas == null && k == null) toast('No hay horómetro ni kilometraje vigente para fijar la base.', 'warning');
      else toast(`Contador reiniciado desde ${[horas != null ? `${fmtNum(horas)} h` : null, k != null ? `${fmtNum(k)} km` : null].filter(Boolean).join(' · ')}.`, 'success');
      await cargar();
    } catch (e) { toast(errMsg(e, 'No se pudo reiniciar el contador'), 'error'); }
  }

  /* ───────── Aviso según el estado ───────── */
  const orden0 = abiertas[0];
  const avisoEstado: { tono: TonoFlota; titulo: string; texto: string; cta?: ReactNode } | null = (() => {
    const btnServicio = puede('servicio') ? <button className="btn btn-sm btn-primary" onClick={() => setNuevaOrden(true)}>Crear orden de servicio</button> : undefined;
    switch (estado) {
      case 'averiada': case 'parada':
        return {
          tono: estado === 'averiada' ? 'danger' : 'warning',
          titulo: `${st.label}${eq.estado_nota ? ` · ${eq.estado_nota}` : ''}`,
          texto: `${eq.estado_desde ? `Desde ${fmtDate(eq.estado_desde)}. ` : ''}${orden0 ? `Tiene la orden ${orden0.codigo} en curso.` : 'Abre una orden de servicio: toma los repuestos del inventario y pide a compras lo que falte.'}`,
          cta: orden0 ? <button className="btn btn-sm" onClick={() => setTab('servicios')}>Ver orden</button> : btnServicio,
        };
      case 'taller':
        return { tono: 'primary', titulo: `En taller${orden0 ? ` · ${orden0.codigo}` : ''}`, texto: eq.estado_nota || 'Orden de servicio en curso.', cta: <button className="btn btn-sm" onClick={() => setTab('servicios')}>Ver orden</button> };
      case 'repuestos':
        return { tono: 'warning', titulo: `Esperando repuestos${orden0 ? ` · ${orden0.codigo}` : ''}`, texto: 'La orden sigue sola cuando Pedidos reciba la compra.', cta: <button className="btn btn-sm" onClick={() => (orden0?.orden_compra_id ? setVerCompra(orden0.orden_compra_id) : setTab('compras'))}>Ver compra</button> };
      case 'espera':
        return { tono: 'wait', titulo: 'Esperando instrucciones', texto: eq.estado_nota || 'Sin frente asignado.', cta: puede('quitar_espera') ? <button className="btn btn-sm btn-success" onClick={() => setModoEstado('operativa')}>Ya se decidió</button> : undefined };
      case 'retirada':
        return { tono: 'retired', titulo: 'Retirada de servicio', texto: eq.estado_nota || 'El equipo está inactivo. No se borró nada.', cta: puede('reactivar') ? <button className="btn btn-sm btn-success" onClick={() => setModoEstado('operativa')}>Reactivar</button> : undefined };
      default:
        if (aviso && aviso.nivel !== 'ok') {
          return {
            tono: aviso.nivel === 'vencido' ? 'danger' : 'warning',
            titulo: aviso.nivel === 'vencido' ? `Servicio vencido por ${fmtNum(Math.abs(aviso.restante))} ${aviso.unidad}` : `Servicio en ${fmtNum(aviso.restante)} ${aviso.unidad}`,
            texto: 'Según el contador vigente (Combustible, Maquinaria y bitácora).', cta: btnServicio,
          };
        }
        return null;
    }
  })();

  return (
    <div className="flo flo-exp">
      <Link className="flo-volver" to="/app/maquinaria">← Catálogo</Link>

      <div className="flo-hero">
        <div className="flo-media">
          {foto ? <img src={foto} alt={`${eq.equipo}: ${fotos[0].nombre}`} style={fotos[0].encuadre === 'completa' ? { objectFit: 'contain', background: '#0b0d10' } : undefined} /> : <div className="sin-foto"><span className="ico">🚜</span><span>Sin foto del equipo</span></div>}
          {foto && perm.maquinaria && (
            <button className="fotos-btn" type="button" style={{ right: 'auto', left: '.6rem' }} title="Cambiar cómo se ajusta la foto en la portada"
              onClick={() => alternarEncuadre(fotos[0])}>
              ⤢ {fotos[0].encuadre === 'completa' ? 'Ver recortada' : 'Ver completa'}
            </button>
          )}
          <div className={`estado tone-${st.tono}`}><Chip tono={st.tono} lg>{st.icon} {st.label}</Chip></div>
          {/* Sin foto y con escritura: el botón abre DIRECTO la galería o la cámara del teléfono
              (el selector nativo ofrece las dos). Con fotos, va a la pestaña Fotos (ahí se elige la portada). */}
          <button className="fotos-btn" type="button" disabled={subiendoFotos > 0}
            onClick={() => (fotos.length || !perm.maquinaria ? setTab('fotos') : portadaInputRef.current?.click())}>
            📷 {subiendoFotos ? 'Subiendo…' : fotos.length ? `${fotos.length} foto(s)` : perm.maquinaria ? 'Subir foto' : 'Fotos'}
          </button>
          <input ref={portadaInputRef} type="file" accept="image/*" multiple hidden aria-label="Subir foto del equipo"
            onChange={(e) => { const fs = Array.from(e.currentTarget.files ?? []); e.currentTarget.value = ''; void subirFotos(fs); }} />
        </div>
        <div className="flo-plate">
          <div className="fila"><span className="marca">{eq.marca || 'Sin marca'}</span><span className="prop">{eq.propietario || ''}</span></div>
          <h1>{eq.equipo}</h1>
          <div className="modelo">{[eq.modelo, eq.anio].filter(Boolean).join(' · ') || eq.tipo || '—'}</div>
          <div className="pin">
            <small>SERIAL / PIN</small><b>{eq.serial || '—'}</b>
            {eq.placa && <><small>PLACA</small><b>{eq.placa}</b></>}
          </div>
        </div>
      </div>

      <div className="flo-body">
        {avisoEstado && (
          <div className={`flo-aviso flo-clic tone-${avisoEstado.tono}`}>
            {/* Toda la tarjeta abre el detalle (motivo completo, informe técnico, documentos). */}
            <button type="button" className="flo-estirar" onClick={() => setDetalleEstado(true)} aria-label={`Ver el detalle del estado: ${avisoEstado.titulo}`} />
            <span className="ico">{st.icon}</span>
            <div className="txt"><strong>{avisoEstado.titulo}</strong><p>{avisoEstado.texto}</p></div>
            {avisoEstado.cta && <span className="flo-sobre">{avisoEstado.cta}</span>}
          </div>
        )}

        <Vitales vigente={vigente} avisoH={avisoH} avisoK={avisoK} equipo={eq} ultimoSurtido={ultimoSurtido} lavado={lavado} onLavados={() => setTab('lavados')} onContador={() => setTab('contador')} />

        <section aria-labelledby="flo-acc" style={{ display: 'grid', gap: '.6rem' }}>
          <div className="flo-acc-head"><h2 id="flo-acc">Opciones</h2></div>
          {(puede('servicio') || puede('averia') || puede('lavado') || puede('lectura')) && (
            <div className="flo-tiles">
              {puede('servicio') && (
                <button type="button" className="flo-tile principal" onClick={() => setNuevaOrden(true)}>
                  <span className="ico">🔧</span>
                  <div><strong>Servicio</strong><span>Mantenimiento, reparación o cambio de piezas. Usa el inventario y pide a compras lo que falte.</span>
                    <div className="tags"><i>Preventivo</i><i>Reparación</i><i>Cauchos</i><i>Piezas</i></div></div>
                  <span className="go" aria-hidden="true">+</span>
                </button>
              )}
              {puede('averia') && <Tile icon="🔴" titulo="Reportar avería" sub="Averiada o parada, con motivo" onClick={() => setModoEstado('averia')} />}
              {puede('lavado') && <Tile icon="🚿" titulo="Registrar lavado" sub={lavado ? `Último ${textoHace(diasDesde(lavado.fecha))} · ${lavado.tipo}` : 'Completo, exterior, interior, motor…'} onClick={() => setLavadoOpen(true)} />}
              {puede('lectura') && <Tile icon="⏱️" titulo="Registrar horómetro / km" sub={vigente?.horometro != null ? `Vigente ${fmtNum(vigente.horometro)} h · se sincroniza con Combustible` : 'Se sincroniza con Combustible'} onClick={() => setLecturaOpen(true)} />}
            </div>
          )}
          <div className="flo-quick">
            {puede('bitacora') && <button type="button" onClick={() => setBitacora(true)}><span className="ico">📒</span><span>Bitácora</span></button>}
            <button type="button" onClick={() => setMovimientos(true)}><span className="ico">🧾</span><span>Consumos</span></button>
            {puede('documentos') && <button type="button" onClick={() => setDocumentos(true)}><span className="ico">📎</span><span>Documentos</span></button>}
            {puede('ficha') && <button type="button" onClick={() => void pdfFicha()}><span className="ico">📄</span><span>Ficha PDF</span></button>}
            {puede('editar') && <button type="button" onClick={() => setEditar(true)}><span className="ico">✎</span><span>Editar ficha</span></button>}
            {puede('mantt_hecho') && <button type="button" onClick={() => setConfirmMantt(true)}><span className="ico">✔</span><span>Mantt. hecho</span></button>}
          </div>
          {(puede('espera') || puede('quitar_espera') || puede('retirar') || puede('reactivar') || puede('eliminar')) && (
            <div className="flo-estado-acc">
              {puede('espera') && <button className="btn" onClick={() => setModoEstado('espera')}>⏳ Esperando instrucciones</button>}
              {puede('quitar_espera') && <button className="btn btn-success" onClick={() => setModoEstado('operativa')}>✅ Ya se decidió (quitar espera)</button>}
              {puede('retirar') && <button className="btn btn-danger" onClick={() => setModoEstado('retirar')}>⬛ Retirar de servicio</button>}
              {puede('reactivar') && <button className="btn btn-success" onClick={() => setModoEstado('operativa')}>✅ Reactivar (operativa)</button>}
              {puede('eliminar') && <button className="btn btn-ghost" onClick={() => setBorrar(true)}>🗑 Eliminar</button>}
            </div>
          )}
          {!perm.maquinaria && <p className="flo-solo-lectura">Puedes consultar este equipo, su bitácora y su ficha. Para abrir servicios o cambiar su estado hace falta permiso de escritura en Maquinaria.</p>}
        </section>

        <nav className="flo-tabs" role="tablist" aria-label="Secciones del equipo">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}{cuenta[t.id] ? <span className="n">{cuenta[t.id]}</span> : null}
            </button>
          ))}
        </nav>

        <section className="flo-panel" role="tabpanel">
          {tab === 'resumen' && <TabResumen eq={eq} eventos={eventos} ordenes={ordenes} lavados={lavados} />}
          {tab === 'lavados' && <TabLavados lavados={lavados} puedeRegistrar={puede('lavado')} puedeEditar={perm.maquinaria} onNuevo={() => setLavadoOpen(true)} onEditar={setEditarLavado} onBorrar={setBorrarLavado} />}
          {tab === 'servicios' && (
            <TabServicios
              onReemplazar={(o, i) => setReemplazo({ orden: o, indice: i })}
              ordenes={ordenes} salidas={salidas} compras={compras} perm={perm} trabajando={trabajando}
              puedeCrear={puede('servicio')} onNueva={() => setNuevaOrden(true)}
              onIniciar={(o) => void iniciar(o)} onCerrar={(o, e) => setCerrar({ orden: o, estado: e })}
              onPedir={(o, q) => void pedir(o, q)} onPdf={(o) => void pdfOrden(o)} onVerCompra={setVerCompra}
              onEditar={setEditarOrden} onBorrar={setBorrarOrden}
            />
          )}
          {tab === 'repuestos' && (
            <TabRepuestos ficha={fichaRep} productos={productosRep} puedeEditar={perm.maquinaria}
              onNuevo={() => setNuevoRep(true)} onCopiar={() => setCopiarRep(true)} onEditar={setEditarRep} onBorrar={setBorrarRep}
              onPdf={() => void exportarRepuestos('pdf')} onExcel={() => void exportarRepuestos('excel')} />
          )}
          {tab === 'compras' && <TabCompras compras={compras} puedePedidos={perm.pedidos} onVer={setVerCompra} />}
          {tab === 'contador' && <TabContador eq={eq} vigente={vigente} lecturas={lecturas} ultimoSurtido={ultimoSurtido} puede={puede('lectura')} onRegistrar={() => setLecturaOpen(true)}
            puedeEditar={perm.maquinaria} isAdmin={isAdmin} onEditar={setEditarLectura} onBorrar={setBorrarLectura} />}
          {tab === 'fotos' && (
            <TabFotos fotos={fotos} puedeEditar={perm.maquinaria} subiendo={subiendoFotos} onDocs={() => setDocumentos(true)}
              onSubir={(fs) => void subirFotos(fs)} onBorrar={setBorrarFoto} onPortada={elegirPortada} onEncuadre={alternarEncuadre} />
          )}
          {tab === 'ficha' && <TabFicha eq={eq} onPdf={() => void pdfFicha()} />}
        </section>
      </div>

      {modoEstado && <EstadoEquipoModal equipo={eq} modo={modoEstado} onClose={() => setModoEstado(null)} onSaved={() => void cargar()} />}
      {detalleEstado && <EstadoDetalleModal equipo={eq} evento={eventos[0] ?? null} enExpediente onClose={() => setDetalleEstado(false)} onCambio={() => void cargar()} />}
      {nuevaOrden && (
        <OrdenServicioModal equipo={eq} horometro={horometro} kilometraje={km} aviso={aviso}
          puedeSalidas={perm.salidas} puedePedidos={perm.pedidos} actor={{ email: actor, nombre: actorName }}
          onClose={() => setNuevaOrden(false)} onCreated={() => { setTab('servicios'); void cargar(); }} />
      )}
      {editarOrden && (
        <OrdenServicioModal equipo={eq} horometro={horometro} kilometraje={km} aviso={aviso} orden={editarOrden}
          puedeSalidas={perm.salidas} puedePedidos={perm.pedidos} actor={{ email: actor, nombre: actorName }}
          onClose={() => setEditarOrden(null)} onCreated={() => void cargar()} />
      )}
      {pedirCompra && <PedirCompraModal orden={pedirCompra} onClose={() => setPedirCompra(null)} onDone={() => void cargar()} />}
      {borrarOrden && (
        <BorrarOrdenDialog orden={borrarOrden} equipo={eq.equipo}
          salida={borrarOrden.solicitud_salida_id ? salidas.get(borrarOrden.solicitud_salida_id)?.codigo ?? 'vinculada' : null}
          compra={borrarOrden.orden_compra_id ? (() => { const c = compras.find((x) => x.id === borrarOrden.orden_compra_id); return c ? c.oc_codigo || c.codigo : 'vinculado'; })() : null}
          onClose={() => setBorrarOrden(null)} onDone={() => void cargar()} />
      )}
      {cerrar && (
        <CerrarOrdenModal orden={cerrar.orden} estado={cerrar.estado} equipo={eq} horometro={horometro} km={km}
          actor={actor} actorName={actorName} onClose={() => setCerrar(null)} onDone={() => void cargar()} />
      )}
      {lecturaOpen && (
        <LecturaModal equipo={eq} isAdmin={isAdmin}
          vigente={vigente ?? { horometro: null, horometro_fecha: null, horometro_origen: null, kilometraje: null, km_fecha: null, km_origen: null }}
          onClose={() => setLecturaOpen(false)} onSaved={() => void cargar()} />
      )}
      {editarLectura && (
        <LecturaModal equipo={eq} isAdmin={isAdmin} lecturaId={editarLectura}
          vigente={vigente ?? { horometro: null, horometro_fecha: null, horometro_origen: null, kilometraje: null, km_fecha: null, km_origen: null }}
          onClose={() => setEditarLectura(null)} onSaved={() => void cargar()} />
      )}
      {verCompra && (() => {
        const os = ordenes.find((o) => o.orden_compra_id === verCompra);
        return <SeguimientoCompraModal compraId={verCompra} equipoId={eq.id} ordenServicio={os ? { id: os.id, codigo: os.codigo } : null}
          puedePedidos={perm.pedidos} onClose={() => setVerCompra(null)} />;
      })()}
      {borrarLectura && (
        <ConfirmDialog title="Borrar lectura" danger confirmText="Borrar"
          message="Se borra esta lectura del contador. El horómetro / km vigente se recalcula con las demás lecturas (también el arranque del próximo surtido en Combustible). No se puede deshacer."
          preview={<VistaPrevia><Dato label="Equipo">{eq.equipo}</Dato><Dato label="Lectura">{[borrarLectura.horometro != null ? `${fmtNum(borrarLectura.horometro)} h` : null, borrarLectura.kilometraje != null ? `${fmtNum(borrarLectura.kilometraje)} km` : null].filter(Boolean).join(' · ')}</Dato><Dato label="Fecha">{dateTime(borrarLectura.fecha)}</Dato><Dato label="Tipo">{borrarLectura.es_correccion ? 'Corrección (solo administrador)' : undefined}</Dato><Dato label="Registró">{borrarLectura.actor ? <NombreUsuario correo={borrarLectura.actor} /> : undefined}</Dato></VistaPrevia>}
          onCancel={() => setBorrarLectura(null)}
          onConfirm={() => {
            const l = borrarLectura; setBorrarLectura(null);
            void eliminarLectura(l.referencia).then(() => { toast('Lectura borrada: el contador vigente se recalculó.', 'success'); void cargar(); })
              .catch((e) => toast(errMsg(e, 'No se pudo borrar la lectura'), 'error'));
          }} />
      )}
      {nuevoRep && <RepuestoEquipoModal equipo={eq} ficha={fichaRep} actor={{ email: actor, nombre: actorName }} onClose={() => setNuevoRep(false)} onSaved={() => void cargar()} />}
      {editarRep && <RepuestoEquipoModal equipo={eq} ficha={fichaRep} repuesto={editarRep} actor={{ email: actor, nombre: actorName }} onClose={() => setEditarRep(null)} onSaved={() => void cargar()} />}
      {copiarRep && <CopiarRepuestosModal equipo={eq} ficha={fichaRep} actor={{ email: actor, nombre: actorName }} onClose={() => setCopiarRep(false)} onDone={() => void cargar()} />}
      {borrarRep && (
        <ConfirmDialog title="Quitar de la ficha" danger confirmText="Quitar"
          message={<>Se quita <strong>{nombreRepuesto(borrarRep)}</strong> de la ficha de repuestos de {eq.equipo}. Las órdenes de servicio que ya lo pidieron no cambian.</>}
          onCancel={() => setBorrarRep(null)}
          onConfirm={() => {
            const r = borrarRep; setBorrarRep(null);
            void eliminarRepuestoEquipo(r.id).then(() => { toast(`${nombreRepuesto(r)} quitado de la ficha`, 'success'); void cargar(); })
              .catch((e) => toast(errMsg(e, 'No se pudo quitar'), 'error'));
          }} />
      )}
      {editarLavado && (
        <LavadoModal equipo={eq} horometro={horometro} km={km} ultimo={lavado} actor={{ email: actor, nombre: actorName }} lavado={editarLavado}
          onClose={() => setEditarLavado(null)} onSaved={() => void cargar()} />
      )}
      {lavadoOpen && (
        <LavadoModal equipo={eq} horometro={horometro} km={km} ultimo={lavado} actor={{ email: actor, nombre: actorName }}
          onClose={() => setLavadoOpen(false)} onSaved={() => void cargar()} />
      )}
      {reemplazo && (
        <ReemplazarPiezaModal orden={reemplazo.orden} indice={reemplazo.indice} onClose={() => setReemplazo(null)} onDone={() => void cargar()} />
      )}
      {borrarLavado && (
        <ConfirmDialog title="Borrar lavado" danger confirmText="Borrar"
          message="Se borra este registro de lavado. No se puede deshacer."
          preview={<VistaPrevia><Dato label="Equipo">{eq.equipo}</Dato><Dato label="Lavado">{borrarLavado.tipo}</Dato><Dato label="Fecha">{dateTime(borrarLavado.fecha)}</Dato><Dato label="Lo realizó">{borrarLavado.responsable ?? undefined}</Dato><Dato label="Registró">{borrarLavado.actor_name || borrarLavado.actor ? <NombreUsuario nombre={borrarLavado.actor_name} correo={borrarLavado.actor} /> : undefined}</Dato></VistaPrevia>}
          onCancel={() => setBorrarLavado(null)}
          onConfirm={() => {
            const l = borrarLavado; setBorrarLavado(null);
            void eliminarLavado(l.id).then(() => { toast('Lavado borrado', 'success'); void cargar(); })
              .catch((e) => toast(errMsg(e, 'No se pudo borrar el lavado'), 'error'));
          }} />
      )}
      {bitacora && <BitacoraModal equipo={eq} canWrite={perm.maquinaria} actor={actor} actorName={actorName} onClose={() => setBitacora(false)} />}
      {documentos && <DocumentosEquipoModal equipo={eq} canWrite={perm.maquinaria} actor={actor} onClose={() => { setDocumentos(false); void cargar(); }} />}
      {borrarFoto && (
        <ConfirmDialog
          title="Eliminar foto"
          message={<>Se elimina la foto <strong>{borrarFoto.nombre}</strong> de {eq.equipo}. Se borra el archivo; no se puede deshacer.</>}
          confirmText="Eliminar" danger
          onCancel={() => setBorrarFoto(null)}
          onConfirm={() => {
            const f = borrarFoto; setBorrarFoto(null);
            void eliminarFotoEquipo(f).then(() => { toast('Foto eliminada', 'success'); void cargar(); })
              .catch((e) => toast(errMsg(e, 'No se pudo eliminar la foto'), 'error'));
          }}
        />
      )}
      {movimientos && <EquipoMovimientosModal equipo={eq} onClose={() => setMovimientos(false)} />}
      {editar && <EquipoFormModal equipo={eq} actor={actor} onClose={() => setEditar(false)} onSaved={() => void cargar()} />}
      {confirmMantt && (
        <ConfirmDialog title="Mantenimiento hecho" confirmText="Reiniciar contador"
          message="Se marca el mantenimiento como realizado: el contador de horas/km vuelve a empezar desde la lectura vigente."
          preview={<VistaPrevia titulo="Base nueva"><Dato label="Equipo">{eq.equipo}</Dato><Dato label="Horómetro">{horometro != null ? `${fmtNum(horometro)} h` : undefined}</Dato><Dato label="Kilometraje">{km != null ? `${fmtNum(km)} km` : undefined}</Dato></VistaPrevia>}
          onCancel={() => setConfirmMantt(false)} onConfirm={() => { setConfirmMantt(false); void manttHecho(); }} />
      )}
      {borrar && (
        <ConfirmDialog title="Eliminar equipo" danger confirmText="Eliminar" requireText={eq.equipo}
          message="Se borra el equipo con su bitácora, sus documentos, sus órdenes de servicio y su historial de estados. No se puede deshacer. Si solo dejó de trabajar, usa «Retirar de servicio»."
          preview={<VistaPrevia><Dato label="Equipo">{eq.equipo}</Dato><Dato label="Tipo">{eq.tipo ?? undefined}</Dato><Dato label="Serial">{eq.serial ?? undefined}</Dato><Dato label="Órdenes">{ordenes.length ? String(ordenes.length) : undefined}</Dato></VistaPrevia>}
          onCancel={() => setBorrar(false)}
          onConfirm={() => {
            setBorrar(false);
            void eliminarEquipo(eq.id).then(() => { toast('Equipo eliminado', 'success'); navigate('/app/maquinaria'); })
              .catch((e) => toast(errMsg(e, 'No se pudo eliminar'), 'error'));
          }} />
      )}
    </div>
  );
}

function Tile({ icon, titulo, sub, onClick }: { icon: string; titulo: string; sub: string; onClick: () => void }) {
  return <button type="button" className="flo-tile" onClick={onClick}><span className="ico">{icon}</span><strong>{titulo}</strong><span>{sub}</span></button>;
}

function Vitales({ vigente, avisoH, avisoK, equipo, ultimoSurtido, lavado, onLavados, onContador }: {
  vigente: LecturaVigente | null; avisoH: AvisoServicio | null; avisoK: AvisoServicio | null;
  equipo: MaquinariaEquipo; ultimoSurtido: UltimoSurtido | null; lavado: LavadoEquipo | null; onLavados: () => void; onContador: () => void;
}) {
  const horometro = vigente?.horometro ?? null;
  const km = vigente?.kilometraje ?? null;
  const origen = horometro != null ? vigente?.horometro_origen : vigente?.km_origen;
  const dias = diasDesde(lavado?.fecha);
  const aviso = avisoMasUrgente(avisoH, avisoK);
  const tono = !aviso ? 'var(--text-dim)' : aviso.nivel === 'vencido' ? 'var(--danger)' : aviso.nivel === 'proximo' ? 'var(--warning)' : 'var(--success)';
  const lectura = horometro != null ? { v: horometro, u: 'h', l: 'Horómetro' } : km != null ? { v: km, u: 'km', l: 'Kilometraje' } : null;
  return (
    <div className="flo-vitals">
      <button type="button" className="flo-vital flo-vital-btn" onClick={onContador} aria-label="Ver el contador del equipo">
        <small>{lectura?.l ?? 'Horómetro / km'}</small>
        <strong>{lectura ? fmtNum(lectura.v) : '—'}{lectura && <em>{lectura.u}</em>}</strong>
        <span>{[horometro != null && km != null ? `${fmtNum(km)} km` : null, lectura ? etiquetaOrigenLectura(origen) : 'Sin lecturas'].filter(Boolean).join(' · ')}</span>
      </button>
      <div className="flo-vital">
        <small>Próx. servicio</small>
        <strong>{aviso ? fmtNum(Math.max(0, aviso.restante)) : '—'}{aviso && <em>{aviso.unidad}</em>}</strong>
        {aviso && <div className="flo-meter" style={{ ['--tone' as string]: tono }}><i style={{ width: `${aviso.pct}%` }} /></div>}
        <span>{!aviso ? 'Define el intervalo en la ficha' : aviso.nivel === 'vencido' ? `Vencido por ${fmtNum(Math.abs(aviso.restante))} ${aviso.unidad}` : aviso.nivel === 'proximo' ? 'Servicio próximo' : `Cada ${fmtNum(aviso.unidad === 'h' ? equipo.mantenimiento_cada_hrs : equipo.mantenimiento_cada_km)} ${aviso.unidad}`}</span>
      </div>
      <button type="button" className="flo-vital flo-vital-btn" onClick={onContador} aria-label="Ver el último surtido">
        <small>Último surtido</small>
        <strong>{ultimoSurtido ? fmtNum(ultimoSurtido.litros) : '—'}{ultimoSurtido && <em>L</em>}</strong>
        <span>{ultimoSurtido ? `${fmtDate(ultimoSurtido.fecha)}${ultimoSurtido.tanque ? ` · ${ultimoSurtido.tanque}` : ''}` : equipo.combustible_equipo ? 'Sin surtidos' : 'Sin vínculo en Combustible'}</span>
      </button>
      <button type="button" className="flo-vital flo-vital-btn" onClick={onLavados} aria-label="Ver los lavados del equipo">
        <small>Último lavado</small>
        <strong>{dias == null ? '—' : dias}{dias != null && <em>{dias === 1 ? 'día' : 'días'}</em>}</strong>
        <span>{lavado ? `${lavado.tipo} · ${textoHace(dias)}` : 'Sin lavados registrados'}</span>
      </button>
    </div>
  );
}

function TabResumen({ eq, eventos, ordenes, lavados }: { eq: MaquinariaEquipo; eventos: EventoEstado[]; ordenes: OrdenServicio[]; lavados: LavadoEquipo[] }) {
  const actividad = [
    ...eventos.map((e) => ({
      at: e.created_at, icon: ESTADOS_EQUIPO[e.estado]?.icon ?? '•',
      titulo: `${e.estado_anterior && ESTADOS_EQUIPO[e.estado_anterior as keyof typeof ESTADOS_EQUIPO] ? `${ESTADOS_EQUIPO[e.estado_anterior as keyof typeof ESTADOS_EQUIPO].label} → ` : ''}${ESTADOS_EQUIPO[e.estado]?.label ?? e.estado}`,
      detalle: [e.motivo, e.material ? `falta ${e.material}` : null, e.nota, e.actor_name || e.actor].filter(Boolean).join(' · '),
    })),
    ...ordenes.map((o) => ({ at: o.created_at, icon: servicioPorId(o.tipo)?.icon ?? '🔧', titulo: `${o.codigo} abierta`, detalle: [servicioPorId(o.tipo)?.label, o.actor_name || o.created_by].filter(Boolean).join(' · ') })),
    ...lavados.map((l) => ({ at: l.fecha, icon: '🚿', titulo: `Lavado ${l.tipo.toLowerCase()}`, detalle: [l.responsable, l.nota, l.actor_name || l.actor].filter(Boolean).join(' · ') })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  return (
    <div className="flo-2col">
      <div className="flo-sec">
        <div className="flo-sec-head"><h3>🧭 Asignación y ubicación</h3></div>
        <dl className="flo-facts">
          <Fact label="Tipo" v={eq.tipo} />
          <Fact label="Propietario" v={eq.propietario} />
          <Fact label="Ubicación" v={eq.ubicacion} />
          <Fact label="Grupo de mantenimiento" v={eq.grupo_mantenimiento} />
          <Fact label="Equipo en Combustible" v={eq.combustible_equipo} />
          <Fact label="Status (registro)" v={eq.status} />
          <Fact label="Notas" v={eq.notas} />
        </dl>
      </div>
      <div className="flo-sec">
        <div className="flo-sec-head"><h3>🕘 Actividad</h3></div>
        {actividad.length ? (
          <ol className="flo-timeline">
            {actividad.map((a, i) => <li key={i}><span>{a.icon}</span><div><strong>{a.titulo}</strong><span>{dateTime(a.at)}{a.detalle ? ` · ${a.detalle}` : ''}</span></div></li>)}
          </ol>
        ) : <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>Sin actividad registrada desde el 09/10/2026. La bitácora de siempre sigue en «📒 Bitácora».</p>}
      </div>
    </div>
  );
}

function Fact({ label, v }: { label: string; v: string | null | undefined }) {
  if (!v) return null;
  return <div><dt>{label}</dt><dd>{v}</dd></div>;
}

function TabServicios({ ordenes, salidas, compras, perm, trabajando, puedeCrear, onNueva, onIniciar, onCerrar, onPedir, onPdf, onVerCompra, onReemplazar, onEditar, onBorrar }: {
  ordenes: OrdenServicio[]; salidas: Map<string, { codigo: string; estado: string }>; compras: CompraEquipo[];
  perm: { maquinaria: boolean; salidas: boolean; pedidos: boolean; admin: boolean }; trabajando: string | null; puedeCrear: boolean;
  onEditar: (o: OrdenServicio) => void; onBorrar: (o: OrdenServicio) => void;
  onNueva: () => void; onIniciar: (o: OrdenServicio) => void; onCerrar: (o: OrdenServicio, e: EstadoOrdenServicio) => void;
  onPedir: (o: OrdenServicio, q: 'salida' | 'compra') => void; onPdf: (o: OrdenServicio) => void; onVerCompra: (compraId: string) => void;
  onReemplazar: (o: OrdenServicio, indice: number) => void;
}) {
  const [fotosDe, setFotosDe] = useState<OrdenServicio | null>(null);
  const abiertas = ordenes.filter((o) => ordenAbierta(o.estado));
  const cerradas = ordenes.filter((o) => !ordenAbierta(o.estado));
  return (
    <>
      {puedeCrear && <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={onNueva}>🔧 Crear orden de servicio</button>}
      <Link className="flo-ver-todo" to="/app/maquinaria/ordenes">Ver las órdenes de toda la flota →</Link>
      {abiertas.length ? abiertas.map((o) => {
        const s = servicioPorId(o.tipo);
        const est = ORDEN_ESTADOS[o.estado];
        const idx = ORDEN_FLUJO.indexOf(o.estado);
        const urg = URGENCIAS.find((u) => u.id === o.urgencia);
        const sal = o.solicitud_salida_id ? salidas.get(o.solicitud_salida_id) : null;
        const cmp = o.orden_compra_id ? compras.find((c) => c.id === o.orden_compra_id) : null;
        const sig = siguientesEstadosOrden(o.estado);
        const ocupado = trabajando === o.id;
        return (
          <div key={o.id} className="flo-orden">
            <div className="flo-orden-head">
              <div><h3>{s?.icon} {o.codigo}</h3><p>{etiquetaServicio(o.tipo, o.trabajos)} · {fmtDate(o.created_at)} · {o.responsable || 'responsable por asignar'}</p></div>
              <div style={{ display: 'grid', gap: '.3rem', justifyItems: 'end' }}>
                <Chip tono={est.tono}>{est.icon} {est.label}</Chip>
                {urg && urg.id !== 'normal' && <Chip tono={urg.tono}>{urg.label}</Chip>}
              </div>
            </div>
            <ol className="flo-steps" aria-label="Avance de la orden">
              {ORDEN_FLUJO.map((f, i) => <li key={f} className={i < idx ? 'done' : i === idx ? 'current' : ''}>{ORDEN_ESTADOS[f].label}</li>)}
            </ol>
            {o.descripcion && <p style={{ margin: 0, fontSize: '.86rem', color: 'var(--text)' }}>{o.descripcion}</p>}
            {o.repuestos.length > 0 && (
              <ul className="flo-parts">
                {o.repuestos.map((r, i) => (
                  <li key={i}>
                    <span>{r.nombre}</span><strong className="mono">{fmtNum(r.cantidad)} {r.unidad}</strong>
                    <span className="src">
                      {r.desde_inventario > 0 && <Chip tono="success">📦 {fmtNum(r.desde_inventario)} del inventario{sal ? ` · ${sal.codigo}` : ''}</Chip>}
                      {r.a_comprar > 0 && <Chip tono="warning">🛒 {fmtNum(r.a_comprar)} a compra{cmp ? ` · ${cmp.oc_codigo || cmp.codigo}` : ''}</Chip>}
                      {!r.producto_id && <Chip tono="info">🔩 Pieza nueva · se da de alta al pedir la compra</Chip>}
                      {r.pieza_nueva && <Chip tono="info">🔁 Era «{r.pieza_nueva}»</Chip>}
                      {perm.maquinaria && puedeReemplazarPieza(o, i) && (
                        <button type="button" className="btn btn-sm" disabled={ocupado} onClick={() => onReemplazar(o, i)}>🔁 Ya existe en inventario: cambiar por el producto</button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {(sal || cmp) && (
              <div className="muted" style={{ fontSize: '.78rem' }}>
                {sal && <>📦 Salida <strong>{sal.codigo}</strong>: {ESTADO_SALIDA[sal.estado] ?? sal.estado}. </>}
                {cmp && <>🛒 Compra <strong>{cmp.oc_codigo || cmp.codigo}</strong>: {statusBadge(cmp.estado).label}.</>}
              </div>
            )}
            {(faltaSalida(o) || faltaCompra(o)) && (
              <div className="aviso warning sm"><span className="aviso-icono">⚠️</span><div>
                Por solicitar: {[faltaSalida(o) ? 'la salida de inventario' : null, faltaCompra(o) ? 'la compra' : null].filter(Boolean).join(' y ')}.
                {faltaSalida(o) && !perm.salidas && ' La salida la pide quien tenga permiso de Salidas.'}
                {faltaCompra(o) && ' La compra entra a Pedidos con «🛒 Pedir compra».'}
              </div></div>
            )}
            <FotosOrden ordenId={o.id} canWrite={perm.maquinaria} mostrarVacio={false} />
            <div className="flo-orden-foot">
              {perm.maquinaria && sig.includes('en_proceso') &&<button className="btn btn-primary" disabled={ocupado} onClick={() => onIniciar(o)}>🔧 Iniciar trabajo</button>}
              {perm.maquinaria && sig.includes('realizada') && <button className="btn btn-success" disabled={ocupado} onClick={() => onCerrar(o, 'realizada')}>✅ Marcar realizada</button>}
              {faltaSalida(o) && perm.salidas && <button className="btn" disabled={ocupado} onClick={() => onPedir(o, 'salida')}>📦 Pedir salida de inventario</button>}
              {faltaCompra(o) && perm.maquinaria && <button className="btn" disabled={ocupado} onClick={() => onPedir(o, 'compra')}>🛒 Pedir compra</button>}
              {cmp && <button className="btn" onClick={() => onVerCompra(cmp.id)}>🛒 Ver compra</button>}
              <button className="btn" onClick={() => onPdf(o)}>📄 PDF de la orden</button>
              {perm.maquinaria && <button className="btn btn-ghost" disabled={ocupado} onClick={() => onEditar(o)}>✎ Editar</button>}
              {perm.maquinaria && sig.includes('anulada') && <button className="btn btn-ghost" disabled={ocupado} onClick={() => onCerrar(o, 'anulada')}>⛔ Anular</button>}
              {puedeBorrarOrden(o, perm) && <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} disabled={ocupado} onClick={() => onBorrar(o)}>🗑 Borrar</button>}
            </div>
          </div>
        );
      }) : (
        <div className="flo-sec"><EmptyState message="Sin órdenes abiertas. Cuando abras un servicio, aquí verás su avance y de dónde salen los repuestos." icon="✅" /></div>
      )}
      <div className="flo-sec">
        <div className="flo-sec-head"><h3>📚 Historial de servicio</h3><span className="muted" style={{ fontSize: '.76rem' }}>{cerradas.length} orden(es)</span></div>
        {cerradas.length ? (
          <div className="flo-hist">
            {cerradas.map((o) => {
              const s = servicioPorId(o.tipo);
              return (
                <div key={o.id}>
                  <span>{o.estado === 'anulada' ? '⛔' : s?.icon}</span>
                  <div style={{ minWidth: 0 }}><strong>{o.codigo} · {etiquetaServicio(o.tipo, o.trabajos)}</strong><small>{fmtDate(o.created_at)}{o.cerrada_at ? ` → ${fmtDate(o.cerrada_at)}` : ''} · {ORDEN_ESTADOS[o.estado]?.label}{o.nota_cierre ? ` · ${o.nota_cierre}` : ''}</small></div>
                  <span style={{ display: 'flex', gap: '.25rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => setFotosDe(o)} aria-label={`Fotos de ${o.codigo}`}>📷 Fotos</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => onPdf(o)} aria-label={`PDF de ${o.codigo}`}>📄 PDF</button>
                    {perm.maquinaria && <button className="btn btn-sm btn-ghost" onClick={() => onEditar(o)} aria-label={`Editar ${o.codigo}`}>✎</button>}
                    {puedeBorrarOrden(o, perm) && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => onBorrar(o)} aria-label={`Borrar ${o.codigo}`}>🗑</button>}
                  </span>
                </div>
              );
            })}
          </div>
        ) : <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>Todavía no hay servicios cerrados. Los registros anteriores siguen en la bitácora (📒).</p>}
      </div>
      {fotosDe && <FotosOrdenModal ordenId={fotosDe.id} codigo={fotosDe.codigo} canWrite={perm.maquinaria} onClose={() => setFotosDe(null)} />}
    </>
  );
}

function TabCompras({ compras, puedePedidos, onVer }: { compras: CompraEquipo[]; puedePedidos: boolean; onVer: (id: string) => void }) {
  return (
    <>
      <div className="aviso info"><span className="aviso-icono">🛒</span><div>
        <strong>Compras de este equipo.</strong> Las solicitudes de servicio de Pedidos casadas a este equipo y los repuestos pedidos desde sus órdenes de servicio. Toca una para ver en qué va. Se mueven en {puedePedidos ? <Link to="/app/pedidos">Pedidos</Link> : 'Pedidos'}; al recibir los repuestos, la orden de servicio sigue sola. <Link to="/app/maquinaria/repuestos">Ver repuestos y compras de toda la flota →</Link>
      </div></div>
      {compras.length ? (
        <div className="flo-kanban">
          {COLUMNAS_COMPRA.map((c) => {
            const cards = compras.filter((x) => columnaCompra(x.estado) === c.id);
            return (
              <div key={c.id} className={`flo-kcol tone-${c.tono}`}>
                <header><span>{c.icon} {c.label}</span><span>{cards.length}</span></header>
                {cards.length ? cards.map((k) => (
                  <div key={k.id} className="flo-kcard" role="button" tabIndex={0} style={{ cursor: 'pointer' }} title="Ver en qué va"
                    onClick={() => onVer(k.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onVer(k.id); } }}>
                    <div className="fila"><strong>{k.oc_codigo || k.codigo}</strong><span>{fmtDate(k.created_at)}</span></div>
                    <div>{k.lineas.slice(0, 4).map((l, i) => <div key={i}>{fmtNum(l.cantidad)} {l.unidad ?? ''} · {l.nombre}</div>)}{k.lineas.length > 4 && <div>+{k.lineas.length - 4} más</div>}</div>
                    <div className="fila"><span>{k.tipo === 'servicio' ? '🔧 Servicio' : k.orden_servicio ? `🧾 ${k.orden_servicio}` : '📦 Pedido'}</span><span className="mono">{k.total ? `${fmtNum(k.total)} ${k.total_moneda ?? ''}` : 'Sin precio'}</span></div>
                    <span className={`badge ${statusBadge(k.estado).className}`} style={{ justifySelf: 'start' }}>{statusBadge(k.estado).label}</span>
                  </div>
                )) : <div className="vacio">Nada aquí</div>}
              </div>
            );
          })}
        </div>
      ) : <div className="flo-sec"><EmptyState message="Sin compras vinculadas. Aparecerán cuando una orden de servicio pida repuestos o cuando Pedidos registre un servicio para este equipo." icon="🛒" /></div>}
    </>
  );
}

/**
 * Contador del equipo (solo lectura): horómetro y km VIGENTES con su fecha y su origen, el
 * último surtido de Combustible y el historial de lecturas de las tres fuentes. El surtido se
 * registra SOLO en Combustible; aquí solo se sube el horómetro / km (y se sincroniza allá).
 */
function TabContador({ eq, vigente, lecturas, ultimoSurtido, puede, onRegistrar, puedeEditar, isAdmin, onEditar, onBorrar }: {
  eq: MaquinariaEquipo; vigente: LecturaVigente | null; lecturas: LecturaMedidor[]; ultimoSurtido: UltimoSurtido | null;
  puede: boolean; onRegistrar: () => void;
  puedeEditar: boolean; isAdmin: boolean; onEditar: (id: string) => void; onBorrar: (l: LecturaMedidor) => void;
}) {
  return (
    <>
      {puede && <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={onRegistrar}>⏱️ Registrar horómetro / km</button>}
      <div className="flo-stats">
        <div className="flo-stat"><small>Horómetro vigente</small><strong>{vigente?.horometro != null ? `${fmtNum(vigente.horometro)} h` : '—'}</strong>
          <small>{vigente?.horometro_fecha ? `${dateTime(vigente.horometro_fecha)} · ${etiquetaOrigenLectura(vigente.horometro_origen)}` : 'sin lectura'}</small></div>
        <div className="flo-stat"><small>Km vigente</small><strong>{vigente?.kilometraje != null ? `${fmtNum(vigente.kilometraje)} km` : '—'}</strong>
          <small>{vigente?.km_fecha ? `${dateTime(vigente.km_fecha)} · ${etiquetaOrigenLectura(vigente.km_origen)}` : 'sin lectura'}</small></div>
        <div className="flo-stat"><small>Último surtido</small><strong>{ultimoSurtido ? `${fmtNum(ultimoSurtido.litros)} L` : '—'}</strong>
          <small>{ultimoSurtido ? [fmtDate(ultimoSurtido.fecha), ultimoSurtido.hora, ultimoSurtido.tanque, ultimoSurtido.quien].filter(Boolean).join(' · ') : (eq.combustible_equipo ? 'sin surtidos' : 'sin vínculo en Combustible')}</small></div>
      </div>
      <div className="aviso info sm"><span className="aviso-icono">⛽</span><div>
        {eq.combustible_equipo
          ? <>El surtido se registra solo en <strong>Combustible</strong> (equipo «{eq.combustible_equipo}»).</>
          : <>Este equipo no está vinculado a un equipo de <strong>Combustible</strong>: sus lecturas quedan solo en Maquinaria. Vincúlalo en «✎ Editar ficha».</>}
      </div></div>
      <div className="flo-sec">
        <div className="flo-sec-head"><h3>⏱️ Historial de lecturas</h3><span className="muted" style={{ fontSize: '.76rem' }}>Combustible, Maquinaria y bitácora</span></div>
        {lecturas.length ? (
          <div className="flo-hist">
            {lecturas.map((l) => (
              <div key={`${l.origen}-${l.referencia}`}>
                <span>{l.origen === 'combustible' ? '⛽' : l.origen === 'bitacora' ? '📒' : '🚜'}</span>
                <div style={{ minWidth: 0 }}>
                  <strong className="mono">{[l.horometro != null ? `${fmtNum(l.horometro)} h` : null, l.kilometraje != null ? `${fmtNum(l.kilometraje)} km` : null].filter(Boolean).join(' · ')}</strong>
                  <small>{dateTime(l.fecha)} · {etiquetaOrigenLectura(l.origen)}{l.es_correccion ? ' · corrección' : ''}{l.actor ? <> · <NombreUsuario correo={l.actor} /></> : null}</small>
                </div>
                {l.origen === 'maquinaria' && puedeEditar && (!l.es_correccion || isAdmin) ? (
                  <span style={{ display: 'flex', gap: '.25rem' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => onEditar(l.referencia)} aria-label={`Editar la lectura del ${dateTime(l.fecha)}`}>✎</button>
                    <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => onBorrar(l)} aria-label={`Borrar la lectura del ${dateTime(l.fecha)}`}>🗑</button>
                  </span>
                ) : l.origen !== 'maquinaria' && puedeEditar
                  ? <small className="muted" style={{ fontSize: '.7rem', textAlign: 'right' }}>{l.origen === 'combustible' ? 'Se corrige en ⛽ Combustible' : 'Se corrige en 📒 Bitácora'}</small>
                  : <span />}
              </div>
            ))}
          </div>
        ) : <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>Sin lecturas registradas.</p>}
      </div>
    </>
  );
}

function TabLavados({ lavados, puedeRegistrar, puedeEditar, onNuevo, onEditar, onBorrar }: {
  lavados: LavadoEquipo[]; puedeRegistrar: boolean; puedeEditar: boolean; onNuevo: () => void;
  onEditar: (l: LavadoEquipo) => void; onBorrar: (l: LavadoEquipo) => void;
}) {
  const ult = ultimoLavado(lavados);
  return (
    <>
      {puedeRegistrar && <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={onNuevo}>🚿 Registrar lavado</button>}
      <Link className="flo-ver-todo" to="/app/maquinaria/lavados">Ver los lavados de toda la flota →</Link>
      <div className="flo-stats">
        <div className="flo-stat"><small>Último lavado</small><strong style={{ fontSize: '1.1rem' }}>{ult ? textoHace(diasDesde(ult.fecha)) : '—'}</strong></div>
        <div className="flo-stat"><small>Tipo</small><strong style={{ fontSize: '1.1rem' }}>{ult?.tipo ?? '—'}</strong></div>
        <div className="flo-stat"><small>Lavados registrados</small><strong>{lavados.length}</strong></div>
        <div className="flo-stat"><small>Últimos 30 días</small><strong>{lavados.filter((l) => (diasDesde(l.fecha) ?? 999) <= 30).length}</strong></div>
      </div>
      <div className="flo-sec">
        <div className="flo-sec-head"><h3>🚿 Historial de lavados</h3></div>
        {lavados.length ? (
          <div className="flo-hist">
            {lavados.map((l) => (
              <div key={l.id}>
                <span>🚿</span>
                <div style={{ minWidth: 0 }}>
                  <strong>{l.tipo}</strong>
                  <small>{dateTime(l.fecha)} · {textoHace(diasDesde(l.fecha))}{l.responsable ? ` · ${l.responsable}` : ''}{l.horometro != null ? ` · ${fmtNum(l.horometro)} h` : ''}{l.kilometraje != null ? ` · ${fmtNum(l.kilometraje)} km` : ''}</small>
                  {l.nota && <small>{l.nota}</small>}
                </div>
                {puedeEditar ? (
                  <span style={{ display: 'flex', gap: '.25rem' }}>
                    <button className="btn btn-sm btn-ghost" aria-label={`Editar lavado del ${dateTime(l.fecha)}`} onClick={() => onEditar(l)}>✎</button>
                    <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} aria-label={`Borrar lavado del ${dateTime(l.fecha)}`} onClick={() => onBorrar(l)}>🗑</button>
                  </span>
                ) : <span />}
              </div>
            ))}
          </div>
        ) : <p className="muted" style={{ fontSize: '.82rem', margin: 0 }}>Sin lavados registrados.</p>}
      </div>
    </>
  );
}

/** Fotos del equipo (16-10-2026): cámara o galería, eliminar y ELEGIR la portada. Los documentos (RCV, placa…) van aparte. */
function TabFotos({ fotos, puedeEditar, subiendo, onDocs, onSubir, onBorrar, onPortada, onEncuadre }: {
  fotos: FotoEquipo[]; puedeEditar: boolean; subiendo: number; onDocs: () => void;
  onSubir: (files: File[]) => void; onBorrar: (f: FotoEquipo) => void; onPortada: (f: FotoEquipo) => void; onEncuadre: (f: FotoEquipo) => void;
}) {
  const camaraRef = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);
  const lleno = fotos.length >= MAX_FOTOS_EQUIPO;
  const recibir = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) onSubir(files);
  };
  return (
    <>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {puedeEditar && !lleno && (
          <>
            <button type="button" className="btn btn-primary" disabled={subiendo > 0} onClick={() => camaraRef.current?.click()}>📷 Tomar foto</button>
            <button type="button" className="btn" disabled={subiendo > 0} onClick={() => galeriaRef.current?.click()}>🖼 Subir de la galería</button>
            <input ref={camaraRef} type="file" accept="image/*" capture="environment" hidden aria-label="Tomar foto con la cámara" onChange={(e) => recibir(e.currentTarget)} />
            <input ref={galeriaRef} type="file" accept="image/*" multiple hidden aria-label="Elegir fotos de la galería" onChange={(e) => recibir(e.currentTarget)} />
          </>
        )}
        <button type="button" className="btn btn-ghost" onClick={onDocs}>📎 Documentos (RCV, placa, contrato…)</button>
        <span className="muted" style={{ fontSize: '.8rem' }}>{subiendo ? `Subiendo ${subiendo} foto(s)…` : `${fotos.length} de ${MAX_FOTOS_EQUIPO} fotos`}</span>
      </div>
      {lleno && puedeEditar && <p className="hint muted">Ya tiene las {MAX_FOTOS_EQUIPO} fotos. Elimina una para agregar otra.</p>}
      {fotos.length > 1 && puedeEditar && <p className="hint muted" style={{ marginTop: '.4rem' }}>La <strong>portada</strong> (marcada con ★) es la que se muestra arriba, en el catálogo y en la ficha PDF. Toca «★ Portada» en otra foto para cambiarla.</p>}
      {fotos.length ? (
        <div className="flo-fotos" style={{ marginTop: '.6rem' }}>
          {fotos.map((f, i) => (
            <figure key={f.id} style={i === 0 ? { outline: '2px solid var(--brand, #ff8a00)' } : undefined}>
              <a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={f.nombre} loading="lazy" /></a>
              <figcaption style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i === 0 ? '★ Portada · ' : ''}{f.nombre}</span>
                {puedeEditar && i > 0 && <button type="button" className="btn btn-sm btn-ghost" title="Mostrar esta foto como portada" onClick={() => onPortada(f)}>★ Portada</button>}
                {puedeEditar && i === 0 && <button type="button" className="btn btn-sm btn-ghost" title="Cambiar cómo se ajusta en la portada" onClick={() => onEncuadre(f)}>⤢ {f.encuadre === 'completa' ? 'Completa' : 'Recortada'}</button>}
                {puedeEditar && <button type="button" className="btn btn-sm btn-danger" title="Eliminar foto" onClick={() => onBorrar(f)}>🗑</button>}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="flo-sec" style={{ marginTop: '.6rem' }}>
          <EmptyState message={puedeEditar ? 'Sin fotos del equipo. Toma una con la cámara o súbela de la galería: la primera es la portada del expediente, del catálogo y de la ficha PDF. Si la foto está en Documentos, ábrelos y toca «📷 Es foto del equipo».' : 'Sin fotos del equipo.'} icon="📷" />
        </div>
      )}
    </>
  );
}

function TabFicha({ eq, onPdf }: { eq: MaquinariaEquipo; onPdf: () => void }) {
  const filas: [string, string | null | undefined][] = [
    ['Equipo', eq.equipo], ['Tipo', eq.tipo], ['Marca', eq.marca], ['Modelo', eq.modelo], ['Año', eq.anio != null ? String(eq.anio) : null],
    ['Color', eq.color], ['Serial / PIN', eq.serial], ['Placa', eq.placa], ['Motor (modelo)', eq.motor_modelo], ['Motor (serial)', eq.motor_serial],
    ['Combustible', eq.combustible], ['Consumo esperado', eq.litros_consume != null ? `${fmtNum(eq.litros_consume)} L` : null],
    ['Mantenimiento cada', [eq.mantenimiento_cada_hrs ? `${fmtNum(eq.mantenimiento_cada_hrs)} h` : null, eq.mantenimiento_cada_km ? `${fmtNum(eq.mantenimiento_cada_km)} km` : null].filter(Boolean).join(' · ') || null],
    ['Ficha técnica', eq.ficha_tecnica], ['Ficha de mantenimiento', eq.ficha_mantenimiento], ['Documentación', eq.documentacion],
    ['Estado operativo', `${ESTADOS_EQUIPO[estadoEfectivo(eq)].label}${eq.estado_nota ? ` (${eq.estado_nota})` : ''}`],
  ];
  return (
    <>
      <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={onPdf}>📄 Ficha técnico-operativa (PDF)</button>
      <div className="flo-sec">
        <div className="flo-sec-head"><h3>Identificación del equipo</h3></div>
        <dl className="flo-facts">{filas.map(([k, v]) => <Fact key={k} label={k} v={v} />)}</dl>
      </div>
    </>
  );
}

/** Cierra (realizada) o anula una orden. Al realizarla, ofrece anotarla en la bitácora y reiniciar el contador. */
function CerrarOrdenModal({ orden, estado, equipo, horometro, km, actor, actorName, onClose, onDone }: {
  orden: OrdenServicio; estado: EstadoOrdenServicio; equipo: MaquinariaEquipo; horometro: number | null; km: number | null;
  actor: string; actorName: string | null; onClose: () => void; onDone: () => void;
}) {
  const realizar = estado === 'realizada';
  const s = servicioPorId(orden.tipo);
  const [nota, setNota] = useState('');
  const [bitacora, setBitacora] = useState(true);
  // El contador lo reinicia el usuario (13/10/2026): la casilla viene sin marcar.
  const [reiniciar, setReiniciar] = useState(false);
  const [saving, setSaving] = useState(false);
  const falta = !realizar && nota.trim().length < 3;

  async function guardar() {
    setSaving(true);
    try {
      await avanzarOrdenServicio(orden.id, estado, nota.trim() || null);
      const extras: string[] = [];
      if (realizar && bitacora) {
        try {
          await addMantenimiento({
            equipo_id: equipo.id, fecha: new Date().toISOString().slice(0, 10), tipo: s?.bitacora ?? 'otro',
            horometro, kilometraje: km,
            trabajo: [`${orden.codigo}`, orden.descripcion, nota.trim()].filter(Boolean).join(' · '),
            consumibles: orden.repuestos.map((r) => `${fmtNum(r.cantidad)} ${r.unidad} ${r.nombre}`).join(', ') || null,
            mecanico: orden.responsable,
          }, actor, actorName);
          extras.push('anotada en la bitácora');
        } catch (e) { toast(`No se pudo anotar en la bitácora: ${errMsg(e, 'error')}`, 'warning'); }
      }
      if (realizar && reiniciar) {
        try { await reiniciarMantenimientoDeEquipo(equipo.id); extras.push('contador reiniciado'); }
        catch (e) { toast(`No se pudo reiniciar el contador: ${errMsg(e, 'error')}`, 'warning'); }
      }
      toast(`${orden.codigo} ${realizar ? 'realizada' : 'anulada'}${extras.length ? ` · ${extras.join(' · ')}` : ''}.`, 'success');
      onDone();
      onClose();
    } catch (e) { toast(errMsg(e, 'No se pudo cerrar la orden'), 'error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal compact title={realizar ? `✅ Marcar realizada · ${orden.codigo}` : `⛔ Anular · ${orden.codigo}`} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className={`btn ${realizar ? 'btn-success' : 'btn-danger'}`} disabled={saving || falta} onClick={() => void guardar()}>{saving ? 'Guardando…' : realizar ? 'Marcar realizada' : 'Anular orden'}</button>
      </>}>
      <div className="flo" style={{ display: 'grid', gap: '.7rem' }}>
        <VistaPrevia titulo={realizar ? 'Se cierra la orden' : 'Se anula la orden'}>
          <Dato label="Orden">{orden.codigo}</Dato>
          <Dato label="Servicio">{s?.label ?? orden.tipo}</Dato>
          <Dato label="Equipo">{equipo.equipo}</Dato>
          <Dato label="Repuestos">{orden.repuestos.length ? orden.repuestos.map((r) => `${fmtNum(r.cantidad)} ${r.nombre}`).join(', ') : undefined}</Dato>
        </VistaPrevia>
        {!realizar && <p className="muted" style={{ fontSize: '.8rem', margin: 0 }}>Anular no cancela la salida ni la compra que ya se pidieron: esas se cancelan en Salidas y Pedidos.</p>}
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label htmlFor="flo-cierre">{realizar ? 'Nota de cierre (opcional)' : 'Motivo de la anulación'}</label>
          <textarea id="flo-cierre" className="textarea" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} placeholder={realizar ? 'Qué se hizo, observaciones' : 'Por qué se anula'} />
        </div>
        {realizar && (
          <>
            <label style={{ display: 'flex', gap: '.45rem', alignItems: 'center', fontSize: '.85rem' }}>
              <input type="checkbox" checked={bitacora} onChange={(e) => setBitacora(e.target.checked)} /> Anotar el servicio en la bitácora del equipo
            </label>
            <label style={{ display: 'flex', gap: '.45rem', alignItems: 'center', fontSize: '.85rem' }}>
              <input type="checkbox" checked={reiniciar} onChange={(e) => setReiniciar(e.target.checked)} /> Reiniciar el contador de mantenimiento (horas/km) desde la lectura vigente
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Ficha de repuestos y consumibles del equipo: por sistema, con el stock del producto vinculado. */
function TabRepuestos({ ficha, productos, puedeEditar, onNuevo, onCopiar, onEditar, onBorrar, onPdf, onExcel }: {
  ficha: RepuestoEquipo[]; productos: Map<string, Producto>; puedeEditar: boolean;
  onNuevo: () => void; onCopiar: () => void; onEditar: (r: RepuestoEquipo) => void; onBorrar: (r: RepuestoEquipo) => void;
  onPdf: () => void; onExcel: () => void;
}) {
  const grupos = agruparPorSistema(ficha);
  const resumen = { hay: 0, no_hay: 0, sin_producto: 0 };
  for (const r of ficha) resumen[estadoStock(r, r.producto_id ? productos.get(r.producto_id) : null).estado] += 1;
  return (
    <>
      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
        {puedeEditar && <button className="btn btn-primary" onClick={onNuevo}>🔩 Agregar repuesto</button>}
        {puedeEditar && <button className="btn" onClick={onCopiar}>📋 Copiar de otro equipo</button>}
        <button className="btn btn-ghost" disabled={!ficha.length} onClick={onPdf}>↓ PDF</button>
        <button className="btn btn-ghost" disabled={!ficha.length} onClick={onExcel}>↓ Excel</button>
      </div>
      <Link className="flo-ver-todo" to="/app/maquinaria/repuestos">¿Para qué equipo sirve un repuesto? · Qué comprar para el próximo servicio →</Link>
      <div className="flo-stats">
        <div className="flo-stat"><small>En la ficha</small><strong>{ficha.length}</strong></div>
        <div className="flo-stat"><small>🟢 Hay en inventario</small><strong>{resumen.hay}</strong></div>
        <div className="flo-stat"><small>🔴 No hay suficiente</small><strong>{resumen.no_hay}</strong></div>
        <div className="flo-stat"><small>⚪ No está en inventario</small><strong>{resumen.sin_producto}</strong></div>
      </div>
      {ficha.length ? grupos.map((g) => (
        <div className="flo-sec" key={g.sistema.id}>
          <div className="flo-sec-head"><h3>{g.sistema.icon} {g.sistema.label}</h3><span className="muted" style={{ fontSize: '.76rem' }}>{g.items.length}</span></div>
          <div className="flo-hist">
            {g.items.map((r) => {
              const p = r.producto_id ? productos.get(r.producto_id) : null;
              const st = estadoStock(r, p);
              return (
                <div key={r.id}>
                  <span title={ESTADOS_STOCK[st.estado].label} aria-label={ESTADOS_STOCK[st.estado].label}>{ESTADOS_STOCK[st.estado].icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <strong>{r.tipo} <span className="mono" style={{ fontWeight: 600 }}>· {fmtNum(r.cantidad)} {r.unidad}</span></strong>
                    <small>{detalleRepuesto(r) || 'sin número de parte'} · {textoCada(r, fmtNum)}</small>
                    <small>{p ? `${p.nombre} (${p.sku}) · ${st.stock != null && st.stock > 0 ? `${fmtNum(st.stock)} ${p.unidad} en stock` : 'sin stock'}` : 'No está en el inventario: se pide por número de parte'}{r.nota ? ` · ${r.nota}` : ''}</small>
                  </div>
                  {puedeEditar ? (
                    <span style={{ display: 'flex', gap: '.25rem' }}>
                      <button className="btn btn-sm btn-ghost" aria-label={`Editar ${r.tipo}`} onClick={() => onEditar(r)}>✎</button>
                      <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} aria-label={`Quitar ${r.tipo}`} onClick={() => onBorrar(r)}>🗑</button>
                    </span>
                  ) : <span />}
                </div>
              );
            })}
          </div>
        </div>
      )) : (
        <div className="flo-sec">
          <EmptyState icon="🔩" message={puedeEditar
            ? 'Sin ficha de repuestos. Agrega lo que lleva este equipo (aceite, filtros, cauchos, batería…) con su número de parte y sus equivalencias, o cópiala de un equipo igual.'
            : 'Este equipo todavía no tiene ficha de repuestos.'} />
        </div>
      )}
      <p className="muted" style={{ fontSize: '.76rem', margin: 0 }}>Sistemas: {agruparPorSistema(ficha).length ? grupos.map((g) => g.sistema.label).join(', ') : sistemaDe('motor').label + '…'}. El stock es el del producto vinculado al cargar la pestaña.</p>
    </>
  );
}
