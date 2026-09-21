/* ============================================================
   MGG · Cocina · Control de distribución (modelo EOQ)

   Réplica del formato «SISTEMA DE CONTROL DE CONSUMO & MODELO EOQ» que se
   llevaba en Excel para el pollo, aplicado a TODOS los víveres del mercado.

   Por cada víver y por cada día/turno del ciclo:
     Inv. Inicial + Entradas − Salidas (consumo) = Inv. Final Teórico
     Inv. Físico Real = Teórico − mermas del día (salidas que no son comida)
     Diferencia / Merma = Físico − Teórico  (negativa = faltó)
     Ratio = Salidas ÷ Comensales del día
   Y el lote óptimo de compra:
     D  = consumo promedio diario × 365   (demanda anual estimada)
     Q* = √(2·D·S ÷ H)                    (lote óptimo, EOQ)
     ROP = (D ÷ 365) × L                  (punto de reorden)
     Ciclo = Q* ÷ D × 365 días · Frecuencia = D ÷ Q* órdenes/año
   S (costo de emitir una orden), H (costo de almacenar una unidad al año) y
   L (días de entrega) se configuran por cocina.

   Todo sale del resumen del mercado que ya calcula `mercados.repository`: no
   se consulta nada nuevo ni se guarda otro libro.
   ============================================================ */
import type { KardexRow, DisponibleItem } from './mercados.repository';

export type EstadoStock = 'NORMAL' | 'ALERTA' | 'REORDENAR';

/** Parámetros del modelo, por cocina. */
export interface ParametrosEoq {
  /** S · costo de emitir una orden ($). */
  costoOrden: number;
  /** H · costo de almacenar una unidad durante un año ($/unidad·año). */
  costoAlmacenar: number;
  /** L · tiempo de entrega del proveedor, en días. */
  leadTimeDias: number;
}

export const PARAMETROS_EOQ_DEFECTO: ParametrosEoq = { costoOrden: 3.33, costoAlmacenar: 1.2, leadTimeDias: 2 };

/** Un renglón del registro diario, como en la planilla. */
export interface FilaDistribucion {
  fecha: string;          // YYYY-MM-DD
  turno: string;          // Desayuno · Almuerzo · Cena (o «—» si solo hubo movimientos)
  invInicial: number;
  entradas: number;       // compras + traslados recibidos
  salidas: number;        // consumo de las comidas
  teorico: number;        // invInicial + entradas − salidas
  mermas: number;         // pérdidas / salidas manuales / ajustes del día
  fisico: number;         // teorico − mermas
  diferencia: number;     // fisico − teorico (negativa = faltante)
  comensales: number;
  ratio: number;          // salidas ÷ comensales
  estado: EstadoStock;
}

/** Cierre del víver: KPIs + modelo EOQ, para la tabla de todo el mercado. */
export interface ResumenDistribucion {
  producto_id: string; sku: string; nombre: string; unidad: string;
  stock: number;             // lo que queda hoy
  consumoTotal: number;
  diasConConsumo: number;
  promedioDia: number;
  comensales: number;
  ratioPromedio: number;     // consumo total ÷ comensales del ciclo
  mermas: number;
  demandaAnual: number;      // D
  eoq: number;               // Q*
  puntoReorden: number;      // ROP
  cicloDias: number;
  frecuenciaAnual: number;
  estado: EstadoStock;
  filas: FilaDistribucion[];
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
/** El ratio va con 4 decimales: con 2 un consumo chico por comensal se redondea a cero. */
const r4 = (n: number) => Math.round((Number(n) || 0) * 10000) / 10000;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const dia = (at: string) => String(at ?? '').slice(0, 10);

/** Q* = √(2·D·S ÷ H), redondeado hacia arriba. Sin demanda o sin costo de almacenar no hay lote. */
export function loteOptimo(demandaAnual: number, p: ParametrosEoq): number {
  const D = num(demandaAnual), S = num(p.costoOrden), H = num(p.costoAlmacenar);
  if (D <= 0 || S <= 0 || H <= 0) return 0;
  return Math.ceil(Math.sqrt((2 * D * S) / H));
}

/** ROP = consumo de los días que tarda en llegar el pedido, redondeado hacia arriba. */
export function puntoReorden(demandaAnual: number, p: ParametrosEoq): number {
  const D = num(demandaAnual), L = num(p.leadTimeDias);
  if (D <= 0 || L <= 0) return 0;
  return Math.ceil((D / 365) * L);
}

/** Cada cuántos días toca pedir el lote óptimo. */
export function cicloDias(eoq: number, demandaAnual: number): number {
  const D = num(demandaAnual);
  return D > 0 ? Math.round((num(eoq) / D) * 365) : 0;
}

/** Cuántas órdenes al año salen con ese lote. */
export function frecuenciaAnual(eoq: number, demandaAnual: number): number {
  const Q = num(eoq);
  return Q > 0 ? r2(num(demandaAnual) / Q) : 0;
}

/**
 * Semáforo del stock: REORDENAR cuando ya está en el punto de reorden o por
 * debajo; ALERTA cuando le falta poco (hasta una vez y media el punto). Sin
 * punto de reorden (víver que no se consume) siempre es NORMAL.
 */
export function estadoStock(stock: number, rop: number): EstadoStock {
  const s = num(stock), r = num(rop);
  if (r <= 0) return 'NORMAL';
  if (s <= r) return 'REORDENAR';
  if (s <= r * 1.5) return 'ALERTA';
  return 'NORMAL';
}

export function etiquetaEstado(e: EstadoStock): string {
  return e === 'REORDENAR' ? '🚨 REORDENAR' : e === 'ALERTA' ? '⚠️ ALERTA' : '✅ NORMAL';
}

/** Movimientos de un día, ya separados por tipo. */
interface DiaViver { entradas: number; mermas: number; porTurno: Map<string, { salidas: number; comensales: number }>; }

/**
 * Arma el registro diario de CADA víver del mercado y su modelo EOQ.
 * `dias` es la cantidad de días del ciclo ya transcurridos: con ella se saca el
 * promedio diario (el Excel divide entre los días registrados, no entre 21).
 */
export function distribucionPorViver(
  disponible: DisponibleItem[],
  kardex: KardexRow[],
  p: ParametrosEoq,
): ResumenDistribucion[] {
  // 1) Movimientos por víver y por día.
  const porViver = new Map<string, Map<string, DiaViver>>();
  const dias = (id: string) => {
    let m = porViver.get(id);
    if (!m) { m = new Map(); porViver.set(id, m); }
    return m;
  };
  const delDia = (id: string, f: string) => {
    const m = dias(id);
    let d = m.get(f);
    if (!d) { d = { entradas: 0, mermas: 0, porTurno: new Map() }; m.set(f, d); }
    return d;
  };
  // Comensales del día: se cuentan UNA vez por comida, aunque la comida use 10 víveres.
  const comensalesDia = new Map<string, Map<string, number>>();

  for (const k of kardex) {
    if (k.kind === 'entrada') {
      delDia(k.producto_id, dia(k.at)).entradas += num(k.cantidad);
    } else if (k.kind === 'traslado') {
      // Con signo: lo recibido suma como entrada; lo enviado sale como merma del centro.
      const c = num(k.cantidad);
      const d = delDia(k.producto_id, dia(k.at));
      if (c >= 0) d.entradas += c; else d.mermas += -c;
    } else if (k.kind === 'merma') {
      delDia(k.producto_id, dia(k.at)).mermas += num(k.cantidad);
    } else if (k.kind === 'consumo') {
      const f = dia(k.at);
      const turno = String(k.comida?.tipo_comida ?? '—');
      const platos = num(k.comida?.platos);
      const porTurno = comensalesDia.get(f) ?? new Map<string, number>();
      porTurno.set(turno, (porTurno.get(turno) ?? 0) + platos);
      comensalesDia.set(f, porTurno);
      for (const it of k.comida?.items ?? []) {
        const id = String((it as { producto_id?: string }).producto_id ?? '');
        if (!id) continue;
        const d = delDia(id, f);
        const t = d.porTurno.get(turno) ?? { salidas: 0, comensales: 0 };
        t.salidas += num((it as { cantidad?: number }).cantidad);
        d.porTurno.set(turno, t);
      }
    }
  }

  // 2) Una tabla por víver, en orden de fecha y turno.
  return disponible.map((v) => {
    const mapaDias = porViver.get(v.producto_id) ?? new Map<string, DiaViver>();
    const fechas = [...mapaDias.keys()].sort();
    let saldo = num(v.saldoInicial);
    const filas: FilaDistribucion[] = [];
    let consumoTotal = 0, mermasTotal = 0, comensalesTotal = 0, diasConConsumo = 0;

    for (const f of fechas) {
      const d = mapaDias.get(f)!;
      const turnos = [...d.porTurno.keys()];
      // Las entradas y las mermas del día se cargan en el primer renglón del día.
      const filasDia = turnos.length ? turnos : ['—'];
      let consumoDelDia = 0;
      filasDia.forEach((turno, i) => {
        const salidas = r2(d.porTurno.get(turno)?.salidas ?? 0);
        const entradas = i === 0 ? r2(d.entradas) : 0;
        const mermas = i === 0 ? r2(d.mermas) : 0;
        const invInicial = r2(saldo);
        const teorico = r2(invInicial + entradas - salidas);
        const fisico = r2(teorico - mermas);
        const comensales = num(comensalesDia.get(f)?.get(turno));
        filas.push({
          fecha: f, turno, invInicial, entradas, salidas, teorico, mermas, fisico,
          diferencia: r2(fisico - teorico),
          comensales,
          ratio: comensales > 0 ? r4(salidas / comensales) : 0,
          estado: 'NORMAL', // se completa abajo, con el ROP ya calculado
        });
        saldo = fisico;
        consumoDelDia += salidas;
        consumoTotal += salidas;
        mermasTotal += mermas;
        comensalesTotal += comensales;
      });
      if (consumoDelDia > 0) diasConConsumo += 1;
    }

    const promedioDia = diasConConsumo > 0 ? r2(consumoTotal / diasConConsumo) : 0;
    const demandaAnual = Math.round(promedioDia * 365);
    const eoq = loteOptimo(demandaAnual, p);
    const rop = puntoReorden(demandaAnual, p);
    const stock = r2(v.queda);
    for (const f of filas) f.estado = estadoStock(f.fisico, rop);

    return {
      producto_id: v.producto_id, sku: v.sku, nombre: v.nombre, unidad: v.unidad,
      stock,
      consumoTotal: r2(consumoTotal),
      diasConConsumo,
      promedioDia,
      comensales: comensalesTotal,
      ratioPromedio: comensalesTotal > 0 ? r4(consumoTotal / comensalesTotal) : 0,
      mermas: r2(mermasTotal),
      demandaAnual,
      eoq,
      puntoReorden: rop,
      cicloDias: cicloDias(eoq, demandaAnual),
      frecuenciaAnual: frecuenciaAnual(eoq, demandaAnual),
      estado: estadoStock(stock, rop),
      filas,
    };
  });
}

/** Totales de la vista: cuántos víveres hay que reponer y cuántos están en alerta. */
export function totalesDistribucion(items: ResumenDistribucion[]) {
  return {
    viveres: items.length,
    reordenar: items.filter((i) => i.estado === 'REORDENAR').length,
    alerta: items.filter((i) => i.estado === 'ALERTA').length,
    consumoTotal: r2(items.reduce((a, i) => a + i.consumoTotal, 0)),
    mermas: r2(items.reduce((a, i) => a + i.mermas, 0)),
  };
}
