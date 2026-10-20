/* ============================================================
   MGG · Retenciones v8 · El perfil fiscal del proveedor (lógica pura)

   El de la maqueta: el diálogo dlg-perfil (v8, l. 1469), su residencia fiscal
   y su categoría (v8-4-dialogos-registro.js §7), la actividad y la licencia
   (v7-3-registro-comprobante.js, v6TrasAbrirPerfil) y la pestaña «Retenciones»
   (v8-14-analisis.js, punto 4).
   Los datos son los de la base de Retenciones, paquete 05 (v2.2): la tabla
   retencion_perfil_proveedor, su vista retencion_perfil_proveedor_v, el número
   de licencia en proveedores.licencia_actividad y su historial en
   retencion_licencia_historial. Las restricciones de la tabla se validan aquí
   antes de guardar.
   ============================================================ */
import { rangoDeAtajo } from '../pantalla/reportes/Reportes';

export type TipoContribuyente = 'ordinario' | 'especial' | 'formal';
export type Persona = 'pj_domiciliada' | 'pj_no_domiciliada' | 'pn_residente' | 'pn_no_residente';
export type TipoPersona = 'juridica' | 'natural';
export type Residencia = 've' | 'fuera';

export const TIPOS_CONTRIBUYENTE: [TipoContribuyente, string][] = [['ordinario', 'Ordinario'], ['especial', 'Especial'], ['formal', 'Formal']];

/** La categoría del ISLR: la columna de su tabla que se aplica. */
export const CATEGORIA: Record<Persona, string> = {
  pj_domiciliada: 'Persona jurídica domiciliada',
  pj_no_domiciliada: 'Persona jurídica no domiciliada',
  pn_residente: 'Persona natural residente',
  pn_no_residente: 'Persona natural no residente',
};

/** Una fila de la vista retencion_perfil_proveedor_v. */
export interface PerfilProveedor {
  proveedorId: string;
  razonSocial: string;
  rif: string;
  direccion: string | null;
  /** Proveedor inactivo: el perfil se conserva y no propone. */
  vigente: boolean;
  tipoContribuyente: TipoContribuyente | null;
  persona: Persona | null;
  actividadCodigo: string | null;
  sujeto100Portal: boolean | null;
  licenciaActividad: string | null;
  numeroId: string | null;
  tienePerfil: boolean;
  completo: boolean;
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}

/** Lo que se edita en el diálogo (vacío = «No registrado»). */
export interface BorradorPerfil {
  tipoContribuyente: TipoContribuyente | '';
  persona: Persona | '';
  actividadCodigo: string;
  sujeto100Portal: boolean;
  licenciaActividad: string;
  numeroId: string;
}

export function borradorDe(p: PerfilProveedor | null): BorradorPerfil {
  return {
    tipoContribuyente: p?.tipoContribuyente ?? '', persona: p?.persona ?? '', actividadCodigo: p?.actividadCodigo ?? '',
    sujeto100Portal: !!p?.sujeto100Portal, licenciaActividad: p?.licenciaActividad ?? '', numeroId: p?.numeroId ?? '',
  };
}

export function personaDe(tipo: TipoPersona | '', residencia: Residencia | ''): Persona | '' {
  if (!tipo || !residencia) return '';
  if (tipo === 'juridica') return residencia === 've' ? 'pj_domiciliada' : 'pj_no_domiciliada';
  return residencia === 've' ? 'pn_residente' : 'pn_no_residente';
}

export function partesDePersona(p: Persona | '' | null): { tipo: TipoPersona | ''; residencia: Residencia | '' } {
  if (!p) return { tipo: '', residencia: '' };
  return { tipo: p.startsWith('pj') ? 'juridica' : 'natural', residencia: p === 'pj_domiciliada' || p === 'pn_residente' ? 've' : 'fuera' };
}

export function textoCategoria(p: Persona | '' | null): { categoria: string | null; falta: string | null } {
  if (!p) return { categoria: null, falta: null };
  return { categoria: CATEGORIA[p], falta: p === 'pj_no_domiciliada' ? 'No domiciliada: Tarifa N° 2, el monto se indica a mano al registrar.' : null };
}

export const SIN_CATEGORIA = 'Categoría: sin definir hasta indicar el tipo de persona y la residencia. Sin ella, el ISLR queda «Por definir».';

/** La letra del RIF sugiere el tipo de persona; nunca se marca sola. */
export function sugerenciaRif(rif: string | null | undefined): TipoPersona | '' {
  const l = String(rif ?? '').trim().charAt(0).toUpperCase();
  if (!l) return '';
  return 'JGC'.includes(l) ? 'juridica' : 'VE'.includes(l) ? 'natural' : '';
}

/** La restricción retencion_perfil_actividad_check: 3.2.14.04 (de 1 a 6 niveles) o sin actividad en el municipio. */
export const SIN_ACTIVIDAD_MUNICIPIO = 'sin_actividad_municipio';
const ACTIVIDAD = /^[0-9]+(\.[0-9]+){0,5}$/;

export function validarPerfil(b: BorradorPerfil): string[] {
  const errores: string[] = [];
  const act = b.actividadCodigo.trim();
  if (act && act !== SIN_ACTIVIDAD_MUNICIPIO && !ACTIVIDAD.test(act)) {
    errores.push('La actividad se indica con su código, como 3.2.14.04 (de 1 a 6 niveles).');
  }
  return errores;
}

/**
 * Las columnas de retencion_perfil_proveedor que se guardan (vacío → null, como piden sus restricciones).
 * La actividad no: la pone la base desde la principal de retencion_proveedor_actividades (v8p-04).
 */
export function filaPerfil(proveedorId: string, b: BorradorPerfil) {
  return {
    proveedor_id: proveedorId, tipo_contribuyente: b.tipoContribuyente || null, persona: b.persona || null,
    sujeto_100_portal: b.sujeto100Portal, numero_id: b.numeroId.trim() || null,
  };
}

export function huellaPerfil(quien: string | null, cuando: string | null): string {
  return quien && cuando ? `Última modificación del perfil: ${quien} · ${cuando}` : 'Perfil sin modificaciones registradas.';
}

export type OrigenLicencia = 'ficha' | 'retenciones' | 'sistema';
const ORIGEN: Record<OrigenLicencia, string> = { ficha: 'desde la ficha del proveedor', retenciones: 'desde Retenciones', sistema: 'del sistema' };

/** Un cambio del número de licencia (retencion_licencia_historial). */
export interface CambioLicencia { antes: string | null; despues: string | null; origen: OrigenLicencia; quien: string; cuando: string }

export function textoLicenciaHistorial(c: CambioLicencia): string {
  return `${c.antes ?? '(vacía)'} → ${c.despues ?? '(vacía)'} · ${ORIGEN[c.origen]} · ${c.quien} · ${c.cuando}`;
}

/** Los rangos de la pestaña «Retenciones» (PF_ATAJOS). */
export type AtajoPerfil = 'anio_actual' | 'ultimos_6' | 'ultimos_12' | 'anio_anterior';
export const ATAJOS_PERFIL: [AtajoPerfil, string][] = [['anio_actual', 'Este año'], ['ultimos_6', 'Últimos 6 meses'], ['ultimos_12', 'Últimos 12 meses'], ['anio_anterior', 'Año anterior']];

export function rangoPerfil(atajo: AtajoPerfil, hoy: Date): [string, string] {
  const y = hoy.getFullYear();
  const iso = (d: Date) => d.toLocaleDateString('en-CA');
  if (atajo === 'anio_actual') return [`${y}-01-01`, iso(hoy)];
  if (atajo === 'anio_anterior') return [`${y - 1}-01-01`, `${y - 1}-12-31`];
  return rangoDeAtajo(atajo, hoy, '', '');
}

export const NOTA_PERFIL = 'El perfil fiscal se guarda en Retenciones y no modifica la ficha del proveedor. Los cambios afectan solo a las retenciones pendientes; las registradas y los comprobantes emitidos conservan los datos con que se emitieron.';
export const NOTA_INACTIVO = 'Proveedor inactivo: el perfil se conserva y no genera propuestas.';
export const NOTA_LECTURA = 'Solo lectura: la edición requiere permiso de escritura en Retenciones o rol de administración.';
export const NOTA_PROPUESTA = 'A partir de estos datos se propone la aplicabilidad de cada retención. La propuesta puede modificarse manualmente en cada factura.';
