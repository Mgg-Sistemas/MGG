import { describe, expect, it } from 'vitest';
import {
  FILTRO_BITACORA_VACIO, conteoPorSegmento, devolucionesDeAlmacen, errorEntregaMantenimiento, errorRegistroEntrega,
  esFotoImagen, filtrarBitacora, filtrarSurtidos, motivoConMaquina, restarDias, resumenEntrega, segmentosDe, tiposAlEditar,
  type RegistroBitacora,
} from './entregasAlmacen';

const et = (t: string) => t.replace('_', ' ');
const reg = (p: Partial<RegistroBitacora> & { id: string }): RegistroBitacora => ({ fecha: '2026-11-10', tipo: null, ...p });

describe('Entregas del almacén para mantenimiento', () => {
  it('resume la entrega como la ve Maquinaria', () => {
    const items = [1, 2, 3, 4].map((i) => ({ producto_id: `p${i}`, producto_nombre: `FILTRO ${i}`, unidad: 'UND', cantidad: 1, almacen: 'ALMACEN A' }));
    expect(resumenEntrega({ items, equipo_nombre: 'EXCAVADORA 1', entregado_por_nombre: 'Almacenista', entregado_por: 'a@x.test' }))
      .toBe('Almacenista entrega 4 ítems para la máquina EXCAVADORA 1');
    expect(resumenEntrega({ items: items.slice(0, 1), equipo_nombre: 'EQ', entregado_por_nombre: null, entregado_por: null }))
      .toBe('El almacén entrega 1 ítem para la máquina EQ');
  });

  it('el almacenista tiene que elegir la máquina si marca mantenimiento', () => {
    expect(errorEntregaMantenimiento(false, '')).toBeNull();
    expect(errorEntregaMantenimiento(true, '')).toBe('Elige la máquina a la que va el material.');
    expect(errorEntregaMantenimiento(true, 'eq1')).toBeNull();
  });

  it('el motivo de la salida lleva la máquina (una sola vez)', () => {
    expect(motivoConMaquina('Cambio de filtros', 'EXCAVADORA 1')).toBe('Cambio de filtros · Mantenimiento: EXCAVADORA 1');
    expect(motivoConMaquina('', 'EXCAVADORA 1')).toBe('Mantenimiento: EXCAVADORA 1');
    expect(motivoConMaquina('Algo', null)).toBe('Algo');
    expect(motivoConMaquina('Algo · Mantenimiento: EXCAVADORA 1', 'EXCAVADORA 1')).toBe('Algo · Mantenimiento: EXCAVADORA 1');
  });

  it('Maquinaria tiene que decir qué hizo y cuándo', () => {
    const ok = { tipos: ['cambio_filtro'], fecha: '2026-11-10', horometro: '1250', kilometraje: '' };
    const hoy = '2026-11-12';
    expect(errorRegistroEntrega(ok, hoy)).toBeNull();
    expect(errorRegistroEntrega({ ...ok, tipos: [] }, hoy)).toMatch(/al menos un tipo/);
    expect(errorRegistroEntrega({ ...ok, fecha: '' }, hoy)).toMatch(/fecha/);
    expect(errorRegistroEntrega({ ...ok, fecha: '2026-11-13' }, hoy)).toMatch(/futura/);
    expect(errorRegistroEntrega({ ...ok, horometro: 'abc' }, hoy)).toMatch(/horómetro/);
    expect(errorRegistroEntrega({ ...ok, kilometraje: '-5' }, hoy)).toMatch(/kilometraje/);
    expect(errorRegistroEntrega({ ...ok, horometro: '1250,5' }, hoy)).toBeNull();
  });

  it('el teléfono ve solo las devoluciones de su almacén', () => {
    const it1 = { producto_id: 'p', producto_nombre: 'X', unidad: null, cantidad: 1, almacen: 'A' };
    const xs = [
      { id: '1', almacen: 'A', items: [it1] },
      { id: '2', almacen: 'B', items: [{ ...it1, almacen: 'B' }] },
    ];
    expect(devolucionesDeAlmacen(xs, 'A').map((x) => x.id)).toEqual(['1']);
    expect(devolucionesDeAlmacen(xs, null)).toHaveLength(2);
  });

  it('al editar el tipo principal de un registro con varios tipos, los demás se quedan', () => {
    expect(tiposAlEditar(['cambio_filtro', 'cambio_aceite'], 'cambio_filtro', 'engrase')).toEqual(['engrase', 'cambio_aceite']);
    expect(tiposAlEditar(null, null, 'otro')).toEqual(['otro']);
    expect(tiposAlEditar(['a', 'b'], 'a', 'b')).toEqual(['b']);
  });

  it('las fotos del teléfono y del mantenimiento son imágenes; los adjuntos de la PC, según la extensión', () => {
    expect(esFotoImagen({ path: 'x/1-foto', filename: 'foto', bucket: 'inventario-salidas' })).toBe(true);
    expect(esFotoImagen({ path: 'bitacora/eq/1-a.jpg', filename: 'a.jpg' })).toBe(true);
    expect(esFotoImagen({ path: 's/nota.pdf', filename: 'nota.pdf', bucket: 'salidas-adjuntos' })).toBe(false);
    expect(esFotoImagen({ path: 's/foto.PNG', filename: 'foto.PNG', bucket: 'salidas-adjuntos' })).toBe(true);
  });
});

describe('Bitácora por segmentos', () => {
  const rows = [
    reg({ id: '1', tipo: 'cambio_filtro', tipos: ['cambio_filtro', 'cambio_aceite'], fecha: '2026-11-01', mecanico: 'MECANICO UNO' }),
    reg({ id: '2', tipo: 'repuestos', consumibles: 'MANGUERA HIDRÁULICA 1/2', fecha: '2026-11-05' }),
    reg({ id: '3', tipo: 'otro', trabajo: 'Cambio de cauchos delanteros', fecha: '2026-10-20' }),
    reg({ id: '4', tipo: 'lectura', fecha: '2026-11-09' }),
    reg({ id: '5', tipo: 'cambio_manguera', fecha: '2026-11-11' }),
  ];

  it('clasifica por tipo y, en registros viejos, por las palabras del trabajo', () => {
    expect(segmentosDe(rows[0])).toEqual(['filtros', 'aceite']);
    expect(segmentosDe(rows[1])).toEqual(['mangueras', 'hidraulico', 'piezas']);
    expect(segmentosDe(rows[2])).toContain('cauchos');
    expect(segmentosDe(rows[3])).toEqual(['otros']);
    expect(segmentosDe(rows[4])).toEqual(['mangueras']);
  });

  it('cada switch filtra su bitácora por fechas y por buscador', () => {
    expect(filtrarBitacora(rows, { ...FILTRO_BITACORA_VACIO, segmento: 'filtros' }, et).map((r) => r.id)).toEqual(['1']);
    expect(filtrarBitacora(rows, { ...FILTRO_BITACORA_VACIO, desde: '2026-11-01', hasta: '2026-11-06' }, et).map((r) => r.id)).toEqual(['1', '2']);
    expect(filtrarBitacora(rows, { ...FILTRO_BITACORA_VACIO, texto: 'mecanico uno' }, et).map((r) => r.id)).toEqual(['1']);
    expect(filtrarBitacora(rows, { ...FILTRO_BITACORA_VACIO, texto: 'hidraulica 1/2' }, et).map((r) => r.id)).toEqual(['2']);
    const c = conteoPorSegmento(rows);
    expect(c.todos).toBe(5);
    expect(c.filtros).toBe(1);
    expect(c.mangueras).toBe(2);
  });

  it('los atajos de fecha restan días sin correrse por la zona horaria', () => {
    expect(restarDias('2026-11-12', 29)).toBe('2026-10-14');
    expect(restarDias('2026-03-01', 1)).toBe('2026-02-28');
  });

  it('el segmento Combustible filtra los surtidos por fecha y texto', () => {
    const surtidos = [
      { fecha: '2026-11-02', litros: 120, horometro_fin: 1500, kilometraje: null, ubicacion: 'MINA', autorizado_por: 'AUTORIZA UNO' },
      { fecha: '2026-10-02', litros: 80, horometro_fin: 1400, kilometraje: null, ubicacion: 'PLANTA', autorizado_por: 'AUTORIZA DOS' },
    ];
    expect(filtrarSurtidos(surtidos, { ...FILTRO_BITACORA_VACIO, desde: '2026-11-01' })).toHaveLength(1);
    expect(filtrarSurtidos(surtidos, { ...FILTRO_BITACORA_VACIO, texto: 'dos' })[0].litros).toBe(80);
  });
});
