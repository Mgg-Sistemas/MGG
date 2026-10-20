/* ============================================================
   MGG · Retenciones v8 · El TXT del IVA desde el libro (lógica pura)

   La maqueta (v7-4-pantallas.js, R2-11, y v8-12 §4) lo abre desde cada
   período de IVA; aquí sale del Libro y de Reportes con el período elegido.
   Las líneas las arma logica/txtIva.ts (16 columnas). Este archivo elige las
   retenciones del período y las pasa a FilaTxt:
   - el período es el de la retención (aaaamm) y su quincena, si la tiene;
   - los montos van en bolívares: las de $ se pasan con su tasa;
   - el monto del documento es base + IVA: la retención no guarda el exento
     ni el total de la factura, así que el exento va en 0;
   - hoy no hay notas de crédito en la base (paquete 07): todo va como 01.
   El formato está sin cotejar con un TXT real: la pantalla lo dice.
   ============================================================ */
import type { RetencionPracticada } from '../datos/puerta';
import type { FilaTxt, LineaTxt } from '../logica/txtIva';

export interface PeriodoTxt { clave: string; periodo: string; quincena: 1 | 2 | null; texto: string }

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const r2 = (n: number) => Math.round(n * 100) / 100;
const delIva = (r: RetencionPracticada) => r.tipo === 'iva' && r.direccion === 'practicada';
const enPeriodo = (r: RetencionPracticada, p: Pick<PeriodoTxt, 'periodo' | 'quincena'>) => r.periodo === p.periodo && (p.quincena == null || r.quincena === p.quincena);

/** Como la maqueta (nombrePeriodo): «1.ª quincena de octubre de 2026» o «Octubre de 2026». */
export function nombrePeriodoTxt(p: Pick<PeriodoTxt, 'periodo' | 'quincena'>): string {
  const mes = MESES[Number(p.periodo.slice(4, 6)) - 1] ?? '—', anio = p.periodo.slice(0, 4);
  return p.quincena ? `${p.quincena}.ª quincena de ${mes} de ${anio}` : `${mes[0].toUpperCase()}${mes.slice(1)} de ${anio}`;
}

export function periodosTxt(libro: readonly RetencionPracticada[]): PeriodoTxt[] {
  const vistos = new Map<string, PeriodoTxt>();
  for (const r of libro) {
    if (!delIva(r) || !/^\d{6}$/.test(r.periodo)) continue;
    const clave = r.quincena ? `${r.periodo}-${r.quincena}` : r.periodo;
    if (!vistos.has(clave)) vistos.set(clave, { clave, periodo: r.periodo, quincena: r.quincena, texto: nombrePeriodoTxt(r) });
  }
  return [...vistos.values()].sort((a, b) => b.clave.localeCompare(a.clave));
}

export function filasTxtDe(libro: readonly RetencionPracticada[], p: Pick<PeriodoTxt, 'periodo' | 'quincena'>): FilaTxt[] {
  return libro.filter((r) => delIva(r) && enPeriodo(r, p)).map((r) => {
    const t = r.moneda === 'USD' ? (r.tasa ?? 1) : 1;
    const base = r2(r.baseImponible * t), impuesto = r2(r.impuesto * t);
    return {
      fecha: (r.facturaFecha ?? r.createdAt).slice(0, 10), rifProveedor: r.contraparteRif ?? '', factura: r.facturaNumero ?? '', control: r.facturaControl ?? '',
      total: r2(base + impuesto), base, impuesto, retenido: r2(r.montoRetenido * t), exento: 0, comprobante: r.numeroComprobante ?? '',
      tipoDoc: 'FC', facturaAfectada: null, anulada: r.anulada,
    };
  });
}

/** Cuántas del período están en $ sin tasa (no se pueden pasar a Bs). */
export function sinTasaTxt(libro: readonly RetencionPracticada[], p: Pick<PeriodoTxt, 'periodo' | 'quincena'>): number {
  return libro.filter((r) => delIva(r) && enPeriodo(r, p) && !r.anulada && r.moneda === 'USD' && !r.tasa).length;
}

/** La vista previa: ⇥ en lugar del tabulador. */
export function vistaPreviaTxt(lineas: readonly LineaTxt[], tabuladorFinal: boolean): string {
  return lineas.map((l) => l.join('⇥') + (tabuladorFinal ? '⇥' : '')).join('\n');
}

export const MARCA_SIN_COTEJAR = 'Formato sin cotejar con un TXT real: se valida con el portal antes de usarlo.';
