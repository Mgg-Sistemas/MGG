import { describe, expect, it } from 'vitest';
import {
  comprobanteDeSalida, errorRetorno, errorSalida, errorTraslado, filaHistoricoSalida, filtrarPorRetornar, filtrarSalidas,
  mensajeEntrada, mensajeProductoNuevo, mensajeRetorno, mensajeSalida, mensajeStock, mensajeTraslado, pendienteRetorno,
  stockPorPeriodo, textoRetorno, ultimosDias, type SalidaTelefono,
} from './inventarioTelefono';
import { muestraPdfEnPagina } from '@/shared/lib/reportPreview';

const salida: SalidaTelefono = {
  id: 's1', codigo: 'SAT-0007', almacen: 'Los Pinos', producto_id: 'p1', producto_nombre: 'MANGUERA 2"',
  unidad: 'MTS', cantidad: 10, motivo: 'Bomba del pozo 3', autorizado_por: 'LEYDIS RENGEL', retorna: true,
  retornado: 4, retornos: [], fotos: [{ path: 'a', filename: 'a.jpg' }], estado: 'por_retornar',
  actor: 'isner@x.com', actor_name: 'ISNER', created_at: '2026-10-29T14:00:00Z',
};

const sinSelector = (t: string) => expect(t).not.toContain('️');

describe('vista de teléfono de inventario · validaciones', () => {
  it('la salida no deja sacar más de lo que hay en el almacén', () => {
    expect(errorSalida({ productoId: 'p1', cantidad: 5, stock: 3, motivo: 'obra', autorizado: 'X', retorna: false }))
      .toBe('No alcanza: en el almacén hay 3.');
    expect(errorSalida({ productoId: 'p1', cantidad: 2, stock: 3, motivo: 'obra', autorizado: 'X', retorna: null }))
      .toBe('¿Retorna? Marca SÍ o NO.');
    expect(errorSalida({ productoId: 'p1', cantidad: 2, stock: 3, motivo: 'obra', autorizado: 'X', retorna: true })).toBeNull();
  });

  it('el retorno no pasa de lo que falta', () => {
    expect(pendienteRetorno(salida)).toBe(6);
    expect(errorRetorno(salida, 7)).toBe('Solo faltan 6 por retornar.');
    expect(errorRetorno(salida, 6)).toBeNull();
  });

  it('el traslado pide otro almacén y stock suficiente', () => {
    const base = { productoId: 'p1', origen: 'Los Pinos', cantidad: 2, stock: 5, motivo: 'reposición' };
    expect(errorTraslado({ ...base, destino: 'Los Pinos' })).toBe('El destino tiene que ser otro almacén.');
    expect(errorTraslado({ ...base, destino: 'General', cantidad: 9 })).toBe('No alcanza: en Los Pinos hay 5.');
    expect(errorTraslado({ ...base, destino: 'General' })).toBeNull();
  });
});

describe('vista de teléfono de inventario · mensajes de WhatsApp', () => {
  it('producto nuevo', () => {
    const t = mensajeProductoNuevo({ almacen: 'Los Pinos', sku: 'FER-012', nombre: 'TUBO PVC', categoria: 'FERRETERIA', unidad: 'und', cantidad: 4, costo: 2.5, quien: 'ISNER' });
    expect(t).toContain('PRODUCTO NUEVO EN INVENTARIO');
    expect(t).toContain('🔢 *Cantidad inicial:* 4 und');
    expect(t).toContain('👷 *Registrado por:* ISNER');
    expect(t).toContain('MINERAL GROUP GUAYANA C.A.* · Los Pinos');
    sinSelector(t);
  });

  it('entrada', () => {
    const t = mensajeEntrada({ almacen: 'General', nombre: 'CEMENTO', sku: 'CON-001', unidad: 'SACO', cantidad: 10, stockDespues: 25, nota: 'Llegó del proveedor' });
    expect(t).toContain('📥 *ENTRADA A INVENTARIO*');
    expect(t).toContain('📊 *Queda en:* 25 SACO');
    expect(t).not.toContain('Almacén:* General');
    expect(t).not.toContain('Costo c/u');
    sinSelector(t);
  });

  it('entrada con costo (toda entrada lleva costo en MGG)', () => {
    const t = mensajeEntrada({ almacen: 'Los Pinos', nombre: 'CEMENTO', unidad: 'SACO', cantidad: 10, stockDespues: 25, costo: 12.5 });
    expect(t).toContain('💵 *Costo c/u:* $12,5');
  });

  it('buscador de «Por retornar»: material, N°, motivo o quién autorizó, sin acentos', () => {
    const otra = { ...salida, id: 's2', codigo: 'SAT-0008', producto_nombre: 'TALADRO', motivo: 'Taller', autorizado_por: 'JESÚS LOZADA' };
    expect(filtrarPorRetornar([salida, otra], '').length).toBe(2);
    expect(filtrarPorRetornar([salida, otra], 'manguera').map((s) => s.id)).toEqual(['s1']);
    expect(filtrarPorRetornar([salida, otra], 'sat-0008').map((s) => s.id)).toEqual(['s2']);
    expect(filtrarPorRetornar([salida, otra], 'jesus').map((s) => s.id)).toEqual(['s2']);
    expect(filtrarPorRetornar([salida, otra], 'pozo').map((s) => s.id)).toEqual(['s1']);
  });

  it('salida con retorno y fotos', () => {
    const t = mensajeSalida(salida);
    expect(t).toContain('📤 *SALIDA DE ALMACÉN*');
    expect(t).toContain('🔖 *N°:* SAT-0007');
    expect(t).toContain('✅ *Autorizado por:* LEYDIS RENGEL');
    expect(t).toContain('🔄 *Retorna:* SÍ');
    expect(t).toContain('📷 *Fotos:* 1');
    sinSelector(t);
  });

  it('retorno parcial dice cuánto falta', () => {
    const t = mensajeRetorno(salida, 4, 'volvió una parte', 'ISNER');
    expect(t).toContain('🔢 *Retorna:* 4 MTS de 10 MTS');
    expect(t).toContain('⏳ *Falta por retornar:* 6 MTS');
    expect(mensajeRetorno({ ...salida, retornado: 10 }, 6)).toContain('✅ *Retornó completo*');
    sinSelector(t);
  });

  it('traslado entre almacenes', () => {
    const t = mensajeTraslado({ origen: 'Los Pinos', destino: 'General', nombre: 'GUANTES', unidad: 'PAR', cantidad: 3, motivo: 'Para el taller', quedaOrigen: 7, quien: 'ISNER' });
    expect(t).toContain('🔁 *TRASLADO ENTRE ALMACENES*');
    expect(t).toContain('🏬 *De:* Los Pinos');
    expect(t).toContain('🔢 *Cantidad:* 3 PAR');
    expect(t).toContain('📊 *Queda en Los Pinos:* 7 PAR');
    sinSelector(t);
  });
});

describe('histórico de salidas (02-11-2026)', () => {
  it('abre con los últimos 60 días contando hoy, cruzando meses', () => {
    expect(ultimosDias(60, '2026-11-02')).toEqual({ desde: '2026-09-04', hasta: '2026-11-02' });
    expect(ultimosDias(1, '2026-11-02')).toEqual({ desde: '2026-11-02', hasta: '2026-11-02' });
  });

  it('el buscador encuentra por material, N° SAT o motivo', () => {
    const otra = { ...salida, id: 's2', codigo: 'SAT-0120', producto_nombre: 'CABLE', motivo: 'Taller eléctrico' };
    expect(filtrarSalidas([salida, otra], 'sat-0120').map((s) => s.id)).toEqual(['s2']);
    expect(filtrarSalidas([salida, otra], 'electrico').map((s) => s.id)).toEqual(['s2']);
    expect(filtrarSalidas([salida, otra], 'MANGUERA').map((s) => s.id)).toEqual(['s1']);
  });

  it('el retorno se lee en palabras', () => {
    expect(textoRetorno({ ...salida, retorna: false })).toBe('No retorna');
    expect(textoRetorno(salida)).toBe('Retornó 4 MTS · faltan 6 MTS');
    expect(textoRetorno({ ...salida, retornado: 0 })).toBe('Por retornar: 10 MTS');
    expect(textoRetorno({ ...salida, retornado: 10 })).toBe('Retornó completo');
  });

  it('la fila lleva N°, fecha, motivo, quién autorizó y quién registró', () => {
    const f = filaHistoricoSalida(salida, 'ISNER');
    expect(f.titulo).toBe('MANGUERA 2"');
    expect(f.cantidad).toBe('10 MTS');
    expect(f.lineas).toEqual(['SAT-0007 · 29/10/2026 10:00', 'Motivo: Bomba del pozo 3', 'Autorizó LEYDIS RENGEL · Registró ISNER']);
    expect(filaHistoricoSalida({ ...salida, autorizado_por: null }).lineas).toHaveLength(2);
  });

  it('el comprobante es el mismo de recién registrada', () => {
    expect(comprobanteDeSalida(salida, 'OTRO')).toMatchObject({
      tipo: 'salida', codigo: 'SAT-0007', producto: { nombre: 'MANGUERA 2"', unidad: 'MTS' }, cantidad: 10,
      detalle: 'Bomba del pozo 3', autorizadoPor: 'LEYDIS RENGEL', retorna: true, fotos: 1,
      actor: 'isner@x.com', actorName: 'ISNER', at: '2026-10-29T14:00:00Z',
    });
    expect(comprobanteDeSalida({ ...salida, actor: null, actor_name: null }, 'KELVIN')).toMatchObject({ actor: 'KELVIN', actorName: 'KELVIN' });
  });
});

describe('PDF en el teléfono (02-11-2026)', () => {
  it('Android y iPhone no pintan el PDF dentro de la página: el visor ofrece abrirlo aparte', () => {
    const android = 'Mozilla/5.0 (Linux; Android 14; SM-A145M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    const pc = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    expect(muestraPdfEnPagina({ userAgent: android, pdfViewerEnabled: true })).toBe(false);
    expect(muestraPdfEnPagina({ userAgent: iphone, pdfViewerEnabled: true })).toBe(false);
    expect(muestraPdfEnPagina({ userAgent: pc, pdfViewerEnabled: true })).toBe(true);
    expect(muestraPdfEnPagina({ userAgent: pc, pdfViewerEnabled: false })).toBe(false);
    expect(muestraPdfEnPagina(undefined)).toBe(true);
  });
});

describe('reporte de stock por período', () => {
  const productos = [
    { id: 'a', nombre: 'CEMENTO', categoria: 'CONSTRUCCION', unidad: 'SACO', stock: 20 },
    { id: 'b', nombre: 'CLAVOS', categoria: 'FERRETERIA', unidad: 'KG', stock: 0 },
  ];
  const movs = [
    { producto_id: 'a', delta: 10, at: '2026-10-10T15:00:00Z' },
    { producto_id: 'a', delta: -4, at: '2026-10-12T15:00:00Z' },
    { producto_id: 'a', delta: 5, at: '2026-10-20T15:00:00Z' }, // después del «hasta»
  ];

  it('reconstruye el cierre del período y lo que entró y salió', () => {
    const f = stockPorPeriodo(productos, movs, '2026-10-01', '2026-10-15');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ nombre: 'CEMENTO', cierre: 15, entradas: 10, salidas: 4, inicio: 9 });
  });

  it('el mensaje lleva el almacén y los totales', () => {
    const t = mensajeStock('Los Pinos', stockPorPeriodo(productos, movs, '2026-10-01', '2026-10-15'), '2026-10-01', '2026-10-15', { quien: 'ISNER' });
    expect(t).toContain('📦 *STOCK · LOS PINOS*');
    expect(t).toContain('📅 *Período:* 01/10/2026 al 15/10/2026');
    expect(t).toContain('• CEMENTO: *15 SACO* (📥 +10 · 📤 −4)');
    expect(t).toContain('🔢 *Productos con existencia:* 1');
    sinSelector(t);
  });
});
