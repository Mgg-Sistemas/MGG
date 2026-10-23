/* ============================================================
   Golden Touch · Retenciones · Parámetros de R1: piezas puras de pantalla

   Rótulos, territorio, el perfil con el que arranca el formulario y el filtro
   «todos / incompletos / completos». Sin base ni DOM: se prueban solas.
   ============================================================ */
import type { ClaseImagenAgente, ClaveImpuesto, Ente, TipoEnte } from './entes.repository';
import type { EstadoLicencia, FilaPerfil, PerfilFiscal, PerfilNuevo, TipoContribuyente } from './perfilesFiscales.repository';
import { sugerirSujetoPorRif } from './residenciaSujeto';
import { sujetoDelPerfil } from './perfilesFiscales.repository';
import { rotuloImpuesto, rotuloTipoEnte } from './rotulos';

/** El rótulo de una clave de impuesto (MUNICIPAL → «ISAE (municipal)»); nunca la clave cruda (rotulos.ts). */
export const labelClave = (c: ClaveImpuesto) => rotuloImpuesto(c);

export const TIPOS_ENTE: { key: TipoEnte; label: string }[] = [
  { key: 'nacional', label: 'Nacional' },
  { key: 'estadal', label: 'Estadal' },
  { key: 'municipal', label: 'Municipal' },
];

export const TIPOS_CONTRIBUYENTE: { key: TipoContribuyente; label: string }[] = [
  { key: 'ordinario', label: 'Ordinario' },
  { key: 'especial', label: 'Especial' },
  { key: 'formal', label: 'Formal' },
];

export const CLASES_AGENTE: { key: ClaseImagenAgente; label: string; ayuda: string }[] = [
  { key: 'logo', label: 'Logo de la empresa', ayuda: 'Va en el encabezado del comprobante.' },
  { key: 'firma', label: 'Firma', ayuda: 'De quien firma los comprobantes, con su nombre y cargo.' },
  { key: 'sello', label: 'Sello', ayuda: 'El sello húmedo de la empresa, escaneado.' },
];

export const labelTipoEnte = (t: TipoEnte) => TIPOS_ENTE.find((x) => x.key === t)?.label ?? rotuloTipoEnte(t);
export const labelContribuyente = (t: TipoContribuyente | null) => TIPOS_CONTRIBUYENTE.find((x) => x.key === t)?.label ?? '—';

/** «Municipal · Caroní, Bolívar» / «Estadal · Bolívar» / «Nacional». */
export function territorio(e: Pick<Ente, 'tipo' | 'estado' | 'municipio'>): string {
  if (e.tipo === 'municipal') return [e.municipio, e.estado].filter(Boolean).join(', ') || '—';
  if (e.tipo === 'estadal') return e.estado || '—';
  return 'Todo el país';
}

/** dd/mm/aaaa. */
export function fechaCorta(iso: string | null | undefined): string {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '—';
}

export type FiltroCompleto = 'todos' | 'incompletos' | 'completos';

export function filtrarPorCompleto(filas: FilaPerfil[], f: FiltroCompleto): FilaPerfil[] {
  if (f === 'incompletos') return filas.filter((r) => !r.completo);
  if (f === 'completos') return filas.filter((r) => r.completo);
  return filas;
}

/** El perfil con el que arranca el formulario: el vigente, o uno vacío (sin adivinar por el RIF). */
export function perfilInicial(vigente: PerfilFiscal | null): PerfilNuevo {
  if (vigente) {
    return {
      tipoPersona: vigente.tipoPersona, residente: vigente.residente,
      tipoContribuyente: vigente.tipoContribuyente, esAgenteRetencion: vigente.esAgenteRetencion,
      licenciaTipo: vigente.licenciaTipo, licenciaNumero: vigente.licenciaNumero,
      licenciaEstado: vigente.licenciaEstado, licenciaVence: vigente.licenciaVence,
      licenciaEnteId: vigente.licenciaEnteId, observacion: vigente.observacion,
    };
  }
  return {
    tipoPersona: 'juridica', residente: true, tipoContribuyente: 'ordinario', esAgenteRetencion: false,
    licenciaTipo: null, licenciaNumero: null, licenciaEstado: 'por_solicitar', licenciaVence: null,
    licenciaEnteId: null, observacion: null,
  };
}

/** La sugerencia por la letra del RIF, solo si difiere de lo elegido. Nunca se aplica sola. */
export function sugerenciaDistinta(rif: string | null, p: Pick<PerfilNuevo, 'tipoPersona' | 'residente'>) {
  const s = sugerirSujetoPorRif(rif ?? '');
  if (!s) return null;
  return s.sujeto === sujetoDelPerfil(p) ? null : s;
}

/** La primera fecha que acepta la base para una versión nueva: el día después de la vigente. */
export function desdeMinimo(vigente: Pick<PerfilFiscal, 'desde'> | null): string | null {
  if (!vigente?.desde) return null;
  const d = new Date(`${vigente.desde}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export const LABEL_LICENCIA: Record<EstadoLicencia, string> = {
  por_solicitar: 'Por solicitar', solicitada: 'Solicitada', vigente: 'Vigente', vencida: 'Vencida', no_aplica: 'No aplica',
};
