/* ============================================================
   Golden Touch · Control de Maquinaria · Vista de Teléfono (Móvil)
   (26/10/2026)

   Diseñada específicamente para smartphones en campo (taller, mina, garaje):
   - «Puro botón» con tarjetas grandes, legibles y táctiles
   - Solicitar Servicio con piezas y contador de horómetro/km
   - Registrar Lavado rápido (sencillo, completo, motor)
   - Reportar Avería / Parada / Cambio de estado al instante
   - Consultar marcas de filtros (Donaldson, Fleetguard, OEM)
   - Envío inmediato de reportes por WhatsApp de CADA movimiento
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { notify } from '@/shared/lib/notify';
import { toast } from '@/shared/ui/Toast';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { num as fmtNum, dateTime } from '@/shared/lib/format';
import { ExportarEquiposModal } from './ExportarEquiposModal';
import {
  listEquipos,
  extraerEncargado,
  type MaquinariaEquipo,
} from './maquinariaEquipos.repository';
import {
  crearOrdenServicio,
  cambiarEstadoEquipo,
  listOrdenesServicio,
  eliminarOrdenServicio,
  registrarLavado,
  listLavadosTodos,
  eliminarLavado,
  lecturasVigentesPorEquipo,
  solicitarCompraDeOrden,
  notificarComprasPiezasNuevas,
  fotosDeEquipos,
  type OrdenServicio,
  type LavadoEquipo,
  type LecturaVigente,
  type FotoEquipo,
} from './flota.repository';
import {
  avisoServicio,
  avisoMasUrgente,
  frecuenciaHrs,
  estadoEfectivo,
  claseEquipo,
  SERVICIOS,
  type EstadoEquipo,
  type AvisoServicio,
} from './flota';
import { AlertasMantenimientoBanner, type EquipoConAviso } from './AlertasMantenimiento';
import { TABLAS_ALERTAS_MANT } from './alertasMantenimiento.repository';
import { listRepuestosEquipo } from './repuestosEquipo.repository';
import { sistemaDe, type RepuestoEquipo } from './repuestosEquipo';
import { EquipoFormModal } from './EquipoFormModal';
import { SubirFotoEquipoModal } from './SubirFotoEquipoModal';
import { addMantenimiento } from './maquinariaMant.repository';
import {
  textoServicioWhatsapp,
  textoLavadoWhatsapp,
  textoAveriaEstadoWhatsapp,
  textoFichaFiltrosWhatsapp,
  textoEstadoEquipoWhatsapp,
} from './maquinariaWhatsapp';

type ModoMovil = 'menu' | 'servicio' | 'lavado' | 'averia' | 'filtros' | 'solicitudes';

const TIPOS_LAVADO = ['SENCILLO', 'COMPLETO', 'CHASIS / MOTOR', 'ENGRASADO Y LAVADO'];

/** Badge del estado del servicio (verde OK · ámbar próximo · rojo vencido) para la tarjeta y la ventana de opciones. */
function BadgeServicio({ av }: { av: AvisoServicio | null | undefined }) {
  if (!av) return <span className="badge" title="Sin intervalo de mantenimiento">Sin intervalo</span>;
  if (av.nivel === 'vencido') {
    return <span className="badge danger" title="Mantenimiento vencido">Vencido +{fmtNum(Math.abs(av.restante))} {av.unidad}</span>;
  }
  if (av.nivel === 'proximo') {
    return <span className="badge warning" title="Mantenimiento próximo">Próx. {fmtNum(av.restante)} {av.unidad}</span>;
  }
  return <span className="badge success" title={`Faltan ${fmtNum(av.restante)} ${av.unidad} para el servicio`}>OK</span>;
}

interface InfoMantenimientoMovil {
  horometro: number | null;
  kilometraje: number | null;
  aviso: AvisoServicio | null;
  estado: EstadoEquipo;
  encargado: string | null;
}

export function MaquinariaMovilView() {
  const { user } = useSession();
  const { appUser, soloTelefono, can } = usePermissions();
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre?.trim() || user?.email || 'Operador';
  // Permiso de escritura del módulo: habilita responder las alertas de mantenimiento desde el teléfono.
  const canWrite = can('maquinaria', 'escritura');

  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenServicio[]>([]);
  const [lavados, setLavados] = useState<LavadoEquipo[]>([]);
  const [lecturas, setLecturas] = useState<Map<string, LecturaVigente>>(new Map());
  const [fotos, setFotos] = useState<Map<string, string>>(new Map());
  const [subirFotoEq, setSubirFotoEq] = useState<MaquinariaEquipo | null>(null);
  const [loading, setLoading] = useState(true);

  // Modo / pantalla activa dentro de la vista móvil
  const [modo, setModo] = useState<ModoMovil>('menu');
  const [equipoSelId, setEquipoSelId] = useState<string>('');
  const [repuestosEquipo, setRepuestosEquipo] = useState<RepuestoEquipo[]>([]);

  // Estados de catálogo y opciones táctiles
  const [busquedaCatalogo, setBusquedaCatalogo] = useState('');
  const [filtroCatalogo, setFiltroCatalogo] = useState<'todos' | 'alertas' | 'lanchas' | 'pesada' | 'vehiculos' | 'motos'>('todos');
  const [equipoOpciones, setEquipoOpciones] = useState<MaquinariaEquipo | null>(null);
  const [nuevoEquipoMovilOpen, setNuevoEquipoMovilOpen] = useState(false);
  const [exportarPdfMovilOpen, setExportarPdfMovilOpen] = useState(false);

  // Borrado de movimientos
  const [borrandoMov, setBorrandoMov] = useState<{ tipo: 'orden' | 'lavado'; id: string; codigo: string } | null>(null);

  // Estados de los formularios móviles
  const [saving, setSaving] = useState(false);
  const [mensajeWhatsapp, setMensajeWhatsapp] = useState<string | null>(null);

  function mostrarWhatsapp(texto: string) {
    setMensajeWhatsapp(texto);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // Formulario Servicio (Intervenciones y Solicitud a Compras)
  const [tipoServicio, setTipoServicio] = useState<string>('preventivo');
  const [intervencionesServicio, setIntervencionesServicio] = useState<string[]>(['preventivo']);
  const [urgenciaServicio, setUrgenciaServicio] = useState<'normal' | 'urgente'>('normal');
  const [horasServicio, setHorasServicio] = useState<string>('');
  const [kmServicio, setKmServicio] = useState<string>('');
  const [responsableServicio, setResponsableServicio] = useState<string>(actorName);
  const [descripcionServicio, setDescripcionServicio] = useState<string>('');
  const [piezasSeleccionadas, setPiezasSeleccionadas] = useState<Array<{ nombre: string; cantidad: number; unidad: string }>>([]);
  const [nombrePiezaLibre, setNombrePiezaLibre] = useState<string>('');
  const [cantPiezaLibre, setCantPiezaLibre] = useState<string>('1');
  const [unidadPiezaLibre, setUnidadPiezaLibre] = useState<string>('und');

  // Formulario Lavado
  const [tipoLavado, setTipoLavado] = useState<string>('SENCILLO');
  const [lavador, setLavador] = useState<string>(actorName);
  const [notasLavado, setNotasLavado] = useState<string>('');

  // Formulario Avería
  const [estadoAveria, setEstadoAveria] = useState<EstadoEquipo>('averiada');
  const [motivoAveria, setMotivoAveria] = useState<string>('');

  async function cargarDatos() {
    try {
      const [eqs, ords, lavs, lecs, fts] = await Promise.all([
        listEquipos(),
        listOrdenesServicio(),
        listLavadosTodos(),
        lecturasVigentesPorEquipo().catch(() => new Map<string, LecturaVigente>()),
        fotosDeEquipos().catch(() => [] as FotoEquipo[]),
      ]);

      const mapFotos = new Map<string, string>();
      for (const f of fts) {
        if (!mapFotos.has(f.equipo_id)) mapFotos.set(f.equipo_id, f.url);
      }

      setEquipos(eqs.filter((e) => e.activo));
      setOrdenes(ords);
      setLavados(lavs);
      setLecturas(lecs);
      setFotos(mapFotos);
    } catch (e) {
      console.error('Error al cargar datos de maquinaria móvil:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void cargarDatos();
  }, []);

  // Un surtido de combustible (horómetro/km), una anotación en la bitácora o una respuesta a la
  // alerta deben refrescar el aviso de mantenimiento sin recargar la página.
  useRealtime([
    'maquinaria_equipos', 'maquinaria_ordenes_servicio', 'maquinaria_lavados', 'maquinaria_lecturas',
    'combustible_tanque_movimientos', 'maquinaria_mantenimientos', ...TABLAS_ALERTAS_MANT,
  ], () => {
    void cargarDatos();
  });

  // Mapa de info de mantenimiento para cada equipo
  const infoEquipos = useMemo(() => {
    const map = new Map<string, InfoMantenimientoMovil>();
    for (const e of equipos) {
      const lec = lecturas.get(e.id);
      const horo = lec?.horometro ?? null;
      const km = lec?.kilometraje ?? null;
      // Horas: la frecuencia del equipo o 250 h por defecto (igual que la vista de PC y el banner).
      const avisoH = avisoServicio(frecuenciaHrs(e), horo, e.mantenimiento_base_hrs, 'h');
      const avisoK = avisoServicio(e.mantenimiento_cada_km, km, e.mantenimiento_base_km, 'km');
      const aviso = avisoMasUrgente(avisoH, avisoK);
      const est = estadoEfectivo(e);
      const enc = extraerEncargado(e);
      map.set(e.id, { horometro: horo, kilometraje: km, aviso, estado: est, encargado: enc });
    }
    return map;
  }, [equipos, lecturas]);

  // Equipos activos (no retirados) con el servicio PRÓXIMO o VENCIDO para el banner de alertas
  // (26/10/2026). La lectura va en la unidad del aviso más urgente (horas o km).
  const alertasMant = useMemo<EquipoConAviso[]>(() => {
    const out: EquipoConAviso[] = [];
    for (const e of equipos) {
      if (!e.activo) continue;
      const inf = infoEquipos.get(e.id);
      if (!inf || inf.estado === 'retirada' || !inf.aviso || inf.aviso.nivel === 'ok') continue;
      out.push({ equipo: e, aviso: inf.aviso, lectura: inf.aviso.unidad === 'h' ? inf.horometro : inf.kilometraje });
    }
    return out;
  }, [equipos, infoEquipos]);

  // Al elegir equipo, cargar sus repuestos/filtros
  useEffect(() => {
    if (!equipoSelId) {
      setRepuestosEquipo([]);
      return;
    }
    listRepuestosEquipo(equipoSelId)
      .then((rs) => setRepuestosEquipo(rs))
      .catch(() => setRepuestosEquipo([]));

    const eq = equipos.find((e) => e.id === equipoSelId);
    if (eq) {
      const enc = extraerEncargado(eq);
      if (enc) setResponsableServicio(enc);
      const lec = lecturas.get(eq.id);
      if (lec?.horometro != null) setHorasServicio(String(lec.horometro));
      if (lec?.kilometraje != null) setKmServicio(String(lec.kilometraje));
    }
  }, [equipoSelId, equipos, lecturas]);

  const equipoActual = useMemo(
    () => equipos.find((e) => e.id === equipoSelId) ?? null,
    [equipos, equipoSelId]
  );

  const opcionesEquipos = useMemo(
    () => equipos.map((e) => ({ value: e.id, label: `${e.equipo}${e.tipo ? ` (${e.tipo})` : ''}` })),
    [equipos]
  );

  // Equipos filtrados para la vista de catálogo
  const equiposCatalogo = useMemo(() => {
    let lista = equipos;
    if (filtroCatalogo === 'alertas') {
      lista = lista.filter((e) => {
        const inf = infoEquipos.get(e.id);
        return inf?.aviso && inf.aviso.nivel !== 'ok';
      });
    } else if (filtroCatalogo === 'lanchas') {
      lista = lista.filter((e) => claseEquipo(e) === 'lancha');
    } else if (filtroCatalogo === 'pesada') {
      lista = lista.filter((e) => claseEquipo(e) === 'maquinaria');
    } else if (filtroCatalogo === 'vehiculos') {
      lista = lista.filter((e) => claseEquipo(e) === 'vehiculo');
    } else if (filtroCatalogo === 'motos') {
      lista = lista.filter((e) => claseEquipo(e) === 'moto');
    }

    if (busquedaCatalogo.trim()) {
      const q = busquedaCatalogo.trim().toLowerCase();
      lista = lista.filter((e) => {
        const enc = infoEquipos.get(e.id)?.encargado ?? '';
        return (
          e.equipo.toLowerCase().includes(q) ||
          (e.tipo && e.tipo.toLowerCase().includes(q)) ||
          (e.marca && e.marca.toLowerCase().includes(q)) ||
          (e.modelo && e.modelo.toLowerCase().includes(q)) ||
          enc.toLowerCase().includes(q)
        );
      });
    }

    return lista;
  }, [equipos, filtroCatalogo, busquedaCatalogo, infoEquipos]);

  // Contadores por categoría para los botones táctiles
  const conteosCatalogo = useMemo(() => {
    let lanchas = 0;
    let pesada = 0;
    let vehiculos = 0;
    let motos = 0;
    let alertas = 0;

    for (const e of equipos) {
      const c = claseEquipo(e);
      if (c === 'lancha') lanchas++;
      else if (c === 'maquinaria') pesada++;
      else if (c === 'vehiculo') vehiculos++;
      else if (c === 'moto') motos++;

      const inf = infoEquipos.get(e.id);
      if (inf?.aviso && inf.aviso.nivel !== 'ok') alertas++;
    }

    return { lanchas, pesada, vehiculos, motos, alertas, total: equipos.length };
  }, [equipos, infoEquipos]);

  // Abrir opciones de una máquina desde el catálogo
  function abrirOpcionesEquipo(eq: MaquinariaEquipo) {
    setEquipoOpciones(eq);
    setEquipoSelId(eq.id);
  }

  // ── Guardar Servicio (Solicitud Directa a Compras + Bitácora) ──
  async function guardarServicio() {
    if (!equipoActual) { toast('Selecciona la máquina o vehículo', 'error'); return; }
    if (!descripcionServicio.trim()) { toast('Indica el trabajo o falla', 'error'); return; }

    setSaving(true);
    try {
      // 1. Crear Orden de Servicio (sin tocar inventario: nombres generales para compras)
      const res = await crearOrdenServicio({
        equipo_id: equipoActual.id,
        tipo: tipoServicio,
        urgencia: urgenciaServicio === 'urgente' ? 'urgente' : 'normal',
        intervenciones: intervencionesServicio.length ? intervencionesServicio : [tipoServicio],
        trabajos: [descripcionServicio.trim()],
        origen: 'interno',
        responsable: responsableServicio.trim() || actorName,
        descripcion: descripcionServicio.trim(),
        horometro: horasServicio ? Number(horasServicio) : null,
        kilometraje: kmServicio ? Number(kmServicio) : null,
        repuestos: piezasSeleccionadas.map((p) => ({
          producto_id: null,
          nombre: p.nombre,
          unidad: p.unidad || 'und',
          cantidad: Number(p.cantidad) || 1,
        })),
      });

      // 2. Si hay piezas/repuestos o solicitud de trabajo, enviar DIRECTAMENTE a Compras
      let spCodigo: string | null = null;
      if (piezasSeleccionadas.length > 0) {
        try {
          const nuevas = piezasSeleccionadas.map((p) => ({
            nombre: p.nombre.trim().toUpperCase(),
            categoria: 'REPUESTOS MAQUINARIA',
            unidad: p.unidad || 'UND',
          }));
          spCodigo = await solicitarCompraDeOrden(res, nuevas);
        } catch (errCompras) {
          // Mismo respaldo que la PC (OrdenServicioModal): si no se pudo abrir la solicitud de
          // pedido, al menos Compras se entera de las piezas nuevas y se avisa que queda pendiente.
          const motivo = errCompras instanceof Error ? errCompras.message : (errCompras as { message?: string })?.message || 'error';
          let avisada = false;
          if (res.repuestos.some((x) => !x.producto_id)) {
            try { avisada = await notificarComprasPiezasNuevas(res); } catch { /* queda por solicitar */ }
          }
          notify(`🔧 ${res.codigo} creada${avisada ? ' · Compras notificada de las piezas nuevas' : ''} — ${equipoActual.equipo}`, 'warning', {
            link: `#/app/maquinaria/equipo/${equipoActual.id}?tab=servicios`,
            detail: `Queda por solicitar la solicitud de servicio (${motivo})`,
          });
          toast(`Queda por solicitar la solicitud de servicio (${motivo}). Se puede generar después desde la orden.`, 'warning');
        }
      }

      // 3. Registrar todo en la Bitácora del equipo (historial completo de mantenimientos)
      try {
        await addMantenimiento({
          equipo_id: equipoActual.id,
          fecha: new Date().toISOString().slice(0, 10),
          tipo: tipoServicio,
          pieza: piezasSeleccionadas.map((p) => p.nombre).join(', ') || null,
          horometro: horasServicio ? Number(horasServicio) : null,
          kilometraje: kmServicio ? Number(kmServicio) : null,
          trabajo: descripcionServicio.trim(),
          observacion: `Orden de servicio ${res.codigo}${spCodigo ? ` · Solicitud de servicio ${spCodigo}` : ''}. Piezas solicitadas con nombres generales para cotización y número de parte en Compras.`,
          mecanico: responsableServicio.trim() || actorName,
        }, actor, actorName);
      } catch (errBit) {
        console.warn('Registro en bitácora:', errBit);
      }

      // 4. Cambiar estado a 'repuestos' si es correctivo o tiene piezas pendientes
      if (piezasSeleccionadas.length > 0 || urgenciaServicio === 'urgente') {
        try {
          await cambiarEstadoEquipo(equipoActual.id, 'repuestos', `Esperando repuestos solicitados a Compras (${res.codigo}${spCodigo ? ` · ${spCodigo}` : ''})`);
        } catch { /* continua */ }
      }

      // 5. Mensaje formateado para WhatsApp
      const txt = textoServicioWhatsapp({
        codigo: `${res.codigo}${spCodigo ? ` (Compras: ${spCodigo})` : ''}`,
        equipo: equipoActual.equipo,
        tipoEquipo: equipoActual.tipo,
        marca: equipoActual.marca,
        modelo: equipoActual.modelo,
        tipoServicio,
        urgencia: urgenciaServicio,
        horasActuales: horasServicio ? Number(horasServicio) : null,
        kmActuales: kmServicio ? Number(kmServicio) : null,
        responsable: responsableServicio.trim() || actorName,
        solicitante: actorName,
        descripcion: descripcionServicio.trim(),
        repuestos: piezasSeleccionadas.map((p) => ({
          nombre: p.nombre,
          cantidad: p.cantidad,
          unidad: p.unidad,
          a_comprar: p.cantidad,
        })),
      });

      toast(`Orden ${res.codigo} creada ${spCodigo ? `· Solicitud a Compras ${spCodigo}` : ''}`, 'success');
      mostrarWhatsapp(txt);
      setDescripcionServicio('');
      setPiezasSeleccionadas([]);
      setModo('solicitudes');
      await cargarDatos();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error al solicitar el servicio', 'error');
    } finally {
      setSaving(false);
    }
  }

  // ── Guardar Lavado ──
  async function guardarLavado() {
    if (!equipoActual) { toast('Selecciona la máquina o vehículo', 'error'); return; }

    setSaving(true);
    try {
      await registrarLavado({
        equipo_id: equipoActual.id,
        tipo: tipoLavado,
        responsable: lavador.trim() || actorName,
        horometro: null,
        kilometraje: null,
        nota: notasLavado.trim() || null,
        fecha: new Date().toISOString(),
      }, { email: actor, nombre: actorName });

      const txt = textoLavadoWhatsapp({
        equipo: equipoActual.equipo,
        tipoEquipo: equipoActual.tipo,
        tipoLavado,
        lavador: lavador.trim() || actorName,
        responsable: actorName,
        notas: notasLavado.trim() || null,
      });

      toast('Lavado registrado con éxito', 'success');
      mostrarWhatsapp(txt);
      setNotasLavado('');
      await cargarDatos();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error al registrar el lavado', 'error');
    } finally {
      setSaving(false);
    }
  }

  // ── Guardar Avería / Cambio de Estado ──
  async function guardarAveria() {
    if (!equipoActual) { toast('Selecciona la máquina o vehículo', 'error'); return; }
    if (!motivoAveria.trim()) { toast('Indica el motivo o daño del equipo', 'error'); return; }

    setSaving(true);
    try {
      await cambiarEstadoEquipo(equipoActual.id, estadoAveria, motivoAveria.trim());

      const txt = textoAveriaEstadoWhatsapp({
        equipo: equipoActual.equipo,
        tipoEquipo: equipoActual.tipo,
        estadoNuevo: estadoAveria,
        motivo: motivoAveria.trim(),
        responsable: actorName,
        ubicacion: equipoActual.ubicacion,
      });

      toast(`Estado actualizado a ${estadoAveria.toUpperCase()}`, 'success');
      mostrarWhatsapp(txt);
      setMotivoAveria('');
      await cargarDatos();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error al cambiar estado', 'error');
    } finally {
      setSaving(false);
    }
  }

  const agregarPiezaLibre = () => {
    if (!nombrePiezaLibre.trim()) return;
    setPiezasSeleccionadas((prev) => [
      ...prev,
      {
        nombre: nombrePiezaLibre.trim().toUpperCase(),
        cantidad: Number(cantPiezaLibre) || 1,
        unidad: unidadPiezaLibre,
      },
    ]);
    setNombrePiezaLibre('');
    setCantPiezaLibre('1');
  };

  const formatoEtiquetaServicio = (label: string): string => {
    return label
      .replace('Cambio de piezas', 'Cambio de\u00A0piezas')
      .replace('Cauchos / neumáticos', 'Cauchos\u00A0/ neumáticos')
      .replace('Aceite y filtros', 'Aceite\u00A0y filtros');
  };

  return (
    <div className="surtidor flo-movil-wrap" style={{ maxWidth: '540px', margin: '0 auto' }}>
      {/* ── Encabezado Móvil ── */}
      <header className="surt-head" style={{ marginBottom: '.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.15rem', margin: 0, fontWeight: 800 }}>📱 Maquinaria y Equipos</h1>
          <div className="muted" style={{ fontSize: '.74rem' }}>{actorName}</div>
        </div>
        {!soloTelefono && (
          <Link to="/app/maquinaria" className="btn btn-sm btn-ghost" style={{ padding: '.2rem .5rem', fontSize: '.74rem', border: '1px solid var(--border)' }} title="Ir a la vista completa de computadora">
            💻 Modo PC
          </Link>
        )}
      </header>

      {/* ── Alertas de mantenimiento (como el «Dinero por entrar» de Acopio): equipos con servicio
          próximo o vencido; al tocarlo se ven y se responden (26/10/2026). Arriba de todo. ── */}
      <AlertasMantenimientoBanner compacto items={alertasMant} actor={actor} actorName={actorName} canWrite={canWrite} onChanged={() => void cargarDatos()} />

      {/* ── Modal flotante de WhatsApp: aparece al instante centrado en pantalla ── */}
      {mensajeWhatsapp && (
        <Modal title="📲 Compartir por WhatsApp" size="md" onClose={() => setMensajeWhatsapp(null)}>
          <div style={{ marginBottom: '.75rem', fontSize: '.84rem', color: 'var(--text-muted)' }}>
            Reporte generado listo para enviar por WhatsApp o copiar:
          </div>
          <CompartirWhatsapp texto={mensajeWhatsapp} />
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setMensajeWhatsapp(null)}
            >
              Cerrar
            </button>
          </div>
        </Modal>
      )}

      {/* Si hay un mensaje de WhatsApp reciente, banner superior de respaldo */}
      {mensajeWhatsapp && (
        <div className="card" style={{
          marginBottom: '.65rem',
          borderColor: 'var(--success)',
          background: 'color-mix(in srgb, var(--success) 8%, var(--surface))',
          padding: '.65rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
            <strong style={{ color: 'var(--success)', fontSize: '.82rem' }}>✅ Movimiento registrado con éxito</strong>
            <button type="button" className="btn btn-sm btn-ghost" style={{ fontSize: '.74rem', padding: '.15rem .45rem' }} onClick={() => setMensajeWhatsapp(null)}>✕ Cerrar</button>
          </div>
          <CompartirWhatsapp texto={mensajeWhatsapp} />
        </div>
      )}

      {/* ── Menú de Acciones Rápidas (Compacto con colores institucionales) ── */}
      <div className="surt-rotulo" style={{ fontSize: '.82rem', fontWeight: 700, margin: '.2rem 0 .4rem', color: 'var(--text-muted)', letterSpacing: '.04em' }}>
        ¿QUÉ DESEAS REPORTAR HOY?
      </div>

      <div className="flo-mv-acciones">
        <button
          type="button"
          className="btn btn-ghost flo-mv-accion"
          aria-pressed={modo === 'servicio'}
          onClick={() => { setModo('servicio'); setMensajeWhatsapp(null); }}
        >
          <span className="ico">🔧</span>
          <strong>Solicitar Servicio</strong>
        </button>

        <button
          type="button"
          className="btn btn-ghost flo-mv-accion tone-info"
          aria-pressed={modo === 'lavado'}
          onClick={() => { setModo('lavado'); setMensajeWhatsapp(null); }}
        >
          <span className="ico">🚿</span>
          <strong>Registrar Lavado</strong>
        </button>

        <button
          type="button"
          className="btn btn-ghost flo-mv-accion tone-danger"
          aria-pressed={modo === 'averia'}
          onClick={() => { setModo('averia'); setMensajeWhatsapp(null); }}
        >
          <span className="ico">⚠️</span>
          <strong>Reportar Avería</strong>
        </button>

        <button
          type="button"
          className="btn btn-ghost flo-mv-accion tone-primary-3"
          aria-pressed={modo === 'filtros'}
          onClick={() => { setModo('filtros'); setMensajeWhatsapp(null); }}
        >
          <span className="ico">🔍</span>
          <strong>Ver Filtros / Rep.</strong>
        </button>
      </div>

      {/* Botón de acceso directo a Solicitudes / Órdenes (Compacto) */}
      {(() => {
        const ordenesActivas = ordenes.filter((o) => o.estado !== 'cancelada' && o.estado !== 'anulada' && o.estado !== 'realizada');
        return (
          <button
            type="button"
            className="btn btn-ghost flo-mv-solicitudes"
            aria-pressed={modo === 'solicitudes'}
            onClick={() => { setModo(modo === 'solicitudes' ? 'menu' : 'solicitudes'); setMensajeWhatsapp(null); }}
          >
            <span>
              <span className="ico">📋</span>
              <span>Mis Solicitudes y Órdenes de Servicio</span>
            </span>
            <span className={`badge ${ordenesActivas.length > 0 ? 'primary' : ''}`}>
              {ordenesActivas.length} {ordenesActivas.length === 1 ? 'activa' : 'activas'}
            </span>
          </button>
        );
      })()}

      {/* ── Vista: Lista de Solicitudes y Órdenes de Servicio (Compacta) ── */}
      {modo === 'solicitudes' && (
        <div className="card" style={{ padding: '.75rem', marginBottom: '.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.6rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '.4rem', color: 'var(--text)' }}>
              <span>📋</span> Solicitudes y Órdenes ({ordenes.length})
            </h3>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '.25rem .6rem', fontSize: '.82rem' }}
              onClick={() => setModo('menu')}
            >
              ✕ Volver
            </button>
          </div>

          {ordenes.length === 0 ? (
            <div style={{ padding: '1.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '1.8rem', marginBottom: '.35rem' }}>📭</div>
              <div style={{ fontSize: '.88rem' }}>No hay solicitudes registradas todavía.</div>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                style={{ marginTop: '.6rem', fontSize: '.82rem', padding: '.35rem .75rem' }}
                onClick={() => setModo('servicio')}
              >
                + Crear primera solicitud
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '.65rem' }}>
              {ordenes.map((o) => {
                const eq = equipos.find((e) => e.id === o.equipo_id);
                const foto = eq ? fotos.get(eq.id) : null;
                const isCancelada = o.estado === 'cancelada';
                const isRepuestos = o.estado === 'repuestos';
                const isRealizada = o.estado === 'realizada';
                return (
                  <div
                    key={o.id}
                    style={{
                      padding: '.75rem',
                      background: 'var(--bg-1)',
                      borderRadius: 'var(--r-md)',
                      border: isCancelada
                        ? '1px solid color-mix(in srgb, var(--danger) 35%, transparent)'
                        : isRepuestos
                        ? '1px solid color-mix(in srgb, var(--warning) 35%, transparent)'
                        : '1px solid var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.35rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 800, fontSize: '.95rem', color: 'var(--primary)' }}>
                          {o.codigo}
                        </span>
                        <span
                          className={`badge ${isCancelada ? 'danger' : isRepuestos ? 'warning' : isRealizada ? 'success' : 'info'}`}
                          style={{ fontSize: '.74rem', fontWeight: 700, textTransform: 'uppercase' }}
                        >
                          {isCancelada ? '❌ CANCELADA (COMPRAS)' : o.estado}
                        </span>
                        {o.urgencia === 'urgente' && (
                          <span className="badge danger" style={{ fontSize: '.72rem' }}>
                            🚨 URGENTE
                          </span>
                        )}
                      </div>
                      <div className="muted" style={{ fontSize: '.78rem' }}>
                        {dateTime(o.created_at)}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '.65rem', alignItems: 'center', margin: '.45rem 0' }}>
                      {foto ? (
                        <img src={foto} alt={eq?.equipo ?? 'Equipo'} style={{ width: 48, height: 48, borderRadius: 'var(--r-sm)', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: 48, height: 48, borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem' }}>
                          {eq ? (claseEquipo(eq) === 'lancha' ? '🚤' : claseEquipo(eq) === 'moto' ? '🏍️' : claseEquipo(eq) === 'vehiculo' ? '🚚' : '🚜') : '🚜'}
                        </div>
                      )}
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '.95rem' }}>{eq?.equipo ?? 'Equipo'}</div>
                        <div className="muted" style={{ fontSize: '.82rem' }}>
                          {[eq?.marca, eq?.modelo].filter(Boolean).join(' · ')}
                          {eq?.placa && <span style={{ marginLeft: '.4rem', padding: '1px 5px', background: 'var(--surface-3)', borderRadius: 'var(--r-sm)', fontWeight: 600 }}>🚗 {eq.placa}</span>}
                        </div>
                      </div>
                    </div>

                    <div style={{ fontSize: '.88rem', marginBottom: '.4rem', color: 'var(--text)', lineHeight: 1.35 }}>
                      <strong>Trabajo / Falla:</strong> {o.descripcion || 'Sin descripción'}
                    </div>

                    {(o.horometro != null || o.kilometraje != null || o.responsable) && (
                      <div className="muted" style={{ fontSize: '.82rem', marginBottom: '.45rem', display: 'flex', flexWrap: 'wrap', gap: '.65rem' }}>
                        {o.responsable && <span>👤 Responsable: {o.responsable}</span>}
                        {o.horometro != null && <span>⏱️ Horómetro: {fmtNum(o.horometro)} h</span>}
                        {o.kilometraje != null && <span>🚗 Km: {fmtNum(o.kilometraje)} km</span>}
                      </div>
                    )}

                    {o.repuestos && o.repuestos.length > 0 && (
                      <div style={{ fontSize: '.82rem', padding: '.45rem .6rem', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', marginBottom: '.55rem' }}>
                        <strong style={{ display: 'block', marginBottom: '.2rem', color: 'var(--warning)' }}>
                          🛒 Piezas enviadas a Compras ({o.repuestos.length}):
                        </strong>
                        {o.repuestos.map((r, ri) => (
                          <div key={ri} className="muted" style={{ fontSize: '.82rem', marginBottom: '.15rem' }}>
                            • <strong>{r.nombre}</strong> ({fmtNum(r.cantidad)} {r.unidad})
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '.5rem', gap: '.5rem' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-success"
                        style={{
                          fontSize: '.84rem',
                          minHeight: '38px',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '.35rem',
                          padding: '.35rem .75rem',
                        }}
                        onClick={() => {
                          const txt = textoServicioWhatsapp({
                            codigo: o.codigo,
                            equipo: eq?.equipo ?? 'Equipo',
                            tipoEquipo: eq?.tipo,
                            marca: eq?.marca,
                            modelo: eq?.modelo,
                            tipoServicio: o.tipo,
                            urgencia: o.urgencia === 'urgente' ? 'urgente' : 'normal',
                            horasActuales: o.horometro,
                            kmActuales: o.kilometraje,
                            responsable: o.responsable,
                            descripcion: o.descripcion,
                            repuestos: o.repuestos.map((r) => ({ nombre: r.nombre, cantidad: r.cantidad, unidad: r.unidad })),
                            fecha: o.created_at,
                          });
                          mostrarWhatsapp(txt);
                        }}
                      >
                        <span>📲</span> Compartir por WhatsApp
                      </button>

                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        style={{
                          fontSize: '.82rem',
                          minHeight: '38px',
                          fontWeight: 600,
                          padding: '.35rem .6rem',
                        }}
                        title="Eliminar orden"
                        onClick={() => setBorrandoMov({ tipo: 'orden', id: o.id, codigo: o.codigo })}
                      >
                        🗑 Borrar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Formulario: Solicitar Servicio (Solicitud a Compras) ── */}
      {modo === 'servicio' && (
        <div className="card" style={{ padding: '1.1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.85rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
              <span>🛒</span> Solicitud de Servicio a Compras
            </h3>
            <button type="button" className="btn btn-sm btn-ghost" style={{ fontSize: '.84rem' }} onClick={() => setModo('menu')}>✕ Volver</button>
          </div>

          <div style={{ display: 'grid', gap: '.85rem' }}>
            <div>
              <label style={{ fontSize: '.9rem', fontWeight: 600, display: 'block', marginBottom: '.3rem' }}>Máquina / Vehículo *</label>
              <SearchSelect
                value={equipoSelId}
                onChange={setEquipoSelId}
                options={opcionesEquipos}
                placeholder="Busca y toca la máquina…"
              />
            </div>

            {equipoActual && (
              <div style={{ padding: '.55rem .75rem', background: 'var(--bg-1)', borderRadius: 'var(--r-md)', fontSize: '.86rem', display: 'flex', gap: '.65rem', alignItems: 'center' }}>
                {fotos.has(equipoActual.id) ? (
                  <img src={fotos.get(equipoActual.id)} alt={equipoActual.equipo} style={{ width: 48, height: 48, borderRadius: 'var(--r-sm)', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: 48, height: 48, borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem' }}>
                    {claseEquipo(equipoActual) === 'lancha' ? '🚤' : claseEquipo(equipoActual) === 'moto' ? '🏍️' : claseEquipo(equipoActual) === 'vehiculo' ? '🚚' : '🚜'}
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div><strong>{equipoActual.equipo}</strong> · {[equipoActual.marca, equipoActual.modelo].filter(Boolean).join(' ')}</div>
                  {equipoActual.placa && <div><span className="badge" style={{ fontSize: '.75rem', padding: '2px 6px' }}>🚗 Placa: {equipoActual.placa}</span></div>}
                  {extraerEncargado(equipoActual) && <div className="muted" style={{ fontSize: '.8rem' }}>👤 Encargado: {extraerEncargado(equipoActual)}</div>}
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  style={{ fontSize: '.78rem', padding: '.3rem .55rem' }}
                  onClick={() => setSubirFotoEq(equipoActual)}
                >
                  📷 Foto
                </button>
              </div>
            )}

            {/* Opciones de Intervención / Tipo de Falla (Aceite, Pieza, Sistema Hidráulico, etc.) */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
                <label style={{ fontSize: '.9rem', fontWeight: 600, margin: 0 }}>
                  Sistema / Intervención requerida *
                </label>
                {intervencionesServicio.length > 0 && (
                  <span className="badge" style={{ fontSize: '.78rem', padding: '2px 8px' }}>
                    {intervencionesServicio.length} {intervencionesServicio.length === 1 ? 'seleccionado' : 'seleccionados'}
                  </span>
                )}
              </div>

              <div className="flo-mv-servicios-grid">
                {SERVICIOS.slice(0, 9).map((s) => {
                  const activa = intervencionesServicio.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`flo-mv-servicio-btn ${activa ? 'activa' : ''}`}
                      onClick={() => {
                        setTipoServicio(s.id);
                        if (activa) {
                          setIntervencionesServicio((prev) => prev.filter((x) => x !== s.id));
                        } else {
                          setIntervencionesServicio((prev) => [...prev, s.id]);
                        }
                        if (!descripcionServicio.trim()) {
                          if (s.id === 'aceite') setDescripcionServicio('Cambio de aceite de motor y filtros');
                          else if (s.id === 'hidraulico') setDescripcionServicio('Revisión de fuga / manguera hidráulica y reposición');
                          else if (s.id === 'cambio_pieza') setDescripcionServicio('Reemplazo de pieza / repuesto');
                          else if (s.id === 'frenos') setDescripcionServicio('Mantenimiento de sistema de frenos');
                          else if (s.id === 'electrico') setDescripcionServicio('Revisión sistema eléctrico / batería');
                          else if (s.id === 'cauchos') setDescripcionServicio('Reparación / cambio de cauchos');
                        }
                      }}
                    >
                      <span className="ico">{s.icon}</span>
                      <span className="lbl">{formatoEtiquetaServicio(s.label)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="surt-grid2">
              <div>
                <label style={{ fontSize: '.9rem', fontWeight: 600, display: 'block', marginBottom: '.3rem' }}>Urgencia</label>
                <select className="select" style={{ fontSize: '.92rem' }} value={urgenciaServicio} onChange={(e) => setUrgenciaServicio(e.target.value as 'normal' | 'urgente')}>
                  <option value="normal">NORMAL</option>
                  <option value="urgente">🚨 URGENTE</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '.9rem', fontWeight: 600, display: 'block', marginBottom: '.3rem' }}>Responsable / Mecánico</label>
                <input
                  type="text"
                  className="input"
                  style={{ fontSize: '.92rem' }}
                  value={responsableServicio}
                  onChange={(e) => setResponsableServicio(e.target.value)}
                  placeholder="Nombre de quien revisa…"
                />
              </div>
            </div>

            <div className="surt-grid2">
              <div>
                <label style={{ fontSize: '.9rem', fontWeight: 600, display: 'block', marginBottom: '.3rem' }}>Horómetro actual</label>
                <input
                  type="number"
                  className="input mono"
                  style={{ fontSize: '.92rem' }}
                  value={horasServicio}
                  onChange={(e) => setHorasServicio(e.target.value)}
                  placeholder="Ej. 4500"
                />
              </div>

              <div>
                <label style={{ fontSize: '.9rem', fontWeight: 600, display: 'block', marginBottom: '.3rem' }}>Kilometraje actual</label>
                <input
                  type="number"
                  className="input mono"
                  style={{ fontSize: '.92rem' }}
                  value={kmServicio}
                  onChange={(e) => setKmServicio(e.target.value)}
                  placeholder="Ej. 120000"
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '.9rem', fontWeight: 600, display: 'block', marginBottom: '.3rem' }}>Trabajo o falla a reparar *</label>
              <textarea
                className="input"
                rows={3}
                style={{ fontSize: '.92rem' }}
                value={descripcionServicio}
                onChange={(e) => setDescripcionServicio(e.target.value)}
                placeholder="Describe qué trabajo necesita la máquina o qué repuesto hace falta…"
              />
            </div>

            {/* Repuestos de la ficha para añadir con un toque */}
            {repuestosEquipo.length > 0 && (
              <div>
                <label style={{ fontSize: '.9rem', fontWeight: 600, display: 'block', marginBottom: '.35rem' }}>
                  🔩 Agregar repuestos de la ficha ({repuestosEquipo.length})
                </label>
                <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', maxHeight: '110px', overflowY: 'auto' }}>
                  {repuestosEquipo.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ fontSize: '.82rem', padding: '.25rem .55rem' }}
                      onClick={() => {
                        const ya = piezasSeleccionadas.some((p) => p.nombre === r.tipo);
                        if (!ya) {
                          setPiezasSeleccionadas((prev) => [...prev, { nombre: r.tipo, cantidad: r.cantidad || 1, unidad: r.unidad || 'und' }]);
                        }
                      }}
                    >
                      + {r.tipo}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Agregar pieza libre con nombre general (Compras formalizará con N° de parte) */}
            <div style={{ padding: '.85rem', background: 'var(--bg-1)', borderRadius: 'var(--r-md)', border: '1px dashed var(--border-strong)' }}>
              <label style={{ fontSize: '.92rem', fontWeight: 700, display: 'block', marginBottom: '.5rem', color: 'var(--text)' }}>
                🛒 Pedir pieza o repuesto a Compras (nombre general):
              </label>

              {/* Fila 1: Campo de texto con ancho completo para el nombre o descripción */}
              <div style={{ marginBottom: '.55rem' }}>
                <input
                  type="text"
                  className="input"
                  style={{ fontSize: '.92rem', padding: '.6rem .75rem', width: '100%', boxSizing: 'border-box' }}
                  placeholder="Ej. Filtro de aceite, Manguera 1/2, Correa…"
                  value={nombrePiezaLibre}
                  onChange={(e) => setNombrePiezaLibre(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      agregarPiezaLibre();
                    }
                  }}
                />
              </div>

              {/* Fila 2: Cantidad, unidad y botón Agregar espacioso y táctil */}
              <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flex: '0 0 auto' }}>
                  <span style={{ fontSize: '.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Cant:</span>
                  <input
                    type="number"
                    className="input mono"
                    style={{ fontSize: '.92rem', padding: '.5rem .4rem', width: '65px', textAlign: 'center', boxSizing: 'border-box' }}
                    placeholder="1"
                    value={cantPiezaLibre}
                    onChange={(e) => setCantPiezaLibre(e.target.value)}
                  />
                </div>
                <div style={{ flex: '0 0 auto' }}>
                  <select
                    className="select"
                    style={{ fontSize: '.88rem', padding: '.5rem .5rem', minWidth: '78px' }}
                    value={unidadPiezaLibre}
                    onChange={(e) => setUnidadPiezaLibre(e.target.value)}
                  >
                    <option value="und">und</option>
                    <option value="lts">lts</option>
                    <option value="jgo">jgo</option>
                    <option value="mts">mts</option>
                  </select>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{
                    flex: 1,
                    fontSize: '.9rem',
                    fontWeight: 700,
                    padding: '.55rem .75rem',
                    minHeight: '42px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '.35rem',
                  }}
                  onClick={agregarPiezaLibre}
                >
                  + Agregar
                </button>
              </div>

              <small className="muted" style={{ fontSize: '.78rem', display: 'block', marginTop: '.5rem', lineHeight: 1.35 }}>
                💡 Escribe nombres generales. Compras recibirá la solicitud directa para cotizar y asignar el N° de parte oficial.
              </small>
            </div>

            {/* Piezas agregadas */}
            {piezasSeleccionadas.length > 0 && (
              <div style={{ padding: '.65rem', background: 'var(--bg-1)', borderRadius: 'var(--r-md)' }}>
                <small style={{ fontWeight: 700, fontSize: '.88rem', display: 'block', marginBottom: '.35rem', color: 'var(--warning)' }}>
                  Piezas que se enviarán a Compras ({piezasSeleccionadas.length}):
                </small>
                {piezasSeleccionadas.map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.86rem', marginBottom: '.3rem' }}>
                    <span>• {p.nombre} ({fmtNum(p.cantidad)} {p.unidad})</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ padding: '0 .4rem', color: 'var(--danger)' }}
                      onClick={() => setPiezasSeleccionadas((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '.85rem', fontWeight: 700, fontSize: '1rem' }}
              disabled={saving}
              onClick={() => void guardarServicio()}
            >
              {saving ? 'Enviando a Compras…' : '🛒 Guardar y Enviar a Compras'}
            </button>
          </div>
        </div>
      )}

      {/* ── Formulario: Registrar Lavado ── */}
      {modo === 'lavado' && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.15rem' }}>🚿 Registrar Lavado de Equipo</h3>
            <button type="button" className="btn btn-sm btn-ghost" style={{ fontSize: '.85rem' }} onClick={() => setModo('menu')}>✕ Volver</button>
          </div>

          <div style={{ display: 'grid', gap: '.85rem' }}>
            <div>
              <label style={{ fontSize: '.9rem', fontWeight: 700, display: 'block', marginBottom: '.3rem' }}>Máquina / Vehículo *</label>
              <SearchSelect
                value={equipoSelId}
                onChange={setEquipoSelId}
                options={opcionesEquipos}
                placeholder="Busca la máquina que se lavó…"
              />
            </div>

            <div>
              <label style={{ fontSize: '.9rem', fontWeight: 700, display: 'block', marginBottom: '.35rem' }}>Tipo de lavado</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.4rem' }}>
                {TIPOS_LAVADO.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`btn btn-sm ${tipoLavado === t ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ minHeight: '44px', fontSize: '.88rem', fontWeight: tipoLavado === t ? 700 : 500 }}
                    onClick={() => setTipoLavado(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '.9rem', fontWeight: 700, display: 'block', marginBottom: '.3rem' }}>Lavador / Responsable</label>
              <input
                className="input"
                style={{ fontSize: '.92rem', padding: '.45rem .6rem' }}
                value={lavador}
                onChange={(e) => setLavador(e.target.value)}
                placeholder="Nombre de quien realizó el lavado…"
              />
            </div>

            <div>
              <label style={{ fontSize: '.9rem', fontWeight: 700, display: 'block', marginBottom: '.3rem' }}>Observaciones (opcional)</label>
              <input
                className="input"
                style={{ fontSize: '.92rem', padding: '.45rem .6rem' }}
                value={notasLavado}
                onChange={(e) => setNotasLavado(e.target.value)}
                placeholder="Ej. Lavado con desengrasante, chasis limpio"
              />
            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '.85rem', fontWeight: 700, fontSize: '1rem', minHeight: '48px' }}
              disabled={saving}
              onClick={() => void guardarLavado()}
            >
              {saving ? 'Guardando…' : '💾 Guardar y Enviar por WhatsApp'}
            </button>
          </div>
        </div>
      )}

      {/* ── Formulario: Reportar Avería / Estado ── */}
      {modo === 'averia' && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.15rem' }}>⚠️ Reportar Avería / Parada</h3>
            <button type="button" className="btn btn-sm btn-ghost" style={{ fontSize: '.85rem' }} onClick={() => setModo('menu')}>✕ Volver</button>
          </div>

          <div style={{ display: 'grid', gap: '.85rem' }}>
            <div>
              <label style={{ fontSize: '.9rem', fontWeight: 700, display: 'block', marginBottom: '.3rem' }}>Máquina / Vehículo *</label>
              <SearchSelect
                value={equipoSelId}
                onChange={setEquipoSelId}
                options={opcionesEquipos}
                placeholder="Busca la máquina con la avería…"
              />
            </div>

            <div>
              <label style={{ fontSize: '.9rem', fontWeight: 700, display: 'block', marginBottom: '.35rem' }}>Nuevo estado del equipo</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.4rem' }}>
                <button
                  type="button"
                  className={`btn btn-sm ${estadoAveria === 'averiada' ? 'btn-danger' : 'btn-ghost'}`}
                  style={{ minHeight: '46px', fontSize: '.88rem', fontWeight: 700 }}
                  onClick={() => setEstadoAveria('averiada')}
                >
                  🚨 AVERIADA
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${estadoAveria === 'parada' ? 'btn-danger' : 'btn-ghost'}`}
                  style={{ minHeight: '46px', fontSize: '.88rem', fontWeight: 700 }}
                  onClick={() => setEstadoAveria('parada')}
                >
                  🛑 PARADA
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${estadoAveria === 'taller' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ minHeight: '46px', fontSize: '.88rem', fontWeight: 700 }}
                  onClick={() => setEstadoAveria('taller')}
                >
                  🛠️ EN TALLER
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${estadoAveria === 'espera' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ minHeight: '46px', fontSize: '.88rem', fontWeight: 700 }}
                  onClick={() => setEstadoAveria('espera')}
                >
                  ⏳ ESPERANDO REP.
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${estadoAveria === 'operativa' ? 'btn-success' : 'btn-ghost'}`}
                  style={{ gridColumn: '1 / -1', minHeight: '46px', fontSize: '.88rem', fontWeight: 700 }}
                  onClick={() => setEstadoAveria('operativa')}
                >
                  ✅ OPERATIVA
                </button>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '.9rem', fontWeight: 700, display: 'block', marginBottom: '.3rem' }}>Motivo / Falla detectada *</label>
              <textarea
                className="input"
                rows={2}
                style={{ fontSize: '.92rem', padding: '.5rem .65rem' }}
                value={motivoAveria}
                onChange={(e) => setMotivoAveria(e.target.value)}
                placeholder="Explica qué daño tiene o por qué se paró el equipo…"
              />
            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '.85rem', fontWeight: 700, fontSize: '1rem', minHeight: '48px' }}
              disabled={saving}
              onClick={() => void guardarAveria()}
            >
              {saving ? 'Guardando…' : '💾 Guardar y Enviar por WhatsApp'}
            </button>
          </div>
        </div>
      )}

      {/* ── Consulta de Filtros / Repuestos ── */}
      {modo === 'filtros' && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.15rem' }}>🔍 Filtros y Marcas de la Máquina</h3>
            <button type="button" className="btn btn-sm btn-ghost" style={{ fontSize: '.85rem' }} onClick={() => setModo('menu')}>✕ Volver</button>
          </div>

          <div style={{ marginBottom: '.75rem' }}>
            <SearchSelect
              value={equipoSelId}
              onChange={setEquipoSelId}
              options={opcionesEquipos}
              placeholder="Elige una máquina para ver sus filtros…"
            />
          </div>

          {equipoActual ? (
            <div>
              <div style={{ padding: '.65rem .75rem', background: 'var(--bg-1)', borderRadius: 'var(--r-md)', fontSize: '.88rem', marginBottom: '.75rem' }}>
                <div style={{ fontSize: '.92rem' }}><strong>{equipoActual.equipo}</strong> · {[equipoActual.marca, equipoActual.modelo].filter(Boolean).join(' ')}</div>
                {extraerEncargado(equipoActual) && <div className="muted" style={{ fontSize: '.82rem', marginTop: '.2rem' }}>👤 Encargado: {extraerEncargado(equipoActual)}</div>}
                {(equipoActual.motor_modelo || equipoActual.motor_serial) && (
                  <div className="muted" style={{ fontSize: '.82rem', marginTop: '.2rem' }}>⚙️ Motor: {[equipoActual.motor_modelo, equipoActual.motor_serial].filter(Boolean).join(' · ')}</div>
                )}
              </div>

              {repuestosEquipo.length === 0 ? (
                <div className="muted" style={{ fontSize: '.85rem', padding: '.5rem 0' }}>Sin ficha de repuestos cargada aún.</div>
              ) : (
                <div style={{ display: 'grid', gap: '.5rem', marginBottom: '.75rem' }}>
                  {repuestosEquipo.map((r) => {
                    const sis = sistemaDe(r.sistema);
                    return (
                      <div key={r.id} style={{ padding: '.6rem .75rem', background: 'var(--bg-1)', borderRadius: 'var(--r-md)', fontSize: '.86rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong style={{ fontSize: '.9rem' }}>{sis.icon} {r.tipo}</strong>
                          <span className="muted" style={{ fontWeight: 600 }}>{fmtNum(r.cantidad)} {r.unidad}</span>
                        </div>
                        {r.numero_parte && <div className="mono" style={{ color: 'var(--primary)', marginTop: '.15rem', fontSize: '.84rem' }}>OEM: {r.numero_parte}</div>}
                        {r.equivalencias && r.equivalencias.length > 0 && (
                          <div style={{ color: 'var(--info)', marginTop: '.15rem', fontSize: '.82rem' }}>Marcas: {r.equivalencias.join(' · ')}</div>
                        )}
                        {r.especificacion && <div className="muted" style={{ fontSize: '.8rem', marginTop: '.15rem' }}>Esp: {r.especificacion}</div>}
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', padding: '.85rem', fontWeight: 700, fontSize: '1rem', minHeight: '48px' }}
                onClick={() => {
                  const txt = textoFichaFiltrosWhatsapp({
                    equipo: equipoActual.equipo,
                    tipo: equipoActual.tipo,
                    marca: equipoActual.marca,
                    modelo: equipoActual.modelo,
                    motor: [equipoActual.motor_modelo, equipoActual.motor_serial].filter(Boolean).join(' · '),
                    horasActuales: equipoActual.mantenimiento_base_hrs ?? null,
                    filtros: repuestosEquipo.map((f) => ({
                      sistema: f.sistema,
                      tipo: f.tipo,
                      numeroParte: f.numero_parte,
                      equivalencias: f.equivalencias,
                      especificacion: f.especificacion,
                    })),
                  });
                  setMensajeWhatsapp(txt);
                }}
              >
                📲 Compartir filtros por WhatsApp
              </button>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: '.8rem' }}>Selecciona una máquina arriba para consultar sus especificaciones técnicas y filtros.</div>
          )}
        </div>
      )}

      {/* ── Catálogo de Máquinas y Horas de Mantenimiento ── */}
      <div className="flo-mv-cat">
        <div className="flo-mv-cat-head">
          <div>
            <strong>🚜 Catálogo de Equipos y Horas</strong>
            <span className="badge">{equiposCatalogo.length} de {equipos.length}</span>
          </div>
          <div className="flo-mv-cat-acc">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              title="Descargar Catálogo y Fichas Técnicas en PDF"
              onClick={() => setExportarPdfMovilOpen(true)}
            >
              📄 PDF
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setNuevoEquipoMovilOpen(true)}
            >
              {filtroCatalogo === 'motos' ? '+ Nueva moto' : filtroCatalogo === 'lanchas' ? '+ Nueva lancha' : filtroCatalogo === 'vehiculos' ? '+ Nuevo vehículo' : filtroCatalogo === 'pesada' ? '+ Nueva maquinaria' : '+ Nuevo equipo'}
            </button>
          </div>
        </div>

        {/* Buscador táctil */}
        <input
          className="input"
          placeholder="🔍 Buscar máquina, modelo, placa, encargado…"
          value={busquedaCatalogo}
          onChange={(e) => setBusquedaCatalogo(e.target.value)}
        />

        {/* Filtros rápidos por categoría: chips deslizables (sin scroll horizontal de la página) */}
        <div className="flo-pills solido" role="tablist" aria-label="Filtrar catálogo por categoría">
          <button type="button" className="flo-pill" aria-pressed={filtroCatalogo === 'todos'} onClick={() => setFiltroCatalogo('todos')}>
            Todos<span className="n">{conteosCatalogo.total}</span>
          </button>
          <button type="button" className="flo-pill" aria-pressed={filtroCatalogo === 'lanchas'} onClick={() => setFiltroCatalogo('lanchas')}>
            🚤 Lanchas<span className="n">{conteosCatalogo.lanchas}</span>
          </button>
          <button type="button" className="flo-pill" aria-pressed={filtroCatalogo === 'pesada'} onClick={() => setFiltroCatalogo('pesada')}>
            🚜 Maquinaria<span className="n">{conteosCatalogo.pesada}</span>
          </button>
          <button type="button" className="flo-pill" aria-pressed={filtroCatalogo === 'vehiculos'} onClick={() => setFiltroCatalogo('vehiculos')}>
            🚚 Vehículos<span className="n">{conteosCatalogo.vehiculos}</span>
          </button>
          <button type="button" className="flo-pill" aria-pressed={filtroCatalogo === 'motos'} onClick={() => setFiltroCatalogo('motos')}>
            🏍️ Motos<span className="n">{conteosCatalogo.motos}</span>
          </button>
          <button type="button" className="flo-pill" aria-pressed={filtroCatalogo === 'alertas'} onClick={() => setFiltroCatalogo('alertas')}>
            ⚠️ Próx. / Vencidos<span className="n">{conteosCatalogo.alertas}</span>
          </button>
        </div>

        {/* Lista / Tarjetas de equipos tipo catálogo */}
        <div className="flo-mv-lista">
          {equiposCatalogo.map((eq) => {
            const inf = infoEquipos.get(eq.id);
            const av = inf?.aviso;
            const horo = inf?.horometro;
            const km = inf?.kilometraje;
            const enc = inf?.encargado;
            const foto = fotos.get(eq.id);
            const operativa = !inf?.estado || inf.estado === 'operativa';

            return (
              <div
                key={eq.id}
                role="button"
                tabIndex={0}
                className={`flo-mv-card${av?.nivel === 'vencido' ? ' vencido' : av?.nivel === 'proximo' ? ' proximo' : ''}`}
                onClick={() => abrirOpcionesEquipo(eq)}
                onKeyDown={(e) => { if (e.key === 'Enter') abrirOpcionesEquipo(eq); }}
              >
                <div className="flo-mv-card-top">
                  {/* Foto miniatura o icono de clase */}
                  <div className="flo-mv-thumb">
                    <div className="flo-thumb">
                      {foto ? (
                        <img src={foto} alt={eq.equipo} />
                      ) : (
                        claseEquipo(eq) === 'lancha' ? '🚤' : claseEquipo(eq) === 'moto' ? '🏍️' : claseEquipo(eq) === 'vehiculo' ? '🚚' : '🚜'
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost flo-mv-foto-btn"
                      title="Cambiar foto del equipo"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSubirFotoEq(eq);
                      }}
                    >
                      📷
                    </button>
                  </div>

                  {/* Datos del equipo */}
                  <div className="flo-mv-datos">
                    <div className="flo-mv-nombre">
                      <strong>{eq.equipo}</strong>
                      <span className={`badge ${operativa ? 'success' : 'danger'}`}>
                        {inf?.estado?.toUpperCase() || 'OPERATIVA'}
                      </span>
                    </div>

                    <div className="flo-mv-sub muted">
                      <span>{[eq.tipo, eq.marca, eq.modelo].filter(Boolean).join(' · ') || 'Sin tipo'}</span>
                      {eq.placa && <span className="flo-mv-placa mono">{eq.placa}</span>}
                    </div>

                    {enc && (
                      <div className="flo-mv-enc">
                        👤 Encargado: <strong>{enc}</strong>
                      </div>
                    )}
                  </div>
                </div>

                {/* Lectura vigente + estado del servicio en una sola fila */}
                <div className="flo-mv-lectura">
                  <span>
                    <span className="muted">{horo == null && km != null ? 'Kilometraje: ' : 'Horómetro: '}</span>
                    <span className="mono">{horo != null ? `${fmtNum(horo)} h` : km != null ? `${fmtNum(km)} km` : '—'}</span>
                  </span>
                  <BadgeServicio av={av} />
                </div>

                <div className="flo-mv-card-acc">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      const txt = textoEstadoEquipoWhatsapp({
                        equipo: eq.equipo,
                        tipo: eq.tipo,
                        marca: eq.marca,
                        modelo: eq.modelo,
                        estado: inf?.estado || 'operativa',
                        encargado: enc,
                        horometro: horo,
                        kilometraje: km,
                        horasFaltantes: av?.restante ?? null,
                        nivelAviso: av?.nivel ?? null,
                        unidadAviso: av?.unidad ?? 'h',
                      });
                      mostrarWhatsapp(txt);
                    }}
                  >
                    📲 WhatsApp
                  </button>
                  <span className="ayuda">Toque para ver opciones ▸</span>
                </div>
              </div>
            );
          })}

          {!equiposCatalogo.length && (
            <div className="muted" style={{ padding: '1rem', textAlign: 'center', fontSize: '.84rem' }}>
              No se encontraron equipos con ese filtro o búsqueda.
            </div>
          )}
        </div>
      </div>

      {/* ── Modal de Opciones para un Equipo (al tocarlo en el catálogo) ── */}
      {equipoOpciones && (
        <Modal
          title={`🚜 ${equipoOpciones.equipo}`}
          size="md"
          onClose={() => setEquipoOpciones(null)}
          footer={
            <button type="button" className="btn btn-ghost btn-grande" onClick={() => setEquipoOpciones(null)}>
              ✕ Volver al Catálogo
            </button>
          }
        >
          {(() => {
            const inf = infoEquipos.get(equipoOpciones.id);
            const av = inf?.aviso;
            const horo = inf?.horometro;
            const km = inf?.kilometraje;
            const enc = inf?.encargado;

            return (
              <div style={{ display: 'grid', gap: '.75rem' }}>
                {/* Resumen del equipo (mismo patrón que la tarjeta del catálogo) */}
                <div className="flo-mv-resumen">
                  <div className="flo-mv-card-top">
                    <div className="flo-thumb">
                      {fotos.has(equipoOpciones.id) ? (
                        <img src={fotos.get(equipoOpciones.id)} alt={equipoOpciones.equipo} />
                      ) : (
                        claseEquipo(equipoOpciones) === 'lancha' ? '🚤' : claseEquipo(equipoOpciones) === 'moto' ? '🏍️' : claseEquipo(equipoOpciones) === 'vehiculo' ? '🚚' : '🚜'
                      )}
                    </div>
                    <div className="flo-mv-datos">
                      <div className="flo-mv-sub muted">
                        <span>{[equipoOpciones.tipo, equipoOpciones.marca, equipoOpciones.modelo].filter(Boolean).join(' · ') || 'Sin tipo'}</span>
                        {equipoOpciones.placa && <span className="flo-mv-placa mono">{equipoOpciones.placa}</span>}
                      </div>
                      {enc && <div className="flo-mv-enc">👤 Encargado: <strong>{enc}</strong></div>}
                    </div>
                  </div>

                  <div className="flo-mv-lectura">
                    <span>
                      <span className="muted">{horo == null && km != null ? '⏱️ Kilometraje: ' : '⏱️ Horómetro: '}</span>
                      <span className="mono">{horo != null ? `${fmtNum(horo)} h` : km != null ? `${fmtNum(km)} km` : '—'}</span>
                    </span>
                    <BadgeServicio av={av} />
                  </div>
                </div>

                <div className="muted" style={{ fontSize: '.82rem', fontWeight: 600, marginTop: '.2rem' }}>
                  ¿Qué deseas registrar para esta máquina?
                </div>

                {/* Botones de acción directa */}
                <button
                  type="button"
                  className="btn btn-primary flo-mv-opcion"
                  onClick={() => {
                    setEquipoSelId(equipoOpciones.id);
                    setModo('servicio');
                    setEquipoOpciones(null);
                  }}
                >
                  <span>🔧</span>
                  <span>Solicitar Servicio a este Equipo</span>
                </button>

                <button
                  type="button"
                  className="btn btn-ghost flo-mv-opcion"
                  onClick={() => {
                    setSubirFotoEq(equipoOpciones);
                    setEquipoOpciones(null);
                  }}
                >
                  <span>📷</span>
                  <span>{fotos.has(equipoOpciones.id) ? 'Ver / Actualizar Foto del Equipo' : 'Subir Foto de la Máquina'}</span>
                </button>

                <button
                  type="button"
                  className="btn btn-ghost flo-mv-opcion"
                  onClick={() => {
                    setEquipoSelId(equipoOpciones.id);
                    setModo('lavado');
                    setEquipoOpciones(null);
                  }}
                >
                  <span>🚿</span>
                  <span>Registrar Lavado</span>
                </button>

                <button
                  type="button"
                  className="btn btn-ghost flo-mv-opcion"
                  onClick={() => {
                    setEquipoSelId(equipoOpciones.id);
                    setModo('averia');
                    setEquipoOpciones(null);
                  }}
                >
                  <span>⚠️</span>
                  <span>Reportar Avería o Parada</span>
                </button>

                <button
                  type="button"
                  className="btn btn-ghost flo-mv-opcion"
                  onClick={() => {
                    setEquipoSelId(equipoOpciones.id);
                    setModo('filtros');
                    setEquipoOpciones(null);
                  }}
                >
                  <span>🔍</span>
                  <span>Ver Filtros y Repuestos (OEM / Marcas)</span>
                </button>

                <button
                  type="button"
                  className="btn btn-ghost flo-mv-opcion ficha"
                  onClick={async () => {
                    try {
                      const fts = await fotosDeEquipos(equipoOpciones.id).catch(() => []);
                      const { fichaEquipoPdf } = await import('./flotaPdf');
                      await fichaEquipoPdf(
                        equipoOpciones,
                        {
                          horometro: horo ?? null,
                          km: km ?? null,
                          restantesHrs: (av?.unidad === 'h' && av.restante != null) ? av.restante : null,
                          restantesKm: (av?.unidad === 'km' && av.restante != null) ? av.restante : null,
                          ultimoSurtido: null,
                        },
                        ordenes.filter((o) => o.equipo_id === equipoOpciones.id),
                        fts,
                        lavados.filter((l) => l.equipo_id === equipoOpciones.id)
                      );
                    } catch (err) {
                      toast(err instanceof Error ? err.message : 'Error al generar ficha técnica', 'error');
                    }
                  }}
                >
                  <span>📄</span>
                  <span>Descargar Ficha Técnica Oficial (PDF)</span>
                </button>

                <button
                  type="button"
                  className="btn btn-success flo-mv-opcion"
                  onClick={() => {
                    const txt = textoEstadoEquipoWhatsapp({
                      equipo: equipoOpciones.equipo,
                      tipo: equipoOpciones.tipo,
                      marca: equipoOpciones.marca,
                      modelo: equipoOpciones.modelo,
                      estado: inf?.estado || 'operativa',
                      encargado: enc,
                      horometro: horo,
                      kilometraje: km,
                      horasFaltantes: av?.restante ?? null,
                      nivelAviso: av?.nivel ?? null,
                      unidadAviso: av?.unidad ?? 'h',
                    });
                    mostrarWhatsapp(txt);
                    setEquipoOpciones(null);
                  }}
                >
                  <span>📲</span>
                  <span>Compartir Estado por WhatsApp</span>
                </button>
              </div>
            );
          })()}
        </Modal>
      )}

      {/* ── Últimos Movimientos de la Flota (con reenvío WhatsApp y Borrado) ── */}
      <div style={{ marginTop: '1.25rem' }}>
        <div style={{ fontSize: '.86rem', fontWeight: 600, marginBottom: '.5rem', display: 'flex', justifyContent: 'space-between' }}>
          <span>📋 Últimos movimientos</span>
          <span className="muted" style={{ fontSize: '.75rem' }}>{ordenes.length + lavados.length} registros</span>
        </div>

        {loading ? (
          <div className="muted" style={{ fontSize: '.8rem' }}>Cargando movimientos…</div>
        ) : (
          <div style={{ display: 'grid', gap: '.45rem' }}>
            {ordenes.slice(0, 5).map((o) => {
              const eq = equipos.find((e) => e.id === o.equipo_id);
              return (
                <div key={o.id} className="flo-linea" style={{
                  padding: '.55rem .75rem',
                  background: 'var(--surface-2)',
                  borderRadius: 'var(--r-md)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <div style={{ minWidth: 0, marginRight: '.5rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      🔧 {o.codigo} · {eq?.equipo ?? 'Equipo'}
                    </div>
                    <div className="muted" style={{ fontSize: '.72rem' }}>
                      {o.tipo.toUpperCase()} · {o.responsable ?? 'Sin resp.'} · {dateTime(o.created_at)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '.3rem', flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ fontSize: '.72rem', padding: '.2rem .4rem' }}
                      title="Compartir por WhatsApp"
                      onClick={() => {
                        const txt = textoServicioWhatsapp({
                          codigo: o.codigo,
                          equipo: eq?.equipo ?? 'Equipo',
                          tipoEquipo: eq?.tipo,
                          marca: eq?.marca,
                          modelo: eq?.modelo,
                          tipoServicio: o.tipo,
                          urgencia: o.urgencia,
                          horasActuales: o.horometro,
                          kmActuales: o.kilometraje,
                          responsable: o.responsable,
                          descripcion: o.descripcion,
                          repuestos: o.repuestos.map((r) => ({ nombre: r.nombre, cantidad: r.cantidad, unidad: r.unidad })),
                          fecha: o.created_at,
                        });
                        setMensajeWhatsapp(txt);
                      }}
                    >
                      📲 WhatsApp
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ fontSize: '.72rem', padding: '.2rem .35rem', color: 'var(--danger)' }}
                      title="Eliminar este movimiento"
                      onClick={() => setBorrandoMov({ tipo: 'orden', id: o.id, codigo: o.codigo })}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              );
            })}

            {lavados.slice(0, 3).map((l) => {
              const eq = equipos.find((e) => e.id === l.equipo_id);
              return (
                <div key={l.id} className="flo-linea" style={{
                  padding: '.55rem .75rem',
                  background: 'var(--surface-2)',
                  borderRadius: 'var(--r-md)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <div style={{ minWidth: 0, marginRight: '.5rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      🚿 Lavado {l.tipo} · {eq?.equipo ?? 'Equipo'}
                    </div>
                    <div className="muted" style={{ fontSize: '.72rem' }}>
                      Lavador: {l.responsable ?? '—'} · {dateTime(l.fecha)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '.3rem', flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ fontSize: '.72rem', padding: '.2rem .4rem' }}
                      title="Compartir por WhatsApp"
                      onClick={() => {
                        const txt = textoLavadoWhatsapp({
                          equipo: eq?.equipo ?? 'Equipo',
                          tipoEquipo: eq?.tipo,
                          tipoLavado: l.tipo,
                          lavador: l.responsable,
                          notas: l.nota,
                          fecha: l.fecha,
                        });
                        mostrarWhatsapp(txt);
                      }}
                    >
                      📲 WhatsApp
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ fontSize: '.72rem', padding: '.2rem .35rem', color: 'var(--danger)' }}
                      title="Eliminar este lavado"
                      onClick={() => setBorrandoMov({ tipo: 'lavado', id: l.id, codigo: `Lavado ${l.tipo}` })}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              );
            })}

            {!ordenes.length && !lavados.length && (
              <div className="muted" style={{ fontSize: '.8rem', padding: '.6rem', textAlign: 'center' }}>
                Sin movimientos recientes registrados.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirmación para borrar movimiento */}
      {borrandoMov && (
        <ConfirmDialog
          title="Eliminar movimiento"
          message={`¿Estás seguro de eliminar el registro «${borrandoMov.codigo}»? Esta acción no se puede deshacer.`}
          confirmText="Sí, eliminar"
          danger
          onConfirm={async () => {
            try {
              if (borrandoMov.tipo === 'orden') {
                await eliminarOrdenServicio({ id: borrandoMov.id, codigo: borrandoMov.codigo });
              } else {
                await eliminarLavado(borrandoMov.id);
              }
              toast('Movimiento eliminado correctamente', 'success');
              setBorrandoMov(null);
              await cargarDatos();
            } catch (err) {
              toast(err instanceof Error ? err.message : 'No se pudo eliminar el movimiento', 'error');
            }
          }}
          onCancel={() => setBorrandoMov(null)}
        />
      )}

      {/* Modal para Subir / Actualizar Foto del Equipo desde Móvil */}
      {subirFotoEq && (
        <SubirFotoEquipoModal
          equipoId={subirFotoEq.id}
          equipoNombre={subirFotoEq.equipo}
          fotos={fotos.has(subirFotoEq.id) ? 1 : 0}
          actor={actor}
          actorName={actorName}
          onClose={() => setSubirFotoEq(null)}
          onSubida={cargarDatos}
          onVerFotos={() => {}}
          onDocumentos={() => {}}
        />
      )}

      {/* Modal para Crear Nuevo Equipo / Moto / Lancha desde Móvil */}
      {nuevoEquipoMovilOpen && (
        <EquipoFormModal
          equipo={null}
          actor={actor}
          claseInicial={
            filtroCatalogo === 'lanchas' ? 'lancha' :
            filtroCatalogo === 'motos' ? 'moto' :
            filtroCatalogo === 'vehiculos' ? 'vehiculo' :
            filtroCatalogo === 'pesada' ? 'maquinaria' : null
          }
          tipoInicial={
            filtroCatalogo === 'lanchas' ? 'LANCHA' :
            filtroCatalogo === 'motos' ? 'MOTO' :
            filtroCatalogo === 'vehiculos' ? 'VEHÍCULO' :
            filtroCatalogo === 'pesada' ? 'MAQUINARIA PESADA' : null
          }
          onClose={() => setNuevoEquipoMovilOpen(false)}
          onSaved={cargarDatos}
        />
      )}

      {/* Modal para Exportar Catálogo y Fichas Técnicas en PDF desde Móvil */}
      {exportarPdfMovilOpen && (
        <ExportarEquiposModal
          equipos={equiposCatalogo}
          total={equipos.length}
          fotosMap={fotos}
          contextoMap={new Map(
            equiposCatalogo.map((e) => {
              const inf = infoEquipos.get(e.id);
              return [
                e.id,
                {
                  horometro: inf?.horometro ?? null,
                  kilometraje: inf?.kilometraje ?? null,
                  encargado: inf?.encargado ?? null,
                  avisoServicio: inf?.aviso
                    ? `${inf.aviso.nivel === 'vencido' ? '⛔ Vencido' : inf.aviso.nivel === 'proximo' ? '⚠️ Próximo' : '🟢 Al día'} (${fmtNum(Math.abs(inf.aviso.restante))} ${inf.aviso.unidad})`
                    : null,
                },
              ];
            })
          )}
          onClose={() => setExportarPdfMovilOpen(false)}
        />
      )}
    </div>
  );
}
export default MaquinariaMovilView;
