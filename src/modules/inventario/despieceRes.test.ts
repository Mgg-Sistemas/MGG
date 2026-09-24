import { describe, it, expect } from 'vitest';
import {
  esDespiezable, normalizarCorte, calcularDespiece, calcularReparto,
  CORTES_SUGERIDOS, TOLERANCIA_KG,
} from './despieceRes';

describe('qué se recibe despiezado', () => {
  it('la res en canal, escrita como sea', () => {
    expect(esDespiezable('RES EN CANAL')).toBe(true);
    expect(esDespiezable('res en canal')).toBe(true);
    // Con espacios de más también: una ficha mal tipeada es la misma res.
    expect(esDespiezable('  Res  En  Canal  ')).toBe(true);
    expect(esDespiezable('RES EN CANAL DE PRIMERA')).toBe(true);
  });

  it('no confunde con algo que apenas se le parece', () => {
    expect(esDespiezable('RESMA EN CANALETA')).toBe(false);
    expect(esDespiezable('CANAL DE RES')).toBe(false);
  });

  it('lo demás no', () => {
    expect(esDespiezable('CARNE MECHADA')).toBe(false);
    expect(esDespiezable('POLLO ENTERO')).toBe(false);
    expect(esDespiezable('')).toBe(false);
    expect(esDespiezable(null)).toBe(false);
  });

  it('los tres cortes de siempre están', () => {
    expect(CORTES_SUGERIDOS).toEqual(['CARNE MECHADA', 'CARNE MOLIDA', 'CARNE PARA BISTEC']);
  });
});

describe('el nombre del corte', () => {
  it('va en mayúscula, sin espacios de más', () => {
    expect(normalizarCorte('  carne   mechada ')).toBe('CARNE MECHADA');
    expect(normalizarCorte('Lomito')).toBe('LOMITO');
    expect(normalizarCorte('')).toBe('');
    expect(normalizarCorte(null)).toBe('');
  });
});

describe('el costo se reparte entre los kg ÚTILES', () => {
  // El caso real: SP-2026-0129, 262,5 kg a $5,30 = $1.391,25.
  const base = { kgRecibidos: 262.5, costoTotal: 1391.25 };

  it('la merma encarece el corte, no se pierde plata', () => {
    const d = calcularDespiece({
      ...base,
      cortes: [
        { nombre: 'CARNE MECHADA', kg: 100 },
        { nombre: 'CARNE MOLIDA', kg: 80 },
        { nombre: 'CARNE PARA BISTEC', kg: 60 },
      ],
      mermaKg: 22.5,
    });
    expect(d.kgUtiles).toBe(240);
    expect(d.costoPorKg).toBeCloseTo(5.7969, 4);   // 1.391,25 ÷ 240, no ÷ 262,5
    expect(d.cuadra).toBe(true);
  });

  it('los subtotales suman EXACTAMENTE lo que dice la factura', () => {
    const d = calcularDespiece({
      ...base,
      cortes: [
        { nombre: 'CARNE MECHADA', kg: 100 },
        { nombre: 'CARNE MOLIDA', kg: 80 },
        { nombre: 'CARNE PARA BISTEC', kg: 60 },
      ],
      mermaKg: 22.5,
    });
    expect(d.totalCortes).toBe(1391.25);
  });

  it('cierra exacto con cualquier reparto, aunque el costo por kg no sea redondo', () => {
    // Si el último corte no absorbiera el redondeo, acá faltarían centavos.
    const repartos = [
      [33.33, 33.33, 33.34],
      [1, 1, 238],
      [79.99, 80.01, 80],
      [240, 0.001, 0.001],
    ];
    for (const [a, b, c] of repartos) {
      const d = calcularDespiece({
        kgRecibidos: round(a + b + c + 22.5), costoTotal: 1391.25,
        cortes: [{ nombre: 'A', kg: a }, { nombre: 'B', kg: b }, { nombre: 'C', kg: c }],
        mermaKg: 22.5,
      });
      expect(d.totalCortes).toBe(1391.25);
    }
  });

  it('con un solo corte, ese corte se lleva todo el costo', () => {
    const d = calcularDespiece({
      ...base, cortes: [{ nombre: 'CARNE MOLIDA', kg: 240 }], mermaKg: 22.5,
    });
    expect(d.cortes[0].subtotal).toBe(1391.25);
    expect(d.cuadra).toBe(true);
  });

  it('sin merma, el costo por kg es el de la compra', () => {
    const d = calcularDespiece({
      ...base, cortes: [{ nombre: 'CARNE MOLIDA', kg: 262.5 }], mermaKg: 0,
    });
    expect(d.costoPorKg).toBeCloseTo(5.3, 4);
    expect(d.costoMerma).toBe(0);
  });

  it('dice cuánto le cargó la merma a los cortes', () => {
    const d = calcularDespiece({
      ...base, cortes: [{ nombre: 'CARNE MOLIDA', kg: 240 }], mermaKg: 22.5,
    });
    // 22,5 kg × $5,7969 ≈ $130,43 que se reparten entre los cortes.
    expect(d.costoMerma).toBeCloseTo(130.43, 1);
  });
});

describe('los kilos tienen que cuadrar', () => {
  const base = { kgRecibidos: 262.5, costoTotal: 1391.25 };

  it('avisa cuando falta repartir', () => {
    const d = calcularDespiece({ ...base, cortes: [{ nombre: 'CARNE MOLIDA', kg: 100 }], mermaKg: 10 });
    expect(d.cuadra).toBe(false);
    expect(d.diferenciaKg).toBe(152.5);
    expect(d.problemas[0]).toContain('Faltan 152.50 kg');
  });

  it('avisa cuando se repartió de más', () => {
    const d = calcularDespiece({ ...base, cortes: [{ nombre: 'CARNE MOLIDA', kg: 300 }], mermaKg: 0 });
    expect(d.cuadra).toBe(false);
    expect(d.problemas[0]).toContain('de más');
  });

  it('un redondeo de balanza no es un error', () => {
    const d = calcularDespiece({ ...base, cortes: [{ nombre: 'CARNE MOLIDA', kg: 240 }], mermaKg: 22.5 - TOLERANCIA_KG });
    expect(d.cuadra).toBe(true);
  });

  it('sin cortes no se puede recibir', () => {
    const d = calcularDespiece({ ...base, cortes: [], mermaKg: 262.5 });
    expect(d.cuadra).toBe(false);
    expect(d.problemas).toContain('Cargá al menos un corte con su peso.');
  });

  it('las filas a medio llenar no cuentan como cortes', () => {
    const d = calcularDespiece({
      ...base,
      cortes: [
        { nombre: 'CARNE MOLIDA', kg: 240 },
        { nombre: '', kg: 50 },        // sin nombre
        { nombre: 'LOMITO', kg: 0 },   // sin peso
      ],
      mermaKg: 22.5,
    });
    expect(d.cortes).toHaveLength(1);
    expect(d.cuadra).toBe(true);
  });

  it('no deja dos veces el mismo corte', () => {
    const d = calcularDespiece({
      ...base,
      cortes: [{ nombre: 'CARNE MOLIDA', kg: 120 }, { nombre: 'carne molida', kg: 120 }],
      mermaKg: 22.5,
    });
    expect(d.cuadra).toBe(false);
    expect(d.problemas.some((p) => p.includes('repetidos'))).toBe(true);
  });

  it('una merma negativa se toma como cero', () => {
    const d = calcularDespiece({ ...base, cortes: [{ nombre: 'X', kg: 262.5 }], mermaKg: -5 });
    expect(d.mermaKg).toBe(0);
    expect(d.cuadra).toBe(true);
  });
});

describe('reparto de los cortes entre cocinas', () => {
  const cortes = calcularDespiece({
    kgRecibidos: 262.5, costoTotal: 1391.25,
    cortes: [
      { nombre: 'CARNE MECHADA', kg: 100 },
      { nombre: 'CARNE MOLIDA', kg: 80 },
      { nombre: 'CARNE PARA BISTEC', kg: 60 },
    ],
    mermaKg: 22.5,
  }).cortes;

  const PINOS = '80ac3a0e-268e-4636-91db-aaa2facb5b08';
  const ESPERANZA = '49d62a59-6968-4e83-925d-3376edaee7d9';

  it('agrupa lo que le toca a cada cocina', () => {
    const r = calcularReparto(cortes, [
      { corte: 'CARNE MECHADA', cocinaId: ESPERANZA, kg: 40 },
      { corte: 'CARNE MOLIDA', cocinaId: ESPERANZA, kg: 30 },
    ]);
    expect(r.cuadra).toBe(true);
    expect(r.porCocina.get(ESPERANZA)).toEqual([
      { corte: 'CARNE MECHADA', kg: 40 },
      { corte: 'CARNE MOLIDA', kg: 30 },
    ]);
  });

  it('lo que no se reparte se queda donde llegó, y no es un error', () => {
    const r = calcularReparto(cortes, [{ corte: 'CARNE MECHADA', cocinaId: ESPERANZA, kg: 40 }]);
    expect(r.cuadra).toBe(true);
    expect(r.quedaEnOrigen).toEqual([
      { corte: 'CARNE MECHADA', kg: 60 },
      { corte: 'CARNE MOLIDA', kg: 80 },
      { corte: 'CARNE PARA BISTEC', kg: 60 },
    ]);
  });

  it('sin reparto, todo se queda', () => {
    const r = calcularReparto(cortes, []);
    expect(r.cuadra).toBe(true);
    expect(r.porCocina.size).toBe(0);
    expect(r.quedaEnOrigen.reduce((a, x) => a + x.kg, 0)).toBe(240);
  });

  it('no deja mandar más de lo que hay de un corte', () => {
    const r = calcularReparto(cortes, [
      { corte: 'CARNE MOLIDA', cocinaId: ESPERANZA, kg: 50 },
      { corte: 'CARNE MOLIDA', cocinaId: PINOS, kg: 50 },
    ]);
    expect(r.cuadra).toBe(false);
    expect(r.problemas[0]).toContain('CARNE MOLIDA');
    expect(r.problemas[0]).toContain('100.00');
  });

  it('dos líneas del mismo corte a la misma cocina se juntan', () => {
    const r = calcularReparto(cortes, [
      { corte: 'CARNE MOLIDA', cocinaId: ESPERANZA, kg: 20 },
      { corte: 'CARNE MOLIDA', cocinaId: ESPERANZA, kg: 15 },
    ]);
    expect(r.porCocina.get(ESPERANZA)).toEqual([{ corte: 'CARNE MOLIDA', kg: 35 }]);
  });

  it('avisa si se reparte un corte que esta res no tiene', () => {
    const r = calcularReparto(cortes, [{ corte: 'LOMITO', cocinaId: ESPERANZA, kg: 5 }]);
    expect(r.cuadra).toBe(false);
    expect(r.problemas[0]).toContain('LOMITO');
  });

  it('las líneas vacías se ignoran', () => {
    const r = calcularReparto(cortes, [
      { corte: '', cocinaId: ESPERANZA, kg: 10 },
      { corte: 'CARNE MOLIDA', cocinaId: '', kg: 10 },
      { corte: 'CARNE MOLIDA', cocinaId: ESPERANZA, kg: 0 },
    ]);
    expect(r.cuadra).toBe(true);
    expect(r.porCocina.size).toBe(0);
  });

  it('el nombre del corte se empata sin importar mayúsculas', () => {
    const r = calcularReparto(cortes, [{ corte: 'carne molida', cocinaId: ESPERANZA, kg: 10 }]);
    expect(r.cuadra).toBe(true);
    expect(r.porCocina.get(ESPERANZA)).toEqual([{ corte: 'CARNE MOLIDA', kg: 10 }]);
  });
});

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

describe('la res se reparte al 100 %', () => {
  const base = { kgRecibidos: 200, costoTotal: 1000, mermaKg: 20 };

  it('cada corte dice qué tajada de la res es', () => {
    const r = calcularDespiece({
      ...base,
      cortes: [{ nombre: 'MECHADA', kg: 90 }, { nombre: 'MOLIDA', kg: 60 }, { nombre: 'BISTEC', kg: 30 }],
    });
    expect(r.cortes.map((c) => c.pct)).toEqual([45, 30, 15]);
  });

  it('consumible y merma suman 100 cuando el despiece cuadra', () => {
    const r = calcularDespiece({
      ...base,
      cortes: [{ nombre: 'MECHADA', kg: 90 }, { nombre: 'MOLIDA', kg: 60 }, { nombre: 'BISTEC', kg: 30 }],
    });
    expect(r.cuadra).toBe(true);
    expect(r.pctUtiles).toBe(90);
    expect(r.pctMerma).toBe(10);
    expect(r.pctUtiles + r.pctMerma).toBe(100);
  });

  it('el % se mide sobre lo que LLEGÓ, no sobre lo aprovechado', () => {
    // Si se midiera sobre los útiles, la mechada daría 50 % y no 45 %.
    const r = calcularDespiece({ ...base, cortes: [{ nombre: 'MECHADA', kg: 90 }, { nombre: 'MOLIDA', kg: 90 }] });
    expect(r.cortes[0].pct).toBe(45);
  });

  it('sin kg recibidos no inventa porcentajes', () => {
    const r = calcularDespiece({ kgRecibidos: 0, costoTotal: 0, mermaKg: 0, cortes: [{ nombre: 'MECHADA', kg: 10 }] });
    expect(r.cortes[0].pct).toBe(0);
    expect(r.pctUtiles).toBe(0);
    expect(r.pctMerma).toBe(0);
  });

  it('una res sin merma se aprovecha entera', () => {
    const r = calcularDespiece({ kgRecibidos: 100, costoTotal: 500, mermaKg: 0, cortes: [{ nombre: 'MECHADA', kg: 100 }] });
    expect(r.pctUtiles).toBe(100);
    expect(r.pctMerma).toBe(0);
  });
});
