import { describe, expect, it } from 'vitest';
import { crearRepositorio } from './contabilidad.repository';
import type { CabeceraBorrador, RenglonBorrador } from './logica/comprobantes';
import { estadoDePrueba } from './pruebas/datosPrueba';
import { AlmacenSimulado } from './simulacion/almacen';

const almacenNuevo = () => new AlmacenSimulado(null, async () => estadoDePrueba());
const repoNuevo = () => crearRepositorio(almacenNuevo());

const cab = (x: Partial<CabeceraBorrador> = {}): CabeceraBorrador => ({
  tipo_id: 'tc-01', fecha: '2026-09-15', concepto: 'pago de prueba', moneda_documento: 'USD', tasa: 178, origen_ref: '', ...x,
});
const r = (cuenta: string, lado: 'debe' | 'haber', monto: number, x: Partial<RenglonBorrador> = {}): RenglonBorrador => ({
  cuenta_id: `cta-${cuenta}`, fecha_referencia: null, referencia: '', auxiliar_id: null, centro_costo_id: null,
  descripcion: '', moneda: 'USD', monto_moneda: monto, lado, tasa: 178, ...x,
});
const pago = (monto = 500) => [r('2.1.01.01.001', 'debe', monto, { auxiliar_id: 'aux-PRV-002', referencia: 'chq-001' }), r('1.1.01.01.002', 'haber', monto)];

describe('Comprobante → Insertar / Modificar', () => {
  it('un comprobante que cuadra se graba Contabilizado y numerado (Mes-Consecutivo)', async () => {
    const repo = repoNuevo();
    const c = await repo.grabarComprobante({ cabecera: cab(), renglones: pago() }, 'ana');
    expect(c).toMatchObject({ estado: 'contabilizado', numero: 1, codigo: '09-000001', concepto: 'PAGO DE PRUEBA', total_debe_usd: 500, total_debe_ves: 89000, created_by: 'ana', modificado: false, ejercicio_id: 'ej-2026' });
    expect(c.historial).toMatchObject([{ evento: 'grabado', actor: 'ana', origen: 'manual' }]);
    const dos = await repo.grabarComprobante({ cabecera: cab({ tipo_id: 'tc-09', fecha: '2026-09-20' }), renglones: pago() }, 'ana');
    expect(dos.codigo).toBe('09-000002');
    expect((await repo.getComprobante(c.id)).lineas[0].referencia).toBe('CHQ-001');
  });

  it('uno que no cuadra se graba Descuadrado, con número, si Parámetros lo permite', async () => {
    const repo = repoNuevo();
    const c = await repo.grabarComprobante({ cabecera: cab(), renglones: [r('6.2.01.01.001', 'debe', 10), r('1.1.01.01.002', 'haber', 9)] }, 'x');
    expect(c).toMatchObject({ estado: 'descuadrado', codigo: '09-000001' });
  });

  it('con «Permitir descuadrados» apagado, un descuadrado no se graba', async () => {
    const almacen = almacenNuevo();
    await almacen.modificar((e) => { e.cont_parametros.permite_descuadrados = false; });
    const repo = crearRepositorio(almacen);
    await expect(repo.grabarComprobante({ cabecera: cab(), renglones: [r('6.2.01.01.001', 'debe', 10), r('1.1.01.01.002', 'haber', 9)] }, 'x'))
      .rejects.toThrow(/no cuadra .*no permite grabar descuadrados/);
  });

  it('lo mal escrito se rechaza siempre, cuadre o no', async () => {
    const repo = repoNuevo();
    await expect(repo.grabarComprobante({ cabecera: cab(), renglones: [r('1.1.01.01', 'debe', 10), r('1.1.01.01.002', 'haber', 10)] }, 'x'))
      .rejects.toThrow(/Cuenta Título/);
  });

  it('modificar conserva el número si sigue en el mismo mes, y lo cambia si pasa a otro', async () => {
    const repo = repoNuevo();
    const c = await repo.grabarComprobante({ cabecera: cab(), renglones: pago() }, 'x');
    await repo.grabarComprobante({ cabecera: cab({ fecha: '2026-09-16' }), renglones: pago() }, 'x');
    const mismoMes = await repo.grabarComprobante({ id: c.id, cabecera: cab({ fecha: '2026-09-18', concepto: 'otro' }), renglones: pago(600) }, 'x');
    expect(mismoMes).toMatchObject({ id: c.id, codigo: '09-000001', concepto: 'OTRO', total_debe_usd: 600 });
    const otroMes = await repo.grabarComprobante({ id: c.id, cabecera: cab({ fecha: '2026-08-05' }), renglones: pago() }, 'x');
    expect(otroMes.codigo).toBe('08-000001'); // agosto no tiene asientos de ejemplo: arranca su correlativo
  });

  it('modificar puede pasar de Descuadrado a Contabilizado al completar el asiento', async () => {
    const repo = repoNuevo();
    const c = await repo.grabarComprobante({ cabecera: cab(), renglones: [r('6.2.01.01.001', 'debe', 10)] }, 'x');
    expect(c.estado).toBe('descuadrado');
    const listo = await repo.grabarComprobante({ id: c.id, cabecera: cab(), renglones: [r('6.2.01.01.001', 'debe', 10), r('1.1.01.01.002', 'haber', 10)] }, 'luis');
    expect(listo).toMatchObject({ estado: 'contabilizado', codigo: c.codigo, modificado: true, updated_by: 'luis' });
  });

  it('modificar deja el historial con el antes y el después, solo agregando (usuario, 20/10 13:04)', async () => {
    const repo = repoNuevo();
    const c = await repo.grabarComprobante({ cabecera: cab(), renglones: pago() }, 'ana');
    const m = await repo.grabarComprobante({ id: c.id, cabecera: cab({ concepto: 'pago corregido' }), renglones: [...pago(700), r('6.2.01.01.001', 'debe', 5), r('1.1.01.01.002', 'haber', 5)] }, 'luis');
    expect(m.historial).toHaveLength(2);
    expect(m.historial[0]).toEqual(c.historial[0]); // lo anterior no se reescribe
    expect(m.historial[1]).toMatchObject({
      evento: 'modificado', actor: 'luis',
      antes: { concepto: 'PAGO DE PRUEBA', estado: 'contabilizado', total_debe_usd: 500, asientos: 2 },
      despues: { concepto: 'PAGO CORREGIDO', estado: 'contabilizado', total_debe_usd: 705, asientos: 4 },
    });
  });

  it('con el mes cerrado no se ingresa ni se modifica, y lo dice', async () => {
    const almacen = almacenNuevo();
    const repo = crearRepositorio(almacen);
    const c = await repo.grabarComprobante({ cabecera: cab(), renglones: pago() }, 'x');
    await almacen.modificar((e) => { e.cont_periodos.find((p) => p.codigo === '202609')!.estado = 'cerrado'; });
    const msg = 'El mes 09/2026 está cerrado: no se puede ingresar ni modificar.';
    await expect(repo.grabarComprobante({ id: c.id, cabecera: cab({ fecha: '2026-10-01' }), renglones: pago() }, 'x')).rejects.toThrow(msg);
    await expect(repo.grabarComprobante({ cabecera: cab(), renglones: pago() }, 'x')).rejects.toThrow(msg);
    await expect(repo.reversarComprobante(c.id, 'motivo', 'x')).rejects.toThrow(msg);
  });
});

describe('Comprobante → Reversar', () => {
  it('crea el reverso contabilizado, Debe ↔ Haber, con el motivo en la descripción', async () => {
    const repo = repoNuevo();
    const c = await repo.grabarComprobante({ cabecera: cab(), renglones: pago() }, 'x');
    await expect(repo.reversarComprobante(c.id, '  ', 'x')).rejects.toThrow('Motivo del reverso requerido.');
    const rev = await repo.reversarComprobante(c.id, 'pago duplicado', 'luis');
    expect(rev).toMatchObject({ estado: 'contabilizado', origen: 'reverso', reverso_de_id: c.id, codigo: '09-000002', concepto: 'REVERSO DE Nº 09-000001 · PAGO DUPLICADO' });
    expect(rev.total_haber_usd).toBe(c.total_debe_usd);
    expect((await repo.getComprobante(rev.id)).lineas[0].haber_usd).toBe(500);
    const original = await repo.getComprobante(c.id);
    expect(original.reversadoPor?.codigo).toBe('09-000002');
    expect(original.comprobante.historial.at(-1)).toMatchObject({ evento: 'reversado', actor: 'luis', reverso: '09-000002' });
    expect(rev.historial).toMatchObject([{ evento: 'grabado', origen: 'reverso' }]);
  });

  it('una sola vez, nunca un reverso ni un descuadrado, y lo reversado ya no se modifica', async () => {
    const repo = repoNuevo();
    const c = await repo.grabarComprobante({ cabecera: cab(), renglones: pago() }, 'x');
    const rev = await repo.reversarComprobante(c.id, 'motivo', 'x');
    await expect(repo.reversarComprobante(c.id, 'otra vez', 'x')).rejects.toThrow(/ya fue reversado por el 09-000002/);
    await expect(repo.reversarComprobante(rev.id, 'x', 'x')).rejects.toThrow('Un comprobante de reverso no se reversa.');
    await expect(repo.grabarComprobante({ id: c.id, cabecera: cab(), renglones: pago() }, 'x')).rejects.toThrow(/ya fue reversado: no se modifica/);
    await expect(repo.grabarComprobante({ id: rev.id, cabecera: cab(), renglones: pago() }, 'x')).rejects.toThrow('Un comprobante de reverso no se modifica.');
    const desc = await repo.grabarComprobante({ cabecera: cab(), renglones: [r('6.2.01.01.001', 'debe', 10)] }, 'x');
    await expect(repo.reversarComprobante(desc.id, 'x', 'x')).rejects.toThrow('No se puede reversar un comprobante descuadrado.');
  });
});

describe('lecturas', () => {
  it('la tasa del día sale de cont_tasas', async () => {
    const repo = repoNuevo();
    expect(await repo.getTasa('USD', '2026-01-01')).toBe(50);
    expect(await repo.getTasa('USD', '2026-10-20')).toBe(196);
    expect(await repo.getTasa('VES', '2026-10-20')).toBe(1);
  });

  it('la lista viene de la más reciente a la más vieja', async () => {
    const lista = await repoNuevo().listComprobantes();
    expect(lista[0].fecha >= lista[lista.length - 1].fecha).toBe(true);
    expect(lista).toHaveLength(11);
  });
});
