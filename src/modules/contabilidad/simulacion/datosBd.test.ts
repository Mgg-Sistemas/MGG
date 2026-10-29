/* ============================================================
   Prueba ORÁCULO: el motor de reglas, a partir de los 1.410 hechos del
   Carril BD, produce EXACTAMENTE los 1.419 comprobantes esperados.

   · Huella: la forma canónica de lo generado tiene que dar la misma
     sha256 que la de los esperados (calculada por el conversor y
     guardada en bd.json). Se prueba que la huella PUEDE fallar.
   · Control: comprobantes por mes y tipo, totales por mes y balance por
     cuenta al cierre de cada mes, solo con los contabilizados.
   · Uno por uno, contra contabilidad-comprobantes-esperados.json, si
     docs/ está en la máquina (no viaja con el repo). Si no está, la
     prueba se SALTA y lo avisa: no pasa en silencio.
   ============================================================ */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { balanceComprobacion } from '../logica/reportes';
import { lineasContabilizadas, saldosPorCuenta } from '../logica/saldos';
import { formaCanonica } from '../pruebas/huella';
import { crearRepositorio } from '../contabilidad.repository';
import { AlmacenSimulado } from './almacen';
import { armarEstado, type DatosBd } from './datosBd';
import bdCrudo from './datos/bd.json';

const bd = bdCrudo as unknown as DatosBd;
const estado = armarEstado(bd);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('oráculo · los comprobantes generados son los esperados', () => {
  it('genera la misma cantidad de comprobantes', () => {
    expect(estado.cont_comprobantes).toHaveLength(bd.meta.oraculo.comprobantes);
  });

  it('la huella de lo generado es la de los esperados', () => {
    expect(sha(formaCanonica(estado))).toBe(bd.meta.oraculo.huella);
  });

  it('la huella PUEDE fallar: un solo centavo de diferencia la cambia', () => {
    const alterado = armarEstado(bd);
    alterado.cont_comprobante_lineas[100].debe_ves += 0.01;
    expect(sha(formaCanonica(alterado))).not.toBe(bd.meta.oraculo.huella);
    const otraDescripcion = armarEstado(bd);
    otraDescripcion.cont_comprobantes[5].concepto += ' ';
    expect(sha(formaCanonica(otraDescripcion))).not.toBe(bd.meta.oraculo.huella);
  });
});

describe('el camino de la app: almacén por defecto con import() dinámico', () => {
  it('el repositorio lee los 1.419 comprobantes y la compañía de BD', async () => {
    const repo = crearRepositorio(new AlmacenSimulado(null));
    expect(await repo.listComprobantes()).toHaveLength(bd.meta.oraculo.comprobantes);
    expect((await repo.getParametros()).empresa_nombre).toBe('Minera Ejemplo, C.A. (datos ficticios)');
    expect((await repo.listCuentas()).length).toBe(bd.cuentas.length);
  });
});

describe('oráculo · control del Carril BD', () => {
  const tipo = new Map(estado.cont_tipos_comprobante.map((t) => [t.id, t.codigo]));
  const periodo = new Map(estado.cont_periodos.map((p) => [p.id, p]));

  it('comprobantes por mes y tipo', () => {
    const cuenta: Record<string, Record<string, number>> = {};
    for (const c of estado.cont_comprobantes) {
      const p = periodo.get(c.periodo_id)!.codigo;
      const t = tipo.get(c.tipo_id)!;
      (cuenta[p] ??= {})[t] = (cuenta[p][t] ?? 0) + 1;
    }
    expect(cuenta).toEqual(bd.control.comprobantes_por_mes_y_tipo);
  });

  it('totales por mes (todos los comprobantes; septiembre trae el descuadrado a propósito)', () => {
    for (const [mes, esperado] of Object.entries(bd.control.totales_por_mes)) {
      const delMes = estado.cont_comprobantes.filter((c) => periodo.get(c.periodo_id)!.codigo === mes);
      const suma = (k: 'total_debe_ves' | 'total_haber_ves' | 'total_debe_usd' | 'total_haber_usd') =>
        (delMes.reduce((a, c) => a + Math.round(c[k] * 100), 0) / 100).toFixed(2);
      for (const k of ['total_debe_ves', 'total_haber_ves', 'total_debe_usd', 'total_haber_usd'] as const) {
        expect(suma(k), `${mes} ${k}`).toBe(Number(esperado[k]).toFixed(2));
      }
    }
  });

  it('balance por cuenta al cierre de cada mes, solo con los contabilizados, y suma cero', () => {
    const codigo = new Map(estado.cont_cuentas.map((c) => [c.id, c.codigo]));
    for (const [mes, esperado] of Object.entries(bd.control.balance_por_mes)) {
      const fin = estado.cont_periodos.find((p) => p.codigo === mes)!.fecha_fin;
      const saldos = saldosPorCuenta(lineasContabilizadas(estado.cont_comprobantes, estado.cont_comprobante_lineas, fin));
      const obtenido: Record<string, { saldo_ves: string; saldo_usd: string }> = {};
      let cero = 0;
      for (const [id, s] of saldos) {
        cero += Math.round(s.saldo_ves * 100);
        if (s.saldo_ves !== 0 || s.saldo_usd !== 0) obtenido[codigo.get(id)!] = { saldo_ves: s.saldo_ves.toFixed(2), saldo_usd: s.saldo_usd.toFixed(2) };
      }
      const normal = Object.fromEntries(Object.entries(esperado)
        .filter(([, v]) => Number(v.saldo_ves) !== 0 || Number(v.saldo_usd) !== 0)
        .map(([k, v]) => [k, { saldo_ves: Number(v.saldo_ves).toFixed(2), saldo_usd: Number(v.saldo_usd).toFixed(2) }]));
      expect(obtenido, mes).toEqual(normal);
      expect(cero, `${mes}: el balance suma cero en Bs`).toBe(0);
    }
  });

  it('el Balance de Comprobación al cierre de cada mes coincide con el control, en Bs y en $', () => {
    const fuente = { comprobantes: estado.cont_comprobantes, lineas: estado.cont_comprobante_lineas, cuentas: estado.cont_cuentas };
    for (const [mes, esperado] of Object.entries(bd.control.balance_por_mes)) {
      const fin = estado.cont_periodos.find((p) => p.codigo === mes)!.fecha_fin;
      for (const moneda of ['VES', 'USD'] as const) {
        const b = balanceComprobacion(fuente, { desde: '2026-01-01', hasta: fin, moneda, nivel: 5 });
        expect(b.totales.saldoActual, `${mes} ${moneda}`).toBe(0);
        expect(b.totales.debe, `${mes} ${moneda}`).toBe(b.totales.haber);
        for (const fila of b.filas.filter((x) => x.cuenta.es_movimiento)) {
          const e = esperado[fila.cuenta.codigo];
          const valor = Number(moneda === 'VES' ? e?.saldo_ves ?? 0 : e?.saldo_usd ?? 0);
          expect(fila.saldoActual.toFixed(2), `${mes} ${moneda} ${fila.cuenta.codigo}`).toBe(valor.toFixed(2));
        }
      }
    }
  });

  it('el descuadrado de septiembre no entra en los saldos', () => {
    const desc = estado.cont_comprobantes.filter((c) => c.estado === 'descuadrado');
    expect(desc.map((c) => c.codigo)).toEqual(['09-000487']);
    const lineas = lineasContabilizadas(estado.cont_comprobantes, estado.cont_comprobante_lineas, '2026-09-30');
    expect(lineas.some((l) => l.comprobante_id === desc[0].id)).toBe(false);
  });
});

/* Uno por uno: solo si los esperados están en la máquina (docs/ no viaja con el repo). */
// En la carpeta del repo, o desde un worktree en ../MGG-worktrees/<nombre> (docs/ vive solo en la carpeta principal).
const candidatos = [
  join(__dirname, '../../../../docs/cuaderno/informes/contabilidad-comprobantes-esperados.json'),
  join(__dirname, '../../../../../../MGG/docs/cuaderno/informes/contabilidad-comprobantes-esperados.json'),
];
const rutaEsperados = candidatos.find((p) => existsSync(p));
if (!rutaEsperados) {
  console.warn('[oráculo] No se encontró contabilidad-comprobantes-esperados.json en docs/: la comparación uno por uno SE SALTA. La huella y el control sí corren.');
}

describe.skipIf(!rutaEsperados)('oráculo · uno por uno contra los esperados de docs/', () => {
  it('la huella de bd.json corresponde al archivo de esperados que hay en docs/', () => {
    const crudo = readFileSync(rutaEsperados!, 'utf8');
    expect(sha(crudo)).toBe(bd.meta.fuente.esperados_sha256);
  });

  it('cada comprobante coincide, y si no, dice cuál y en qué', () => {
    const esperados = (JSON.parse(readFileSync(rutaEsperados!, 'utf8')) as { comprobantes: Array<{ codigo: string }> }).comprobantes;
    const mio = JSON.parse(formaCanonica(estado)) as unknown[][];
    const porCodigo = new Map(mio.map((c) => [c[0] as string, c]));
    // Se reusa la forma canónica: se arma una por cada esperado con el mismo formato del conversor.
    const dec = (s: unknown, n: number) => Number(s ?? 0).toFixed(n);
    const diferencias: string[] = [];
    type Fila = Record<string, unknown>;
    for (const e of esperados as Array<Fila & { codigo: string; lineas: Fila[] }>) {
      const m = porCodigo.get(e.codigo);
      if (!m) { diferencias.push(`${e.codigo}: no se generó`); continue; }
      const esperado = [
        e.codigo, e.tipo, e.periodo, e.fecha, e.concepto, e.estado, e.origen, dec(e.tasa, 6), e.regla ?? null, e.hecho ?? null,
        e.origen_ref ?? null, e.reverso_de ?? null, e.numero_lote ?? null, Boolean(e.modificado), JSON.stringify(e.historial ?? []),
        dec(e.total_debe_ves, 2), dec(e.total_haber_ves, 2), dec(e.total_debe_usd, 2), dec(e.total_haber_usd, 2),
        e.lineas.map((l) => [l.cuenta, l.referencia ?? null, l.centro ?? null, l.auxiliar ?? null, l.descripcion ?? null, l.moneda,
          dec(l.monto_moneda, 2), dec(l.tasa, 6), dec(l.debe_ves, 2), dec(l.haber_ves, 2), dec(l.debe_usd, 2), dec(l.haber_usd, 2)]),
      ];
      if (JSON.stringify(esperado) !== JSON.stringify(m)) diferencias.push(`${e.codigo}: esperado ${JSON.stringify(esperado).slice(0, 300)} · generado ${JSON.stringify(m).slice(0, 300)}`);
    }
    expect(diferencias.slice(0, 5)).toEqual([]);
  });
});
