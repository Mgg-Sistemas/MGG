import { describe, it, expect } from 'vitest';
import type { Orden, Proveedor } from '@/shared/lib/types';
import {
  creadorDeOrden, filtrarOrdenes, filtrarPorCreador, formasDeFecha, opcionesCreador, textoBuscableOrden,
} from './buscarOrdenes';

/* Tres órdenes como las que hay en la base, con lo justo para que cada prueba
   tenga un dato que la distinga de las otras dos. */

const ferreteria: Proveedor = {
  id: 'prov-1', rif: 'J-12345678-9', razon_social: 'FERRETERÍA EL TORNILLO C.A.',
  numero_administracion: '0414-5551234', categorias: [], origen: 'nacional', estado: 'activo', created_at: '2026-01-01',
};

const base: Orden = {
  id: 'o-0', codigo: 'SP-2026-0001', proveedor_id: null, solicitante_email: 'x@mgg.com',
  items: [], total: 0, estado: 'pendiente', historial: [], created_at: '2026-01-01T12:00:00Z',
};

const tornillos: Orden = {
  ...base, id: 'o-1', codigo: 'SP-2026-0150', oc_codigo: 'OC-2026-0186', proveedor_id: 'prov-1',
  solicitante: 'FUNDICIÓN', ci_solicitante: 'ENDER MEJÍAS', estado: 'oc_aprobada', total: 2946.59,
  moneda: 'USD', almacen_destino: 'CENTRO DE FUNDICION - MATANZAS', numero_administracion: '0414-5551234',
  items: [
    { sku: 'FER-0042', nombre: 'TORNILLO HEXAGONAL 1/2"', cantidad: 100, precio: 1.25, unidad: 'und' },
    { sku: 'FER-0099', nombre: 'ELECTRODO 6013', cantidad: 20, precio: 141.08, unidad: 'KG' },
  ],
  metodo_pago: [{ metodo: 'pago_movil', moneda: 'Bs', monto: 2946.59 }],
  created_at: '2026-10-16T14:30:00Z', // 10:30 a. m. en Venezuela, mismo día
  // La OC la creó Kelvin (analista de compras); la OP la cargó otra persona.
  oc_creada_por: 'kelvin@mgg.com', oc_creada_en: '2026-10-16T15:00:00Z',
  historial: [
    { at: '2026-10-16T14:30:00Z', evento: 'creada', actor: 'x@mgg.com' },
    { at: '2026-10-16T15:00:00Z', evento: 'oc_creada', actor: 'kelvin@mgg.com' },
  ],
};

const camion: Orden = {
  ...base, id: 'o-2', codigo: 'SP-2026-0151', solicitante: 'MAQUINARIA', estado: 'pendiente',
  total: 850, items: [{ sku: 'REP-0007', nombre: 'FILTRO DE ACEITE CAMIÓN', cantidad: 2, precio: 425 }],
  created_at: '2026-09-03T20:00:00Z', urgente: true,
  // OP sin OC todavía: la «realizó» quien la cargó.
  solicitante_email: 'isner@mgg.com',
  historial: [{ at: '2026-09-03T20:00:00Z', evento: 'creada', actor: 'isner@mgg.com' }],
};

const gas: Orden = {
  ...base, id: 'o-3', codigo: 'SV-2026-0018', clase: 'servicio', solicitante: 'COCINA',
  solicitante_persona: 'LEYDIS RENGEL', estado: 'finalizada', total: 120, moneda: 'Bs',
  items: [{ sku: 'SRV-1', nombre: 'RECARGA DE GAS · 4 BOMBONAS', cantidad: 1, precio: 120, servicio_categoria: 'RECARGA DE GAS' }],
  created_at: '2026-08-20T13:00:00Z',
  // OC vieja: sin oc_creada_por en la columna, pero el historial sabe quién la creó.
  oc_codigo: 'OC-2026-0020',
  historial: [
    { at: '2026-08-20T13:00:00Z', evento: 'creada', actor: 'x@mgg.com' },
    { at: '2026-08-21T13:00:00Z', evento: 'oc_creada', actor: 'KELVIN@mgg.com' },
  ],
};

const todas = [tornillos, camion, gas];
const NOMBRES: Record<string, string> = { 'kelvin@mgg.com': 'KELVIN PEÑA', 'isner@mgg.com': 'ISNER ROJAS' };
const ctx = {
  proveedor: (o: Orden) => (o.proveedor_id === 'prov-1' ? ferreteria : null),
  labelMetodo: (m: string | null | undefined) => (m === 'pago_movil' ? 'Pago móvil' : m ?? ''),
  nombreDe: (e: string | null | undefined) => (e ? NOMBRES[e.toLowerCase()] : undefined),
};
const codigos = (os: Orden[]) => os.map((o) => o.codigo);

describe('filtrarOrdenes · buscador ampliado de Órdenes de Compra', () => {
  it('sin texto devuelve todo', () => {
    expect(filtrarOrdenes(todas, '   ')).toBe(todas);
  });

  it('no distingue acentos ni mayúsculas', () => {
    expect(codigos(filtrarOrdenes(todas, 'fundicion'))).toEqual(['SP-2026-0150']);
    expect(codigos(filtrarOrdenes(todas, 'MEJIAS'))).toEqual(['SP-2026-0150']);
    expect(codigos(filtrarOrdenes(todas, 'camión'))).toEqual(['SP-2026-0151']);
  });

  it('varias palabras: TODAS deben estar, en cualquier orden', () => {
    expect(codigos(filtrarOrdenes(todas, 'tornillo fundicion'))).toEqual(['SP-2026-0150']);
    expect(codigos(filtrarOrdenes(todas, 'fundicion tornillo'))).toEqual(['SP-2026-0150']);
    // «tornillo» está en una y «cocina» en otra: ninguna tiene las dos.
    expect(filtrarOrdenes(todas, 'tornillo cocina')).toEqual([]);
  });

  it('encuentra por el nombre y por el SKU de los renglones', () => {
    expect(codigos(filtrarOrdenes(todas, 'electrodo'))).toEqual(['SP-2026-0150']);
    expect(codigos(filtrarOrdenes(todas, 'FER-0099'))).toEqual(['SP-2026-0150']);
    expect(codigos(filtrarOrdenes(todas, 'rep-0007'))).toEqual(['SP-2026-0151']);
  });

  it('monto con coma, con punto, con o sin separador de miles', () => {
    expect(codigos(filtrarOrdenes(todas, '2946,59'))).toEqual(['SP-2026-0150']);
    expect(codigos(filtrarOrdenes(todas, '2946.59'))).toEqual(['SP-2026-0150']);
    expect(codigos(filtrarOrdenes(todas, '2.946,59'))).toEqual(['SP-2026-0150']);
    // El precio de un renglón también cuenta.
    expect(codigos(filtrarOrdenes(todas, '141,08'))).toEqual(['SP-2026-0150']);
  });

  it('fecha de creación en dd/mm/yyyy o yyyy-mm-dd (día de Venezuela)', () => {
    expect(codigos(filtrarOrdenes(todas, '16/10/2026'))).toEqual(['SP-2026-0150']);
    expect(codigos(filtrarOrdenes(todas, '2026-09-03'))).toEqual(['SP-2026-0151']);
    expect(codigos(filtrarOrdenes(todas, '20-08-2026'))).toEqual(['SV-2026-0018']);
  });

  it('estado por su etiqueta en español y por su clave', () => {
    expect(codigos(filtrarOrdenes(todas, 'confirmada pagar'))).toEqual(['SP-2026-0150']);
    expect(codigos(filtrarOrdenes(todas, 'oc_aprobada'))).toEqual(['SP-2026-0150']);
    expect(codigos(filtrarOrdenes(todas, 'finalizada'))).toEqual(['SV-2026-0018']);
  });

  it('proveedor (nombre y RIF), teléfono de administración, sede destino y código de OC', () => {
    expect(codigos(filtrarOrdenes(todas, 'ferreteria', ctx))).toEqual(['SP-2026-0150']);
    expect(codigos(filtrarOrdenes(todas, 'J-12345678-9', ctx))).toEqual(['SP-2026-0150']);
    expect(codigos(filtrarOrdenes(todas, '0414-5551234'))).toEqual(['SP-2026-0150']);
    expect(codigos(filtrarOrdenes(todas, 'matanzas'))).toEqual(['SP-2026-0150']);
    expect(codigos(filtrarOrdenes(todas, 'OC-2026-0186'))).toEqual(['SP-2026-0150']);
    // Sin contexto el proveedor no está (la fila solo guarda su id): no inventa nada.
    expect(filtrarOrdenes(todas, 'ferreteria')).toEqual([]);
  });

  it('método de pago (clave, etiqueta en español), moneda, urgencia y categoría del servicio', () => {
    expect(codigos(filtrarOrdenes(todas, 'pago movil'))).toEqual(['SP-2026-0150']);
    expect(codigos(filtrarOrdenes(todas, 'pago móvil', ctx))).toEqual(['SP-2026-0150']);
    expect(codigos(filtrarOrdenes(todas, 'urgente'))).toEqual(['SP-2026-0151']);
    expect(codigos(filtrarOrdenes(todas, 'recarga de gas'))).toEqual(['SV-2026-0018']);
    expect(codigos(filtrarOrdenes(todas, 'leydis'))).toEqual(['SV-2026-0018']);
    // La moneda: 'Bs' solo la tiene el servicio; «usd» es el valor por defecto de las otras.
    expect(codigos(filtrarOrdenes(todas, 'bs cocina'))).toEqual(['SV-2026-0018']);
  });

  it('encuentra por quién la realizó: por el correo y, con el mapa de usuarios, por el nombre', () => {
    expect(codigos(filtrarOrdenes(todas, 'kelvin@mgg.com'))).toEqual(['SP-2026-0150', 'SV-2026-0018']);
    expect(codigos(filtrarOrdenes(todas, 'kelvin peña', ctx))).toEqual(['SP-2026-0150', 'SV-2026-0018']);
    expect(codigos(filtrarOrdenes(todas, 'KELVIN PENA', ctx))).toEqual(['SP-2026-0150', 'SV-2026-0018']);
    expect(codigos(filtrarOrdenes(todas, 'isner rojas', ctx))).toEqual(['SP-2026-0151']);
    // Sin el mapa no se conoce el nombre: no inventa nada.
    expect(filtrarOrdenes(todas, 'kelvin peña')).toEqual([]);
    // Se combina con el resto del texto (AND).
    expect(codigos(filtrarOrdenes(todas, 'kelvin gas', ctx))).toEqual(['SV-2026-0018']);
  });
});

describe('Realizada por · creadorDeOrden / opcionesCreador / filtrarPorCreador', () => {
  it('la OC la realizó quien está en oc_creada_por; si falta, el actor del evento oc_creada; una OP sin OC, quien la cargó', () => {
    expect(creadorDeOrden(tornillos)).toBe('kelvin@mgg.com');
    expect(creadorDeOrden(gas)).toBe('kelvin@mgg.com');          // del historial, en minúscula
    expect(creadorDeOrden(camion)).toBe('isner@mgg.com');        // evento 'creada' / solicitante_email
    expect(creadorDeOrden({ ...base, historial: [] })).toBe('x@mgg.com'); // respaldo: solicitante_email
    expect(creadorDeOrden({ ...base, historial: [], solicitante_email: '' })).toBe('');
  });

  it('el desplegable trae a cada usuario una sola vez, con su nombre (o el correo) y en orden alfabético', () => {
    expect(opcionesCreador(todas, ctx.nombreDe)).toEqual([
      { email: 'isner@mgg.com', label: 'ISNER ROJAS' },
      { email: 'kelvin@mgg.com', label: 'KELVIN PEÑA' },
    ]);
    // Sin mapa de usuarios se muestra el correo.
    expect(opcionesCreador([camion]).map((c) => c.label)).toEqual(['isner@mgg.com']);
    expect(opcionesCreador([])).toEqual([]);
  });

  it('al elegir «KELVIN PEÑA» se ven todas las OC de ese usuario; vacío = todos', () => {
    expect(codigos(filtrarPorCreador(todas, 'kelvin@mgg.com'))).toEqual(['SP-2026-0150', 'SV-2026-0018']);
    expect(codigos(filtrarPorCreador(todas, 'KELVIN@MGG.COM'))).toEqual(['SP-2026-0150', 'SV-2026-0018']);
    expect(codigos(filtrarPorCreador(todas, 'isner@mgg.com'))).toEqual(['SP-2026-0151']);
    expect(filtrarPorCreador(todas, '')).toBe(todas);
    expect(filtrarPorCreador(todas, 'nadie@mgg.com')).toEqual([]);
    // Como en el Histórico: primero el usuario, después el texto.
    expect(codigos(filtrarOrdenes(filtrarPorCreador(todas, 'kelvin@mgg.com'), 'tornillo', ctx))).toEqual(['SP-2026-0150']);
  });
});

describe('textoBuscableOrden / formasDeFecha', () => {
  it('el texto sale normalizado (sin acentos, en minúscula) y con el estado en español', () => {
    const t = textoBuscableOrden(tornillos, ctx);
    expect(t).toContain('fundicion');
    expect(t).toContain('confirmada pagar');
    expect(t).toContain('ferreteria el tornillo');
    expect(t).not.toMatch(/[ÁÉÍÓÚáéíóú]/);
  });

  it('una fecha ISO sale en las formas que alguien teclea', () => {
    const f = formasDeFecha('2026-10-16T14:30:00Z');
    expect(f).toContain('16/10/2026');
    expect(f).toContain('2026-10-16');
    expect(f).toContain('16-10-2026');
    // Fecha pura, sin hora: se respeta el día tal cual.
    expect(formasDeFecha('2026-02-01')).toContain('01/02/2026');
    expect(formasDeFecha(null)).toBe('');
    expect(formasDeFecha('no es fecha')).toBe('');
  });
});
