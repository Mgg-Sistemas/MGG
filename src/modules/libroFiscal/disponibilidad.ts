/* ============================================================
   Golden Touch · Retenciones · ¿Está la tabla en la base?

   Mientras los paquetes de la base se aplican aparte, una pantalla que
   depende de una tabla nueva se muestra solo si la tabla existe y PostgREST la
   expone. Se pregunta una vez por sesión con un GET de 0 filas (no HEAD: ver abajo).
   · responde (aunque sea con 0 filas o sin permiso de lectura) → existe;
   · «relation does not exist» (42P01) o tabla no expuesta (PGRST205) → no;
   · cualquier otro fallo (red, sesión) → no, y no se guarda en caché, para
     volver a preguntar.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

const cache = new Map<string, Promise<boolean>>();

/** ¿El error dice que la tabla no existe o no está expuesta? */
export function esTablaInexistente(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  return /relation .* does not exist|could not find the table/i.test(e.message ?? '');
}

/** ¿El error es de la base, con un código propio? Si no, es de red o de sesión y vale volver a preguntar. */
const esRespuestaDeLaBase = (e: { code?: string }) => !!e.code && e.code !== 'PGRST301';

export function tablaDisponible(nombre: string): Promise<boolean> {
  const previa = cache.get(nombre);
  if (previa) return previa;
  const consulta = (async () => {
    try {
      // GET y no HEAD: a un HEAD de una tabla que no existe PostgREST responde 404 sin cuerpo, y la librería
      // lo da por bueno (sin error); así cada sección se mostraba sin su tabla. El GET trae el PGRST205.
      const { error } = await supabase.from(nombre).select('*').limit(0);
      if (!error) return true;
      if (esTablaInexistente(error)) return false;
      if (esRespuestaDeLaBase(error)) return true;   // existe: respondió con otro rechazo (permiso, RLS…)
      cache.delete(nombre);
      return false;
    } catch {
      cache.delete(nombre);
      return false;
    }
  })();
  cache.set(nombre, consulta);
  return consulta;
}

/** R1 aplicado: entes y perfiles de proveedores. */
export async function r1Disponible(): Promise<boolean> {
  const [entes, perfiles] = await Promise.all([tablaDisponible('retencion_entes'), tablaDisponible('retencion_contraparte_perfiles')]);
  return entes && perfiles;
}

/** R2 aplicado: el impuesto contenedor. */
export function r2Disponible(): Promise<boolean> {
  return tablaDisponible('retencion_impuestos');
}

/** V2R aplicado: la base numera las practicadas (su tabla propia es retencion_numeros). */
export function v2rDisponible(): Promise<boolean> {
  return tablaDisponible('retencion_numeros');
}

/** P03 aplicado: la puente documento × origen y el borrado de una factura libre. */
export function p03Disponible(): Promise<boolean> {
  return tablaDisponible('retencion_documento_origenes');
}

/** ¿El error dice que la columna no existe o no está expuesta? */
function esColumnaInexistente(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  if (e.code === '42703' || e.code === 'PGRST204') return true;
  return /column .* does not exist|could not find the .* column/i.test(e.message ?? '');
}

/**
 * ¿Existe la columna (y, por lo tanto, su tabla)? Un GET de 0 filas pidiendo solo
 * esa columna: si la columna no está, PostgREST responde 42703; si falta la tabla,
 * 42P01/PGRST205. Sirve para distinguir un paquete de base de su versión siguiente.
 */
export function columnaDisponible(tabla: string, columna: string): Promise<boolean> {
  const clave = `${tabla}.${columna}`;
  const previa = cache.get(clave);
  if (previa) return previa;
  const consulta = (async () => {
    try {
      const { error } = await supabase.from(tabla).select(columna).limit(0);
      if (!error) return true;
      if (esColumnaInexistente(error) || esTablaInexistente(error)) return false;
      if (esRespuestaDeLaBase(error)) return true;   // existe: otro rechazo (permiso, RLS…)
      cache.delete(clave);
      return false;
    } catch {
      cache.delete(clave);
      return false;
    }
  })();
  cache.set(clave, consulta);
  return consulta;
}

/**
 * R11 + R12 aplicados: el buzón de facturas del teléfono y las empresas que las
 * reciben. R12 agrega la columna tipo_documento y ablanda los campos; por eso se
 * pide esa columna (que ya implica que la tabla existe), para que el teléfono no
 * intente cargar contra una base a medias.
 */
export async function buzonDisponible(): Promise<boolean> {
  const [facturas, empresas] = await Promise.all([
    columnaDisponible('retencion_facturas_externas', 'tipo_documento'),
    tablaDisponible('retencion_empresas_receptoras'),
  ]);
  return facturas && empresas;
}

/**
 * Multi-empresa aplicado (F-ME1): las retenciones registradas llevan la empresa
 * receptora. Se pregunta por la columna `empresa_id` de `retencion_documentos`
 * (que ya implica que el paquete de base está). Sin ella, el módulo se comporta
 * single-empresa como hasta hoy (degradación segura).
 */
export function multiEmpresaDisponible(): Promise<boolean> {
  return columnaDisponible('retencion_documentos', 'empresa_id');
}

/**
 * Régimen por empresa aplicado (D2): el régimen (retencion_agente_condiciones) lleva
 * la empresa. Con la columna `empresa_id`, el régimen y la pregunta «¿practica X?»
 * son por empresa (RPC de 3 args). Sin ella, todo es GT como hoy (degradación segura).
 */
export function regimenPorEmpresaDisponible(): Promise<boolean> {
  return columnaDisponible('retencion_agente_condiciones', 'empresa_id');
}

/** Olvida lo preguntado (al cambiar de sesión, o en las pruebas). */
export function olvidarDisponibilidad(): void {
  cache.clear();
}
