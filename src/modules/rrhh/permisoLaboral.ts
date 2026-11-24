/* ============================================================
   MGG · RRHH · Solicitud de Permiso Laboral (20-11-2026)

   Reglas del formulario y del PDF, sin React ni Supabase, para poder
   probarlas. Vale para TODAS las empresas de la nómina (MGG, GT, MTO…):
   la razón social y el RIF se toman de `rrhh_empresas`.
   ============================================================ */
import { isoAVe } from '@/shared/lib/fechaVe';
import type {
  DatosJefeDepartamentoPermiso,
  DatosTrabajadorPermiso,
  Personal,
  RrhhEvento,
  SolicitudPermisoLaboral,
} from '@/shared/lib/types';
import { definicionEmpresa, type DefinicionEmpresa, type Empresa } from './empresa';

const VACIO_TRABAJADOR: DatosTrabajadorPermiso = {
  nombre: '', apellido: '', cedula: '', cargo: '', departamento: '', telefono: '',
};

/** Lo que se llena en el modal (la solicitud + a quién pertenece). */
export type SolicitudPermisoForm = SolicitudPermisoLaboral & { personal_id: string };

/** Texto que el trabajador acepta al pedir el permiso (palabra por palabra). */
export const COMPROMISO_TRABAJADOR =
  'Me comprometo a coordinar previamente con mi equipo de trabajo para que mis responsables queden cubiertas durante mi ausencia y evitar cualquier afectación a las actividades del departamento. Asimismo, adjuntaré los soportes y justificativos correspondientes al momento.';

/** Hoy en aaaa-mm-dd, sin el desfase de UTC (Caracas). */
export function hoyIsoPermiso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Días inclusive entre dos fechas ISO; 0 si falta alguna o el fin es anterior. */
export function diasInclusivePermiso(desde?: string | null, hasta?: string | null): number {
  if (!desde || !hasta) return 0;
  const m1 = /^(\d{4})-(\d{2})-(\d{2})/.exec(desde);
  const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(hasta);
  if (!m1 || !m2) return 0;
  const a = new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]));
  const b = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
  const n = Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
  return n > 0 ? n : 0;
}

/** Snapshot del trabajador: el PDF histórico no depende de que la ficha cambie después. */
export function datosTrabajadorDe(p: Personal): DatosTrabajadorPermiso {
  return {
    nombre: p.nombre ?? '',
    apellido: p.apellido ?? '',
    cedula: p.cedula ?? '',
    cargo: p.cargo ?? '',
    departamento: p.departamento ?? '',
    telefono: p.telefono ?? '',
  };
}

/** Snapshot del jefe de departamento para firma opcional. */
export function datosJefeDe(p: Personal): DatosJefeDepartamentoPermiso {
  return {
    personal_id: p.id,
    nombre: p.nombre ?? '',
    apellido: p.apellido ?? '',
    cedula: p.cedula ?? '',
    cargo: p.cargo ?? '',
    departamento: p.departamento ?? '',
  };
}

/**
 * Arma el formulario tanto para una solicitud nueva como para un permiso ya
 * guardado. Antes, al abrir el ícono 📎 desde el histórico se pasaba el
 * `personalId` del formulario de arriba (vacío), así que un permiso viejo sin
 * `solicitud` aparecía con el trabajador en «—» y sin poder agregar la firma.
 * Acá el trabajador siempre se toma del propio evento.
 */
export function inicialSolicitudPermiso(
  personal: Personal[],
  personalId: string,
  empresa: Empresa,
  evento?: RrhhEvento | null,
): SolicitudPermisoForm {
  if (evento?.solicitud) {
    return {
      ...evento.solicitud,
      personal_id: evento.personal_id,
      empresa: evento.solicitud.empresa || evento.empresa || empresa,
      requiere_firma_jefe: evento.solicitud.requiere_firma_jefe ?? false,
      jefe_departamento: evento.solicitud.jefe_departamento ?? null,
    };
  }
  const id = evento?.personal_id || personalId;
  const p = personal.find((x) => x.id === id);
  const dias = evento?.dias ?? diasInclusivePermiso(evento?.fecha_desde, evento?.fecha_hasta);
  return {
    personal_id: id,
    fecha_solicitud: evento?.created_at?.slice(0, 10) || hoyIsoPermiso(),
    fecha_inicio: evento?.fecha_desde || '',
    fecha_fin: evento?.fecha_hasta || '',
    tiempo_solicitado: dias > 0 ? `${dias} día(s)` : '',
    horario: '',
    motivo: evento?.descripcion || '',
    compromiso: COMPROMISO_TRABAJADOR,
    trabajador: p ? datosTrabajadorDe(p) : { ...VACIO_TRABAJADOR },
    empresa: evento?.empresa || empresa,
    requiere_firma_jefe: false,
    jefe_departamento: null,
  };
}

/** La solicitud que se graba en el evento no debe repetir el `personal_id` de la cabecera. */
export function solicitudSinPersonal(form: SolicitudPermisoForm): SolicitudPermisoLaboral {
  const { personal_id, ...solicitud } = form;
  void personal_id;
  return solicitud;
}

/** ¿Se cambió la firma del jefe al editar? Sirve para no guardar un evento sin cambios. */
export function hayCambioFirmaEnEdicion(
  evento: RrhhEvento | null | undefined,
  form: SolicitudPermisoForm,
): boolean {
  const antes = evento?.solicitud ?? null;
  if (!!form.requiere_firma_jefe !== !!antes?.requiere_firma_jefe) return true;
  return JSON.stringify(form.jefe_departamento ?? null) !== JSON.stringify(antes?.jefe_departamento ?? null);
}

/** Error en palabras, o null cuando se puede guardar. */
export function validarSolicitudPermiso(f: SolicitudPermisoForm): string | null {
  if (!f.personal_id) return 'Elegí el trabajador de la lista.';
  if (!f.fecha_solicitud) return 'Indicá la fecha de solicitud.';
  if (!f.fecha_inicio) return 'Indicá la fecha de inicio.';
  if (!f.fecha_fin) return 'Indicá la fecha de fin.';
  if (f.fecha_fin < f.fecha_inicio) return 'La fecha de fin no puede ser antes de la fecha de inicio.';
  if (!f.tiempo_solicitado?.trim()) return 'Indicá el tiempo solicitado.';
  if (!f.motivo?.trim()) return 'Indicá el motivo de la ausencia.';
  if (!f.trabajador?.nombre?.trim() && !f.trabajador?.apellido?.trim()) return 'Faltan los datos del trabajador.';
  if (f.compromiso !== COMPROMISO_TRABAJADOR) return 'Falta el compromiso del trabajador.';
  if (f.requiere_firma_jefe && (!f.jefe_departamento || (!f.jefe_departamento.nombre?.trim() && !f.jefe_departamento.personal_id))) {
    return 'Elegí el jefe de departamento para la firma.';
  }
  return null;
}

/**
 * Todo lo que debe aparecer en el PDF, en texto plano. El generador pinta este
 * mismo contenido con el estilo del sistema; acá se prueba sin armar el PDF.
 */
export function contenidoSolicitudPermiso(
  f: SolicitudPermisoForm,
  empresa: DefinicionEmpresa | string,
): string {
  const def = typeof empresa === 'string' ? definicionEmpresa(empresa) : empresa;
  const t = f.trabajador;
  const nombre = `${t.nombre ?? ''} ${t.apellido ?? ''}`.trim();
  const lineas = [
    `${def.razonSocial}${def.rif ? ` · RIF ${def.rif}` : ''}`,
    `Puerto Ordaz, ${isoAVe(f.fecha_solicitud) || '—'}`,
    'SOLICITUD DE PERMISO LABORAL',
    'DATOS DEL TRABAJADOR',
    `Nombre y apellido: ${nombre || '—'}`,
    `Cédula: ${t.cedula?.trim() || '—'}`,
    `Cargo: ${t.cargo?.trim() || '—'}`,
    `Departamento: ${t.departamento?.trim() || '—'}`,
    `Teléfono: ${t.telefono?.trim() || '—'}`,
    'DETALLES DEL PERMISO',
    `Fecha Inicio: ${isoAVe(f.fecha_inicio) || '—'}`,
    `Fecha fin: ${isoAVe(f.fecha_fin) || '—'}`,
    `Tiempo solicitado: ${f.tiempo_solicitado?.trim() || '—'}`,
  ];
  if (f.horario?.trim()) lineas.push(`Horario (si aplica): ${f.horario.trim()}`);
  lineas.push(
    `Motivo de la Ausencia: ${f.motivo?.trim() || '—'}`,
    'COMPROMISO DEL TRABAJADOR:',
    COMPROMISO_TRABAJADOR,
    'Firma del trabajador',
    `${nombre || '—'} · Cédula: ${t.cedula?.trim() || '—'}`,
  );
  if (f.requiere_firma_jefe && f.jefe_departamento) {
    const nomJefe = `${f.jefe_departamento.nombre ?? ''} ${f.jefe_departamento.apellido ?? ''}`.trim();
    lineas.push(
      'Firma Jefe de Departamento',
      `${nomJefe || '—'}${f.jefe_departamento.cargo ? ` · ${f.jefe_departamento.cargo}` : ''}`,
    );
  }
  lineas.push('Firma de RRHH');
  return lineas.join('\n');
}
