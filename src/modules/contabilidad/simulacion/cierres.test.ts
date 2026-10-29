/* ============================================================
   Cierres sobre los datos del Carril BD (modelo v0.5 §4): el proceso
   completo, de punta a punta, y el diferencial de septiembre contra el
   esperado de BD (control.revaluaciones['202609'], aplicada = false).
   ============================================================ */
import { describe, expect, it } from 'vitest';
import { crearRepositorio, renglonDeLinea } from '../contabilidad.repository';
import { balanceComprobacion } from '../logica/reportes';
import { AlmacenSimulado } from './almacen';
import bdCrudo from './datos/bd.json';
import type { DatosBd } from './datosBd';

const bd = bdCrudo as unknown as DatosBd;
const nuevo = () => {
  const almacen = new AlmacenSimulado(null);
  return { almacen, repo: crearRepositorio(almacen) };
};
const per = (codigo: string) => `per-${codigo}`;

/** Corrige el descuadrado de septiembre (09-000487: el haber mal tipeado) para poder cerrar. */
async function corregirDescuadrado(repo: ReturnType<typeof crearRepositorio>) {
  const lista = await repo.listComprobantes();
  const d = lista.find((c) => c.codigo === '09-000487')!;
  const { lineas } = await repo.getComprobante(d.id);
  const renglones = lineas.map(renglonDeLinea).map((r) => ({ ...r, monto_moneda: 2400000 }));
  return repo.grabarComprobante({
    id: d.id, renglones,
    cabecera: { tipo_id: d.tipo_id, fecha: d.fecha, concepto: d.concepto, moneda_documento: d.moneda_documento, tasa: d.tasa ?? 0, origen_ref: '' },
  }, 'contador@ejemplo.test');
}

/** Integración → Por contabilizar: los 33 documentos de octubre (datos v1.5). Sin eso, octubre no cierra (C42). */
async function contabilizarBandeja(repo: ReturnType<typeof crearRepositorio>) {
  const pendientes = await repo.listIntegraciones({ estados: ['pendiente'] });
  const r = await repo.contabilizarIntegraciones(pendientes.map((p) => p.integracion.id), 'contador@ejemplo.test');
  expect(r.errores).toEqual([]);
}

describe('Período → Cerrar Mes', () => {
  it('septiembre no cierra con el descuadrado y lo dice', async () => {
    const { repo } = nuevo();
    await expect(repo.cerrarMes(per('202609'), 'x')).rejects.toThrow(/1 comprobante\(s\) descuadrado\(s\) \(09-000487\)/);
  });

  it('los meses se cierran en orden', async () => {
    const { repo } = nuevo();
    await expect(repo.cerrarMes(per('202610'), 'x')).rejects.toThrow('Los meses se cierran en orden: primero el 09/2026.');
  });

  it('el diferencial de septiembre es EXACTAMENTE el esperado por BD', async () => {
    const { repo } = nuevo();
    await corregirDescuadrado(repo);
    const vista = await repo.vistaPreviaCierreMes(per('202609'));
    expect(vista.errores).toEqual([]);
    const cuentas = new Map((await repo.listCuentas()).map((c) => [c.id, c.codigo]));
    const centros = new Map((await repo.listCentrosCosto()).map((c) => [c.id, c.codigo]));
    const aux = new Map((await repo.listAuxiliares()).map((a) => [a.id, a.codigo]));
    const obtenido = vista.revaluacion!.detalle.map((x) => ({
      cuenta: cuentas.get(x.cuenta_id), centro: x.centro_costo_id ? centros.get(x.centro_costo_id) : null,
      auxiliar: x.auxiliar_id ? aux.get(x.auxiliar_id) : null, saldo_moneda: x.saldo_moneda.toFixed(2),
      tasa_cierre: x.tasa_cierre.toFixed(6), saldo_ves_antes: x.saldo_ves_antes.toFixed(2), ajuste_ves: x.ajuste_ves.toFixed(2),
    }));
    const esperado = bd.control.revaluaciones['202609'].cuentas.map((x) => ({
      ...x, saldo_moneda: Number(x.saldo_moneda).toFixed(2), tasa_cierre: Number(x.tasa_cierre).toFixed(6),
      saldo_ves_antes: Number(x.saldo_ves_antes).toFixed(2), ajuste_ves: Number(x.ajuste_ves).toFixed(2),
    }));
    expect(obtenido).toEqual(esperado);
  });

  it('cerrar septiembre graba el AJ cuadrado, deja la foto y bloquea el mes', async () => {
    const { repo } = nuevo();
    await corregirDescuadrado(repo);
    const { periodo, revaluacion } = await repo.cerrarMes(per('202609'), 'contador@ejemplo.test');
    expect(periodo.estado).toBe('cerrado');
    expect(revaluacion).toMatchObject({ codigo: '09-000488', estado: 'contabilizado', origen: 'automatico' });
    expect(revaluacion!.total_debe_ves).toBe(revaluacion!.total_haber_ves);
    const cierre = (await repo.listCierres()).find((c) => c.periodo_id === per('202609'))!;
    expect(cierre).toMatchObject({ tipo: 'mes', estado: 'vigente', comprobante_id: revaluacion!.id });
    expect(Object.keys(cierre.saldos).length).toBeGreaterThan(50);
    const d = (await repo.listComprobantes()).find((c) => c.codigo === '09-000487')!;
    const { lineas } = await repo.getComprobante(d.id);
    await expect(repo.grabarComprobante({ id: d.id, renglones: lineas.map(renglonDeLinea), cabecera: { tipo_id: d.tipo_id, fecha: d.fecha, concepto: 'x', moneda_documento: 'VES', tasa: d.tasa ?? 0, origen_ref: '' } }, 'x'))
      .rejects.toThrow('El mes 09/2026 está cerrado: no se puede ingresar ni modificar.');
  });
});

describe('Período → Abrir Mes', () => {
  it('del último al primero, con motivo, y reversa el diferencial', async () => {
    const { repo } = nuevo();
    await corregirDescuadrado(repo);
    const { revaluacion } = await repo.cerrarMes(per('202609'), 'x');
    await expect(repo.reabrirMes(per('202608'), 'ajuste', 'x')).rejects.toThrow('primero el 09/2026');
    await expect(repo.reabrirMes(per('202609'), ' ', 'x')).rejects.toThrow('Motivo de la reapertura requerido.');
    const sep = await repo.reabrirMes(per('202609'), 'Falta una factura', 'x');
    expect(sep).toMatchObject({ estado: 'abierto', reabierto_motivo: 'Falta una factura' });
    expect((await repo.getComprobante(revaluacion!.id)).reversadoPor?.concepto).toMatch(/^REVERSO DE Nº 09-000488 · REAPERTURA DEL MES: FALTA UNA FACTURA/);
    // Agosto venía cerrado por BD con su diferencial 08-000430: también se reversa.
    await repo.reabrirMes(per('202608'), 'Revisión', 'x');
    const ago = (await repo.listComprobantes()).find((c) => c.codigo === '08-000430')!;
    expect((await repo.getComprobante(ago.id)).reversadoPor).not.toBeNull();
  });

  it('cerrar, reabrir y volver a cerrar deja los mismos saldos que el primer cierre', async () => {
    const { repo } = nuevo();
    await corregirDescuadrado(repo);
    await repo.cerrarMes(per('202609'), 'x');
    const foto1 = (await repo.listCierres()).find((c) => c.periodo_id === per('202609') && c.estado === 'vigente')!.saldos;
    await repo.reabrirMes(per('202609'), 'revisión', 'x');
    await repo.cerrarMes(per('202609'), 'x');
    const foto2 = (await repo.listCierres()).find((c) => c.periodo_id === per('202609') && c.estado === 'vigente')!.saldos;
    expect(foto2).toEqual(foto1);
  });
});

describe('la tasa al cierre sigue la regla de la base: la del día o la de los 7 días previos', () => {
  it('sin tasa del último día ni de los 6 anteriores, el mes no cierra y lo dice', async () => {
    const { almacen, repo } = nuevo();
    await corregirDescuadrado(repo);
    await repo.cerrarMes(per('202609'), 'x');
    await contabilizarBandeja(repo);
    // Se quitan las tasas de octubre a propósito: la serie de BD (v1.3) sí las trae.
    await almacen.modificar((e) => { e.cont_tasas = e.cont_tasas.filter((t) => t.fecha < '2026-10-01'); });
    await expect(repo.cerrarMes(per('202610'), 'x')).rejects.toThrow('No hay tasa de USD del 31/10/2026 ni de los 6 días anteriores');
  });
});

describe('octubre a diciembre: con la bandeja de octubre contabilizada, el cierre funciona (tasas hasta el 31/12)', () => {
  it('octubre no cierra con documentos sin contabilizar (C42)', async () => {
    const { repo } = nuevo();
    await corregirDescuadrado(repo);
    await repo.cerrarMes(per('202609'), 'x');
    await expect(repo.cerrarMes(per('202610'), 'x')).rejects.toThrow('El mes tiene 33 documento(s) de otros módulos sin contabilizar');
  });

  it('se cierran en orden; cada diferencial sale solo del cambio de tasa sobre los saldos y cuadra', async () => {
    const { repo } = nuevo();
    await corregirDescuadrado(repo);
    await repo.cerrarMes(per('202609'), 'x');
    await contabilizarBandeja(repo);
    for (const m of ['10', '11', '12']) {
      const vista = await repo.vistaPreviaCierreMes(per(`2026${m}`));
      expect(vista.errores, m).toEqual([]);
      expect(vista.revaluacion!.detalle.length, m).toBeGreaterThan(0);
      const { periodo, revaluacion } = await repo.cerrarMes(per(`2026${m}`), 'x');
      expect(periodo.estado).toBe('cerrado');
      expect(revaluacion!.total_debe_ves).toBe(revaluacion!.total_haber_ves);
      expect(revaluacion!.total_debe_usd).toBe(0); // el diferencial mueve solo bolívares
    }
  });
});

describe('Cerrar Período → ejercicio y apertura', () => {
  async function cerrarHastaDiciembre(repo: ReturnType<typeof crearRepositorio>) {
    await corregirDescuadrado(repo);
    await contabilizarBandeja(repo);
    for (const m of ['09', '10', '11', '12']) await repo.cerrarMes(per(`2026${m}`), 'x');
  }

  it('no cierra el ejercicio con meses abiertos', async () => {
    const { repo } = nuevo();
    await expect(repo.cerrarEjercicio('ej-2026', 'pre_cierre', 'x')).rejects.toThrow(/faltan 09\/2026, 10\/2026, 11\/2026, 12\/2026/);
  });

  it('pre-cierre: dos CI en el mes 13 que dejan en cero los resultados y llevan el resultado a superávit; se reabre', async () => {
    const { almacen, repo } = nuevo();
    await cerrarHastaDiciembre(repo);
    const ej = await repo.cerrarEjercicio('ej-2026', 'pre_cierre', 'x');
    expect(ej.estado).toBe('pre_cierre');
    const lista = await repo.listComprobantes();
    const cis = lista.filter((c) => c.periodo_id === per('202613'));
    expect(cis.map((c) => c.codigo).sort()).toEqual(['13-000001', '13-000002']);
    for (const c of cis) {
      expect(c.estado).toBe('contabilizado');
      expect(c.total_debe_ves).toBe(c.total_haber_ves);
      expect(c.total_debe_usd).toBe(c.total_haber_usd);
    }
    const e = await almacen.leer();
    const b = balanceComprobacion({ comprobantes: e.cont_comprobantes, lineas: e.cont_comprobante_lineas, cuentas: e.cont_cuentas }, { desde: '2026-01-01', hasta: '2026-12-31', moneda: 'VES', nivel: 1, incluirSinMovimiento: true });
    for (const g of ['4', '5', '6']) expect(b.filas.find((x) => x.cuenta.codigo === g)!.saldoActual, `grupo ${g}`).toBe(0);
    expect(b.totales.saldoActual).toBe(0);
    const resultado = e.cont_parametros.cuenta_resultado_ejercicio_id;
    const saldoRes = e.cont_comprobante_lineas.filter((l) => l.cuenta_id === resultado && cis.some((c) => c.id === l.comprobante_id))
      .reduce((a, l) => a + Math.round(l.debe_ves * 100) - Math.round(l.haber_ves * 100), 0);
    expect(saldoRes).toBe(0);

    await expect(repo.reabrirMes(per('202612'), 'x', 'x')).rejects.toThrow(/pre-cierre: primero se reabre el ejercicio/);
    const reab = await repo.reabrirEjercicio('ej-2026', 'Falta un ajuste de auditoría', 'x');
    expect(reab.estado).toBe('abierto');
    const despues = await repo.listComprobantes();
    expect(despues.filter((c) => c.periodo_id === per('202613') && c.origen === 'reverso')).toHaveLength(2);
  });

  it('el pre-cierre pasa a definitivo sin repetir asientos, y el definitivo no se reabre', async () => {
    const { repo } = nuevo();
    await cerrarHastaDiciembre(repo);
    await repo.cerrarEjercicio('ej-2026', 'pre_cierre', 'x');
    const antes = (await repo.listComprobantes()).length;
    const ej = await repo.cerrarEjercicio('ej-2026', 'definitivo', 'x');
    expect(ej.estado).toBe('cerrado');
    expect((await repo.listComprobantes()).length).toBe(antes);
    await expect(repo.reabrirEjercicio('ej-2026', 'x', 'x')).rejects.toThrow('tiene cierre definitivo: no se reabre');
  });

  it('abrir el siguiente: 2027 con 13 meses y un AP cuadrado con los saldos de balance', async () => {
    const { repo } = nuevo();
    await expect(repo.abrirEjercicioSiguiente('ej-2026', 'x')).rejects.toThrow('Primero se cierra el ejercicio 2026');
    await cerrarHastaDiciembre(repo);
    await repo.cerrarEjercicio('ej-2026', 'pre_cierre', 'x');
    const nuevoEj = await repo.abrirEjercicioSiguiente('ej-2026', 'x');
    expect(nuevoEj).toMatchObject({ nombre: '2027', estado: 'abierto' });
    expect((await repo.listPeriodos()).filter((p) => p.ejercicio_id === 'ej-2027')).toHaveLength(13);
    const ap = (await repo.listComprobantes()).find((c) => c.ejercicio_id === 'ej-2027' && c.origen === 'apertura')!;
    expect(ap).toMatchObject({ codigo: '01-000001', fecha: '2027-01-01', estado: 'contabilizado' });
    expect(ap.total_debe_ves).toBe(ap.total_haber_ves);
    await expect(repo.reabrirEjercicio('ej-2026', 'x', 'x')).rejects.toThrow('El ejercicio 2027 ya tiene su apertura');
  });
});
