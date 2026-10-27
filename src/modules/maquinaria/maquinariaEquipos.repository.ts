/* ============================================================
   Golden Touch · Control de Maquinaria · registro de equipos
   Ficha técnica de cada equipo/maquinaria (réplica de la hoja
   DATOS MAQUINARIA). Integra con Combustible: si el equipo se
   vincula (combustible_equipo), el horómetro y el gasoil consumido
   se traen del módulo de Combustible.
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';
import { ultimoHorometroEquipo, consumoPorEquipo, asegurarCatalogo } from '@/modules/combustible/tanques.repository';
import { norm } from '@/shared/lib/texto';
import { pathsDocumentosDeEquipo, borrarArchivosDocumentos } from './maquinariaDocumentos.repository';
import { pathsFotosDeEquipo, borrarArchivosFotosOrden } from './osFotos.repository';

export interface MaquinariaEquipo {
  id: string;
  equipo: string;
  tipo: string | null;
  propietario: string | null;
  status: string;
  ubicacion: string | null;
  anio: number | null;
  marca: string | null;
  modelo: string | null;
  color: string | null;
  serial: string | null;
  placa: string | null;
  motor_modelo: string | null;
  motor_serial: string | null;
  combustible: string | null;
  litros_consume: number | null;
  ficha_tecnica: string | null;
  ficha_mantenimiento: string | null;
  documentacion: string | null;
  mantenimiento_cada_hrs: number | null;
  /** Intervalo de mantenimiento por KILOMETRAJE (km). Alerta al acercarse al próximo múltiplo. */
  mantenimiento_cada_km: number | null;
  /** Horómetro registrado al ÚLTIMO mantenimiento (base del contador de horas restantes).
   *  La reinicia el USUARIO a la lectura vigente («✔ Mantt. hecho», 13/10/2026) → el próximo
   *  toca `base + mantenimiento_cada_hrs`. null = todavía sin base (usa el múltiplo del horómetro). */
  mantenimiento_base_hrs: number | null;
  /** Kilometraje al último mantenimiento (base del contador de km restantes). */
  mantenimiento_base_km: number | null;
  combustible_equipo: string | null;
  /** Grupo del submódulo Servicio de Mantenimiento (ver GRUPOS_MANTENIMIENTO). */
  grupo_mantenimiento: string | null;
  doc_fisico: boolean;
  ficha_mantt: boolean;
  doc_drive: boolean;
  esp_tecnicas: boolean;
  revision_mina: boolean;
  notas: string | null;
  /** Encargado responsable del equipo o vehículo (chofer, operador, mecánico). */
  encargado_responsable?: string | null;
  /** Estado operativo (Flota y Servicio, 09/10/2026). null = se deduce de status/activo
   *  (ver `estadoEfectivo` en flota.ts). Lo cambia el RPC `maquinaria_cambiar_estado`. */
  estado_operativo?: string | null;
  /** Motivo del estado actual («se le dañó el gato»). */
  estado_nota?: string | null;
  estado_desde?: string | null;
  activo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
}

export type MaquinariaEquipoInput = Partial<Omit<MaquinariaEquipo, 'id' | 'created_at' | 'updated_at'>> & { equipo: string };

/** Extrae el encargado responsable del campo directo o del tag [Encargado: Nombre] en notas. */
export function extraerEncargado(eq: { notas?: string | null; encargado_responsable?: string | null }): string | null {
  if (eq.encargado_responsable?.trim()) return eq.encargado_responsable.trim();
  const m = (eq.notas ?? '').match(/\[(?:Encargado|Responsable):\s*([^\]]+)\]/i);
  return m ? m[1].trim() : null;
}

/** Inserta o actualiza el tag [Encargado: Nombre] en notas sin perder el resto del texto. */
export function componerNotasConEncargado(notas?: string | null, encargado?: string | null): string | null {
  const encLimpio = (encargado ?? '').trim();
  let base = (notas ?? '').replace(/\[(?:Encargado|Responsable):\s*[^\]]+\]\s*/gi, '').trim();
  if (encLimpio) {
    base = base ? `${base}\n[Encargado: ${encLimpio}]` : `[Encargado: ${encLimpio}]`;
  }
  return base || null;
}

function parseEquipo(r: Record<string, unknown>): MaquinariaEquipo {
  const eq = r as unknown as MaquinariaEquipo;
  return {
    ...eq,
    encargado_responsable: extraerEncargado(eq),
  };
}

/** Grupos del submódulo Servicio de Mantenimiento (switches). Orden = orden de los switches. */
export const GRUPOS_MANTENIMIENTO = ['FLOTA PESADA', 'VEHÍCULOS DE CARGA', 'PLANTAS ELÉCTRICAS'] as const;
export type GrupoMantenimiento = (typeof GRUPOS_MANTENIMIENTO)[number];

const TABLE = 'maquinaria_equipos';

export async function listEquipos(): Promise<MaquinariaEquipo[]> {
  const { data, error } = await supabase.from(TABLE).select('*')
    .order('equipo', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => parseEquipo(r as Record<string, unknown>));
}

export async function getEquipo(id: string): Promise<MaquinariaEquipo | null> {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? parseEquipo(data as Record<string, unknown>) : null;
}

function sanitize(input: MaquinariaEquipoInput): Record<string, unknown> {
  const v = (s?: string | null) => (s == null ? null : String(s).trim() || null);
  const n = (x?: number | null) => (x == null || Number.isNaN(Number(x)) ? null : Number(x));
  const notasFinal = componerNotasConEncargado(input.notas, input.encargado_responsable);
  return {
    equipo: input.equipo.trim().toUpperCase(),
    tipo: v(input.tipo), propietario: v(input.propietario),
    status: v(input.status) ?? 'ACTIVO',
    ubicacion: v(input.ubicacion), anio: n(input.anio),
    marca: v(input.marca), modelo: v(input.modelo), color: v(input.color),
    serial: v(input.serial), placa: v(input.placa),
    motor_modelo: v(input.motor_modelo), motor_serial: v(input.motor_serial),
    combustible: v(input.combustible), litros_consume: n(input.litros_consume),
    ficha_tecnica: v(input.ficha_tecnica), ficha_mantenimiento: v(input.ficha_mantenimiento),
    documentacion: v(input.documentacion), mantenimiento_cada_hrs: n(input.mantenimiento_cada_hrs),
    mantenimiento_cada_km: n(input.mantenimiento_cada_km),
    // NB: mantenimiento_base_hrs/km NO se tocan aquí (los maneja reiniciarMantenimientoDeEquipo,
    // que escribe directo). Así editar la ficha del equipo no borra el contador.
    combustible_equipo: v(input.combustible_equipo),
    grupo_mantenimiento: v(input.grupo_mantenimiento),
    doc_fisico: !!input.doc_fisico, ficha_mantt: !!input.ficha_mantt, doc_drive: !!input.doc_drive,
    esp_tecnicas: !!input.esp_tecnicas, revision_mina: !!input.revision_mina,
    notas: notasFinal,
  };
}

/**
 * Deja al equipo vinculado a sí mismo en Combustible (26/10/2026): crea su nombre en el
 * catálogo de equipos de Combustible si no estaba (sin duplicar por mayúsculas/acentos) y
 * devuelve el nombre tal como quedó en el catálogo, listo para guardarlo en
 * `combustible_equipo`. Lo usa el formulario (botón «Vincular a sí mismo» y la opción de
 * crear) y el alta de equipos nuevos.
 */
export async function vincularEquipoEnCombustible(nombre: string): Promise<string> {
  const n = nombre.trim();
  if (!n) throw new Error('Indica el nombre del equipo.');
  const fila = await asegurarCatalogo('equipo', n);
  return fila.valor;
}

export async function addEquipo(input: MaquinariaEquipoInput, actor: string): Promise<MaquinariaEquipo> {
  if (!input.equipo?.trim()) throw new Error('Indica el equipo.');
  const fila = sanitize(input);
  // Equipo NUEVO sin vínculo → queda vinculado a sí mismo (26/10/2026): el mismo nombre se
  // crea en el catálogo de Combustible. La base lo garantiza con un trigger (también crea el
  // valor del catálogo con SECURITY DEFINER, por si quien registra no tiene permiso de
  // Combustible); aquí se hace además desde la app para que la ficha ya salga vinculada sin
  // esperar a recargar, y el catálogo se intenta best-effort (si falla por permiso, lo
  // termina el trigger). Al EDITAR no se vincula solo: eso lo decide el botón del formulario.
  if (!fila.combustible_equipo) {
    const nombre = fila.equipo as string;
    fila.combustible_equipo = await vincularEquipoEnCombustible(nombre).catch(() => nombre);
  }
  const { data, error } = await supabase.from(TABLE)
    .insert({ ...fila, created_by: actor })
    .select('*').single();
  if (error) throw error;
  return data as MaquinariaEquipo;
}

export async function updateEquipo(id: string, input: MaquinariaEquipoInput): Promise<void> {
  if (!input.equipo?.trim()) throw new Error('Indica el equipo.');
  const { error } = await supabase.from(TABLE)
    .update({ ...sanitize(input), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function setEquipoActivo(id: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ activo, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/**
 * Elimina un equipo de forma definitiva. Primero borra su bitácora de
 * mantenimientos (para no chocar contra la FK) y luego el equipo.
 */
export async function eliminarEquipo(id: string): Promise<void> {
  // Rutas de sus documentos (📎): los registros se van solos por la FK en cascada,
  // pero los archivos del bucket hay que borrarlos a mano, y solo si el equipo se borró.
  const archivos = await pathsDocumentosDeEquipo(id).catch(() => [] as string[]);
  // Igual con las fotos de sus órdenes de servicio (bucket maquinaria-os-fotos).
  const fotosOs = await pathsFotosDeEquipo(id).catch(() => [] as string[]);
  // Borra la bitácora del equipo (mantenimientos) antes que el equipo.
  await supabase.from('maquinaria_mantenimientos').delete().eq('equipo_id', id);
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
  await borrarArchivosDocumentos(archivos);
  await borrarArchivosFotosOrden(fotosOs);
}

/**
 * REINICIA el contador de mantenimiento de un equipo: fija la base de horas (y de km, si
 * hay lectura) en el horómetro/kilometraje VIGENTE, de modo que el próximo mantenimiento
 * pase a tocar en `base + intervalo`. Se llama automáticamente cuando se concreta la compra
 * del mantenimiento (servicio directo casado al equipo finalizado) y también desde el botón
 * manual «Mantenimiento hecho». Best-effort: si el equipo no tiene lectura, no rompe nada.
 * Devuelve las lecturas usadas como base (null si no había dato).
 */
export async function reiniciarMantenimientoDeEquipo(equipoId: string): Promise<{ horas: number | null; km: number | null }> {
  if (!equipoId) return { horas: null, km: null };
  const eq = await getEquipo(equipoId);
  if (!eq) return { horas: null, km: null };
  // Lectura vigente UNIFICADA (09/10/2026): la mayor entre Combustible, las lecturas
  // registradas en Maquinaria y la bitácora (desde la última corrección).
  const { data: vig } = await supabase.rpc('maquinaria_lecturas_vigentes');
  const fila = ((vig ?? []) as Array<{ equipo_id: string; horometro: number | null; kilometraje: number | null }>).find((x) => x.equipo_id === equipoId);
  const horas: number | null = fila?.horometro != null ? Number(fila.horometro) : null;
  const km: number | null = fila?.kilometraje != null ? Number(fila.kilometraje) : null;
  // Escribe la base vía RPC SECURITY DEFINER: así el reinicio funciona aunque quien
  // finaliza la compra (p. ej. Tesorería) no tenga permiso de escritura en Maquinaria.
  // coalesce en el servidor no pisa con null la dimensión sin lectura.
  if (horas != null || km != null) {
    await supabase.rpc('reiniciar_mantenimiento_equipo', {
      p_equipo_id: equipoId, p_horas: horas, p_km: km,
    });
  }
  return { horas, km };
}

/* ───────── Integración con Combustible ───────── */

export interface DatosCombustibleEquipo {
  horometro: number | null;     // última lectura de horómetro (Combustible)
  gasoilLts: number;            // gasoil consumido (uso) en el rango
  gasoilUsd: number;            // su equivalente en USD
}

/**
 * Trae del módulo de Combustible el horómetro vigente y el gasoil consumido por el
 * equipo vinculado (`combustible_equipo`) en el rango dado. Devuelve ceros/null si
 * el equipo no está vinculado o no tiene movimientos.
 */
export async function datosCombustibleDeEquipo(
  combustibleEquipo: string | null | undefined,
  desde?: Date, hasta?: Date,
): Promise<DatosCombustibleEquipo> {
  const nombre = (combustibleEquipo ?? '').trim();
  if (!nombre) return { horometro: null, gasoilLts: 0, gasoilUsd: 0 };
  const d = desde ?? new Date(2000, 0, 1);
  const h = hasta ?? new Date();
  const [horometro, consumo] = await Promise.all([
    ultimoHorometroEquipo(nombre).catch(() => null),
    consumoPorEquipo(d, h).catch(() => [] as { nombre: string; cantidad: number; valor: number }[]),
  ]);
  const fila = consumo.find((c) => norm(c.nombre) === norm(nombre));
  return { horometro, gasoilLts: fila?.cantidad ?? 0, gasoilUsd: fila?.valor ?? 0 };
}
