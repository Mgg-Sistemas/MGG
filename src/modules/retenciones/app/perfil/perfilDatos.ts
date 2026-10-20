/* ============================================================
   MGG · Retenciones v8 · El perfil: filas de la base ↔ pantalla (lógica pura)

   Los nombres son los de BD (14:23): la vista retencion_perfil_proveedor_v
   (v2.2 05, ampliada en v8p-05), retencion_proveedor_actividades (v8p-04),
   retencion_licencia_tipos y retencion_proveedor_licencias (v8p-03) y
   retencion_licencia_historial (v2.2 05).
   El plan de las actividades respeta la base: sin DELETE (se desactiva) y el
   mismo código activo una sola vez; la que deja de ser principal se guarda
   antes que la nueva principal.
   ============================================================ */
import type { ActividadProveedor, TipoLicencia } from './actividadesLicencia';
import type { CambioLicencia, OrigenLicencia, Persona, PerfilProveedor, TipoContribuyente } from './perfilProveedor';

type Fila = Record<string, unknown>;
const txt = (v: unknown) => (v == null || v === '' ? null : String(v));
const fecha = (v: unknown) => (v == null || v === '' ? null : String(v).slice(0, 10));
const unoDe = <T extends string>(v: unknown, xs: readonly T[]): T | null => (xs.includes(v as T) ? (v as T) : null);

const CONTRIBUYENTES = ['ordinario', 'especial', 'formal'] as const satisfies readonly TipoContribuyente[];
const PERSONAS = ['pj_domiciliada', 'pj_no_domiciliada', 'pn_residente', 'pn_no_residente'] as const satisfies readonly Persona[];
const ORIGENES = ['ficha', 'retenciones', 'sistema'] as const satisfies readonly OrigenLicencia[];

export interface LicenciaProveedor { tipoId: string | null; emision: string | null; vence: string | null }

export function perfilDeFila(f: Fila): { perfil: PerfilProveedor; licencia: LicenciaProveedor } {
  return {
    perfil: {
      proveedorId: String(f.proveedor_id), razonSocial: txt(f.razon_social) ?? '—', rif: txt(f.rif) ?? '—', direccion: txt(f.direccion),
      vigente: f.vigente !== false, tipoContribuyente: unoDe(f.tipo_contribuyente, CONTRIBUYENTES), persona: unoDe(f.persona, PERSONAS),
      actividadCodigo: txt(f.actividad_codigo), sujeto100Portal: f.sujeto_100_portal == null ? null : !!f.sujeto_100_portal,
      licenciaActividad: txt(f.licencia_actividad), numeroId: txt(f.numero_id), tienePerfil: !!f.tiene_perfil, completo: !!f.completo,
      actualizadoPor: txt(f.actualizado_por), actualizadoEn: txt(f.actualizado_en),
    },
    licencia: { tipoId: txt(f.licencia_tipo_id), emision: fecha(f.licencia_emision), vence: fecha(f.licencia_vence) },
  };
}

export function actividadDeFila(f: Fila): ActividadProveedor {
  return { id: String(f.id), codigo: String(f.actividad_codigo), principal: !!f.principal, desde: fecha(f.desde), hasta: fecha(f.hasta) };
}

export function tipoDeFila(f: Fila): TipoLicencia {
  return { id: String(f.id), nombre: String(f.nombre), activo: f.activo !== false, vigenciaMeses: f.vigencia_meses == null ? null : Number(f.vigencia_meses) };
}

export function cambioDeFila(f: Fila, fechaHora: (iso: string) => string): CambioLicencia {
  return {
    antes: txt(f.antes), despues: txt(f.despues), origen: unoDe(f.origen, ORIGENES) ?? 'sistema',
    quien: txt(f.actor_name) ?? txt(f.actor) ?? '—', cuando: f.created_at ? fechaHora(String(f.created_at)) : '—',
  };
}

export interface PlanActividades {
  /** Ids de filas cerradas que se desactivan porque su código vuelve a entrar. */
  desactivar: string[];
  /** Cambios de filas existentes: primero las que dejan de ser principal. */
  actualizar: { id: string; principal: boolean; hasta: string | null }[];
  insertar: { actividad_codigo: string; principal: boolean; desde: string | null; hasta: string | null }[];
}

export function planActividades(antes: readonly ActividadProveedor[], despues: readonly ActividadProveedor[]): PlanActividades {
  const previa = new Map(antes.filter((x) => x.id).map((x) => [x.id as string, x]));
  const nuevas = despues.filter((x) => !x.id);
  const desactivar = antes.filter((x) => x.id && nuevas.some((n) => n.codigo === x.codigo)).map((x) => x.id as string);
  const actualizar = despues
    .filter((x) => x.id && !desactivar.includes(x.id))
    .filter((x) => { const p = previa.get(x.id as string); return !!p && (p.principal !== x.principal || p.hasta !== x.hasta); })
    .map((x) => ({ id: x.id as string, principal: x.principal, hasta: x.hasta }))
    .sort((a, b) => Number(a.principal) - Number(b.principal));
  const insertar = nuevas.map((x) => ({ actividad_codigo: x.codigo, principal: x.principal, desde: x.desde, hasta: x.hasta }));
  return { desactivar, actualizar, insertar };
}
