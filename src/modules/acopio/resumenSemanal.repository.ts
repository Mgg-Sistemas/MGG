/* ============================================================
   Centro de Acopio · Resumen Semanal Casiterita
   Réplica de la hoja «REPORTE PRELIMINAR DE CENTROS DE ACOPIOS».
   Reporte semanal que se archiva a histórico (snapshot por semana).
   Los datos los ingresa el usuario por SECTOR (grupo de centros).
   ============================================================ */
import { supabase } from '@/shared/lib/supabase';

const TABLE = 'acopio_resumen_semanal';

/** Origen externo (otro Supabase) de un dato vinculado. */
export interface FuenteExterna {
  sistema: string;  // p.ej. 'golden-touch'
  metrica: string;  // p.ej. 'acopio_saldo_kg'
  label?: string;   // etiqueta para mostrar
}

/** Aliados internos vinculables en el resumen (sus «Kg Recibidos por MGG»). */
export const ALIADO_JUAN_BODEGA = 'e6bcc18f-ffba-4c09-a658-4cf4eb2935b2';
export const ALIADO_ENDER_MEJIAS = '0efc7005-78b2-4b0c-badb-b564773b8c18';
// Aliados del centro LOS PIJIGUAOS.
export const ALIADO_PIJ_ALBERTO = 'b2bdf572-fe93-40dd-a830-cb17a70bce27';
export const ALIADO_PIJ_ALBERTO_MINA40 = '8d86916d-cfa1-48a6-89cd-9318c9760579';
export const ALIADO_PIJ_MAGUIBER = 'e58ec8b3-dc2d-4988-8b08-d0ae56e5c5da';

/**
 * Catálogo de métricas vinculables. `mgg` = este mismo sistema (RPC local);
 * `mgg-aliado` = un aliado de este sistema (la métrica es el id del aliado);
 * cualquier otro `sistema` = otro Supabase resuelto por la Edge Function segura.
 */
export const METRICAS_EXTERNAS: FuenteExterna[] = [
  { sistema: 'mgg', metrica: 'acopio_saldo_kg', label: 'Este sistema · Saldo en Kg (acopio LA ESPERANZA)' },
  { sistema: 'mgg-aliado', metrica: ALIADO_JUAN_BODEGA, label: 'Aliado JUAN BODEGA · Kg Recibidos por MGG' },
  { sistema: 'mgg-aliado', metrica: ALIADO_ENDER_MEJIAS, label: 'Aliado ENDER MEJÍAS · Kg Recibidos por MGG' },
  { sistema: 'mgg-aliado-saldokg', metrica: ALIADO_JUAN_BODEGA, label: 'Aliado JUAN BODEGA · Saldo en Kg casiterita' },
  { sistema: 'mgg-aliado-saldokg', metrica: ALIADO_ENDER_MEJIAS, label: 'Aliado ENDER MEJÍAS · Saldo en Kg casiterita' },
  { sistema: 'mgg-centro-saldokg', metrica: 'GLOBAL MINERAL TIN', label: 'Este sistema · Saldo en Kg (acopio GLOBAL MINERAL TIN)' },
  { sistema: 'mgg-centro-saldokg', metrica: 'LA ESMERALDA ALI', label: 'Este sistema · Saldo en Kg (acopio LA ESMERALDA ALÍ)' },
  { sistema: 'mgg-centro-saldokg', metrica: 'LOS PIJIGUAOS', label: 'Este sistema · Saldo en Kg (acopio LOS PIJIGUAOS)' },
  { sistema: 'mgg-aliado', metrica: ALIADO_PIJ_ALBERTO, label: 'Aliado ALBERTO (Pijiguaos) · Kg Recibidos por MGG' },
  { sistema: 'mgg-aliado', metrica: ALIADO_PIJ_ALBERTO_MINA40, label: 'Aliado ALBERTO MINA 40 (Pijiguaos) · Kg Recibidos por MGG' },
  { sistema: 'mgg-aliado', metrica: ALIADO_PIJ_MAGUIBER, label: 'Aliado MAGUIBER (Pijiguaos) · Kg Recibidos por MGG' },
  { sistema: 'mgg-aliado-saldokg', metrica: ALIADO_PIJ_ALBERTO, label: 'Aliado ALBERTO (Pijiguaos) · Saldo en Kg casiterita' },
  { sistema: 'mgg-aliado-saldokg', metrica: ALIADO_PIJ_ALBERTO_MINA40, label: 'Aliado ALBERTO MINA 40 (Pijiguaos) · Saldo en Kg casiterita' },
  { sistema: 'mgg-aliado-saldokg', metrica: ALIADO_PIJ_MAGUIBER, label: 'Aliado MAGUIBER (Pijiguaos) · Saldo en Kg casiterita' },
  { sistema: 'golden-touch', metrica: 'acopio_saldo_kg', label: 'Golden Touch · Saldo en Kg (acopio)' },
];

/** RPC en BD por métrica (mismo nombre en cada sistema). */
const RPC_DE_METRICA: Record<string, string> = {
  acopio_saldo_kg: 'metrica_acopio_saldo_kg',
};

/**
 * Lee una métrica vinculada. Si `sistema === 'mgg'` la resuelve con un RPC LOCAL
 * (misma base); para cualquier otro sistema usa la Edge Function `metricas-externas`
 * (lee el otro Supabase sin exponer credenciales al navegador).
 */
export async function leerMetricaExterna(sistema: string, metrica: string): Promise<number> {
  if (sistema === 'mgg') {
    // Saldo de caja $USD y Tasa del material se calculan del resumen de la caja local.
    if (metrica === 'acopio_saldo_usd' || metrica === 'acopio_tasa_material') {
      const { resumenCajaAcopio } = await import('./caja.repository');
      const r = await resumenCajaAcopio();
      return metrica === 'acopio_saldo_usd' ? r.saldoUsd : r.tasaMaterial;
    }
    const rpc = RPC_DE_METRICA[metrica];
    if (!rpc) throw new Error(`Métrica local desconocida: ${metrica}`);
    const { data, error } = await supabase.rpc(rpc);
    if (error) throw new Error(error.message ?? 'No se pudo leer la métrica local');
    const v = Number(data);
    if (!Number.isFinite(v)) throw new Error('Respuesta no numérica de la métrica local');
    return v;
  }
  // Centro de acopio INTERNO específico (multi-centro): la métrica es el NOMBRE del centro.
  // 'mgg-centro-saldo' → Saldo de caja $USD; 'mgg-centro-tasa' → Tasa del material $/Kg;
  // 'mgg-centro-saldokg' → Saldo en Kg de casiterita del centro (Σ kg_cerrados − Σ kg_recibidos).
  // Se usa, p. ej., para GLOBAL MINERAL TIN (caja P-MGG08), que vive en ESTE sistema.
  if (sistema === 'mgg-centro-saldo' || sistema === 'mgg-centro-tasa' || sistema === 'mgg-centro-saldokg') {
    const { resumenCajaAcopio } = await import('./caja.repository');
    const r = await resumenCajaAcopio(undefined, undefined, metrica);
    if (sistema === 'mgg-centro-saldo') return r.saldoUsd;
    if (sistema === 'mgg-centro-tasa') return r.tasaMaterial;
    return r.kgProduccion - r.kgEnviados;
  }
  // Aliado interno: la métrica es el id del aliado. 'mgg-aliado' → «Kg Recibidos por MGG»;
  // 'mgg-aliado-saldokg' → «Saldo en Kg casiterita».
  if (sistema === 'mgg-aliado' || sistema === 'mgg-aliado-saldokg') {
    const { listAliadoMovimientos, resumirAliado } = await import('./subledgers.repository');
    const r = resumirAliado(await listAliadoMovimientos(metrica));
    return sistema === 'mgg-aliado-saldokg' ? r.saldoKg : r.totalKgRecibidos;
  }
  const { data, error } = await supabase.functions.invoke('metricas-externas', { body: { sistema, metrica } });
  if (error) throw new Error(error.message ?? 'No se pudo leer la métrica externa');
  const d = data as { valor?: number; error?: string } | null;
  if (!d || typeof d.valor !== 'number') throw new Error(d?.error || 'Respuesta inválida de la métrica externa');
  return d.valor;
}

/** Un centro (fila numerada) dentro de un bloque: el usuario ingresa los dos Kg. */
export interface CentroResumen {
  centro: string;
  kg_cobrar: number;     // Kg Casiterita por Cobrar
  kg_disponible: number; // Kg Casiterita Disponibles Acopiados
  fuente?: FuenteExterna | null;        // si está, kg_disponible se trae en vivo y NO se edita
  fuente_cobrar?: FuenteExterna | null; // si está, kg_cobrar se trae en vivo y NO se edita
}

/**
 * Un SECTOR = bloque de filas (celdas combinadas de la hoja). Las 4 columnas de
 * la derecha llevan UN valor por bloque: Acopiados MGG (auto = Σ disponibles),
 * y resguardos GT / precio promedio / saldo $USD (que el usuario carga por bloque).
 */
export interface SectorResumen {
  nombre: string;
  centros: CentroResumen[];
  resguardos_gt: number; // Total Kg resguardos y Contratos GT (manual, solo si NO es bloque GT)
  precio_prom: number;   // Precio Promedio de Compra por Sector ($) (por bloque)
  saldo_usd: number;     // Saldo $USD por Sector (por bloque)
  es_gt?: boolean;       // bloque GT/resguardo: sus Disponibles van a Resguardos GT (autosuma), no a Acopiados MGG
  color?: string;        // color de banda del sector (visual)
  fuente_saldo?: FuenteExterna | null;  // si está, saldo_usd se trae en vivo y NO se edita
  fuente_precio?: FuenteExterna | null; // si está, precio_prom se trae en vivo y NO se edita
}

/** Métricas vinculables a nivel SECTOR (valores en $: saldo de caja, tasa del material).
 *  Disponibles para ESTE sistema (mgg) y para el externo (golden-touch). */
export const METRICAS_SECTOR: FuenteExterna[] = [
  { sistema: 'mgg', metrica: 'acopio_saldo_usd', label: 'Este sistema · Saldo de caja $USD (acopio LA ESPERANZA)' },
  { sistema: 'mgg', metrica: 'acopio_tasa_material', label: 'Este sistema · Tasa actual del material $/Kg (LA ESPERANZA)' },
  { sistema: 'mgg-centro-saldo', metrica: 'GLOBAL MINERAL TIN', label: 'Este sistema · Saldo de caja $USD (acopio GLOBAL MINERAL TIN)' },
  { sistema: 'mgg-centro-tasa', metrica: 'GLOBAL MINERAL TIN', label: 'Este sistema · Tasa actual del material $/Kg (GLOBAL MINERAL TIN)' },
  { sistema: 'mgg-centro-saldo', metrica: 'LA ESMERALDA ALI', label: 'Este sistema · Saldo de caja $USD (acopio LA ESMERALDA ALÍ)' },
  { sistema: 'mgg-centro-tasa', metrica: 'LA ESMERALDA ALI', label: 'Este sistema · Tasa actual del material $/Kg (LA ESMERALDA ALÍ)' },
  { sistema: 'mgg-centro-saldo', metrica: 'LOS PIJIGUAOS', label: 'Este sistema · Saldo de caja $USD (acopio LOS PIJIGUAOS)' },
  { sistema: 'mgg-centro-tasa', metrica: 'LOS PIJIGUAOS', label: 'Este sistema · Tasa actual del material $/Kg (LOS PIJIGUAOS)' },
  { sistema: 'golden-touch', metrica: 'acopio_saldo_usd', label: 'Golden Touch · Saldo de caja $USD (acopio)' },
  { sistema: 'golden-touch', metrica: 'acopio_tasa_material', label: 'Golden Touch · Tasa del material $/Kg (acopio)' },
];

/** Totales calculados (snapshot). El "acopiado MGG" total = suma de disponibles. */
export interface TotalesResumen {
  kg_cobrar: number;
  kg_disponible: number;
  kg_resguardos_gt: number;
  kg_acopiado_mgg: number;
  saldo_usd: number;
}

export interface ResumenSemanal {
  id: string;
  numero: string;
  titulo: string;
  periodo_desde: string | null;
  periodo_hasta: string | null;
  fecha: string;
  filas: SectorResumen[];
  totales: TotalesResumen;
  nota: string | null;
  created_by: string | null;
  actor_name: string | null;
  created_at: string;
}

export interface ResumenSemanalInput {
  titulo?: string;
  periodo_desde?: string | null;
  periodo_hasta?: string | null;
  fecha: string;
  filas: SectorResumen[];
  nota?: string | null;
}

/** Total acopiado MGG de un sector = suma de los Kg Disponibles de sus centros. */
export function totalAcopiadoSector(s: SectorResumen): number {
  return (s.centros ?? []).reduce((a, c) => a + (Number(c.kg_disponible) || 0), 0);
}

/** Total por cobrar de un sector = suma de los Kg por Cobrar de sus centros. */
export function totalCobrarSector(s: SectorResumen): number {
  return (s.centros ?? []).reduce((a, c) => a + (Number(c.kg_cobrar) || 0), 0);
}

/**
 * Detecta AUTOMÁTICAMENTE si un bloque es GT (resguardo/contrato) por su nombre:
 * GT/PERAMANAL, ESMERALDA o GLOBAL MINERAL TIN. Sus Disponibles autosuman a
 * «Resguardos y Contratos GT» y no a «Acopiados MGG». (Respeta `es_gt` si viene
 * marcado en un snapshot viejo.)
 */
export function esGt(s: SectorResumen): boolean {
  if (s.es_gt != null) return s.es_gt;
  return /\bGT\b|PERAMANAL|ESMERALDA|GLOBAL\s+MINERAL\s+TIN/i.test(s.nombre || '');
}

/** Acopiados por Sector MGG: 0 si el bloque es GT (sus Kg van a Resguardos). */
export function acopiadoMggSector(s: SectorResumen): number {
  return esGt(s) ? 0 : totalAcopiadoSector(s);
}

/** Resguardos y Contratos GT: si el bloque es GT, autosuma de sus Disponibles; si no, el valor cargado. */
export function resguardoSector(s: SectorResumen): number {
  return esGt(s) ? totalAcopiadoSector(s) : (Number(s.resguardos_gt) || 0);
}

/** Saldo $USD del bloque (valor único por sector). */
export function saldoSector(s: SectorResumen): number {
  return Number(s.saldo_usd) || 0;
}

/** Precio promedio de compra del bloque (valor único por sector). */
export function precioPromSector(s: SectorResumen): number {
  return Number(s.precio_prom) || 0;
}

/** Calcula los grandes totales del reporte a partir de los sectores. */
export function computeTotales(sectores: SectorResumen[]): TotalesResumen {
  return (sectores ?? []).reduce<TotalesResumen>(
    (a, s) => {
      a.kg_cobrar += totalCobrarSector(s);
      a.kg_disponible += totalAcopiadoSector(s);     // todos los disponibles (MGG + GT)
      a.kg_acopiado_mgg += acopiadoMggSector(s);     // solo bloques MGG
      a.kg_resguardos_gt += resguardoSector(s);      // bloques GT (autosuma) + manuales
      a.saldo_usd += Number(s.saldo_usd) || 0;
      return a;
    },
    { kg_cobrar: 0, kg_disponible: 0, kg_resguardos_gt: 0, kg_acopiado_mgg: 0, saldo_usd: 0 },
  );
}

const sector = (nombre: string, color: string, centros: string[]): SectorResumen => ({
  nombre,
  centros: centros.map((centro) => ({ centro, kg_cobrar: 0, kg_disponible: 0 })),
  resguardos_gt: 0, precio_prom: 0, saldo_usd: 0, color,
});


/** Sectores por defecto al abrir un reporte nuevo (según la hoja de referencia). */
export function sectoresPorDefecto(): SectorResumen[] {
  return [
    sector('SECTOR MGG · LOS PINOS', '#fde68a', [
      'C.A. LOS PINOS MGG',
      'MATERIAL DE FUNDICIÓN #1',
      'MATERIAL DE FUNDICIÓN #3',
      'MATERIAL DE FUNDICIÓN #4',
      'C.A. LOS PINOS - MERCANCÍA EN TRÁNSITO (EXPORTACIÓN #52)',
      'C.A. LOS PINOS - MERCANCÍA EN TRÁNSITO (EXPORTACIÓN #53)',
      'C.A. LOS PINOS - MERCANCÍA EN TRÁNSITO (EXPORTACIÓN #54)',
      'C.A. LOS PINOS - MERCANCÍA EN TRÁNSITO (EXPORTACIÓN #55)',
      'C.A. LOS PINOS RESGUARDOS - GT',
      'C.A. LOS PINOS RESGUARDOS - GMT',
    ]),
    sector('SECTOR LOS PIJIGUAOS', '#fbcfe8', [
      'C.A. LOS PIJIGUAOS - P-MGG04 - A HECTOR',
      'C.A. LOS PIJIGUAOS - P-MGG04 - B ALBERTO',
      'C.A. LOS PIJIGUAOS - P-MGG04 - C MAGUIBER',
    ]),
    sector('RESGUARDO LOS PIJIGUAOS', '#5eead4', [
      'C.A. LOS PIJIGUAOS - P-MGG01 - A CAMPOS YEPEZ (RESGUARDO LOS PIJIGUAOS)',
    ]),
    {
      nombre: 'SECTOR LA ESPERANZA', color: '#bfdbfe', resguardos_gt: 0, precio_prom: 0, saldo_usd: 0,
      // Saldo $USD y Precio Promedio del sector = Saldo de caja y Tasa del material del acopio de ESTE sistema.
      fuente_saldo: { sistema: 'mgg', metrica: 'acopio_saldo_usd', label: 'Este sistema · Saldo de caja $USD (acopio LA ESPERANZA)' },
      fuente_precio: { sistema: 'mgg', metrica: 'acopio_tasa_material', label: 'Este sistema · Tasa actual del material $/Kg (LA ESPERANZA)' },
      centros: [
        // El disponible de COMERCIALIZACIÓN = Saldo en Kg del acopio de ESTE sistema (LA ESPERANZA).
        { centro: 'C.A. LA ESPERANZA - P-MGG06 - A COMERCIALIZACIÓN', kg_cobrar: 0, kg_disponible: 0, fuente: { sistema: 'mgg', metrica: 'acopio_saldo_kg', label: 'Este sistema · Saldo en Kg (acopio LA ESPERANZA)' } },
        // JUAN BODEGA y ENDER MEJÍAS (aliados internos, en vivo): Disponibles = «Kg Recibidos por MGG»;
        // por Cobrar = «Saldo en Kg casiterita».
        { centro: 'C.A. LA ESPERANZA - P-MGG06-B JUAN BODEGA', kg_cobrar: 0, kg_disponible: 0, fuente: { sistema: 'mgg-aliado', metrica: ALIADO_JUAN_BODEGA, label: 'Aliado JUAN BODEGA · Kg Recibidos por MGG' }, fuente_cobrar: { sistema: 'mgg-aliado-saldokg', metrica: ALIADO_JUAN_BODEGA, label: 'Aliado JUAN BODEGA · Saldo en Kg casiterita' } },
        { centro: 'C.A. LA ESPERANZA - P-MGG06-C ROBERT BODEGA', kg_cobrar: 0, kg_disponible: 0 },
        { centro: 'C.A. LA ESPERANZA - P-MGG06-D ENDER MEJÍA', kg_cobrar: 0, kg_disponible: 0, fuente: { sistema: 'mgg-aliado', metrica: ALIADO_ENDER_MEJIAS, label: 'Aliado ENDER MEJÍAS · Kg Recibidos por MGG' }, fuente_cobrar: { sistema: 'mgg-aliado-saldokg', metrica: ALIADO_ENDER_MEJIAS, label: 'Aliado ENDER MEJÍAS · Saldo en Kg casiterita' } },
      ],
    },
    {
      nombre: 'SECTOR GT PERAMANAL', color: '#fde68a', resguardos_gt: 0, precio_prom: 0, saldo_usd: 0,
      // Saldo $USD y Precio Promedio del sector GT = Saldo de caja y Tasa del material del acopio EXTERNO (Golden Touch).
      fuente_saldo: { sistema: 'golden-touch', metrica: 'acopio_saldo_usd', label: 'Golden Touch · Saldo de caja $USD (acopio)' },
      fuente_precio: { sistema: 'golden-touch', metrica: 'acopio_tasa_material', label: 'Golden Touch · Tasa del material $/Kg (acopio)' },
      centros: [
        { centro: 'C.A. GT PERAMANAL - P-MGG09 - A.1 GT PERAMANAL (M)', kg_cobrar: 0, kg_disponible: 0 },
        // El disponible de este centro vive en Golden Touch (Saldo en Kg del acopio).
        { centro: 'C.A. GT PERAMANAL - P-MGG09 - A.2 GT PERAMANAL (P)', kg_cobrar: 0, kg_disponible: 0, fuente: { sistema: 'golden-touch', metrica: 'acopio_saldo_kg', label: 'Golden Touch · Saldo en Kg (acopio)' } },
      ],
    },
    sector('SECTOR LA ESMERALDA', '#fecaca', [
      'C.A. LA ESMERALDA - P-MGG10 - A ENDER MEJIA',
      'C.A. LA ESMERALDA - P-MGG10-B GUAIMA (MARTILLO ELECTRICO)',
      'C.A. LA ESMERALDA - P-MGG10-C JOSE MATO (MARTILLO ELECTRICO)',
      'C.A. LA ESMERALDA - P-MGG10-D GENESIS',
      'C.A. LA ESMERALDA - P-MGG10-E OMI LOPEZ',
      'C.A. LA ESMERALDA - P-MGG10-F ALEXIS NOGUERA',
    ]),
    {
      nombre: 'C.A. GLOBAL MINERAL TIN', color: '#bfdbfe', resguardos_gt: 0, precio_prom: 0, saldo_usd: 0,
      // GMT es un centro INTERNO con su propia caja (P-MGG08): Saldo $USD y Precio Promedio
      // del sector = Saldo de caja y Tasa del material de su caja en ESTE sistema.
      fuente_saldo: { sistema: 'mgg-centro-saldo', metrica: 'GLOBAL MINERAL TIN', label: 'Este sistema · Saldo de caja $USD (acopio GLOBAL MINERAL TIN)' },
      fuente_precio: { sistema: 'mgg-centro-tasa', metrica: 'GLOBAL MINERAL TIN', label: 'Este sistema · Tasa actual del material $/Kg (GLOBAL MINERAL TIN)' },
      centros: [
        // El disponible de GUANERGE = Saldo en Kg de la caja GMT (en vivo).
        { centro: 'C.A. GLOBAL MINERAL TIN - P-MGG08-A GUANERGE', kg_cobrar: 0, kg_disponible: 0, fuente: { sistema: 'mgg-centro-saldokg', metrica: 'GLOBAL MINERAL TIN', label: 'Este sistema · Saldo en Kg (acopio GLOBAL MINERAL TIN)' } },
      ],
    },
    {
      nombre: 'C.A. LA ESMERALDA (ALÍ)', color: '#fecaca', resguardos_gt: 0, precio_prom: 0, saldo_usd: 0,
      // Centro INTERNO con caja propia en ESTE sistema: Saldo $USD y Precio Promedio
      // del sector = Saldo de caja y Tasa del material de la caja LA ESMERALDA ALI.
      fuente_saldo: { sistema: 'mgg-centro-saldo', metrica: 'LA ESMERALDA ALI', label: 'Este sistema · Saldo de caja $USD (acopio LA ESMERALDA ALÍ)' },
      fuente_precio: { sistema: 'mgg-centro-tasa', metrica: 'LA ESMERALDA ALI', label: 'Este sistema · Tasa actual del material $/Kg (LA ESMERALDA ALÍ)' },
      centros: [
        // El disponible de ALÍ = Saldo en Kg de la caja LA ESMERALDA ALI (en vivo).
        { centro: 'C.A. LA ESMERALDA ALÍ - P-MGG12 - A ALÍ TORREALBA', kg_cobrar: 0, kg_disponible: 0, fuente: { sistema: 'mgg-centro-saldokg', metrica: 'LA ESMERALDA ALI', label: 'Este sistema · Saldo en Kg (acopio LA ESMERALDA ALÍ)' } },
      ],
    },
    {
      nombre: 'C.A. LOS PIJIGUAOS', color: '#bbf7d0', resguardos_gt: 0, precio_prom: 0, saldo_usd: 0,
      // Centro INTERNO con caja propia: Saldo $USD y Precio Promedio del sector =
      // Saldo de caja y Tasa del material de la caja LOS PIJIGUAOS (en vivo).
      fuente_saldo: { sistema: 'mgg-centro-saldo', metrica: 'LOS PIJIGUAOS', label: 'Este sistema · Saldo de caja $USD (acopio LOS PIJIGUAOS)' },
      fuente_precio: { sistema: 'mgg-centro-tasa', metrica: 'LOS PIJIGUAOS', label: 'Este sistema · Tasa actual del material $/Kg (LOS PIJIGUAOS)' },
      centros: [
        // Disponibles Acopiados del centro = Saldo en Kg de la caja LOS PIJIGUAOS (en vivo).
        { centro: 'C.A. LOS PIJIGUAOS - P-MGG04 ACOPIADO (CAJA)', kg_cobrar: 0, kg_disponible: 0,
          fuente: { sistema: 'mgg-centro-saldokg', metrica: 'LOS PIJIGUAOS', label: 'Este sistema · Saldo en Kg (acopio LOS PIJIGUAOS)' } },
        // Disponible de cada aliado = «Kg Recibidos por MGG»; por Cobrar = «Saldo en Kg casiterita».
        { centro: 'C.A. LOS PIJIGUAOS - P-MGG04-B ALBERTO', kg_cobrar: 0, kg_disponible: 0,
          fuente: { sistema: 'mgg-aliado', metrica: ALIADO_PIJ_ALBERTO, label: 'Aliado ALBERTO · Kg Recibidos por MGG' },
          fuente_cobrar: { sistema: 'mgg-aliado-saldokg', metrica: ALIADO_PIJ_ALBERTO, label: 'Aliado ALBERTO · Saldo en Kg casiterita' } },
        { centro: 'C.A. LOS PIJIGUAOS - P-MGG04-B ALBERTO MINA 40', kg_cobrar: 0, kg_disponible: 0,
          fuente: { sistema: 'mgg-aliado', metrica: ALIADO_PIJ_ALBERTO_MINA40, label: 'Aliado ALBERTO MINA 40 · Kg Recibidos por MGG' },
          fuente_cobrar: { sistema: 'mgg-aliado-saldokg', metrica: ALIADO_PIJ_ALBERTO_MINA40, label: 'Aliado ALBERTO MINA 40 · Saldo en Kg casiterita' } },
        { centro: 'C.A. LOS PIJIGUAOS - P-MGG04-C MAGUIBER', kg_cobrar: 0, kg_disponible: 0,
          fuente: { sistema: 'mgg-aliado', metrica: ALIADO_PIJ_MAGUIBER, label: 'Aliado MAGUIBER · Kg Recibidos por MGG' },
          fuente_cobrar: { sistema: 'mgg-aliado-saldokg', metrica: ALIADO_PIJ_MAGUIBER, label: 'Aliado MAGUIBER · Saldo en Kg casiterita' } },
      ],
    },
    sector('C.A. EL BURRO', '#bbf7d0', [
      'C.A. P-MGG11- A EL BURRO - PIJIGUAOS - PARGUAZA',
    ]),
  ];
}

/** Próximo correlativo RS-AAAA-NNNN (por año). */
async function nextNumero(fecha: string): Promise<string> {
  const year = (fecha || '').slice(0, 4) || String(new Date().getFullYear());
  const { data, error } = await supabase.from(TABLE).select('numero').like('numero', `RS-${year}-%`);
  if (error) throw error;
  let max = 0;
  (data ?? []).forEach((r) => {
    const m = String((r as { numero: string }).numero).match(/-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `RS-${year}-${String(max + 1).padStart(4, '0')}`;
}

export async function listResumenes(): Promise<ResumenSemanal[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ResumenSemanal[];
}

/** Archiva un reporte a histórico (snapshot inmutable de la semana). */
export async function crearResumen(input: ResumenSemanalInput, actor: string, actorName: string | null): Promise<ResumenSemanal> {
  const numero = await nextNumero(input.fecha);
  const totales = computeTotales(input.filas);
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      numero,
      titulo: input.titulo?.trim() || 'REPORTE PRELIMINAR DE CENTROS DE ACOPIOS',
      periodo_desde: input.periodo_desde || null,
      periodo_hasta: input.periodo_hasta || null,
      fecha: input.fecha,
      filas: input.filas,
      totales,
      nota: input.nota?.trim() || null,
      created_by: actor,
      actor_name: actorName,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as ResumenSemanal;
}

export async function eliminarResumen(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
}
