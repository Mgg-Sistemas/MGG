import type { SujetoRetenido } from './retencionesCalculo';

export type TipoPersona = 'natural' | 'juridica';
export type Residencia = 'residente' | 'no_residente';

export function sujetoDesdePersona(tipo: TipoPersona, residencia: Residencia): SujetoRetenido {
  if (tipo === 'natural') return residencia === 'residente' ? 'pn_residente' : 'pn_no_residente';
  return residencia === 'residente' ? 'pj_domiciliada' : 'pj_no_domiciliada';
}

export interface SugerenciaSujeto {
  tipo: TipoPersona;
  residencia: Residencia;
  sujeto: SujetoRetenido;
  confianza: 'alta' | 'media';
}

export function sugerirSujetoPorRif(rif: string | null | undefined): SugerenciaSujeto | null {
  const letra = (rif ?? '').trim().charAt(0).toUpperCase();
  if (!letra) return null;

  switch (letra) {
    case 'J':
    case 'G':
      return { tipo: 'juridica', residencia: 'residente', sujeto: 'pj_domiciliada', confianza: 'alta' };
    case 'V':
    case 'C':
      return { tipo: 'natural', residencia: 'residente', sujeto: 'pn_residente', confianza: 'alta' };
    case 'E':
      return { tipo: 'natural', residencia: 'no_residente', sujeto: 'pn_no_residente', confianza: 'media' };
    case 'P':
      return { tipo: 'natural', residencia: 'no_residente', sujeto: 'pn_no_residente', confianza: 'media' };
    default:
      return null;
  }
}

export function labelTipoPersona(tipo: TipoPersona): string {
  return tipo === 'natural' ? 'Persona natural' : 'Persona jurídica';
}

export function labelResidencia(r: Residencia, tipo: TipoPersona): string {
  if (tipo === 'natural') return r === 'residente' ? 'Residente' : 'No residente';
  return r === 'residente' ? 'Domiciliada' : 'No domiciliada';
}
