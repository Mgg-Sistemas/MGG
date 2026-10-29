/* ============================================================
   Estados financieros contra los esperados del Carril BD (E-07, datos
   v1.4 §6 y v1.6): control.estados_financieros, en los 5 cortes y en Bs y $.
   · 202607, 202608 y 202609: el estado de los datos tal cual (el
     descuadrado 09-000487 no entra en ningún saldo).
   · 202609_corregido_y_cerrado (v1.6, C45): DIRECTO. Se modifica el
     09-000487 con la corrección exacta de BD (control.correccion_09_000487),
     se cierra septiembre y se compara.
   · 202609_con_diferencial: BD lo calcula con el descuadrado afuera, algo
     que la maqueta no puede reproducir (no cierra sin corregirlo). Se
     aísla el efecto del diferencial: (corregido y cerrado) − (corregido
     sin cerrar), y se suma al corte de septiembre tal cual.
   Cada renglón (BG-xx, ER-xx), total de sección y subtotal, a 2 decimales.
   ============================================================ */
import { describe, expect, it } from 'vitest';
import { crearRepositorio, renglonDeLinea } from '../contabilidad.repository';
import { cuadraBalance, valorDe, type EstadoFinanciero } from '../logica/estados';
import { AlmacenSimulado } from './almacen';
import bdCrudo from './datos/bd.json';
import type { DatosBd } from './datosBd';

const bd = bdCrudo as unknown as DatosBd;
const esperados = bd.control.estados_financieros;
const nuevo = () => crearRepositorio(new AlmacenSimulado(null));

/** Corrige el descuadrado de septiembre con la corrección EXACTA de BD: solo el asiento que dice, con el monto que dice. */
async function corregirDescuadrado(repo: ReturnType<typeof crearRepositorio>) {
  const k = bd.control.correccion_09_000487;
  const d = (await repo.listComprobantes()).find((c) => c.codigo === k.comprobante)!;
  const { lineas } = await repo.getComprobante(d.id);
  const cuentas = new Map((await repo.listCuentas()).map((c) => [c.id, c.codigo]));
  const asiento = lineas.find((l) => l.renglon === k.asiento)!;
  expect([cuentas.get(asiento.cuenta_id), asiento.haber_ves.toFixed(2), asiento.haber_usd.toFixed(2)]).toEqual([k.cuenta, k.haber_ves_antes, k.haber_usd_antes]);
  const c = await repo.grabarComprobante({
    id: d.id, renglones: lineas.map((l) => (l.renglon === k.asiento ? { ...renglonDeLinea(l), monto_moneda: Number(k.monto_moneda_despues) } : renglonDeLinea(l))),
    cabecera: { tipo_id: d.tipo_id, fecha: d.fecha, concepto: d.concepto, moneda_documento: d.moneda_documento, tasa: d.tasa ?? 0, origen_ref: '' },
  }, 'contador@ejemplo.test');
  expect(c.estado).toBe('contabilizado');
  const despues = (await repo.getComprobante(d.id)).lineas.find((l) => l.renglon === k.asiento)!;
  expect([despues.haber_ves.toFixed(2), despues.haber_usd.toFixed(2)]).toEqual([k.haber_ves_despues, k.haber_usd_despues]);
}

type Par = { ves: string; usd: string };
const a2 = (x: string | number | undefined) => (x === undefined ? 'falta' : Number(x).toFixed(2));
/** Lo esperado por BD, a 2 decimales. */
const normal = (r: Record<string, Par>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ves: a2(v.ves), usd: a2(v.usd) }]));
/** Lo calculado (consultado en Bs: la principal es Bs y la equivalente $), con las mismas claves. */
function obtenido(e: EstadoFinanciero, claves: string[]): Record<string, { ves: string; usd: string }> {
  const eq = (clave: string) => {
    for (const b of e.bloques) {
      if (b.tipo === 'subtotal' && b.etiqueta === clave) return b.eq?.[0];
      if (b.tipo === 'seccion') {
        if (b.total.etiqueta === clave) return b.total.eq?.[0];
        for (const g of b.grupos) for (const r of g.renglones) if (r.codigo === clave) return r.eq?.[0];
      }
    }
    return e.totales.find((t) => t.etiqueta === clave)?.eq?.[0];
  };
  return Object.fromEntries(claves.map((k) => [k, { ves: a2(valorDe(e, k)), usd: a2(eq(k)) }]));
}

type Mapa = Record<string, { ves: string; usd: string }>;
type Juego = { balance: Mapa; mes: Mapa; acumulado_desde_01_07: Mapa };

/** Los esperados de un corte: Balance General y Resultados del mes y acumulado. */
function esperadoDe(corte: keyof typeof esperados): Juego {
  const esp = esperados[corte];
  const er = (x: (typeof esp)['estado_resultados']['mes']) => ({ ...normal(x.renglones), ...normal(x.subtotales ?? {}) });
  return {
    balance: { ...normal(esp.balance_general.renglones), ...normal(esp.balance_general.totales ?? {}) },
    mes: er(esp.estado_resultados.mes), acumulado_desde_01_07: er(esp.estado_resultados.acumulado_desde_01_07),
  };
}

/** Lo que da la maqueta a la fecha de corte, con las mismas claves que el esperado. */
async function calculado(repo: ReturnType<typeof crearRepositorio>, fecha: string, claves: Juego): Promise<Juego> {
  const bg = await repo.getBalanceGeneral({ hasta: fecha, moneda: 'VES' });
  expect(cuadraBalance(bg)).toEqual([true]);
  const mes = await repo.getEstadoResultados({ variante: 'mensual', corte: fecha.slice(0, 7), moneda: 'VES' });
  const acum = await repo.getEstadoResultados({ variante: 'acumulado', corte: fecha.slice(0, 7), moneda: 'VES' });
  return {
    balance: obtenido(bg, Object.keys(claves.balance)),
    mes: obtenido(mes, Object.keys(claves.mes)),
    acumulado_desde_01_07: obtenido(acum, Object.keys(claves.acumulado_desde_01_07)),
  };
}

/** a + b − c, renglón por renglón, en centavos. */
function combinar(a: Juego, b: Juego, c: Juego): Juego {
  const ct = (x: string) => Math.round(Number(x) * 100);
  const uno = (k: keyof Juego) => Object.fromEntries(Object.keys(a[k]).map((r) => [r, {
    ves: ((ct(a[k][r].ves) + ct(b[k][r].ves) - ct(c[k][r].ves)) / 100).toFixed(2),
    usd: ((ct(a[k][r].usd) + ct(b[k][r].usd) - ct(c[k][r].usd)) / 100).toFixed(2),
  }]));
  return { balance: uno('balance'), mes: uno('mes'), acumulado_desde_01_07: uno('acumulado_desde_01_07') };
}

describe('estados financieros = los esperados de BD (control.estados_financieros)', () => {
  it('trae los cinco cortes', () => {
    expect(Object.keys(esperados).sort()).toEqual(['202607', '202608', '202609', '202609_con_diferencial', '202609_corregido_y_cerrado']);
  });

  for (const corte of ['202607', '202608', '202609'] as const) {
    it(`${corte}: Balance General, Resultados del mes y acumulado, en Bs y en $`, async () => {
      const esp = esperadoDe(corte);
      expect(await calculado(nuevo(), esperados[corte].fecha_corte, esp)).toEqual(esp);
    });
  }

  it('202609 corregido y cerrado: directo contra BD (C45)', async () => {
    const esp = esperadoDe('202609_corregido_y_cerrado');
    const repo = nuevo();
    await corregirDescuadrado(repo);
    await repo.cerrarMes('per-202609', 'contador@ejemplo.test');
    const r = await calculado(repo, esperados['202609_corregido_y_cerrado'].fecha_corte, esp);
    expect(r).toEqual(esp);
    expect(r.mes['UTILIDAD O PÉRDIDA NETA DEL EJERCICIO']).toEqual({ ves: '52056163.41', usd: '90212.85' });
  });

  it('202609 con el diferencial: septiembre + el efecto del cierre de septiembre', async () => {
    const esp = esperadoDe('202609_con_diferencial');
    const fecha = esperados['202609_con_diferencial'].fecha_corte;
    const tal = await calculado(nuevo(), fecha, esp);
    const repo = nuevo();
    await corregirDescuadrado(repo);
    const corregido = await calculado(repo, fecha, esp);
    await repo.cerrarMes('per-202609', 'contador@ejemplo.test');
    const cerrado = await calculado(repo, fecha, esp);
    expect(combinar(tal, cerrado, corregido)).toEqual(esp);
    // En $ el diferencial no mueve nada (§6): cerrar no cambia ninguna cifra en dólares.
    for (const k of ['balance', 'mes', 'acumulado_desde_01_07'] as const) {
      for (const r of Object.keys(esp[k])) expect(cerrado[k][r].usd, `${k} ${r}`).toBe(corregido[k][r].usd);
    }
  });

  it('la estructura sale de cont_esquemas_ef (C44): el por defecto de cada tipo, con la definición de BD tal cual', async () => {
    const almacen = new AlmacenSimulado(null);
    const e = await almacen.leer();
    expect(e.cont_esquemas_ef.map((x) => [x.codigo, x.tipo, x.por_defecto, x.activo])).toEqual([
      ['balance_general', 'balance_general', true, true], ['estado_resultados', 'estado_resultados', true, true],
    ]);
    expect(e.cont_esquemas_ef[0].definicion).toEqual(bd.estructura_ef.balance_general);
    await almacen.modificar((x) => { x.cont_esquemas_ef[1].por_defecto = false; });
    await expect(crearRepositorio(almacen).getEstadoResultados({ variante: 'mensual', corte: '2026-07', moneda: 'VES' }))
      .rejects.toThrow('No hay un esquema de Estado de Resultados por defecto (Esquemas de estados financieros).');
  });

  it('en $ la cifra principal es la de dólares y la equivalente la de bolívares', async () => {
    const repo = nuevo();
    const [enBs, enUsd] = await Promise.all([
      repo.getBalanceGeneral({ hasta: '2026-07-31', moneda: 'VES' }),
      repo.getBalanceGeneral({ hasta: '2026-07-31', moneda: 'USD' }),
    ]);
    expect(valorDe(enUsd, 'TOTAL ACTIVO')).toBe(enBs.totales[0].eq?.[0]);
    expect(enUsd.totales[0].eq?.[0]).toBe(valorDe(enBs, 'TOTAL ACTIVO'));
  });
});
