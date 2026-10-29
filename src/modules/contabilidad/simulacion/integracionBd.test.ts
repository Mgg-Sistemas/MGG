/* ============================================================
   Prueba ORÁCULO de la bandeja «Por contabilizar» (E-07, datos v1.5 §7):
   contabilizar los 33 documentos de octubre da EXACTAMENTE los 33
   comprobantes esperados (10-000001…10-000033), uno por uno y por
   huella, y deja la marca en cont_integraciones.
   · Corre sobre su PROPIA copia del almacén (sin localStorage): nunca
     sobre el estado de la pantalla.
   · La hora del historial es la del momento de contabilizar; el
     generador de BD pone las 18:00 del día del documento. Se normaliza
     solo ese campo, y aparte se prueba que el historial dice quién y cuándo.
   ============================================================ */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crearRepositorio } from '../contabilidad.repository';
import { formaCanonica } from '../pruebas/huella';
import type { EstadoSimulacion } from '../tipos';
import { AlmacenSimulado } from './almacen';
import bdCrudo from './datos/bd.json';
import type { DatosBd } from './datosBd';

const bd = bdCrudo as unknown as DatosBd;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ACTOR = 'simulacion';

async function contabilizarTodo() {
  const almacen = new AlmacenSimulado(null);
  const repo = crearRepositorio(almacen);
  const pendientes = await repo.listIntegraciones({ estados: ['pendiente'] });
  const r = await repo.contabilizarIntegraciones(pendientes.map((p) => p.integracion.id), ACTOR);
  return { almacen, repo, pendientes, r, estado: await almacen.leer() };
}

/** Solo los comprobantes de octubre, con la hora del historial como la escribe el generador de BD. */
function octubreNormalizado(e: EstadoSimulacion): EstadoSimulacion {
  const comprobantes = e.cont_comprobantes
    .filter((c) => c.codigo.startsWith('10-'))
    .map((c) => ({ ...c, historial: c.historial.map((h) => ({ ...h, at: `${c.fecha}T18:00:00-04:00` })) }));
  const ids = new Set(comprobantes.map((c) => c.id));
  return { ...e, cont_comprobantes: comprobantes, cont_comprobante_lineas: e.cont_comprobante_lineas.filter((l) => ids.has(l.comprobante_id)) };
}

describe('bandeja Por contabilizar · los 33 documentos de octubre', () => {
  it('la bandeja trae los 33 pendientes, en orden de fecha y documento, cada uno con su regla', async () => {
    const repo = crearRepositorio(new AlmacenSimulado(null));
    const pendientes = await repo.listIntegraciones({ estados: ['pendiente'] });
    expect(pendientes).toHaveLength(bd.control.por_contabilizar.documentos);
    expect(pendientes.every((p) => p.documento && p.regla && !p.comprobante)).toBe(true);
    expect(pendientes.map((p) => p.integracion.fecha)).toEqual([...pendientes.map((p) => p.integracion.fecha)].sort());
    // Los de julio a septiembre ya están contabilizados, con su comprobante.
    const hechas = await repo.listIntegraciones({ estados: ['contabilizado'] });
    expect(hechas).toHaveLength(bd.hechos.length);
    expect(hechas.every((h) => h.comprobante)).toBe(true);
  });

  it('contabilizar los 33 da los 33 esperados: misma huella', async () => {
    const { r, estado } = await contabilizarTodo();
    expect(r.errores).toEqual([]);
    expect(r.comprobantes.map((c) => c.codigo)).toEqual(Array.from({ length: 33 }, (_, i) => `10-${String(i + 1).padStart(6, '0')}`));
    expect(sha(formaCanonica(octubreNormalizado(estado)))).toBe(bd.meta.oraculo_octubre.huella);
  });

  it('los totales son los del control: debe = haber en Bs y en $', async () => {
    const { r } = await contabilizarTodo();
    const s = (k: 'total_debe_ves' | 'total_haber_ves' | 'total_debe_usd' | 'total_haber_usd') =>
      (r.comprobantes.reduce((a, c) => a + Math.round(c[k] * 100), 0) / 100).toFixed(2);
    const t = bd.control.por_contabilizar.totales;
    expect([s('total_debe_ves'), s('total_haber_ves'), s('total_debe_usd'), s('total_haber_usd')])
      .toEqual([t.total_debe_ves, t.total_haber_ves, t.total_debe_usd, t.total_haber_usd].map((x) => Number(x).toFixed(2)));
  });

  it('deja la marca en cont_integraciones y el historial dice quién y cuándo', async () => {
    const { repo, r, estado } = await contabilizarTodo();
    expect(await repo.listIntegraciones({ estados: ['pendiente', 'error'] })).toEqual([]);
    const marcadas = estado.cont_integraciones.filter((i) => i.origen_id.startsWith('P-'));
    expect(marcadas.every((i) => i.estado === 'contabilizado' && i.comprobante_id && i.updated_by === ACTOR)).toBe(true);
    const porComprobante = new Map(r.comprobantes.map((c) => [c.id, c]));
    expect(marcadas.every((i) => porComprobante.get(i.comprobante_id!)?.origen_id === i.origen_id)).toBe(true);
    expect(r.comprobantes[0].historial).toEqual([expect.objectContaining({ evento: 'grabado', actor: ACTOR, origen: 'automatico' })]);
  });

  it('un documento no se contabiliza dos veces', async () => {
    const { repo, pendientes } = await contabilizarTodo();
    const otra = await repo.contabilizarIntegraciones(pendientes.map((p) => p.integracion.id), ACTOR);
    expect(otra.comprobantes).toEqual([]);
    expect((await repo.listComprobantes()).filter((c) => c.codigo.startsWith('10-'))).toHaveLength(33);
  });

  it('con el mes cerrado no contabiliza: queda en error con el mensaje, y octubre no cierra con pendientes', async () => {
    const repo = crearRepositorio(new AlmacenSimulado(null));
    const [primero] = await repo.listIntegraciones({ estados: ['pendiente'] });
    await expect(repo.vistaPreviaCierreMes('per-202610')).resolves.toMatchObject({
      errores: expect.arrayContaining([expect.stringMatching(/33 documento\(s\) de otros módulos sin contabilizar/)]),
    });
    // Se fuerza el mes cerrado en una copia, para ver el error de un documento.
    const almacen = new AlmacenSimulado(null);
    await almacen.modificar((e) => { e.cont_periodos.find((p) => p.codigo === '202610')!.estado = 'cerrado'; });
    const r = await crearRepositorio(almacen).contabilizarIntegraciones([primero.integracion.id], ACTOR);
    expect(r.comprobantes).toEqual([]);
    expect(r.errores).toEqual([{ documento: primero.integracion.origen_id, error: 'El mes 10/2026 está cerrado: no se puede ingresar ni modificar.' }]);
  });
});

/* Uno por uno: solo si los esperados están en la máquina (docs/ no viaja con el repo). */
const candidatos = [
  join(__dirname, '../../../../docs/cuaderno/informes/contabilidad-octubre-esperados.json'),
  join(__dirname, '../../../../../../MGG/docs/cuaderno/informes/contabilidad-octubre-esperados.json'),
];
const rutaEsperados = candidatos.find((p) => existsSync(p));
if (!rutaEsperados) {
  console.warn('[oráculo octubre] No se encontró contabilidad-octubre-esperados.json en docs/: la comparación uno por uno SE SALTA. La huella sí corre.');
}

describe.skipIf(!rutaEsperados)('bandeja · uno por uno contra contabilidad-octubre-esperados.json', () => {
  it('el archivo de docs/ es el de la huella de bd.json', () => {
    expect(sha(readFileSync(rutaEsperados!, 'utf8'))).toBe(bd.meta.fuente.octubre_sha256);
  });

  it('cada comprobante coincide, y si no, dice cuál y en qué', async () => {
    const { estado } = await contabilizarTodo();
    const mio = new Map((JSON.parse(formaCanonica(octubreNormalizado(estado))) as unknown[][]).map((c) => [c[0] as string, c]));
    type Fila = Record<string, unknown>;
    const esperados = (JSON.parse(readFileSync(rutaEsperados!, 'utf8')) as { comprobantes: Array<Fila & { codigo: string; lineas: Fila[] }> }).comprobantes;
    const dec = (s: unknown, n: number) => Number(s ?? 0).toFixed(n);
    const diferencias: string[] = [];
    for (const e of esperados) {
      const m = mio.get(e.codigo);
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
    expect(esperados).toHaveLength(33);
  });
});
