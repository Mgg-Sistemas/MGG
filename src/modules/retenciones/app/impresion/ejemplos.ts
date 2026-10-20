/* ============================================================
   MGG · Retenciones · Impresión · Datos inventados para probar la impresión

   Pedido de Master (20/10 13:26): la tabla de retenciones de producción está
   vacía y registrar una de verdad gasta un N° de comprobante legal. Para que
   el usuario pruebe la impresión, «🖨 Ejemplo de impresión» abre las mismas
   hojas con estos datos, como los de la maqueta (Proveedor Alfa C.A.,
   J-00000001-0…), y la marca «EJEMPLO». Solo en local: el botón no existe
   fuera de import.meta.env.DEV, y nada de esto toca la base.
   ============================================================ */

import type { DatosComprobante, DatosRelacion, FilaComprobante, FilaRelacion, Impuesto } from './tipos';

const AGENTE = { razon: 'Empresa de Ejemplo C.A.', rif: 'J-00000000-0', direccion: 'Zona industrial, galpón 1 (ejemplo)', licencia: '000000 (ejemplo)' };
const SUJETO = { nombre: 'Proveedor Alfa C.A.', rif: 'J-00000001-0', direccion: 'Av. Principal, local 2 (ejemplo)', licencia: '000001 (ejemplo)', idMunicipal: '0001' };
const PROVEEDORES = ['Proveedor Alfa C.A.', 'Taller Beta S.A.', 'Servicios Gamma C.A.', 'Distribuidora Delta de Repuestos y Suministros Industriales C.A.', 'Fletes Épsilon C.A.'];

export function comprobanteDeEjemplo(impuesto: Impuesto): DatosComprobante {
  const base = { numero: impuesto === 'iva' ? '20260900000011' : '0000000031', fecha: '2026-09-18', periodo: { anio: '2026', mes: '09' }, agente: AGENTE, sujeto: SUJETO, firma: null, logoEnte: null };
  let filas: FilaComprobante[];
  if (impuesto === 'iva') {
    filas = [{ oper: '1', fecha: '2026-09-15', factura: '000123', control: '00-000123', clase: '01-reg', total: 11600, sinDerecho: 0, base: 10000, alic: 16, causado: 1600, retenido: 1200 }];
  } else if (impuesto === 'islr') {
    filas = [
      { fecha: '2026-09-15', documento: '000123', control: '00-000123', descripcion: 'SERVICIOS', base: 6000, pct: 2, sustraendo: 0, retenido: 120 },
      { fecha: '2026-09-15', documento: '000123', control: '00-000123', descripcion: 'FLETES', base: 4000, pct: 3, sustraendo: 0, retenido: 120 },
    ];
  } else {
    filas = [{ oper: '109', fecha: '2026-09-15', factura: '000123', control: '00-000123', total: 11600, base: 10000, actividad: '3.3.29', alicIsae: 2.5, retenido: 250 }];
  }
  return { ...base, impuesto, filas };
}

export function relacionDeEjemplo(): DatosRelacion {
  const filas: FilaRelacion[] = Array.from({ length: 30 }, (_, i) => {
    const base = 1000 + i * 137.5, impuesto = Math.round(base * 16) / 100;
    return {
      rif: `J-0000000${(i % 5) + 1}-0`, nombre: PROVEEDORES[i % 5], comp: `202609${String(11 + i).padStart(8, '0')}`, documento: String(120 + i).padStart(6, '0'),
      control: `00-${String(120 + i).padStart(6, '0')}`, fecha: `2026-09-${String(1 + (i % 30)).padStart(2, '0')}`, exento: 0, base, impuesto,
      total: base + impuesto, retenido: Math.round(impuesto * 75) / 100,
    };
  });
  return { impuesto: 'iva', empresa: AGENTE.razon, desde: '2026-09-01', hasta: '2026-09-30', generado: new Date(2026, 9, 1, 9, 30), filas };
}
