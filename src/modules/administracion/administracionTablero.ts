/* ============================================================================
   Golden Touch · Administración · tablero (datos puros)
   De los gastos fijos arma los KPIs y los datasets de los gráficos del panel.
   Normaliza cada gasto a su equivalente MENSUAL (monto ÷ meses del período) y
   reutiliza administracionCalculo (agruparTotales, proximoVencimiento). Puro.
   ============================================================================ */
import {
  MESES_PERIODO, agruparTotales, proximoVencimiento, totalGeneral,
  type GrupoTotal, type Moneda, type MovimientoCalc, type Periodicidad,
} from './administracionCalculo';
import type { Empresa, GastoFijo } from './admin.repository';

export interface GastoTablero {
  empresaClave: string;
  concepto: string;
  /** Razón social o la clave; es lo que se muestra en el gráfico por empresa. */
  empresaNombre: string;
  /** Nombre de categoría ya resuelto (o 'Sin categoría'). */
  categoria: string;
  monto: number;
  moneda: Moneda;
  periodicidad: Periodicidad;
  diaVencimiento?: number | null;
  vigenteDesde: string | Date;
  estado: 'activo' | 'suspendido';
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const activos = (gs: readonly GastoTablero[]) => gs.filter((g) => g.estado === 'activo');
/** Monto equivalente por mes. */
const porMes = (g: GastoTablero) => g.monto / MESES_PERIODO[g.periodicidad];
/** A USD equivalente (tasa = Bs por USD). */
const aUsd = (monto: number, moneda: Moneda, tasa: number) => (moneda === 'USD' ? monto : tasa > 0 ? monto / tasa : 0);

const movMensual = (g: GastoTablero): MovimientoCalc => ({
  empresaClave: g.empresaNombre, categoria: g.categoria, moneda: g.moneda, monto: porMes(g),
});

export interface KpisTablero {
  /** Gasto fijo equivalente por mes (activos). */
  gastoMes: Omit<GrupoTotal, 'clave'>;
  /** Vencen dentro de `dias` (activos): cantidad y monto equivalente en USD. */
  venceEn: { dias: number; n: number; equivUsd: number };
  /** Cuyo próximo vencimiento cae en el mes de hoy (activos). */
  esteMes: { n: number; equivUsd: number };
  activos: { activos: number; total: number };
}

export function kpisTablero(gastos: readonly GastoTablero[], tasa: number, hoy: Date = new Date(), dias = 7): KpisTablero {
  const act = activos(gastos);
  const gastoMes = totalGeneral(act.map(movMensual), tasa);

  const limite = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + dias);
  let venceN = 0; let venceUsd = 0; let mesN = 0; let mesUsd = 0;
  for (const g of act) {
    const venc = proximoVencimiento(g, hoy);
    const usd = aUsd(g.monto, g.moneda, tasa);
    if (venc.getTime() <= limite.getTime()) { venceN += 1; venceUsd += usd; }
    if (venc.getFullYear() === hoy.getFullYear() && venc.getMonth() === hoy.getMonth()) { mesN += 1; mesUsd += usd; }
  }
  return {
    gastoMes,
    venceEn: { dias, n: venceN, equivUsd: r2(venceUsd) },
    esteMes: { n: mesN, equivUsd: r2(mesUsd) },
    activos: { activos: act.length, total: gastos.length },
  };
}

/** Gasto mensual-equivalente por categoría (activos), de mayor a menor + su % del total. */
export function donutCategoria(gastos: readonly GastoTablero[], tasa: number): (GrupoTotal & { pct: number })[] {
  const grupos = agruparTotales(activos(gastos).map(movMensual), 'categoria', { tasa });
  const total = grupos.reduce((s, g) => s + g.equivUsd, 0);
  return grupos.map((g) => ({ ...g, pct: total > 0 ? r2((g.equivUsd / total) * 100) : 0 }));
}

/** Gasto mensual-equivalente por empresa (activos), de mayor a menor. */
export function barrasEmpresa(gastos: readonly GastoTablero[], tasa: number): GrupoTotal[] {
  return agruparTotales(activos(gastos).map(movMensual), 'empresa', { tasa });
}

/** Mapea los gastos del repo a las filas del tablero (resuelve empresa y categoría). */
export function filasTablero(gastos: readonly GastoFijo[], empresas: readonly Empresa[], nombreCat: Map<string, string>): GastoTablero[] {
  const nombreEmp = new Map(empresas.map((e) => [e.clave, e.nombre]));
  return gastos.map((g) => ({
    empresaClave: g.empresaClave,
    concepto: g.concepto,
    empresaNombre: nombreEmp.get(g.empresaClave) ?? g.empresaClave,
    categoria: g.categoriaGastoId ? nombreCat.get(g.categoriaGastoId) ?? 'Sin categoría' : 'Sin categoría',
    monto: g.monto, moneda: g.moneda, periodicidad: g.periodicidad,
    diaVencimiento: g.diaVencimiento, vigenteDesde: g.vigenteDesde, estado: g.estado,
  }));
}
