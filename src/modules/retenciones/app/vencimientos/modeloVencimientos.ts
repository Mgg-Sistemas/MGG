/* ============================================================
   MGG · Retenciones v8 · Vencimientos (lógica pura)

   Traslado de `v7Vencimientos` y `v7ResumenVencimientos` (maqueta v8,
   l. 5420-5440):
   · licencias (empresa y proveedores): vencida, por vencer a «licencias»
     días (pronto a «licenciasPronto») o al día;
   · declaraciones vencidas o por vencer (retencion_periodos_v);
   · actividades de cada proveedor con fecha «hasta»: solo dentro de
     «actividades» días, y las cerradas hace más de un mes ya no avisan.
   ============================================================ */

import type { PeriodoRetencion } from '../datos/periodos';
import type { AvisoVencimiento, Umbrales } from '../datos/vencimientos';
import { nombreImpuesto } from '../pantalla/pendientesPorDocumento';
import { avisosPeriodosLista, diasEntre } from '../periodos/modeloPeriodos';

export type GrupoVenc = 'vencido' | 'por_vencer' | 'al_dia';

export type Ficha = { tipo: 'periodo'; k: string; est: 'vencido' | 'por_declarar' } | { tipo: 'empresa' } | { tipo: 'perfil'; proveedorId: string; nombre: string; rif: string | null };

export interface Vencimiento {
  grupo: GrupoVenc;
  pronto: boolean;
  fecha: string;
  dias: number;
  que: string;
  ficha: Ficha;
}

export function vencimientos(
  ps: readonly PeriodoRetencion[], avisos: readonly AvisoVencimiento[], impuestos: readonly string[], hoy: string, u: Umbrales,
): Vencimiento[] {
  const out: Vencimiento[] = [];
  for (const a of avisos) {
    const d = diasEntre(hoy, a.vence);
    if (a.aviso === 'actividad_proveedor') {
      if (d < -30 || d > u.actividades) continue;
      out.push({ grupo: d < 0 ? 'vencido' : 'por_vencer', pronto: d >= 0 && d <= 7, fecha: a.vence, dias: d,
        que: `Actividad ${a.detalle ?? ''} de ${a.nombre}`.replace('  ', ' '), ficha: { tipo: 'perfil', proveedorId: a.proveedorId ?? '', nombre: a.nombre, rif: a.rif } });
      continue;
    }
    const grupo: GrupoVenc = d < 0 ? 'vencido' : d <= u.licencias ? 'por_vencer' : 'al_dia';
    const numero = a.detalle || 'sin número';
    out.push(a.aviso === 'licencia_empresa'
      ? { grupo, pronto: d >= 0 && d <= u.licenciasPronto, fecha: a.vence, dias: d, que: `Licencia de actividad económica de la empresa (${numero})`, ficha: { tipo: 'empresa' } }
      : { grupo, pronto: d >= 0 && d <= u.licenciasPronto, fecha: a.vence, dias: d, que: `Licencia de ${a.nombre} (${numero})`, ficha: { tipo: 'perfil', proveedorId: a.proveedorId ?? '', nombre: a.nombre, rif: a.rif } });
  }
  for (const a of avisosPeriodosLista(ps, impuestos, hoy, u.declaraciones)) {
    out.push({ grupo: a.cls === 'vencido' ? 'vencido' : 'por_vencer', pronto: a.cls === 'pronto', fecha: a.p.vence!, dias: a.dias,
      que: `Declaración de ${nombreImpuesto(a.p.tipo)} · ${a.nombre}`, ficha: { tipo: 'periodo', k: a.p.tipo, est: a.cls === 'vencido' ? 'vencido' : 'por_declarar' } });
  }
  return out.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
}

export function resumenVencimientos(xs: readonly Vencimiento[]) {
  return { vencido: xs.filter((x) => x.grupo === 'vencido').length, porVencer: xs.filter((x) => x.grupo === 'por_vencer').length };
}

/** «Venció el … (hace N días)», «Vence hoy (…)» o «Vence el … (en N días)». */
export function textoVence(x: Pick<Vencimiento, 'fecha' | 'dias'>): string {
  const f = x.fecha.split('-').reverse().join('/');
  return x.dias < 0 ? `Venció el ${f} (hace ${-x.dias} días)` : x.dias === 0 ? `Vence hoy (${f})` : `Vence el ${f} (en ${x.dias} días)`;
}

export const textoFicha = (f: Ficha) => (f.tipo === 'periodo' ? 'Ver el período' : f.tipo === 'empresa' ? 'Ver los datos de la empresa' : 'Ver el perfil');
