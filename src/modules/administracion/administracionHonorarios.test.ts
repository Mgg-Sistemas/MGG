import { describe, it, expect } from 'vitest';
import type { Gestion, EnvioTesoreria } from './admin.repository';
import { gestionDelDocumento,
  saldoGestion,
  disponibleParaEnviar,
  estadoGestion,
  puedeReversarEnvio,
  motivoNoReversable,
  notaAgrupacion,
  estadoCuentaProfesional,
} from './administracionHonorarios';

const g = (over: Partial<Gestion>): Gestion => ({
  id: 'g1', empresaClave: 'GT', profesionalId: 'p1', categoriaId: null, centroAcopioId: null, documentoId: null,
  concepto: 'Poder', costoTotal: 200, moneda: 'USD', tasaRef: null,
  fecha: '2026-11-07', fechaPactada: null, estado: 'abierta', notaAcuerdo: null, ...over,
});
const e = (over: Partial<EnvioTesoreria>): EnvioTesoreria => ({
  id: 'e1', gestionId: 'g1', empresaClave: 'GT', monto: 50, moneda: 'USD',
  fechaEnvio: '2026-11-08', estado: 'enviado', servicioDirectoId: 'sd1', enviadoPor: null, pagadoEn: null, ...over,
});

describe('saldoGestion', () => {
  it('resta solo los envíos PAGADOS; ignora enviado y reversado', () => {
    const gestion = g({ id: 'g1', costoTotal: 200 });
    const envios = [
      e({ id: 'a', gestionId: 'g1', monto: 50, estado: 'pagado' }),
      e({ id: 'b', gestionId: 'g1', monto: 30, estado: 'enviado' }),
      e({ id: 'c', gestionId: 'g1', monto: 50, estado: 'reversado' }),
      e({ id: 'd', gestionId: 'otra', monto: 999, estado: 'pagado' }),
    ];
    expect(saldoGestion(gestion, envios)).toBe(150);
  });
  it('nunca es negativo aunque se sobre-pague', () => {
    expect(saldoGestion(g({ costoTotal: 100 }), [e({ monto: 150, estado: 'pagado' })])).toBe(0);
  });
});

describe('disponibleParaEnviar (evita sobre-compromiso)', () => {
  it('descuenta pagados Y enviados-pendientes, no solo pagados', () => {
    const gestion = g({ id: 'g1', costoTotal: 200 });
    // Un envío ya ENVIADO (pendiente) de 200 debe dejar 0 disponible, aunque saldo (costo−pagado) sea 200.
    const envios = [e({ id: 'a', gestionId: 'g1', monto: 200, estado: 'enviado' })];
    expect(saldoGestion(gestion, envios)).toBe(200); // saldo mira solo pagados
    expect(disponibleParaEnviar(gestion, envios)).toBe(0); // disponible mira pagados + enviados
  });
  it('un reversado libera lo comprometido', () => {
    const gestion = g({ id: 'g1', costoTotal: 200 });
    const envios = [
      e({ id: 'a', gestionId: 'g1', monto: 120, estado: 'pagado' }),
      e({ id: 'b', gestionId: 'g1', monto: 50, estado: 'enviado' }),
      e({ id: 'c', gestionId: 'g1', monto: 80, estado: 'reversado' }),
    ];
    expect(disponibleParaEnviar(gestion, envios)).toBe(30); // 200 − 120 − 50
  });
});

describe('estadoGestion', () => {
  it("'anulada' si la gestión está anulada, por encima de todo", () => {
    expect(estadoGestion(g({ estado: 'anulada' }), [e({ monto: 200, estado: 'pagado' })])).toBe('anulada');
  });
  it("'abierta' sin pagos, 'parcial' con pago parcial, 'saldada' cuando cubre el total", () => {
    expect(estadoGestion(g({ costoTotal: 200 }), [])).toBe('abierta');
    expect(estadoGestion(g({ costoTotal: 200 }), [e({ monto: 50, estado: 'pagado' })])).toBe('parcial');
    expect(estadoGestion(g({ costoTotal: 200 }), [e({ monto: 200, estado: 'pagado' })])).toBe('saldada');
  });
});

describe('puedeReversarEnvio', () => {
  it('solo un envío enviado (no pagado) se puede reversar', () => {
    expect(puedeReversarEnvio(e({ estado: 'enviado' }))).toBe(true);
    expect(puedeReversarEnvio(e({ estado: 'pagado' }))).toBe(false);
    expect(puedeReversarEnvio(e({ estado: 'reversado' }))).toBe(false);
  });
});

describe('motivoNoReversable (estado AUTORITATIVO del servicio directo)', () => {
  it('permite reversar un envío enviado cuyo servicio NO está pagado', () => {
    expect(motivoNoReversable(e({ estado: 'enviado' }), false)).toBeNull();
  });
  it('BLOQUEA aunque el envío diga enviado si el servicio directo YA está pagado (estado viejo)', () => {
    expect(motivoNoReversable(e({ estado: 'enviado' }), true)).toMatch(/pagad/i);
  });
  it('bloquea un envío ya marcado pagado o reversado', () => {
    expect(motivoNoReversable(e({ estado: 'pagado' }), false)).toBeTruthy();
    expect(motivoNoReversable(e({ estado: 'reversado' }), false)).toBeTruthy();
  });
});

describe('notaAgrupacion', () => {
  it('junta profesional + concepto + empresa', () => {
    const nota = notaAgrupacion('Abg. Ana', 'Redacción de poder', 'GT');
    expect(nota).toContain('Abg. Ana');
    expect(nota).toContain('Redacción de poder');
    expect(nota).toContain('GT');
  });
});

describe('estadoCuentaProfesional', () => {
  it('agrupa por moneda nativa; USD y Bs por separado, sin reconvertir', () => {
    const gestiones = [
      g({ id: 'g1', moneda: 'USD', costoTotal: 200 }),
      g({ id: 'g2', moneda: 'Bs', costoTotal: 4000 }),
    ];
    const envios = [
      e({ id: 'a', gestionId: 'g1', moneda: 'USD', monto: 50, estado: 'pagado' }),
      e({ id: 'b', gestionId: 'g2', moneda: 'Bs', monto: 1000, estado: 'enviado' }),
    ];
    const cuenta = estadoCuentaProfesional('p1', gestiones, envios);
    expect(cuenta.lineas).toHaveLength(2);
    const monedas = cuenta.porMoneda.map((s) => s.moneda).sort();
    expect(monedas).toEqual(['Bs', 'USD']);
    const usd = cuenta.porMoneda.find((s) => s.moneda === 'USD')!;
    expect(usd).toMatchObject({ costo: 200, pagado: 50, saldo: 150 });
    const bs = cuenta.porMoneda.find((s) => s.moneda === 'Bs')!;
    expect(bs).toMatchObject({ costo: 4000, enviado: 1000, pagado: 0, saldo: 4000 });
    // No existe una fila "total" que mezcle monedas
    expect(cuenta.porMoneda).toHaveLength(2);
  });

  it('excluye gestiones anuladas del saldo por moneda', () => {
    const gestiones = [g({ id: 'g1', moneda: 'USD', costoTotal: 200, estado: 'anulada' })];
    const cuenta = estadoCuentaProfesional('p1', gestiones, []);
    const usd = cuenta.porMoneda.find((s) => s.moneda === 'USD');
    expect(usd?.saldo ?? 0).toBe(0);
  });
});

describe('gestionDelDocumento · qué honorario tramitó este documento', () => {
  const prof = [{ id: 'p1', nombre: 'Abg. Ana Pérez', profesion: 'Abogado', contacto: null, activo: true }];
  const g = {
    id: 'g1', empresaClave: 'GT', profesionalId: 'p1',
    concepto: 'Renovación de permisos mineros', costoTotal: 500, moneda: 'USD',
    estado: 'abierta', fecha: '2026-11-01',
  } as never;

  const doc = (id: string, gestionId: string | null) =>
    ({ id, empresaClave: 'GT', carpeta: 'legal', tipo: 'rupdae', nombre: 'RUPDAE', gestionId } as never);

  it('un documento sin gestión enlazada no devuelve nada', () => {
    expect(gestionDelDocumento(doc('d1', null), [g], [doc('d1', null)], prof as never)).toBeNull();
  });

  it('si la gestión enlazada ya no existe, no inventa nada', () => {
    expect(gestionDelDocumento(doc('d1', 'borrada'), [g], [doc('d1', 'borrada')], prof as never)).toBeNull();
  });

  it('devuelve la gestión y el nombre del profesional, no su clave', () => {
    const r = gestionDelDocumento(doc('d1', 'g1'), [g], [doc('d1', 'g1')], prof as never);
    expect(r?.gestion.concepto).toBe('Renovación de permisos mineros');
    expect(r?.profesionalNombre).toBe('Abg. Ana Pérez');
  });

  it('dice cuántos documentos cubre, para que el costo no se multiplique', () => {
    const docs = [doc('d1', 'g1'), doc('d2', 'g1'), doc('d3', 'g1'), doc('d4', null)];
    const r = gestionDelDocumento(doc('d1', 'g1'), [g], docs, prof as never);
    expect(r?.documentosQueCubre).toBe(3);
  });

  it('con un profesional desconocido no muestra una clave cruda', () => {
    const r = gestionDelDocumento(doc('d1', 'g1'), [g], [doc('d1', 'g1')], [] as never);
    expect(r?.profesionalNombre).toBe('Profesional sin identificar');
  });
});
