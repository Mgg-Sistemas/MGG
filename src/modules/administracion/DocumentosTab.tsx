/* ============================================================
   Golden Touch · Administración · Pestaña «Documentos y Permisos»
   (05/11/2026)

   Pilar principal del módulo de Administración para empresas mineras:
     1. Gestión de Documentos y Permisos (Rupdae, Ragda, Mintras, Inces,
        IVSS, Carta Constitutiva, Cédulas de N socios, etc.).
     2. Carpetas organizativas personalizables con notas, íconos y badges dinámicos.
     3. Dimensión de Vencimiento y Caducidad (Vigente, Por Vencer,
        Vencido, Vencido en Trámite, No Vence).
     4. Ingreso dual: Fecha de Vencimiento directa o Tiempo de Vigencia sugerido.
     5. Selectores con barra de búsqueda SearchSelect para Carpetas y Tipos.
     6. Alertas con cuenta regresiva en Hover y detalle al item.
     7. Carga masiva con Drag & Drop (límite seguro de 10 archivos por intento).
     8. Historial ligero de auditoría por documento.
     9. Multi-empresa (reacciona al selector de cabecera).
     10. Reporte dinámico moldeable y mensaje de WhatsApp listos.
   ============================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { toast } from '@/shared/ui/Toast';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { SearchSelect, SearchCreateSelect, type SearchOption } from '@/shared/ui/SearchSelect';
import { ExportarDocumentosModal } from './ExportarDocumentosModal';
import { RenovarDocumentoModal } from './RenovarDocumentoModal';
import { CampoVigenciaVencimiento } from './CampoVigenciaVencimiento';
import { obtenerListaResponsables, type CentroAcopio } from './administracionCentrosResponsables';
import { responsablesEfectivosDocumento, nombrePorEmail } from './administracionResponsabilidad';
import { gestionDelDocumento } from './administracionHonorarios';
import type { Gestion, Profesional } from './admin.repository';
import { listUsuarios } from '@/modules/usuarios/usuarios.repository';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useSession } from '@/modules/auth/authStore';
import type { Responsabilidad } from './admin.repository';
import type { Usuario } from '@/shared/lib/types';
import {
  GestionarCarpetasModal,
  leerCarpetasPersonalizadas,
  guardarCarpetasPersonalizadas,
} from './GestionarCarpetasModal';
import {
  obtenerDetalleHoverVigencia,
} from './administracionVigencia';
import {
  ETIQUETA_CARPETA,
  TIPO_DOCUMENTO_LABEL,
  STATUS_VENCIMIENTO_LABEL,
  STATUS_VENCIMIENTO_COLOR,
  diasRestantes,
  inferirCarpetaYTipo,
  limpiarNombreArchivo,
  type AdminRepo,
  type DocumentoEmpresa,
  type Empresa,
  type InfoCarpetaDoc,
  type StatusVencimiento,
  type TipoDocumento,
} from './admin.repository';

const MAX_ARCHIVOS_POR_INTENTO = 10;
const MAX_TAMANO_BYTES = 25 * 1024 * 1024; // 25 MB

const fFecha = new Intl.DateTimeFormat('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const fFechaHora = new Intl.DateTimeFormat('es-VE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function tamanoFmt(b: number | null): string {
  if (!b || b <= 0) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

interface StagedFile {
  id: string;
  file: File;
  empresaClave: string;
  carpeta: string;
  centroAcopioId?: string;
  responsable?: string;
  tipo: TipoDocumento;
  nombre: string;
  fechaEmision: string;
  fechaVencimiento: string;
  statusVencimiento: StatusVencimiento;
  socioNombre: string;
  entidadEmisora: string;
  numeroRegistro: string;
  notaTramite: string;
}

const OPCIONES_TIPO_DOC: SearchOption[] = [
  // Permisos Mineros y Ambientales
  { value: 'rupdae', label: 'RUPDAE · Registro Único de Actividades Económicas', hint: 'Min. Minas', group: 'Permisos Mineros y Ambientales', groupIcon: '⛏️' },
  { value: 'ragda', label: 'RAGDA · Registro Ambiental y Degradación', hint: 'MinEc', group: 'Permisos Mineros y Ambientales', groupIcon: '⛏️' },
  { value: 'permiso_minero', label: 'Permiso / Concesión Minera Oficial', hint: 'Minas', group: 'Permisos Mineros y Ambientales', groupIcon: '⛏️' },
  { value: 'permiso_ambiental', label: 'Permiso Ambiental / MINEC / Rasda', hint: 'Ambiental', group: 'Permisos Mineros y Ambientales', groupIcon: '⛏️' },
  // Laboral y Parafiscales
  { value: 'mintras', label: 'MINTRAS · Registro Laboral Obligatorio', hint: 'Trabajo', group: 'Laboral y Parafiscales', groupIcon: '⚖️' },
  { value: 'inces', label: 'INCES · Solvencia / Certificado de Aporte', hint: 'Parafiscal', group: 'Laboral y Parafiscales', groupIcon: '⚖️' },
  { value: 'ivss', label: 'IVSS · Solvencia de Seguro Social Obligatorio', hint: 'Parafiscal', group: 'Laboral y Parafiscales', groupIcon: '⚖️' },
  { value: 'faov', label: 'FAOV / BANAVIH · Solvencia Fondo de Vivienda', hint: 'Parafiscal', group: 'Laboral y Parafiscales', groupIcon: '⚖️' },
  // Legal y Estatutario
  { value: 'acta_constitutiva', label: 'Carta / Acta Constitutiva de la Empresa', hint: 'Registro', group: 'Legal y Estatutario', groupIcon: '📜' },
  { value: 'acta_modificacion', label: 'Acta de Asamblea / Modificación Estatutos', hint: 'Estatutos', group: 'Legal y Estatutario', groupIcon: '📜' },
  { value: 'rif', label: 'RIF Jurídico de la Empresa (SENIAT)', hint: 'SENIAT', group: 'Legal y Estatutario', groupIcon: '📜' },
  // Socios y Representantes
  { value: 'cedula_socio', label: 'Cédula de Identidad de Socio', hint: 'Identificación', group: 'Socios y Representantes', groupIcon: '👥' },
  { value: 'rif_socio', label: 'RIF Personal de Socio (SENIAT)', hint: 'SENIAT', group: 'Socios y Representantes', groupIcon: '👥' },
  { value: 'cedula', label: 'Cédula de Identidad Representante Legal', hint: 'Identificación', group: 'Socios y Representantes', groupIcon: '👥' },
  // Tributario y Municipal
  { value: 'patente_municipal', label: 'Patente de Industria y Comercio', hint: 'Alcaldía', group: 'Tributario y Municipal', groupIcon: '🏛️' },
  { value: 'solvencia_municipal', label: 'Solvencia Municipal / Aseo / Inmuebles', hint: 'Alcaldía', group: 'Tributario y Municipal', groupIcon: '🏛️' },
  // Otros
  { value: 'otro', label: 'Otro Documento / Respaldo General', hint: 'General', group: 'Otros Archivos', groupIcon: '📁' },
];

export function DocumentosTab({
  repo,
  empresaClave,
  empresas,
  puedeEscribir = true,
}: {
  repo: AdminRepo;
  empresaClave: string | null;
  empresas: Empresa[];
  puedeEscribir?: boolean;
}) {
  const [docs, setDocs] = useState<DocumentoEmpresa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { appUser } = usePermissions();
  const { user } = useSession();
  const currentActor = useMemo(() => {
    if (appUser) {
      const nombreCompleto = (appUser.nombre || '').trim();
      if (nombreCompleto) return nombreCompleto;
      if (appUser.email) return appUser.email;
    }
    return user?.email || 'Administrador';
  }, [appUser, user]);

  // Carpetas configuradas (estándar + personalizadas con notas)
  const [carpetas, setCarpetas] = useState<InfoCarpetaDoc[]>(() => leerCarpetasPersonalizadas(empresaClave));
  const [modalCarpetas, setModalCarpetas] = useState(false);

  // Filtros activos
  const [carpetaActiva, setCarpetaActiva] = useState<string>('todas');
  const [filtroStatus, setFiltroStatus] = useState<string>('todos');
  const [filtroCentro, setFiltroCentro] = useState<string>('todos');
  const [filtroResponsable, setFiltroResponsable] = useState<string>('todos');
  const [buscar, setBuscar] = useState('');

  // Centros de Acopio disponibles para asociación y filtrado
  // Los centros viven en la base (Configuracion los crea). Se filtran únicamente los activos.
  const [centros, setCentros] = useState<CentroAcopio[]>([]);
  useEffect(() => {
    repo.listCentros().then((cs) => setCentros(cs.filter((c) => c.activo !== false))).catch(() => setCentros([]));
  }, [repo]);

  // Quien responde por cada documento (se asigna en la pestana Responsabilidad).
  // Sin esto se asignaba un analista y al abrir el documento no se veia por ningun lado.
  const [responsabilidades, setResponsabilidades] = useState<Responsabilidad[]>([]);
  const [usuariosResp, setUsuariosResp] = useState<Usuario[]>([]);
  useEffect(() => {
    repo.listResponsabilidades(empresaClave || undefined).then(setResponsabilidades).catch(() => setResponsabilidades([]));
    async function cargarUsuarios() {
      try {
        const u = await listUsuarios();
        if (u && u.length > 0) {
          setUsuariosResp(u);
          return;
        }
      } catch { /* fallback abajo */ }
      try {
        const { data } = await supabase.rpc('obtener_directorio_personas');
        if (data && data.length > 0) {
          setUsuariosResp(data as Usuario[]);
        }
      } catch { /* sin conexión */ }
    }
    void cargarUsuarios();
  }, [repo, empresaClave]);
  const nombresResp = useMemo(() => nombrePorEmail(usuariosResp), [usuariosResp]);

  // Honorarios: para enganchar el documento a la gestion que lo tramito.
  const [gestiones, setGestiones] = useState<Gestion[]>([]);
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  useEffect(() => {
    repo.listGestiones(empresaClave || undefined).then(setGestiones).catch(() => setGestiones([]));
    repo.listProfesionales().then(setProfesionales).catch(() => setProfesionales([]));
  }, [repo, empresaClave]);
  const nombreProf = useMemo(() => new Map(profesionales.map((p) => [p.id, p.nombre])), [profesionales]);
  const mapaCentros = useMemo(() => new Map(centros.map((c) => [c.id, c.nombre])), [centros]);
  const opcionesResponsables = useMemo(() => obtenerListaResponsables(centros, docs, [], carpetas, usuariosResp), [centros, docs, carpetas, usuariosResp]);

  // Drag & drop staging
  const [isDragging, setIsDragging] = useState(false);
  const [archivosEnEspera, setArchivosEnEspera] = useState<StagedFile[] | null>(null);
  const [subiendoLote, setSubiendoLote] = useState(false);
  const [progresoLote, setProgresoLote] = useState<{ actual: number; total: number; nombre: string } | null>(null);

  // Modales
  const [docDetalle, setDocDetalle] = useState<DocumentoEmpresa | null>(null);
  const [docRenovar, setDocRenovar] = useState<DocumentoEmpresa | null>(null);
  const [tabDetalleModal, setTabDetalleModal] = useState<'datos' | 'historial'>('datos');
  const [docBorrar, setDocBorrar] = useState<DocumentoEmpresa | null>(null);
  const [verAlertaWsp, setVerAlertaWsp] = useState(false);
  const [modalReporte, setModalReporte] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const nombreEmpMap = useMemo(() => new Map(empresas.map((e) => [e.clave, e.nombre])), [empresas]);

  // Mapa de carpetas para lookup rápido
  const mapaCarpetas = useMemo(() => {
    const map = new Map<string, InfoCarpetaDoc>();
    for (const c of carpetas) {
      map.set(c.id, c);
    }
    return map;
  }, [carpetas]);

  // Opciones para SearchSelect de Carpetas
  const opcionesCarpetas: SearchOption[] = useMemo(() => {
    return carpetas.map((c) => ({
      value: c.id,
      label: `${c.icon} ${c.label}`,
      hint: c.descripcion || undefined,
      keywords: [c.label, c.descripcion || ''],
    }));
  }, [carpetas]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const data = await repo.listDocumentos(empresaClave ?? undefined);
      setDocs(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron leer los documentos.');
    } finally {
      setCargando(false);
    }
  }, [repo, empresaClave]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Recuento de status global para alertas
  const resumenStatus = useMemo(() => {
    let vencidos = 0;
    let enTramite = 0;
    let porVencer = 0;
    let vigentes = 0;
    let noVence = 0;

    for (const d of docs) {
      if (d.statusVencimiento === 'vencido') vencidos += 1;
      else if (d.statusVencimiento === 'vencido_en_tramite') enTramite += 1;
      else if (d.statusVencimiento === 'por_vencer') porVencer += 1;
      else if (d.statusVencimiento === 'vigente') vigentes += 1;
      else noVence += 1;
    }

    return {
      vencidos,
      enTramite,
      porVencer,
      vigentes,
      noVence,
      total: docs.length,
      requierenAtencion: vencidos + enTramite + porVencer,
    };
  }, [docs]);

  // Recuento de archivos y status por carpeta
  const carpetasStats = useMemo(() => {
    const map = new Map<string, { total: number; vencidos: number; enTramite: number; porVencer: number; vigentes: number }>();

    for (const c of carpetas) {
      map.set(c.id, { total: 0, vencidos: 0, enTramite: 0, porVencer: 0, vigentes: 0 });
    }

    for (const d of docs) {
      const cKey = d.carpeta || 'otros';
      const stat = map.get(cKey) || { total: 0, vencidos: 0, enTramite: 0, porVencer: 0, vigentes: 0 };
      stat.total += 1;
      if (d.statusVencimiento === 'vencido') stat.vencidos += 1;
      else if (d.statusVencimiento === 'vencido_en_tramite') stat.enTramite += 1;
      else if (d.statusVencimiento === 'por_vencer') stat.porVencer += 1;
      else if (d.statusVencimiento === 'vigente') stat.vigentes += 1;
      map.set(cKey, stat);
    }

    return map;
  }, [carpetas, docs]);

  // Lista de documentos filtrada
  const docsFiltrados = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return docs.filter((d) => {
      // Filtro por carpeta
      if (carpetaActiva !== 'todas' && d.carpeta !== carpetaActiva) return false;

      // Filtro por Centro de Acopio / Alcance
      if (filtroCentro === 'general') {
        const cIdDoc = d.centroAcopioId || mapaCarpetas.get(d.carpeta)?.centroAcopioId;
        if (cIdDoc) return false;
      } else if (filtroCentro === 'centros') {
        const cIdDoc = d.centroAcopioId || mapaCarpetas.get(d.carpeta)?.centroAcopioId;
        if (!cIdDoc) return false;
      } else if (filtroCentro !== 'todos') {
        const cIdDoc = d.centroAcopioId || mapaCarpetas.get(d.carpeta)?.centroAcopioId;
        if (cIdDoc !== filtroCentro) return false;
      }

      // Filtro por Responsable / Analista
      if (filtroResponsable !== 'todos') {
        const respEf = responsablesEfectivosDocumento(d, responsabilidades, mapaCarpetas.get(d.carpeta)?.responsable);
        const candidatos = [
          ...respEf.emails.map((e) => (nombresResp.get(e) || e).trim().toLowerCase()),
          (d.responsable || '').trim().toLowerCase(),
          (d.socioNombre || '').trim().toLowerCase(),
          (mapaCarpetas.get(d.carpeta)?.responsable || '').trim().toLowerCase(),
        ].filter(Boolean);
        if (!candidatos.includes(filtroResponsable.toLowerCase())) return false;
      }

      // Filtro por status
      if (filtroStatus === 'atencion' && !['vencido', 'vencido_en_tramite', 'por_vencer'].includes(d.statusVencimiento)) return false;
      if (filtroStatus === 'vencido' && d.statusVencimiento !== 'vencido') return false;
      if (filtroStatus === 'vencido_en_tramite' && d.statusVencimiento !== 'vencido_en_tramite') return false;
      if (filtroStatus === 'por_vencer' && d.statusVencimiento !== 'por_vencer') return false;
      if (filtroStatus === 'vigente' && d.statusVencimiento !== 'vigente') return false;

      // Filtro de búsqueda
      if (q) {
        const texto = `${d.nombre} ${d.tipo} ${d.carpeta} ${d.socioNombre ?? ''} ${d.entidadEmisora ?? ''} ${d.numeroRegistro ?? ''} ${d.notaTramite ?? ''}`.toLowerCase();
        if (!texto.includes(q)) return false;
      }

      return true;
    });
  }, [docs, carpetaActiva, filtroStatus, filtroCentro, filtroResponsable, buscar, mapaCarpetas, responsabilidades, nombresResp]);

  // Manejo de Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!puedeEscribir) return;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const procesarArchivosSeleccionados = (fileList: FileList | File[]) => {
    const rawFiles = Array.from(fileList);
    if (!rawFiles.length) return;

    if (rawFiles.length > MAX_ARCHIVOS_POR_INTENTO) {
      toast(
        `Has seleccionado ${rawFiles.length} archivos. Se procesarán los primeros ${MAX_ARCHIVOS_POR_INTENTO} para garantizar la estabilidad del sistema.`,
        'warning',
      );
    }

    const permitidos = rawFiles.slice(0, MAX_ARCHIVOS_POR_INTENTO);
    const validos: StagedFile[] = [];

    for (const f of permitidos) {
      if (f.size > MAX_TAMANO_BYTES) {
        toast(`«${f.name}» supera el límite de 25 MB y fue omitido.`, 'error');
        continue;
      }

      const { carpeta, tipo } = inferirCarpetaYTipo(f.name);
      const carpetaObj = carpetas.find((cp) => cp.id === carpeta);
      validos.push({
        id: `staged-${Math.random().toString(36).slice(2)}`,
        file: f,
        empresaClave: empresaClave || empresas[0]?.clave || 'GT',
        carpeta,
        centroAcopioId: carpetaObj?.centroAcopioId || (filtroCentro !== 'todos' ? filtroCentro : undefined),
        responsable: carpetaObj?.responsable || (filtroResponsable !== 'todos' ? filtroResponsable : ''),
        tipo,
        nombre: limpiarNombreArchivo(f.name),
        fechaEmision: '',
        fechaVencimiento: '',
        statusVencimiento: 'vigente',
        socioNombre: '',
        entidadEmisora: '',
        numeroRegistro: '',
        notaTramite: '',
      });
    }

    if (validos.length > 0) {
      setArchivosEnEspera(validos);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (!puedeEscribir) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      procesarArchivosSeleccionados(e.dataTransfer.files);
    }
  };

  // Subir lote confirmado
  const ejecutarSubidaLote = async () => {
    if (!archivosEnEspera || !archivosEnEspera.length) return;
    setSubiendoLote(true);

    let exitosos = 0;
    const total = archivosEnEspera.length;

    for (let i = 0; i < total; i += 1) {
      const item = archivosEnEspera[i];
      setProgresoLote({ actual: i + 1, total, nombre: item.file.name });

      try {
        await repo.subirDocumento(
          item.empresaClave,
          item.tipo,
          item.file,
          {
            nombre: item.nombre,
            carpeta: item.carpeta,
            centroAcopioId: item.centroAcopioId || mapaCarpetas.get(item.carpeta)?.centroAcopioId || null,
            responsable: item.responsable || mapaCarpetas.get(item.carpeta)?.responsable || null,
            fechaEmision: item.fechaEmision || null,
            fechaVencimiento: item.fechaVencimiento || null,
            statusVencimiento: item.statusVencimiento,
            socioNombre: item.socioNombre || null,
            entidadEmisora: item.entidadEmisora || null,
            numeroRegistro: item.numeroRegistro || null,
            notaTramite: item.notaTramite || null,
          },
          currentActor,
        );
        exitosos += 1;
      } catch (e) {
        toast(`Error al subir «${item.file.name}»: ${e instanceof Error ? e.message : 'falló'}`, 'error');
      }
    }

    setSubiendoLote(false);
    setProgresoLote(null);
    setArchivosEnEspera(null);

    if (exitosos > 0) {
      toast(`Se subieron exitosamente ${exitosos} de ${total} documento(s).`, 'success');
      await cargar();
    }
  };

  // Abrir documento
  const abrirDoc = async (d: DocumentoEmpresa) => {
    try {
      const url = await repo.urlDocumento(d.path);
      if (!url) {
        toast('No se pudo generar enlace de visualización.', 'info');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo abrir el archivo.', 'error');
    }
  };

  // Borrar documento
  const confirmarBorrar = async () => {
    if (!docBorrar) return;
    try {
      await repo.borrarDocumento(docBorrar);
      toast(`Documento «${docBorrar.nombre}» eliminado.`, 'success');
      setDocBorrar(null);
      await cargar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Error al eliminar.', 'error');
    }
  };

  // Texto para WhatsApp de Vencimientos
  const textoAlertaWsp = useMemo(() => {
    const nombreEmp = empresaClave ? (nombreEmpMap.get(empresaClave) || empresaClave) : 'Todas las empresas';
    const lines = [
      `🏛️ *MINERAL GROUP GUAYANA C.A. · CONTROL DE VENCIMIENTOS*`,
      `💼 Empresa: *${nombreEmp}*`,
      `📅 Fecha de corte: *${fFecha.format(new Date())}*`,
      '',
      `*ESTADO DE PERMISOLOGÍA Y DOCUMENTOS:*`,
      `🔴 Vencidos (Urgentes): *${resumenStatus.vencidos}*`,
      `🟣 Vencidos en Trámite: *${resumenStatus.enTramite}*`,
      `🟡 Por Vencer (Próximos 30d): *${resumenStatus.porVencer}*`,
      `🟢 Vigentes al Día: *${resumenStatus.vigentes}*`,
      `📁 Total Documentos: *${resumenStatus.total}*`,
      '',
    ];

    const criticos = docs.filter((d) => d.statusVencimiento === 'vencido' || d.statusVencimiento === 'vencido_en_tramite' || d.statusVencimiento === 'por_vencer');
    if (criticos.length > 0) {
      lines.push(`*DOCUMENTOS QUE REQUIEREN ATENCIÓN:*`);
      criticos.slice(0, 15).forEach((d, idx) => {
        const icono = d.statusVencimiento === 'vencido' ? '🔴' : d.statusVencimiento === 'vencido_en_tramite' ? '🟣' : '🟡';
        const dias = diasRestantes(d.fechaVencimiento);
        const diasTxt = dias != null ? (dias < 0 ? `hace ${Math.abs(dias)}d` : `en ${dias}d`) : '';
        const nota = d.notaTramite ? ` [Trámite: ${d.notaTramite}]` : '';
        lines.push(`${idx + 1}. ${icono} *${d.nombre}* (${TIPO_DOCUMENTO_LABEL[d.tipo] || d.tipo}) - ${STATUS_VENCIMIENTO_LABEL[d.statusVencimiento]} ${diasTxt}${nota}`);
      });
      if (criticos.length > 15) {
        lines.push(`_... y ${criticos.length - 15} documento(s) más._`);
      }
    } else {
      lines.push(`✅ *Todos los documentos y permisos se encuentran vigentes y al día.*`);
    }

    lines.push('');
    lines.push(`_Generado automáticamente desde Sistema Mineral Group Guayana C.A._`);
    return lines.join('\n');
  }, [docs, resumenStatus, empresaClave, nombreEmpMap]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* 1. SECCIÓN: Banner Resumen de Alertas y Vencimientos */}
      <div
        className="card"
        style={{
          margin: 0,
          padding: '.85rem 1rem',
          background: 'linear-gradient(135deg, var(--surface-2, #182230), var(--surface, #0f172a))',
          border: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '.75rem',
        }}
      >
        <div>
          <div style={{ fontSize: '.74rem', textTransform: 'uppercase', letterSpacing: '.06em', color: '#ff8a00', fontWeight: 700 }}>
            Semáforo de Vigencias y Permisología
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text)', marginTop: '.15rem' }}>
            {resumenStatus.requierenAtencion > 0 ? (
              <span>⚠️ Hay <strong style={{ color: '#ef4444' }}>{resumenStatus.vencidos} vencido(s)</strong> y <strong style={{ color: '#f59e0b' }}>{resumenStatus.porVencer} por vencer</strong></span>
            ) : (
              <span style={{ color: '#10b981' }}>✅ Todos los permisos y documentos están al día</span>
            )}
          </div>
          <div className="muted" style={{ fontSize: '.75rem', marginTop: '.2rem' }}>
            {empresaClave ? `Empresa: ${nombreEmpMap.get(empresaClave) || empresaClave}` : 'Consolidado multiempresa'} · {docs.length} documentos registrados
          </div>
        </div>

        <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setModalReporte(true)}
            disabled={docs.length === 0}
            style={{ background: '#ff8a00', color: '#000', fontWeight: 700 }}
            title="Abrir reporte dinámico con fichas ejecutivas, orientación y filtros"
          >
            ✨ Reporte Dinámico / Exportar
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setVerAlertaWsp(true)}
            disabled={docs.length === 0}
            title="Enviar o copiar el informe de vencimientos por WhatsApp"
          >
            💬 Alerta WhatsApp
          </button>
          {puedeEscribir && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setModalCarpetas(true)}
              title="Añadir, modificar nombres, íconos y notas de carpetas"
            >
              ⚙ Carpetas
            </button>
          )}
          {puedeEscribir && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => fileInputRef.current?.click()}
              title="Seleccionar archivos desde su equipo"
            >
              ⬆ Subir Archivos
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="application/pdf,image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) procesarArchivosSeleccionados(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {/* Panel emergente de WhatsApp */}
      {verAlertaWsp && (
        <div className="card" style={{ margin: 0, padding: '.85rem', borderColor: '#25D366' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem', flexWrap: 'wrap', gap: '.4rem' }}>
            <strong>💬 Alerta de Vencimientos para WhatsApp</strong>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setVerAlertaWsp(false)}>✕ Cerrar</button>
          </div>
          <CompartirWhatsapp texto={textoAlertaWsp} />
        </div>
      )}

      {/* 2. SECCIÓN: Carpetas con Badges de Estado */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '.65rem' }}>
        <div
          onClick={() => setCarpetaActiva('todas')}
          className="card"
          style={{
            margin: 0,
            padding: '.65rem .85rem',
            cursor: 'pointer',
            border: carpetaActiva === 'todas' ? '2px solid #ff8a00' : '1px solid var(--border)',
            background: carpetaActiva === 'todas' ? 'rgba(255, 138, 0, 0.08)' : 'var(--surface-1, #0f172a)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '.4rem',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '.86rem', fontWeight: 700, color: 'var(--text)' }}>📂 Todas las Carpetas</span>
            <span className="badge" style={{ fontSize: '.72rem', background: 'rgba(255,255,255,0.08)' }}>{docs.length}</span>
          </div>
          <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
            {resumenStatus.vencidos > 0 && <span className="badge" style={{ ...STATUS_VENCIMIENTO_COLOR.vencido, fontSize: '.68rem' }}>{resumenStatus.vencidos} 🔴</span>}
            {resumenStatus.enTramite > 0 && <span className="badge" style={{ ...STATUS_VENCIMIENTO_COLOR.vencido_en_tramite, fontSize: '.68rem' }}>{resumenStatus.enTramite} 🟣</span>}
            {resumenStatus.porVencer > 0 && <span className="badge" style={{ ...STATUS_VENCIMIENTO_COLOR.por_vencer, fontSize: '.68rem' }}>{resumenStatus.porVencer} 🟡</span>}
            <span className="badge" style={{ ...STATUS_VENCIMIENTO_COLOR.vigente, fontSize: '.68rem' }}>{resumenStatus.vigentes} 🟢</span>
          </div>
        </div>

        {carpetas.map((c) => {
          const stats = carpetasStats.get(c.id) || { total: 0, vencidos: 0, enTramite: 0, porVencer: 0, vigentes: 0 };
          const activa = carpetaActiva === c.id;

          return (
            <div
              key={c.id}
              onClick={() => setCarpetaActiva(c.id)}
              className="card"
              style={{
                margin: 0,
                padding: '.65rem .85rem',
                cursor: 'pointer',
                border: activa ? '2px solid #ff8a00' : '1px solid var(--border)',
                background: activa ? 'rgba(255, 138, 0, 0.08)' : 'var(--surface-1, #0f172a)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '.4rem',
                transition: 'all 0.15s ease',
              }}
              title={c.descripcion || c.label}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.3rem' }}>
                <span style={{ fontSize: '.84rem', fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.icon} {c.label}
                </span>
                <span className="badge" style={{ fontSize: '.72rem', background: 'rgba(255,255,255,0.08)', flexShrink: 0 }}>
                  {stats.total}
                </span>
              </div>
              {c.centroAcopioId && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
                  <span
                    className="badge"
                    style={{
                      fontSize: '.62rem',
                      padding: '.05rem .35rem',
                      background: 'rgba(234, 179, 8, 0.15)',
                      color: '#eab308',
                      fontWeight: 600,
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={`Asociada a: ${mapaCentros.get(c.centroAcopioId) || c.centroAcopioId}`}
                  >
                    🏭 {mapaCentros.get(c.centroAcopioId) || c.centroAcopioId}
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', gap: '.25rem', flexWrap: 'wrap' }}>
                {stats.vencidos > 0 && <span className="badge" style={{ ...STATUS_VENCIMIENTO_COLOR.vencido, fontSize: '.65rem' }}>{stats.vencidos} 🔴</span>}
                {stats.enTramite > 0 && <span className="badge" style={{ ...STATUS_VENCIMIENTO_COLOR.vencido_en_tramite, fontSize: '.65rem' }}>{stats.enTramite} 🟣</span>}
                {stats.porVencer > 0 && <span className="badge" style={{ ...STATUS_VENCIMIENTO_COLOR.por_vencer, fontSize: '.65rem' }}>{stats.porVencer} 🟡</span>}
                {stats.vigentes > 0 && <span className="badge" style={{ ...STATUS_VENCIMIENTO_COLOR.vigente, fontSize: '.65rem' }}>{stats.vigentes} 🟢</span>}
                {stats.total === 0 && <span className="muted" style={{ fontSize: '.7rem' }}>Vacía</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. SECCIÓN: Drag & Drop Zone */}
      {puedeEscribir && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: isDragging ? '2px dashed #ff8a00' : '2px dashed var(--border)',
            background: isDragging ? 'rgba(255, 138, 0, 0.12)' : 'rgba(255, 255, 255, 0.02)',
            borderRadius: '8px',
            padding: '1.25rem 1rem',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ fontSize: '1.8rem', marginBottom: '.25rem' }}>📤</div>
          <div style={{ fontWeight: 700, fontSize: '.9rem', color: 'var(--text)' }}>
            Arrastra y suelta tus archivos aquí (PDF o Imágenes)
          </div>
          <div className="muted" style={{ fontSize: '.75rem', marginTop: '.25rem' }}>
            Hasta {MAX_ARCHIVOS_POR_INTENTO} archivos por intento · Máx 25 MB por archivo · El sistema clasifica automáticamente Rupdae, Mintras, Inces, IVSS, Carta Constitutiva, Cédulas, etc.
          </div>
        </div>
      )}

      {/* 4. SECCIÓN: Barra de Búsqueda y Filtro de Status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ maxWidth: 260, fontSize: '.8rem', padding: '.3rem .6rem' }}
            placeholder="🔍 Buscar por nombre, socio, N° registro…"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
          />
          <select
            className="select select-sm"
            style={{ fontSize: '.8rem', maxWidth: 240, background: 'var(--surface-2)' }}
            value={filtroCentro}
            onChange={(e) => setFiltroCentro(e.target.value)}
            title="Filtrar por alcance institucional o Centro de Acopio"
          >
            <option value="todos">🌐 Ámbito: Todos los documentos</option>
            <option value="general">🏢 Solo Institucionales (Toda la empresa)</option>
            <option value="centros">🏭 Solo de Centros de Acopio (Operativos)</option>
            {centros.length > 0 && (
              <optgroup label="Centros de Acopio específicos">
                {centros.map((c) => (
                  <option key={c.id} value={c.id}>
                    🏭 {c.nombre}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <select
            className="select select-sm"
            style={{ fontSize: '.8rem', maxWidth: 210, background: 'var(--surface-2)' }}
            value={filtroResponsable}
            onChange={(e) => setFiltroResponsable(e.target.value)}
            title="Filtrar por Responsable o Analista a cargo"
          >
            <option value="todos">👤 Todos los Responsables</option>
            {opcionesResponsables.map((r) => (
              <option key={r} value={r}>
                👤 {r}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`btn btn-xs ${filtroStatus === 'todos' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFiltroStatus('todos')}
          >
            Todos ({docs.length})
          </button>
          <button
            type="button"
            className={`btn btn-xs ${filtroStatus === 'atencion' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFiltroStatus('atencion')}
            style={{ color: filtroStatus === 'atencion' ? '#fff' : '#ef4444' }}
          >
            ⚠️ Requieren Atención ({resumenStatus.requierenAtencion})
          </button>
          <button
            type="button"
            className={`btn btn-xs ${filtroStatus === 'vencido' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFiltroStatus('vencido')}
          >
            🔴 Vencidos ({resumenStatus.vencidos})
          </button>
          <button
            type="button"
            className={`btn btn-xs ${filtroStatus === 'vencido_en_tramite' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFiltroStatus('vencido_en_tramite')}
          >
            🟣 En Trámite ({resumenStatus.enTramite})
          </button>
          <button
            type="button"
            className={`btn btn-xs ${filtroStatus === 'por_vencer' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFiltroStatus('por_vencer')}
          >
            🟡 Por Vencer ({resumenStatus.porVencer})
          </button>
          <button
            type="button"
            className={`btn btn-xs ${filtroStatus === 'vigente' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFiltroStatus('vigente')}
          >
            🟢 Vigentes ({resumenStatus.vigentes})
          </button>
        </div>

        <span className="muted mono" style={{ fontSize: '.76rem' }}>
          Mostrando {docsFiltrados.length} de {docs.length}
        </span>
      </div>

      {/* 5. SECCIÓN: Listado de Documentos */}
      {error && (
        <div className="adm-aviso">
          No se pudieron leer los documentos: {error}
        </div>
      )}

      {cargando ? (
        <div className="card"><p className="muted">Cargando permisología y documentos…</p></div>
      ) : docs.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="📁"
            message="No hay documentos cargados en esta empresa. Arrastra archivos arriba para registrar RUPDAE, MINTRAS, INCES, Carta Constitutiva, etc."
          />
        </div>
      ) : docsFiltrados.length === 0 ? (
        <div className="card"><p className="muted">Ningún documento coincide con el filtro o la carpeta seleccionada.</p></div>
      ) : (
        <div className="adm-tabla">
          <table>
            <thead>
              <tr>
                <th>Documento / Archivo</th>
                <th>Carpeta</th>
                <th>Vigencia / Vencimiento (Hover para Cuenta Regresiva)</th>
                <th>Socio / Organismo</th>
                <th>Tamaño</th>
                <th style={{ textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {docsFiltrados.map((d) => {
                const hoverInfo = obtenerDetalleHoverVigencia(d.fechaVencimiento, d.statusVencimiento, d.notaTramite);
                const carpetaInfo = mapaCarpetas.get(d.carpeta);
                const nombreCarpeta = carpetaInfo ? `${carpetaInfo.icon} ${carpetaInfo.label}` : (ETIQUETA_CARPETA[d.carpeta] || d.carpeta);

                return (
                  <tr key={d.id}>
                    <td>
                      <div>
                        <strong style={{ color: 'var(--text)', fontSize: '.88rem' }}>{d.nombre}</strong>
                        {(() => {
                          const archivoNombre = d.path.split('/').pop() || d.path;
                          return (
                            <div style={{ fontSize: '.72rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '.3rem', marginTop: '.1rem' }}>
                              <span title={`Archivo físico adjunto: ${archivoNombre}`}>📎 {archivoNombre}</span>
                            </div>
                          );
                        })()}
                        <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', marginTop: '.2rem', flexWrap: 'wrap' }}>
                          <span className="adm-chip" style={{ fontSize: '.7rem' }}>
                            {TIPO_DOCUMENTO_LABEL[d.tipo] || d.tipo}
                          </span>
                          {!empresaClave && (
                            <span className="badge" style={{ fontSize: '.68rem', background: 'rgba(255,255,255,0.06)' }}>
                              🏢 {d.empresaClave}
                            </span>
                          )}
                          {(d.centroAcopioId || carpetaInfo?.centroAcopioId) && (
                            <span
                              className="badge"
                              style={{
                                fontSize: '.66rem',
                                background: 'rgba(234, 179, 8, 0.12)',
                                color: '#eab308',
                                borderColor: '#eab308',
                                padding: '.05rem .3rem',
                              }}
                              title="Centro de Acopio Asignado"
                            >
                              🏭 {mapaCentros.get(d.centroAcopioId || carpetaInfo?.centroAcopioId || '') || d.centroAcopioId || carpetaInfo?.centroAcopioId}
                            </span>
                          )}
                          {(() => {
                            const respEf = responsablesEfectivosDocumento(d, responsabilidades, carpetaInfo?.responsable);
                            const respTexto = respEf.emails.length > 0
                              ? respEf.emails.map((e) => nombresResp.get(e) || e).join(', ')
                              : (d.responsable || carpetaInfo?.responsable || null);
                            if (!respTexto) return null;
                            return (
                              <span
                                className="badge"
                                style={{
                                  fontSize: '.66rem',
                                  background: 'rgba(168, 85, 247, 0.12)',
                                  color: '#c084fc',
                                  borderColor: '#c084fc',
                                  padding: '.05rem .3rem',
                                }}
                                title={respEf.emails.length > 0 && respEf.heredado ? 'Responsable heredado de la carpeta' : 'Responsable asignado'}
                              >
                                👤 {respTexto}
                              </span>
                            );
                          })()}
                          {d.numeroRegistro && (
                            <span className="muted mono" style={{ fontSize: '.7rem' }}>
                              Reg: {d.numeroRegistro}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td>
                      <span className="muted" style={{ fontSize: '.78rem' }} title={carpetaInfo?.descripcion}>
                        {nombreCarpeta}
                      </span>
                    </td>

                    {/* VIGENCIA CON HOVER Y CUENTA REGRESIVA PRECISA */}
                    <td title={`${hoverInfo.titulo}\n${hoverInfo.tiempoRestanteTexto}${d.notaTramite ? `\nTrámite: ${d.notaTramite}` : ''}`}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap' }}>
                          <span
                            className="badge"
                            style={{
                              background: hoverInfo.bg,
                              color: hoverInfo.color,
                              borderColor: hoverInfo.border,
                              fontSize: '.72rem',
                              fontWeight: 700,
                            }}
                          >
                            {hoverInfo.badge}
                          </span>
                          {hoverInfo.dias !== null && (
                            <span
                              className="badge"
                              style={{
                                fontSize: '.68rem',
                                background: 'rgba(255,255,255,0.06)',
                                borderColor: hoverInfo.border,
                                color: hoverInfo.color,
                                fontWeight: 600,
                              }}
                              title={hoverInfo.tiempoRestanteTexto}
                            >
                              ⏳ {hoverInfo.tiempoRestanteTexto}
                            </span>
                          )}
                        </div>

                        <div className="muted mono" style={{ fontSize: '.72rem' }}>
                          {d.fechaVencimiento ? (
                            <span>
                              Vence: {fFecha.format(new Date(`${d.fechaVencimiento}T00:00:00`))}
                            </span>
                          ) : (
                            'Permanente (No vence)'
                          )}
                        </div>

                        {d.notaTramite && (
                          <div style={{ fontSize: '.7rem', color: '#a855f7' }}>
                            📋 {d.notaTramite}
                          </div>
                        )}
                      </div>
                    </td>

                    <td>
                      <div style={{ fontSize: '.78rem' }}>
                        {d.socioNombre && <div>👤 <strong>{d.socioNombre}</strong></div>}
                        {d.entidadEmisora && <div className="muted">🏛️ {d.entidadEmisora}</div>}
                        {!d.socioNombre && !d.entidadEmisora && <span className="muted">—</span>}
                      </div>
                    </td>

                    <td className="mono" style={{ whiteSpace: 'nowrap', fontSize: '.76rem' }}>
                      {tamanoFmt(d.tamano)}
                    </td>

                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button type="button" className="btn btn-xs btn-ghost" onClick={() => void abrirDoc(d)} title="Previsualizar archivo">
                        👁️ Ver
                      </button>
                      {puedeEscribir && (
                        <button
                          type="button"
                          className="btn btn-xs"
                          style={{
                            background: '#ff8a00',
                            color: '#000',
                            fontWeight: 700,
                            border: 'none',
                            padding: '.2rem .55rem',
                          }}
                          onClick={() => setDocRenovar(d)}
                          title="Renovar este documento con nuevo archivo y vigencia"
                        >
                          🔄 Renovar
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost"
                        onClick={() => {
                          setDocDetalle(d);
                          setTabDetalleModal('datos');
                        }}
                        title="Ver detalle, editar metadatos y consultar historial"
                      >
                        ✏️ Detalle
                      </button>
                      {puedeEscribir && (
                        <button type="button" className="btn btn-xs btn-ghost" style={{ color: '#ef4444' }} onClick={() => setDocBorrar(d)} title="Eliminar documento">
                          🗑️
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 6. MODAL: Staging de subida por Drag & Drop (Lote) */}
      {archivosEnEspera && (
        <Modal
          title={`⬆ Subir Lote de Documentos (${archivosEnEspera.length} archivos)`}
          size="xl"
          onClose={() => { if (!subiendoLote) setArchivosEnEspera(null); }}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '.5rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: '.78rem' }}>
                  {subiendoLote ? (progresoLote ? `Subiendo ${progresoLote.actual} de ${progresoLote.total}: «${progresoLote.nombre}»` : 'Subiendo…') : `${archivosEnEspera.length} archivo(s) listos para cargar`}
                </span>
                {(() => {
                  const cantDuplicados = archivosEnEspera.filter((it) =>
                    docs.some(
                      (d) =>
                        d.nombre.trim().toLowerCase() === it.nombre.trim().toLowerCase() ||
                        d.nombre.trim().toLowerCase() === it.file.name.trim().toLowerCase() ||
                        (d.path && d.path.toLowerCase().endsWith('/' + it.file.name.toLowerCase())),
                    ),
                  ).length;
                  if (cantDuplicados === 0) return null;
                  return (
                    <span style={{ fontSize: '.74rem', color: '#f59e0b', fontWeight: 600 }}>
                      ⚠️ {cantDuplicados} archivo(s) ya existen en el sistema.
                    </span>
                  );
                })()}
              </div>
              <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setArchivosEnEspera(null)} disabled={subiendoLote}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void ejecutarSubidaLote()}
                  disabled={subiendoLote}
                  title="Sube todos los documentos directamente para asignarles el resto de detalles después"
                >
                  ⚡ Cargar ahora y asignar después
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void ejecutarSubidaLote()} disabled={subiendoLote}>
                  {subiendoLote ? 'Subiendo Lote…' : `Confirmar y Subir (${archivosEnEspera.length})`}
                </button>
              </div>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>
            <p className="muted hint" style={{ margin: 0, fontSize: '.78rem', background: 'rgba(56, 189, 248, 0.08)', padding: '.45rem .65rem', borderRadius: 6, border: '1px solid rgba(56, 189, 248, 0.2)' }}>
              💡 <strong>Carga rápida:</strong> Puedes subir todos los archivos de inmediato. La clasificación (carpeta, vencimiento, responsable, etc.) puede asignarse o ajustarse en cualquier momento desde la tabla o el botón «Detalle».
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', maxHeight: '460px', overflowY: 'auto', paddingRight: '.25rem' }}>
              {archivosEnEspera.map((item, idx) => {
                const duplicadoEnBD = docs.some(
                  (d) =>
                    d.nombre.trim().toLowerCase() === item.nombre.trim().toLowerCase() ||
                    d.nombre.trim().toLowerCase() === item.file.name.trim().toLowerCase() ||
                    (d.path && d.path.toLowerCase().endsWith('/' + item.file.name.toLowerCase())),
                );
                const duplicadoEnLote = archivosEnEspera.some(
                  (other) =>
                    other.id !== item.id &&
                    (other.file.name.toLowerCase() === item.file.name.toLowerCase() ||
                      other.nombre.trim().toLowerCase() === item.nombre.trim().toLowerCase()),
                );
                const esDuplicado = duplicadoEnBD || duplicadoEnLote;

                return (
                <div
                  key={item.id}
                  style={{
                    border: esDuplicado ? '1px solid rgba(239, 68, 68, 0.6)' : '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '.75rem .85rem',
                    background: esDuplicado ? 'rgba(239, 68, 68, 0.04)' : 'var(--surface-1)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem', flexWrap: 'wrap', gap: '.4rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '.86rem', color: 'var(--text)' }}>
                        {idx + 1}. {item.file.name}
                      </span>
                      <span className="muted mono" style={{ fontSize: '.74rem' }}>({tamanoFmt(item.file.size)})</span>
                      {duplicadoEnBD && (
                        <span
                          className="badge"
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)',
                            color: '#ef4444',
                            border: '1px solid rgba(239, 68, 68, 0.4)',
                            fontSize: '.68rem',
                            fontWeight: 700,
                          }}
                          title="Ya existe un documento en el sistema con este nombre o archivo"
                        >
                          ⚠️ Ya registrado en sistema
                        </span>
                      )}
                      {duplicadoEnLote && !duplicadoEnBD && (
                        <span
                          className="badge"
                          style={{
                            background: 'rgba(245, 158, 11, 0.15)',
                            color: '#f59e0b',
                            border: '1px solid rgba(245, 158, 11, 0.4)',
                            fontSize: '.68rem',
                            fontWeight: 700,
                          }}
                          title="Hay otro archivo con el mismo nombre en este lote"
                        >
                          ⚠️ Duplicado en este lote
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      style={{ color: '#ef4444' }}
                      onClick={() => setArchivosEnEspera(archivosEnEspera.filter((x) => x.id !== item.id))}
                      disabled={subiendoLote}
                    >
                      ✕ Quitar
                    </button>
                  </div>

                  {/* Nombre editable del Documento */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', marginBottom: '.65rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ fontSize: '.74rem', fontWeight: 700, color: 'var(--text)' }}>
                        Nombre del Documento (Título visible en el sistema) <span style={{ color: '#ff8a00' }}>*</span>
                      </label>
                      {esDuplicado && (
                        <span style={{ fontSize: '.7rem', color: '#ef4444', fontWeight: 600 }}>
                          {duplicadoEnBD ? '⚠️ Ya existe un documento con este nombre/archivo' : '⚠️ Nombre repetido en este lote'}
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      className="input input-sm"
                      style={{
                        fontSize: '.82rem',
                        fontWeight: 600,
                        borderColor: esDuplicado ? '#ef4444' : undefined,
                      }}
                      placeholder="Escriba un nombre descriptivo para este documento…"
                      value={item.nombre}
                      onChange={(e) => {
                        const val = e.target.value;
                        setArchivosEnEspera(archivosEnEspera.map((x) => (x.id === item.id ? { ...x, nombre: val } : x)));
                      }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.6rem', alignItems: 'flex-start' }}>
                    {/* Carpeta con Barra de Búsqueda */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                      <span className="muted hint" style={{ fontSize: '.7rem' }}>Carpeta</span>
                      <SearchSelect
                        options={opcionesCarpetas}
                        value={item.carpeta}
                        onChange={(val) => {
                          const cp = mapaCarpetas.get(val);
                          setArchivosEnEspera(
                            archivosEnEspera.map((x) =>
                              x.id === item.id
                                ? {
                                    ...x,
                                    carpeta: val,
                                    centroAcopioId: cp?.centroAcopioId ?? x.centroAcopioId,
                                    responsable: cp?.responsable ?? x.responsable,
                                  }
                                : x,
                            ),
                          );
                        }}
                        placeholder="Buscar carpeta…"
                      />
                    </div>

                    {/* Tipo Documento con Barra de Búsqueda */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                      <span className="muted hint" style={{ fontSize: '.7rem' }}>Tipo Documento</span>
                      <SearchSelect
                        options={OPCIONES_TIPO_DOC}
                        value={item.tipo}
                        onChange={(val) => {
                          setArchivosEnEspera(archivosEnEspera.map((x) => x.id === item.id ? { ...x, tipo: val as TipoDocumento } : x));
                        }}
                        placeholder="Buscar tipo de documento…"
                      />
                    </div>

                    {/* Centro de Acopio */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                      <span className="muted hint" style={{ fontSize: '.7rem' }}>Centro de Acopio</span>
                      <select
                        className="select select-sm"
                        style={{ fontSize: '.78rem' }}
                        value={item.centroAcopioId || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setArchivosEnEspera(archivosEnEspera.map((x) => x.id === item.id ? { ...x, centroAcopioId: val || undefined } : x));
                        }}
                      >
                        <option value="">🏢 General / Toda la empresa</option>
                        {centros.map((c) => (
                          <option key={c.id} value={c.id}>
                            🏭 {c.nombre}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Analista / Responsable */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                      <span className="muted hint" style={{ fontSize: '.7rem' }}>Analista / Responsable</span>
                      <SearchCreateSelect
                        options={opcionesResponsables}
                        value={item.responsable || ''}
                        onChange={(val) => {
                          setArchivosEnEspera(archivosEnEspera.map((x) => x.id === item.id ? { ...x, responsable: val } : x));
                        }}
                        placeholder="Elija o escriba responsable…"
                      />
                    </div>

                    {/* Nombre del Socio si aplica */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                      <span className="muted hint" style={{ fontSize: '.7rem' }}>Socio / Titular (Opcional)</span>
                      <input
                        type="text"
                        className="input"
                        style={{ fontSize: '.78rem', padding: '.3rem .5rem' }}
                        placeholder="Ej: Pedro Pérez"
                        value={item.socioNombre}
                        onChange={(e) => {
                          const val = e.target.value;
                          setArchivosEnEspera(archivosEnEspera.map((x) => x.id === item.id ? { ...x, socioNombre: val } : x));
                        }}
                      />
                    </div>
                  </div>

                  {/* Campo Dual de Vigencia y Presets */}
                  <div style={{ marginTop: '.65rem', paddingTop: '.6rem', borderTop: '1px dashed var(--border)' }}>
                    <CampoVigenciaVencimiento
                      fechaEmision={item.fechaEmision || null}
                      fechaVencimiento={item.fechaVencimiento || null}
                      statusVencimiento={item.statusVencimiento}
                      notaTramite={item.notaTramite || null}
                      disabled={subiendoLote}
                      compacto
                      onChange={(v) => {
                        setArchivosEnEspera(
                          archivosEnEspera.map((x) =>
                            x.id === item.id
                              ? {
                                  ...x,
                                  fechaVencimiento: v.fechaVencimiento || '',
                                  statusVencimiento: v.statusVencimiento,
                                  notaTramite: v.notaTramite ?? x.notaTramite,
                                }
                              : x,
                          ),
                        );
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>
      )}

      {/* 7. MODAL: Detalle, Edición e Historial Ligero de Auditoría */}
      {docDetalle && (
        <Modal
          title={`📄 ${docDetalle.nombre}`}
          size="xl"
          onClose={() => setDocDetalle(null)}
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <button type="button" className="btn btn-ghost" onClick={() => void abrirDoc(docDetalle)}>
                👁️ Abrir Archivo
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setDocDetalle(null)}>
                Listo
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Navegación por pestañas dentro del modal de detalle */}
            <div style={{ display: 'flex', gap: '.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn btn-sm ${tabDetalleModal === 'datos' ? 'btn-primary' : 'btn-ghost'}`}
                style={tabDetalleModal === 'datos' ? { background: '#ff8a00', color: '#000', fontWeight: 700 } : undefined}
                onClick={() => setTabDetalleModal('datos')}
              >
                📋 Datos y Metadatos
              </button>
              <button
                type="button"
                className={`btn btn-sm ${tabDetalleModal === 'historial' ? 'btn-primary' : 'btn-ghost'}`}
                style={tabDetalleModal === 'historial' ? { background: '#ff8a00', color: '#000', fontWeight: 700 } : undefined}
                onClick={() => setTabDetalleModal('historial')}
              >
                📜 Historial de Cambios y Auditoría ({docDetalle.historial?.length || 0})
              </button>
              {puedeEscribir && (
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ marginLeft: 'auto', background: '#ff8a00', color: '#000', fontWeight: 700, border: 'none' }}
                  onClick={() => {
                    setDocRenovar(docDetalle);
                    setDocDetalle(null);
                  }}
                >
                  🔄 Renovar Documento
                </button>
              )}
            </div>

            {/* VISTA 1: Historial Destacado y Cronológico */}
            {tabDetalleModal === 'historial' && (
              <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', background: 'var(--surface-1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.6rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '.92rem', color: 'var(--text)' }}>
                    📜 Bitácora de Trazabilidad e Historial del Documento
                  </div>
                  <span className="badge" style={{ fontSize: '.72rem' }}>
                    {docDetalle.historial?.length || 0} evento(s)
                  </span>
                </div>
                <p className="muted hint" style={{ fontSize: '.78rem', margin: '0 0 .85rem' }}>
                  Registro cronológico detallado: quién modificó o renovó el documento, cuándo y qué acción realizó.
                </p>

                {docDetalle.historial && docDetalle.historial.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', maxHeight: '340px', overflowY: 'auto' }}>
                    {[...docDetalle.historial].reverse().map((h) => {
                      const esRenovacion = h.accion === 'renovacion';
                      const esCreacion = h.accion === 'creacion';
                      return (
                        <div
                          key={h.id}
                          style={{
                            padding: '.6rem .8rem',
                            borderRadius: '6px',
                            background: esRenovacion ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                            border: `1px solid ${esRenovacion ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.06)'}`,
                            fontSize: '.8rem',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                              <strong style={{ color: '#ff8a00' }}>👤 {h.actor || 'Usuario'}</strong>
                              <span
                                className="adm-chip"
                                style={{
                                  fontSize: '.66rem',
                                  color: esRenovacion ? '#10b981' : esCreacion ? '#38bdf8' : '#f59e0b',
                                  borderColor: esRenovacion ? '#10b981' : esCreacion ? '#38bdf8' : '#f59e0b',
                                }}
                              >
                                {esRenovacion ? '🔄 Renovación' : esCreacion ? '➕ Creación' : h.accion}
                              </span>
                            </div>
                            <span className="muted mono" style={{ fontSize: '.72rem' }}>
                              {fFechaHora.format(new Date(h.fecha))}
                            </span>
                          </div>
                          <div style={{ color: 'var(--text)', marginTop: '.3rem', lineHeight: 1.4 }}>
                            {h.detalle}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: '.8rem', padding: '1rem', textAlign: 'center' }}>
                    Sin cambios registrados en el historial de este archivo.
                  </div>
                )}
              </div>
            )}

            {/* VISTA 2: Datos y Metadatos */}
            {tabDetalleModal === 'datos' && (
              <>
            {/* Banner de Estado de Vigencia y Cuenta Regresiva al Item */}
            {(() => {
              const hover = obtenerDetalleHoverVigencia(docDetalle.fechaVencimiento, docDetalle.statusVencimiento, docDetalle.notaTramite);
              return (
                <div
                  style={{
                    padding: '.8rem 1rem',
                    borderRadius: 8,
                    background: hover.bg,
                    border: `1.5px solid ${hover.border}`,
                    color: hover.color,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '.3rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.4rem' }}>
                    <strong style={{ fontSize: '.92rem' }}>
                      {docDetalle.statusVencimiento === 'vencido' ? '🔴 ALERTA DE CADUCIDAD' : docDetalle.statusVencimiento === 'vencido_en_tramite' ? '🟣 RENOVACIÓN EN CURSO' : docDetalle.statusVencimiento === 'por_vencer' ? '🟡 PRÓXIMO A VENCER' : '🟢 DOCUMENTO VIGENTE'}
                    </strong>
                    <span className="badge" style={{ fontSize: '.76rem', background: 'rgba(0,0,0,0.25)', color: hover.color, borderColor: hover.border }}>
                      {hover.badge}
                    </span>
                  </div>
                  <div style={{ fontSize: '.84rem', fontWeight: 600 }}>
                    {hover.titulo}
                  </div>
                  <div style={{ fontSize: '.76rem', opacity: 0.9 }}>
                    ⏱️ <strong>Cuenta Regresiva:</strong> {hover.tiempoRestanteTexto}
                  </div>
                </div>
              );
            })()}

            {/* Clasificación y Organización con SearchSelects */}
            <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '.85rem', background: 'var(--surface-1)' }}>
              <div style={{ fontWeight: 700, fontSize: '.86rem', marginBottom: '.6rem', color: 'var(--text)' }}>
                🗂 Organización y Clasificación
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '.75rem' }}>
                <div>
                  <span className="muted hint" style={{ fontSize: '.72rem', display: 'block', marginBottom: '.25rem' }}>Carpeta</span>
                  <SearchSelect
                    options={opcionesCarpetas}
                    value={docDetalle.carpeta}
                    disabled={!puedeEscribir}
                    onChange={async (val) => {
                      try {
                        const act = await repo.editarDocumento(
                          docDetalle.id,
                          { carpeta: val },
                          undefined,
                          `Carpeta cambiada a: ${mapaCarpetas.get(val)?.label || val}`,
                        );
                        setDocDetalle(act);
                        toast('Carpeta actualizada.', 'success');
                        await cargar();
                      } catch (err) {
                        toast(err instanceof Error ? err.message : 'Error al actualizar', 'error');
                      }
                    }}
                    placeholder="Buscar carpeta…"
                  />
                </div>

                <div>
                  <span className="muted hint" style={{ fontSize: '.72rem', display: 'block', marginBottom: '.25rem' }}>Tipo Documento</span>
                  <SearchSelect
                    options={OPCIONES_TIPO_DOC}
                    value={docDetalle.tipo}
                    disabled={!puedeEscribir}
                    onChange={async (val) => {
                      try {
                        const act = await repo.editarDocumento(
                          docDetalle.id,
                          { tipo: val as TipoDocumento },
                          undefined,
                          `Tipo cambiado a: ${TIPO_DOCUMENTO_LABEL[val as TipoDocumento] || val}`,
                        );
                        setDocDetalle(act);
                        toast('Tipo actualizado.', 'success');
                        await cargar();
                      } catch (err) {
                        toast(err instanceof Error ? err.message : 'Error al actualizar', 'error');
                      }
                    }}
                    placeholder="Buscar tipo de documento…"
                  />
                </div>

                <div>
                  <span className="muted hint" style={{ fontSize: '.72rem', display: 'block', marginBottom: '.25rem' }}>
                    🏭 Centro de Acopio Asociado
                  </span>
                  <select
                    className="select select-sm"
                    style={{ width: '100%', fontSize: '.8rem' }}
                    value={docDetalle.centroAcopioId || ''}
                    disabled={!puedeEscribir}
                    onChange={async (e) => {
                      const val = e.target.value.trim() || null;
                      try {
                        const act = await repo.editarDocumento(
                          docDetalle.id,
                          { centroAcopioId: val },
                          undefined,
                          val ? `Centro de acopio asignado: ${mapaCentros.get(val) || val}` : 'Desvinculado de centro de acopio específico',
                        );
                        setDocDetalle(act);
                        toast('Centro de acopio actualizado.', 'success');
                        await cargar();
                      } catch (err) {
                        toast(err instanceof Error ? err.message : 'Error al actualizar', 'error');
                      }
                    }}
                  >
                    <option value="">🏢 General / Toda la empresa</option>
                    {centros.map((c) => (
                      <option key={c.id} value={c.id}>
                        🏭 {c.nombre} ({c.empresaClave})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <span className="muted hint" style={{ fontSize: '.72rem', display: 'block', marginBottom: '.25rem' }}>
                    👤 Analista / Responsable Asignado
                  </span>
                  <SearchCreateSelect
                    options={opcionesResponsables}
                    value={docDetalle.responsable || ''}
                    disabled={!puedeEscribir}
                    placeholder="Elija o escriba responsable…"
                    onChange={async (val) => {
                      const respVal = val.trim() || null;
                      try {
                        const act = await repo.editarDocumento(
                          docDetalle.id,
                          { responsable: respVal },
                          undefined,
                          respVal ? `Responsable asignado: ${respVal}` : 'Sin responsable explícito',
                        );
                        setDocDetalle(act);
                        toast('Responsable asignado.', 'success');
                        await cargar();
                      } catch (err) {
                        toast(err instanceof Error ? err.message : 'Error al actualizar', 'error');
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Formulario Interactivo de Vigencia y Presets */}
            <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '.85rem', background: 'var(--surface-1)' }}>
              <div style={{ fontWeight: 700, fontSize: '.86rem', marginBottom: '.6rem', color: 'var(--text)' }}>
                ⏳ Vigencia, Vencimiento y Tiempos Sugeridos
              </div>

              <CampoVigenciaVencimiento
                fechaEmision={docDetalle.fechaEmision}
                fechaVencimiento={docDetalle.fechaVencimiento}
                statusVencimiento={docDetalle.statusVencimiento}
                notaTramite={docDetalle.notaTramite}
                disabled={!puedeEscribir}
                onChange={async (vals) => {
                  try {
                    const act = await repo.editarDocumento(
                      docDetalle.id,
                      {
                        fechaVencimiento: vals.fechaVencimiento,
                        statusVencimiento: vals.statusVencimiento,
                        notaTramite: vals.notaTramite !== undefined ? vals.notaTramite : docDetalle.notaTramite,
                      },
                      undefined,
                      `Vigencia ajustada: ${STATUS_VENCIMIENTO_LABEL[vals.statusVencimiento]} (Vence: ${vals.fechaVencimiento || 'Sin vencimiento'})`,
                    );
                    setDocDetalle(act);
                    toast('Vigencia actualizada.', 'success');
                    await cargar();
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Error al actualizar', 'error');
                  }
                }}
              />
            </div>

            {/* Quien responde por este documento (viene de la pestana Responsabilidad o asignado directo) */}
            {(() => {
              const r = responsablesEfectivosDocumento(docDetalle, responsabilidades, mapaCarpetas.get(docDetalle.carpeta)?.responsable);
              const direct = docDetalle.responsable?.trim();
              return (
                <div style={{ margin: '.5rem 0', padding: '.5rem .7rem', borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <span className="muted hint" style={{ fontSize: '.72rem' }}>Quién responde por este documento</span>
                  <div style={{ fontSize: '.86rem', marginTop: '.15rem' }}>
                    {r.emails.length === 0 && !direct ? (
                      <span className="muted">Sin asignar. Se asigna en la pestaña Responsabilidad o en el selector superior.</span>
                    ) : (
                      <>
                        <strong>
                          {r.emails.length > 0
                            ? r.emails.map((e) => nombresResp.get(e) || e).join(', ')
                            : direct}
                        </strong>
                        <span className="muted" style={{ fontSize: '.74rem', marginLeft: '.4rem' }}>
                          {r.emails.length > 0
                            ? (r.heredado ? '(heredado de la carpeta)' : '(asignado a este documento)')
                            : '(asignado directo)'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Gestión, aviso y prioridad (Fase 3) */}
            <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '.85rem', background: 'var(--surface-1)' }}>
              <div style={{ fontWeight: 700, fontSize: '.86rem', marginBottom: '.6rem', color: 'var(--text)' }}>
                💼 Gestión, aviso y prioridad
              </div>
              {/* Que honorario tramito este documento. La gestion es la UNICA autoridad
                  sobre el monto: lo que se anote aqui si llega al estado de cuenta. */}
              {(() => {
                const enlace = gestionDelDocumento(docDetalle, gestiones, docs, profesionales);
                return (
                  <div style={{ marginBottom: '.7rem' }}>
                    <span className="muted hint" style={{ fontSize: '.72rem' }}>¿Qué honorario tramitó este documento?</span>
                    <select
                      className="input" disabled={!puedeEscribir} style={{ width: '100%', marginTop: '.2rem' }}
                      value={docDetalle.gestionId ?? ''}
                      onChange={async (e) => {
                        const val = e.target.value || null;
                        try {
                          const act = await repo.editarDocumento(docDetalle.id, { gestionId: val });
                          setDocDetalle(act);
                          toast(val ? 'Documento enlazado al honorario.' : 'Enlace quitado.', 'success');
                          await cargar();
                        } catch (err) { toast(err instanceof Error ? err.message : 'Error', 'error'); }
                      }}
                    >
                      <option value="">Sin enlazar a ningún honorario</option>
                      {gestiones.filter((g) => g.estado !== 'anulada').map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.concepto} · {nombreProf.get(g.profesionalId ?? '') ?? 'sin profesional'} · {g.costoTotal} {g.moneda}
                        </option>
                      ))}
                    </select>

                    {enlace ? (
                      <div style={{ marginTop: '.35rem', padding: '.45rem .6rem', borderRadius: 6, background: 'rgba(16,185,129,.1)', border: '1px solid #10b981', fontSize: '.8rem', lineHeight: 1.45 }}>
                        Lo tramitó <strong>{enlace.profesionalNombre}</strong> por{' '}
                        <strong>{enlace.gestion.costoTotal} {enlace.gestion.moneda}</strong>, y eso ya está en su estado de cuenta.
                        {enlace.documentosQueCubre > 1 && (
                          <>
                            {' '}Ese mismo honorario cubre <strong>{enlace.documentosQueCubre} documentos</strong>:
                            el costo es uno solo, no se cobra por cada uno.
                          </>
                        )}
                      </div>
                    ) : gestiones.length === 0 ? (
                      <span className="muted hint" style={{ fontSize: '.7rem' }}>
                        Todavía no hay honorarios cargados. Se crean en la pestaña Honorarios, eligiendo el profesional.
                      </span>
                    ) : (
                      <span className="muted hint" style={{ fontSize: '.7rem' }}>
                        Sin enlazar, lo que escribas abajo como costo es solo una nota: no llega al estado de cuenta del profesional.
                      </span>
                    )}
                  </div>
                );
              })()}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '.6rem' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                  <span className="muted hint" style={{ fontSize: '.72rem' }}>Costo de gestión</span>
                  <div style={{ display: 'flex', gap: '.3rem' }}>
                    <input
                      className="input" type="number" min="0" step="0.01" disabled={!puedeEscribir}
                      defaultValue={docDetalle.costoGestion ?? ''} placeholder="0.00" style={{ flex: 1 }}
                      onBlur={async (e) => {
                        const val = e.target.value.trim() === '' ? null : Math.round((Number(e.target.value) || 0) * 100) / 100;
                        if (val === (docDetalle.costoGestion ?? null)) return;
                        try { const act = await repo.editarDocumento(docDetalle.id, { costoGestion: val }); setDocDetalle(act); toast('Costo actualizado.', 'success'); await cargar(); }
                        catch (err) { toast(err instanceof Error ? err.message : 'Error', 'error'); }
                      }}
                    />
                    <select
                      className="input" disabled={!puedeEscribir} style={{ width: 70 }}
                      defaultValue={docDetalle.monedaCosto ?? 'USD'}
                      onChange={async (e) => {
                        try { const act = await repo.editarDocumento(docDetalle.id, { monedaCosto: e.target.value === 'Bs' ? 'Bs' : 'USD' }); setDocDetalle(act); await cargar(); }
                        catch (err) { toast(err instanceof Error ? err.message : 'Error', 'error'); }
                      }}
                    >
                      <option value="USD">USD</option>
                      <option value="Bs">Bs</option>
                    </select>
                  </div>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                  <span className="muted hint" style={{ fontSize: '.72rem' }}>Avisar (días antes)</span>
                  <input
                    className="input" type="number" min="0" step="1" disabled={!puedeEscribir}
                    defaultValue={docDetalle.avisoDias ?? ''} placeholder="30"
                    onBlur={async (e) => {
                      const val = e.target.value.trim() === '' ? null : Math.max(0, Math.round(Number(e.target.value) || 0));
                      if (val === (docDetalle.avisoDias ?? null)) return;
                      try { const act = await repo.editarDocumento(docDetalle.id, { avisoDias: val }); setDocDetalle(act); toast('Aviso actualizado.', 'success'); await cargar(); }
                      catch (err) { toast(err instanceof Error ? err.message : 'Error', 'error'); }
                    }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                  <span className="muted hint" style={{ fontSize: '.72rem' }}>Prioridad</span>
                  <select
                    className="input" disabled={!puedeEscribir} defaultValue={docDetalle.prioridad ?? ''}
                    onChange={async (e) => {
                      const val = e.target.value === '' ? null : (e.target.value as 'alta' | 'media' | 'baja');
                      try { const act = await repo.editarDocumento(docDetalle.id, { prioridad: val }); setDocDetalle(act); await cargar(); }
                      catch (err) { toast(err instanceof Error ? err.message : 'Error', 'error'); }
                    }}
                  >
                    <option value="">Sin prioridad</option>
                    <option value="alta">🔴 Alta</option>
                    <option value="media">🟠 Media</option>
                    <option value="baja">🟢 Baja</option>
                  </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                  <span className="muted hint" style={{ fontSize: '.72rem' }}>Etiqueta corta (badge)</span>
                  <input
                    className="input" disabled={!puedeEscribir} maxLength={16}
                    defaultValue={docDetalle.badgeTexto || ''} placeholder="Ej: RUPDAE"
                    onBlur={async (e) => {
                      const val = e.target.value.trim() || null;
                      if (val === (docDetalle.badgeTexto ?? null)) return;
                      try { const act = await repo.editarDocumento(docDetalle.id, { badgeTexto: val }); setDocDetalle(act); toast('Etiqueta actualizada.', 'success'); await cargar(); }
                      catch (err) { toast(err instanceof Error ? err.message : 'Error', 'error'); }
                    }}
                  />
                </label>
              </div>
            </div>

            {/* Metadatos Adicionales */}
            <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '.85rem', background: 'var(--surface-1)' }}>
              <div style={{ fontWeight: 700, fontSize: '.86rem', marginBottom: '.6rem', color: 'var(--text)' }}>
                📋 Metadatos del Documento
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.6rem' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                  <span className="muted hint" style={{ fontSize: '.72rem' }}>Socio o Titular</span>
                  <input
                    className="input"
                    defaultValue={docDetalle.socioNombre || ''}
                    disabled={!puedeEscribir}
                    placeholder="Ej: Carlos Silva"
                    onBlur={async (e) => {
                      const val = e.target.value.trim();
                      if (val === (docDetalle.socioNombre || '')) return;
                      try {
                        const act = await repo.editarDocumento(docDetalle.id, { socioNombre: val || null });
                        setDocDetalle(act);
                        toast('Socio actualizado.', 'success');
                        await cargar();
                      } catch (err) {
                        toast(err instanceof Error ? err.message : 'Error', 'error');
                      }
                    }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                  <span className="muted hint" style={{ fontSize: '.72rem' }}>Entidad u Organismo Emisor</span>
                  <input
                    className="input"
                    defaultValue={docDetalle.entidadEmisora || ''}
                    disabled={!puedeEscribir}
                    placeholder="Ej: Ministerio de Desarrollo Minero Ecológico"
                    onBlur={async (e) => {
                      const val = e.target.value.trim();
                      if (val === (docDetalle.entidadEmisora || '')) return;
                      try {
                        const act = await repo.editarDocumento(docDetalle.id, { entidadEmisora: val || null });
                        setDocDetalle(act);
                        toast('Entidad emisora actualizada.', 'success');
                        await cargar();
                      } catch (err) {
                        toast(err instanceof Error ? err.message : 'Error', 'error');
                      }
                    }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                  <span className="muted hint" style={{ fontSize: '.72rem' }}>N° de Registro o Expediente</span>
                  <input
                    className="input"
                    defaultValue={docDetalle.numeroRegistro || ''}
                    disabled={!puedeEscribir}
                    placeholder="Ej: EXP-2026-99128"
                    onBlur={async (e) => {
                      const val = e.target.value.trim();
                      if (val === (docDetalle.numeroRegistro || '')) return;
                      try {
                        const act = await repo.editarDocumento(docDetalle.id, { numeroRegistro: val || null });
                        setDocDetalle(act);
                        toast('N° de registro actualizado.', 'success');
                        await cargar();
                      } catch (err) {
                        toast(err instanceof Error ? err.message : 'Error', 'error');
                      }
                    }}
                  />
                </label>
              </div>
            </div>

            {/* Historial Ligero de Cambios y Auditoría */}
            <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '.85rem', background: 'var(--surface-1)' }}>
              <div style={{ fontWeight: 700, fontSize: '.86rem', marginBottom: '.4rem', color: 'var(--text)' }}>
                📜 Historial de Cambios y Modificaciones
              </div>
              <p className="muted hint" style={{ fontSize: '.74rem', margin: '0 0 .6rem' }}>
                Registro cronológico liviano de quién modificó el documento, cuándo y qué acción realizó.
              </p>

              {docDetalle.historial && docDetalle.historial.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem', maxHeight: '180px', overflowY: 'auto' }}>
                  {[...docDetalle.historial].reverse().map((h) => (
                    <div
                      key={h.id}
                      style={{
                        padding: '.4rem .6rem',
                        borderRadius: '4px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        fontSize: '.76rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ color: '#ff8a00' }}>👤 {h.actor || 'Usuario'}</strong>
                        <span className="muted mono" style={{ fontSize: '.68rem' }}>
                          {fFechaHora.format(new Date(h.fecha))}
                        </span>
                      </div>
                      <div style={{ color: 'var(--text)', marginTop: '.15rem' }}>
                        {h.detalle}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted" style={{ fontSize: '.76rem' }}>
                  Sin cambios registrados en el historial de este archivo.
                </div>
              )}
            </div>
            </>
            )}
          </div>
        </Modal>
      )}

      {/* 8. MODAL: Confirmar Borrado */}
      {docBorrar && (
        <ConfirmDialog
          title="Eliminar Documento"
          danger
          message={
            <>
              ¿Estás seguro de eliminar <strong>«{docBorrar.nombre}»</strong> ({TIPO_DOCUMENTO_LABEL[docBorrar.tipo]})? Esta acción no se puede deshacer.
            </>
          }
          confirmText="Eliminar"
          onCancel={() => setDocBorrar(null)}
          onConfirm={() => void confirmarBorrar()}
        />
      )}

      {/* 8.1. MODAL: Renovación Formal de Documento */}
      {docRenovar && (
        <RenovarDocumentoModal
          documento={docRenovar}
          repo={repo}
          onClose={() => setDocRenovar(null)}
          onRenovado={async () => {
            await cargar();
          }}
        />
      )}

      {/* 9. MODAL: Reporte Dinámico de Documentos */}
      {modalReporte && (
        <ExportarDocumentosModal
          documentos={docs}
          empresas={empresas}
          empresaClaveInicial={empresaClave}
          onClose={() => setModalReporte(false)}
        />
      )}

      {/* 10. MODAL: Gestión de Carpetas Personalizadas */}
      {modalCarpetas && (
        <GestionarCarpetasModal
          carpetas={carpetas}
          centros={centros}
          empresaClave={empresaClave}
          onClose={() => setModalCarpetas(false)}
          onGuardar={(nuevas) => {
            setCarpetas(nuevas);
            guardarCarpetasPersonalizadas(nuevas);
          }}
        />
      )}
    </div>
  );
}
