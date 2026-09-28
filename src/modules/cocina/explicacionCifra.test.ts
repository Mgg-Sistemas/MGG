import { describe, expect, it } from 'vitest';
import type { CocinaComida } from '@/shared/lib/types';
import type { DisponibleItem, KardexRow } from './mercados.repository';
import { explicarCifra, TOPE_RENGLONES, type ClaveCifra, type DatosCifra } from './explicacionCifra';

const viver = (nombre: string, p: Partial<DisponibleItem> = {}): DisponibleItem => ({
  producto_id: `p-${nombre}`, sku: nombre, nombre, unidad: 'KILOGRAMO', precio: 1,
  saldoInicial: 0, entradas: 0, traslados: 0, consumos: 0, mermas: 0, disponible: 0, queda: 0, ...p,
});

const DISPONIBLE: DisponibleItem[] = [
  viver('ARROZ', { saldoInicial: 100, entradas: 50, consumos: 30, queda: 120, disponible: 150 }),
  viver('POLLO', { saldoInicial: 40, entradas: 10, consumos: 45, queda: 5, disponible: 50, mermas: 2 }),
  viver('ACEITE', { saldoInicial: 5, traslados: -15, queda: -10, disponible: -10 }),
];

const KARDEX: KardexRow[] = [
  { kind: 'entrada', at: '2026-09-25T12:00:00Z', producto_id: 'p-ARROZ', nombre: 'ARROZ', unidad: 'KILOGRAMO', cantidad: 50, valor: 120, detalle: null, almacen: 'Los Pinos' },
  { kind: 'traslado', id: 't1', at: '2026-09-24T12:00:00Z', producto_id: 'p-ACEITE', nombre: 'ACEITE', unidad: 'KILOGRAMO', cantidad: -15, valor: 30, detalle: null, almacen: 'Los Pinos', contraparte: 'La Esperanza', interno: false, codigo: 'TRA-2026-0010', sinLlegada: 0 },
  { kind: 'merma', at: '2026-09-26T12:00:00Z', producto_id: 'p-POLLO', nombre: 'POLLO', unidad: 'KILOGRAMO', cantidad: 2, valor: 8, tipo: 'perdida', detalle: null, almacen: 'Los Pinos', actor_name: 'ISNER' },
  { kind: 'consumo', at: '2026-09-25T12:00:00Z', items: 2, cantidad: 75, comida: { id: 'c1', codigo: 'COC-1', tipo_comida: 'desayuno', platos: 45, valor_total: 40, items: [], at: '2026-09-25T12:00:00Z' } as unknown as CocinaComida },
  { kind: 'consumo', at: '2026-09-26T12:00:00Z', items: 1, cantidad: 10, comida: { id: 'c2', codigo: 'COC-2', tipo_comida: 'almuerzo', platos: 60, valor_total: 55, items: [], at: '2026-09-26T12:00:00Z' } as unknown as CocinaComida },
];

const num = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

const DATOS: DatosCifra = {
  totales: {
    saldoInicial: 145, entradas: 60, traslados: -15, disponible: 190, consumos: 75, mermas: 2, queda: 113,
    inventario: null, diferencia: null, vieresConDiferencia: 0,
  },
  costo: { platos: 105, consumo: 95, entradas: 120, porPlato: 0.9 },
  mermasValor: 8,
  disponible: DISPONIBLE,
  kardex: KARDEX,
  inventarioAl: null,
  dia: 14,
  num,
  money: (n) => `$ ${num(n)}`,
  etiquetaComida: (t) => (t === 'desayuno' ? 'Desayuno' : t === 'almuerzo' ? 'Almuerzo' : t),
};

const TODAS: ClaveCifra[] = [
  'saldoInicial', 'entradas', 'traslados', 'disponible', 'consumos', 'mermas', 'queda',
  'platos', 'costoConsumo', 'costoPorPlato', 'entradasValoradas', 'mermasValoradas',
];

describe('explicarCifra · todas las tarjetas', () => {
  it('cada una tiene título, qué es y un ojo que leer', () => {
    for (const clave of TODAS) {
      const e = explicarCifra(clave, DATOS);
      expect(e.titulo.length, clave).toBeGreaterThan(2);
      expect(e.queEs.length, clave).toBeGreaterThan(10);
      expect(e.ojo, clave).toBeTruthy();
    }
  });

  it('nunca lista más de TOPE_RENGLONES víveres sin decir cuántos faltan', () => {
    const muchos = Array.from({ length: 20 }, (_, i) => viver(`V${i}`, { queda: 20 - i }));
    const e = explicarCifra('queda', { ...DATOS, disponible: muchos });
    expect(e.renglones.length).toBe(TOPE_RENGLONES);
    expect(e.restantes).toBe(20 - TOPE_RENGLONES);
  });
});

describe('explicarCifra · las cuentas', () => {
  it('Disponible muestra la ecuación con los números puestos', () => {
    const e = explicarCifra('disponible', DATOS);
    expect(e.cuenta).toContain('145');
    expect(e.cuenta).toContain('60');
    expect(e.cuenta).toContain('190');
  });

  it('Queda muestra disponible − consumo − mermas', () => {
    const e = explicarCifra('queda', DATOS);
    expect(e.cuenta).toContain('190');
    expect(e.cuenta).toContain('113');
  });

  it('Traslados separa lo enviado de lo recibido', () => {
    const e = explicarCifra('traslados', DATOS);
    expect(e.cuenta).toContain('15');
    expect(e.cuenta).toContain('enviado');
    expect(e.cuenta).toContain('recibido');
  });

  it('Costo por plato divide, y sin platos no inventa un cero', () => {
    expect(explicarCifra('costoPorPlato', DATOS).cuenta).toContain('0,9');
    const sinPlatos = { ...DATOS, costo: { platos: 0, consumo: 0, entradas: 0, porPlato: null } };
    const e = explicarCifra('costoPorPlato', sinPlatos);
    expect(e.cuenta).toBeNull();
    expect(e.ojo).toContain('Todavía no se sirvió');
  });
});

describe('explicarCifra · lo que avisa', () => {
  it('Queda avisa del descuadre contra el inventario', () => {
    const e = explicarCifra('queda', {
      ...DATOS,
      totales: { ...DATOS.totales, inventario: 100, diferencia: -13, vieresConDiferencia: 3 },
      inventarioAl: '26/09/2026',
    });
    expect(e.ojo).toContain('26/09/2026');
    expect(e.ojo).toContain('3 víveres');
  });

  it('Queda avisa de los víveres en negativo y explica que no es un error', () => {
    expect(explicarCifra('queda', DATOS).ojo).toContain('negativo');
  });

  it('sin descuadre ni negativos, Queda habla del arrastre al ciclo nuevo', () => {
    const limpio = DATOS.disponible.map((v) => ({ ...v, queda: Math.abs(v.queda) }));
    const e = explicarCifra('queda', { ...DATOS, disponible: limpio });
    expect(e.ojo).toContain('no se descarta nada');
  });

  it('Traslados avisa cuando una salida no aparece llegando', () => {
    const conPerdido = KARDEX.map((k) => (k.kind === 'traslado' ? { ...k, sinLlegada: 15 } : k));
    expect(explicarCifra('traslados', { ...DATOS, kardex: conPerdido }).ojo).toContain('no aparece su llegada');
  });

  it('Consumo aclara que una salida manual no es consumo', () => {
    expect(explicarCifra('consumos', DATOS).ojo).toContain('Mermas / salidas');
  });

  it('Mermas aclara que no suben el costo por plato', () => {
    expect(explicarCifra('mermas', DATOS).ojo).toContain('costo por plato');
  });
});

describe('explicarCifra · el detalle', () => {
  it('Consumo abre por tipo de comida y después por víver', () => {
    const e = explicarCifra('consumos', DATOS);
    expect(e.renglones[0]).toEqual({ nombre: 'Desayuno', valor: '45 platos', nota: '1 registro' });
    expect(e.renglones[1]).toEqual({ nombre: 'Almuerzo', valor: '60 platos', nota: '1 registro' });
    expect(e.renglones.some((r) => r.nombre === 'POLLO')).toBe(true);
  });

  it('Mermas dice quién las cargó', () => {
    expect(explicarCifra('mermas', DATOS).renglones[0].nombre).toBe('Cargadas por ISNER');
  });

  it('los víveres van de mayor a menor y los que no se movieron no aparecen', () => {
    const e = explicarCifra('entradas', DATOS);
    expect(e.renglones.map((r) => r.nombre)).toEqual(['ARROZ', 'POLLO']);
  });

  it('ordena por valor absoluto: un traslado enviado pesa igual que uno recibido', () => {
    const e = explicarCifra('traslados', DATOS);
    expect(e.renglones[0].nombre).toBe('ACEITE');
    expect(e.renglones[0].valor).toContain('-15');
  });
});
