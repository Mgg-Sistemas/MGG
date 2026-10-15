/* ============================================================
   MGG · Tesorería · Pagar nómina: buscador y pago por lote (15-10-2026)

   Orden de la administradora: en «Pagar nómina» hay un buscador y se puede
   pagar POR LOTE marcando renglones (todos / ninguno). Acá viven las piezas
   puras (filtro, totales del lote) para que se prueben sin pantalla.
   ============================================================ */
import type { NominaRenglon } from '@/shared/lib/types';
import { labelMotivoNomina } from '@/modules/rrhh/nomina.repository';
import { aBs, round2 } from './tasas.repository';

function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Filtra la cola por lo que se escribe: nombre, cargo, departamento, código de
 * la nómina o motivo (sueldo / vacaciones / liquidación). Sin acentos ni
 * mayúsculas; varias palabras = todas tienen que aparecer.
 */
export function filtrarRenglonesNomina(rows: NominaRenglon[], q: string): NominaRenglon[] {
  const palabras = sinAcentos(q.trim()).split(/\s+/).filter(Boolean);
  if (!palabras.length) return rows;
  return rows.filter((r) => {
    const texto = sinAcentos([
      r.nombre, r.cargo ?? '', r.departamento ?? '', r.periodo?.codigo ?? '', labelMotivoNomina(r.periodo?.tipo),
    ].join(' '));
    return palabras.every((p) => texto.includes(p));
  });
}

export interface LineaLote {
  renglon: NominaRenglon;
  /** Neto del renglón en USD (lo que RRHH calculó). */
  netoUsd: number;
  /** Lo que sale de la caja, en la moneda elegida (USD directo; Bs a la tasa). */
  monto: number;
}

/**
 * Arma el lote: un monto por renglón en la moneda de la caja. En Bs se
 * convierte cada neto a la tasa BCV (sin tasa no hay lote en Bs). Devuelve
 * también el total, que es lo que se compara contra el disponible.
 */
export function armarLote(rows: NominaRenglon[], moneda: string, tasa: number): { lineas: LineaLote[]; total: number } {
  const lineas: LineaLote[] = rows.map((r) => {
    const netoUsd = round2(Number(r.neto_usd) || 0);
    const monto = moneda === 'Bs' ? (tasa > 0 ? aBs(netoUsd, tasa) : 0) : netoUsd;
    return { renglon: r, netoUsd, monto: round2(monto) };
  });
  return { lineas, total: round2(lineas.reduce((a, l) => a + l.monto, 0)) };
}

/** Alterna un id en el conjunto de seleccionados (devuelve un conjunto nuevo). */
export function alternarSeleccion(sel: Set<string>, id: string): Set<string> {
  const s = new Set(sel);
  if (s.has(id)) s.delete(id); else s.add(id);
  return s;
}

/**
 * «Marcar todos» marca los VISIBLES (lo que dejó el buscador) sin tocar lo
 * que ya estaba marcado fuera del filtro; «desmarcar todos» los quita.
 */
export function seleccionarVisibles(sel: Set<string>, visibles: NominaRenglon[], marcar: boolean): Set<string> {
  const s = new Set(sel);
  for (const r of visibles) { if (marcar) s.add(r.id); else s.delete(r.id); }
  return s;
}

/** Limpia de la selección los ids que ya no están en la cola (se pagaron o se fueron). */
export function podarSeleccion(sel: Set<string>, rows: NominaRenglon[]): Set<string> {
  const vivos = new Set(rows.map((r) => r.id));
  const s = new Set<string>();
  for (const id of sel) if (vivos.has(id)) s.add(id);
  return s;
}
