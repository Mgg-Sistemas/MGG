import { describe, it, expect } from 'vitest';
import { grossDe, itemHijaDesdeOferta, itemsAgregadosPorOferta, ofertaCubreTodoLoPendiente, recortarOfertaAHija, skusAbsorbiblesPorHija, skusSinCotizar } from './subOc';

// Caso real SP-2026-0116 (27/08/2026).
const TU_PUNTO = {
  precio_total: 25.5,
  precio_efectivo: null,
  descuento: null,
  iva: null,
  igtf: null,
  items: [
    { sku: 'NEW-346', cantidad: 1, precio: 9 },
    { sku: 'NEW-347', cantidad: 1, precio: 8.5 },
    { sku: 'NEW-348', cantidad: 1, precio: 5 },
    { sku: 'NEW-349', cantidad: 1, precio: 3 },
  ],
};
const FERRETERIA_PRINCIPAL = {
  precio_total: 18.43,
  precio_efectivo: null,
  descuento: null,
  iva: 2.95,
  igtf: null,
  items: [
    { sku: 'NEW-346', cantidad: 1, precio: 0 },
    { sku: 'NEW-347', cantidad: 1, precio: 10.52 },
    { sku: 'NEW-348', cantidad: 1, precio: 5.59 },
    { sku: 'NEW-349', cantidad: 1, precio: 2.32 },
  ],
};

describe('grossDe', () => {
  it('suma cantidad × precio ignorando los que no se compran', () => {
    expect(grossDe([{ sku: 'A', cantidad: 2, precio: 1.5 }, { sku: 'B', cantidad: 1, precio: 10, comprar: false }])).toBe(3);
  });
});

describe('skusAbsorbiblesPorHija', () => {
  const madre = ['NEW-346', 'NEW-347', 'NEW-348', 'NEW-349'];

  it('con la hermana viva, la hija solo puede tomar lo suyo', () => {
    expect(skusAbsorbiblesPorHija(['NEW-346'], madre, ['NEW-347', 'NEW-348', 'NEW-349'])).toEqual(['NEW-346']);
  });

  it('cancelada la hermana (SP-2026-0116-2), la -1 puede absorber sus 3 productos', () => {
    expect(skusAbsorbiblesPorHija(['NEW-346'], madre, []).sort()).toEqual(madre);
  });

  it('nunca duplica lo que otra hija viva ya compra', () => {
    expect(skusAbsorbiblesPorHija(['NEW-346'], madre, ['NEW-347']).sort()).toEqual(['NEW-346', 'NEW-348', 'NEW-349']);
  });
});

describe('skusSinCotizar', () => {
  it('detecta los ítems de la hija que la oferta no cotiza o cotiza en $0', () => {
    const hija = [{ sku: 'NEW-346', cantidad: 1, precio: 9 }, { sku: 'NEW-347', cantidad: 1, precio: 8.5 }];
    // FERRETERIA PRINCIPAL cotiza la PIQUETA (NEW-346) en $0 → no sirve para esa hija.
    expect(skusSinCotizar(hija, FERRETERIA_PRINCIPAL.items)).toEqual(['NEW-346']);
    // TU PUNTO cotiza los dos → nada falta.
    expect(skusSinCotizar(hija, TU_PUNTO.items)).toEqual([]);
  });

  it('ignora los ítems que la hija no compra', () => {
    const hija = [{ sku: 'NEW-999', cantidad: 1, precio: 1, comprar: false }];
    expect(skusSinCotizar(hija, TU_PUNTO.items)).toEqual([]);
  });
});

describe('recortarOfertaAHija', () => {
  it('la hija de TU PUNTO con solo la PIQUETA vale $9, no $25,50', () => {
    const r = recortarOfertaAHija(TU_PUNTO, ['NEW-346']);
    expect(r.items.map((i) => i.sku)).toEqual(['NEW-346']);
    expect(r.precio_total).toBe(9);
    expect(r.iva).toBeNull();
    expect(r.fraccion).toBeCloseTo(9 / 25.5, 6);
  });

  it('la hija de FERRETERIA PRINCIPAL con los otros 3 conserva TODO el IVA (fracción 1)', () => {
    const r = recortarOfertaAHija(FERRETERIA_PRINCIPAL, ['NEW-347', 'NEW-348', 'NEW-349']);
    expect(r.precio_total).toBe(18.43);
    expect(r.fraccion).toBe(1);
    expect(r.iva).toBe(2.95);
    expect(r.igtf).toBeNull();
  });

  it('prorratea IVA, IGTF, descuento y efectivo por la fracción de la hija', () => {
    const r = recortarOfertaAHija(
      { ...TU_PUNTO, iva: 4.08, igtf: 0.77, descuento: 2, precio_efectivo: 24 },
      ['NEW-346', 'NEW-348'], // 9 + 5 = 14 de 25.50
    );
    const frac = 14 / 25.5;
    expect(r.precio_total).toBe(14);
    expect(r.iva).toBe(Math.round(4.08 * frac * 100) / 100);
    expect(r.igtf).toBe(Math.round(0.77 * frac * 100) / 100);
    expect(r.descuento).toBe(Math.round(2 * frac * 100) / 100);
    expect(r.precio_efectivo).toBe(Math.round(24 * frac * 100) / 100);
  });

  it('una hija con TODOS los ítems recibe la oferta entera (fracción 1)', () => {
    const r = recortarOfertaAHija({ ...TU_PUNTO, iva: 4.08 }, ['NEW-346', 'NEW-347', 'NEW-348', 'NEW-349']);
    expect(r.precio_total).toBe(25.5);
    expect(r.iva).toBe(4.08);
    expect(r.fraccion).toBe(1);
  });

  it('SKUs que la oferta no cotiza no aparecen y no aportan fracción', () => {
    const r = recortarOfertaAHija(TU_PUNTO, ['NEW-999']);
    expect(r.items).toEqual([]);
    expect(r.precio_total).toBe(0);
    expect(r.fraccion).toBe(0);
    expect(r.iva).toBeNull();
  });

  it('si la oferta no trae precio_total usa la suma de sus ítems como base', () => {
    const r = recortarOfertaAHija({ ...TU_PUNTO, precio_total: 0, iva: 2.55 }, ['NEW-346']);
    expect(r.fraccion).toBeCloseTo(9 / 25.5, 6);
    expect(r.iva).toBe(0.9);
  });

  it('la fracción nunca supera 1 aunque la hija sume más que el precio_total declarado', () => {
    const r = recortarOfertaAHija({ ...TU_PUNTO, precio_total: 10, iva: 1 }, ['NEW-346', 'NEW-347']);
    expect(r.fraccion).toBe(1);
    expect(r.iva).toBe(1);
  });

  it('si la oferta tiene 1 ítem y no coincide SKU, conserva el ítem y prorratea el IVA completo', () => {
    const r = recortarOfertaAHija(
      { precio_total: 30, iva: 4.8, items: [{ sku: 'PROD-A', cantidad: 1, precio: 30 }] },
      ['OTRO-SKU'],
    );
    expect(r.items.length).toBe(1);
    expect(r.precio_total).toBe(30);
    expect(r.iva).toBe(4.8);
    expect(r.fraccion).toBe(1);
  });
});

/* ──────────────────────────────────────────────────────────────────────────
   Descarte de ofertas hermanas al aceptar una (caso real SP-2026-0123):
   se aceptó AZOCAR para 2 filtros y las otras 3 ofertas quedaron «Descartada»,
   dejando los ítems restantes sin con qué comprarse. Solo se descarta cuando
   la compra queda COMPLETA.
   ────────────────────────────────────────────────────────────────────────── */
describe('ofertaCubreTodoLoPendiente', () => {
  const ORDEN = [
    { sku: 'F-1' }, { sku: 'F-2' }, { sku: 'F-3' }, { sku: 'F-4' },
  ];

  it('no cubre todo si la oferta cotiza solo una parte (multiproveedor)', () => {
    const azocar = [{ sku: 'F-1', precio: 59 }, { sku: 'F-2', precio: 59 }];
    expect(ofertaCubreTodoLoPendiente(ORDEN, [], azocar)).toBe(false);
  });

  it('cubre todo si la oferta cotiza todos los ítems (proveedor único)', () => {
    const completa = ORDEN.map((it) => ({ sku: it.sku, precio: 10 }));
    expect(ofertaCubreTodoLoPendiente(ORDEN, [], completa)).toBe(true);
  });

  it('suma lo que ya compran las sub-OCs vivas', () => {
    const hijas = [{ items: [{ sku: 'F-1' }, { sku: 'F-2' }], estado: 'oc_creada' }];
    const resto = [{ sku: 'F-3', precio: 20 }, { sku: 'F-4', precio: 20 }];
    expect(ofertaCubreTodoLoPendiente(ORDEN, hijas, resto)).toBe(true);
  });

  it('una sub-OC cancelada NO cubre: sus ítems vuelven a quedar libres', () => {
    const hijas = [{ items: [{ sku: 'F-1' }, { sku: 'F-2' }], estado: 'cancelada' }];
    const resto = [{ sku: 'F-3', precio: 20 }, { sku: 'F-4', precio: 20 }];
    expect(ofertaCubreTodoLoPendiente(ORDEN, hijas, resto)).toBe(false);
  });

  it('un ítem cotizado en 0 no cuenta como cubierto', () => {
    const conCero = [
      { sku: 'F-1', precio: 10 }, { sku: 'F-2', precio: 10 },
      { sku: 'F-3', precio: 10 }, { sku: 'F-4', precio: 0 },
    ];
    expect(ofertaCubreTodoLoPendiente(ORDEN, [], conCero)).toBe(false);
  });

  it('los ítems marcados «no comprar» no exigen cobertura', () => {
    const orden = [{ sku: 'F-1' }, { sku: 'F-2' }, { sku: 'F-3', comprar: false }];
    const oferta = [{ sku: 'F-1', precio: 5 }, { sku: 'F-2', precio: 5 }];
    expect(ofertaCubreTodoLoPendiente(orden, [], oferta)).toBe(true);
  });
});

describe('la sub-OC compra lo que el proveedor cotizó (SP-2026-0184-1, 14-10-2026)', () => {
  const op = { sku: 'VIV-139', nombre: 'CUBITO DE POLLO MAGGI', cantidad: 240, precio: 0, unidad: 'und', finalidad: 'Cocina', area: 'COCINA', comprar: true as boolean | undefined };
  it('la cantidad sale de la cotización; finalidad y área del solicitante se conservan', () => {
    const h = itemHijaDesdeOferta(op, { sku: 'VIV-139', nombre: 'CUBITO MAGGI 10G', cantidad: 250, precio: 0.19, unidad: 'und' }, 0.19);
    expect(h.cantidad).toBe(250);
    expect(h.precio).toBe(0.19);
    expect(h.nombre).toBe('CUBITO DE POLLO MAGGI');
    expect(h.finalidad).toBe('Cocina');
    expect(h.comprar).toBe(true);
  });
  it('sin cantidad cotizada (o sin renglón) queda la de la solicitud', () => {
    expect(itemHijaDesdeOferta(op, { sku: 'VIV-139', cantidad: 0, precio: 0.19 }, 0.19).cantidad).toBe(240);
    expect(itemHijaDesdeOferta(op, undefined, 0.19).cantidad).toBe(240);
  });
  it('los renglones que el proveedor agregó entran a su sub-OC; los de $0 o descartados no', () => {
    const oferta = [
      { sku: 'VIV-139', cantidad: 250, precio: 0.19 },
      { sku: 'VIV-124', cantidad: 2, precio: 23.9 },
      { sku: 'LIM-020', cantidad: 3, precio: 0 },
      { sku: 'INS-999', cantidad: 1, precio: 5, comprar: false },
    ];
    expect(itemsAgregadosPorOferta(oferta, ['VIV-139']).map((x) => x.sku)).toEqual(['VIV-124']);
    expect(itemsAgregadosPorOferta(oferta, ['VIV-139', 'VIV-124'])).toEqual([]);
  });
});

describe('recorte a la hija con IVA adentro y ajuste (14-10-2026)', () => {
  it('la bandera pasa tal cual y el ajuste se prorratea con su signo y su motivo', () => {
    const rec = recortarOfertaAHija({
      items: [{ sku: 'A', cantidad: 1, precio: 60 }, { sku: 'B', cantidad: 1, precio: 40 }],
      precio_total: 100, iva: 13.79, iva_incluido: true, ajuste: -1, ajuste_motivo: 'redondeo',
    }, ['A']);
    expect(rec.fraccion).toBe(0.6);
    expect(rec.iva_incluido).toBe(true);
    expect(rec.iva).toBe(8.27);
    expect(rec.ajuste).toBe(-0.6);
    expect(rec.ajuste_motivo).toBe('redondeo');
  });

  it('sin ajuste ni bandera, la hija nace sin ellos', () => {
    const rec = recortarOfertaAHija({ items: [{ sku: 'A', cantidad: 1, precio: 10 }], precio_total: 10 }, ['A']);
    expect(rec.iva_incluido).toBe(false);
    expect(rec.ajuste).toBeNull();
    expect(rec.ajuste_motivo).toBeNull();
  });
});
