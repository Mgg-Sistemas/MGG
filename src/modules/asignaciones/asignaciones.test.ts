import { describe, it, expect } from 'vitest';
import {
  TIPOS_ASIGNACION, definicionTipo, labelTipo, iconoTipo, retornablePorDefecto,
  labelEstado, textoEstado, estaPendiente, estaCerrada, descuentaInventario,
  errorAsignacion, errorDevolucion, errorRenglones, resumenLote, reingresaAlInventario,
  filtrarAsignaciones, enRango, hayFiltro, FILTRO_ASIGNACIONES_VACIO,
  resumenAsignaciones, pendientesPorPersona, conteoPorTipo, rangosRapidos,
  type AsignacionBase,
} from './asignaciones';

/** Una asignación válida a la que cada prueba le cambia lo suyo. */
function asig(over: Partial<AsignacionBase> = {}): AsignacionBase {
  return {
    id: 'a1',
    personal_id: 'p1',
    tipo: 'equipo_electronico',
    descripcion: 'Laptop Lenovo T480',
    cantidad: 1,
    fecha_asignacion: '2026-03-10',
    retornable: true,
    estado: 'asignado',
    ...over,
  };
}

describe('los tipos de asignación', () => {
  it('cada tipo dice si lo suyo vuelve o no', () => {
    // El default sale de la realidad: el uniforme no se recibe de vuelta.
    expect(retornablePorDefecto('dotacion')).toBe(false);
    expect(retornablePorDefecto('material_oficina')).toBe(false);
    expect(retornablePorDefecto('epp')).toBe(false);
    expect(retornablePorDefecto('equipo_electronico')).toBe(true);
    expect(retornablePorDefecto('linea_telefonica')).toBe(true);
    expect(retornablePorDefecto('herramienta')).toBe(true);
  });

  it('un tipo que no existe se asume retornable, que es lo prudente', () => {
    expect(retornablePorDefecto('cualquier_cosa')).toBe(true);
    expect(retornablePorDefecto(null)).toBe(true);
  });

  it('la telefonía pide el número y los equipos el serial', () => {
    expect(definicionTipo('linea_telefonica')?.pideLinea).toBe(true);
    expect(definicionTipo('equipo_electronico')?.pideSerial).toBe(true);
    expect(definicionTipo('dotacion')?.pideLinea).toBeUndefined();
  });

  it('las etiquetas no dejan al usuario viendo la clave interna', () => {
    expect(labelTipo('material_oficina')).toBe('Material de oficina');
    expect(iconoTipo('equipo_electronico')).toBe('💻');
    // Un tipo viejo que ya no está en la lista se muestra tal cual, no vacío.
    expect(labelTipo('inventado')).toBe('inventado');
    expect(iconoTipo('inventado')).toBe('📦');
  });

  it('no hay dos tipos con la misma clave', () => {
    const claves = TIPOS_ASIGNACION.map((t) => t.key);
    expect(new Set(claves).size).toBe(claves.length);
  });
});

describe('qué está pendiente y qué ya se cerró', () => {
  it('lo retornable en poder del trabajador está pendiente', () => {
    expect(estaPendiente(asig())).toBe(true);
  });

  it('un uniforme entregado NO queda pendiente para siempre', () => {
    expect(estaPendiente(asig({ tipo: 'dotacion', retornable: false }))).toBe(false);
  });

  it('lo devuelto, lo perdido y lo dañado ya no está pendiente', () => {
    expect(estaPendiente(asig({ estado: 'devuelto' }))).toBe(false);
    expect(estaPendiente(asig({ estado: 'perdido' }))).toBe(false);
    expect(estaPendiente(asig({ estado: 'danado' }))).toBe(false);
  });

  it('cerrada es devuelto, perdido o dañado; asignado no', () => {
    expect(estaCerrada(asig({ estado: 'devuelto' }))).toBe(true);
    expect(estaCerrada(asig({ estado: 'perdido' }))).toBe(true);
    expect(estaCerrada(asig({ estado: 'danado' }))).toBe(true);
    expect(estaCerrada(asig({ estado: 'asignado' }))).toBe(false);
  });

  it('el texto del estado distingue lo que vuelve de lo que no', () => {
    expect(textoEstado('asignado', true)).toBe('Pendiente de devolución');
    expect(textoEstado('asignado', false)).toBe('Entregado · no retorna');
    expect(textoEstado('devuelto', true)).toBe('Devuelto');
    expect(labelEstado('danado')).toBe('Dañado');
  });
});

describe('cuándo se toca el inventario', () => {
  it('lo que sale de una ficha del inventario se descuenta', () => {
    expect(descuentaInventario(asig({ producto_id: 'prod-1' }))).toBe(true);
  });

  it('una línea telefónica no tiene ficha: no descuenta nada', () => {
    expect(descuentaInventario(asig({ tipo: 'linea_telefonica', producto_id: null }))).toBe(false);
  });

  it('una carga histórica NO descuenta, aunque tenga ficha', () => {
    // Ese material salió del almacén hace rato: descontarlo hoy lo cuenta dos veces.
    expect(descuentaInventario(asig({ producto_id: 'prod-1', historico: true }))).toBe(false);
  });

  it('solo lo devuelto reingresa; lo perdido y lo dañado no', () => {
    const conSalida = asig({ descontado: true });
    expect(reingresaAlInventario(conSalida, 'devuelto')).toBe(true);
    expect(reingresaAlInventario(conSalida, 'perdido')).toBe(false);
    expect(reingresaAlInventario(conSalida, 'danado')).toBe(false);
  });

  it('lo que nunca salió del inventario tampoco reingresa al devolverse', () => {
    expect(reingresaAlInventario(asig({ descontado: false }), 'devuelto')).toBe(false);
  });
});

describe('validación de la asignación', () => {
  it('una asignación completa se puede guardar', () => {
    expect(errorAsignacion(asig())).toBeNull();
  });

  it('sin trabajador no se guarda', () => {
    expect(errorAsignacion(asig({ personal_id: '' }))).toMatch(/trabajador/i);
  });

  it('sin tipo válido no se guarda', () => {
    expect(errorAsignacion(asig({ tipo: '' }))).toMatch(/tipo/i);
    expect(errorAsignacion(asig({ tipo: 'inventado' }))).toMatch(/tipo/i);
  });

  it('la descripción no puede ser un par de letras ni una novela', () => {
    expect(errorAsignacion(asig({ descripcion: 'ab' }))).toMatch(/describí/i);
    expect(errorAsignacion(asig({ descripcion: '   ' }))).toMatch(/describí/i);
    expect(errorAsignacion(asig({ descripcion: 'x'.repeat(161) }))).toMatch(/160/);
  });

  it('sin fecha no se guarda', () => {
    expect(errorAsignacion(asig({ fecha_asignacion: '' }))).toMatch(/fecha/i);
  });

  it('la cantidad tiene que ser mayor que cero', () => {
    expect(errorAsignacion(asig({ cantidad: 0 }))).toMatch(/mayor que cero/i);
    expect(errorAsignacion(asig({ cantidad: -2 }))).toMatch(/mayor que cero/i);
    expect(errorAsignacion(asig({ cantidad: 'ocho' }))).toMatch(/mayor que cero/i);
  });

  it('una línea telefónica sin número no se guarda', () => {
    expect(errorAsignacion(asig({ tipo: 'linea_telefonica', numero_linea: '' }))).toMatch(/línea/i);
    expect(errorAsignacion(asig({ tipo: 'linea_telefonica', numero_linea: '0414-1234567' }))).toBeNull();
  });

  it('no se puede devolver algo antes de habérselo dado', () => {
    expect(errorAsignacion(asig({ fecha_retorno: '2026-03-09' }))).toMatch(/anterior/i);
    expect(errorAsignacion(asig({ fecha_retorno: '2026-03-10' }))).toBeNull();
  });
});

describe('entregar varios ítems de una vez', () => {
  it('una tanda con todo bien pasa', () => {
    expect(errorRenglones([asig(), asig({ tipo: 'dotacion', descripcion: 'Botas de seguridad' })])).toBeNull();
  });

  it('una tanda vacía no se guarda', () => {
    expect(errorRenglones([])).toMatch(/al menos un/i);
  });

  it('el mensaje dice EN QUÉ ítem está el problema', () => {
    const r = errorRenglones([asig(), asig({ descripcion: 'ab' }), asig()]);
    expect(r).toMatch(/^Ítem 2:/);
    expect(r).toMatch(/describí/i);
  });

  it('avisa del primer problema, no de los seis juntos', () => {
    const r = errorRenglones([asig({ cantidad: 0 }), asig({ descripcion: '' })]);
    expect(r).toMatch(/^Ítem 1:/);
  });
});

describe('cómo se le cuenta al usuario una tanda', () => {
  it('todo bien, en singular y en plural', () => {
    expect(resumenLote(1, [])).toBe('Asignación registrada');
    expect(resumenLote(4, [])).toBe('4 asignaciones registradas');
  });

  it('si no entró ninguna, se dice el motivo', () => {
    expect(resumenLote(0, [{ descripcion: 'Laptop', motivo: 'sin stock' }])).toMatch(/No se pudo registrar: sin stock/);
  });

  it('una tanda a medias dice qué entró y qué quedó fuera', () => {
    // Lo ya entregado movió inventario y está bien: deshacerlo seria peor.
    const m = resumenLote(2, [{ descripcion: 'Casco', motivo: 'sin stock en MATANZA' }]);
    expect(m).toContain('2 de 3');
    expect(m).toContain('Casco');
    expect(m).toContain('sin stock en MATANZA');
  });
});

describe('validación de la devolución', () => {
  it('una devolución bien hecha pasa', () => {
    expect(errorDevolucion(asig(), '2026-06-01', 'devuelto')).toBeNull();
  });

  it('no se cierra dos veces lo mismo', () => {
    expect(errorDevolucion(asig({ estado: 'devuelto' }), '2026-06-01', 'devuelto')).toMatch(/ya está cerrada/i);
  });

  it('sin fecha no se cierra', () => {
    expect(errorDevolucion(asig(), '', 'devuelto')).toMatch(/fecha/i);
  });

  it('la devolución no puede ser anterior a la asignación', () => {
    expect(errorDevolucion(asig(), '2026-03-09', 'devuelto')).toMatch(/anterior/i);
  });

  it('hay que decir CÓMO se cierra', () => {
    expect(errorDevolucion(asig(), '2026-06-01', 'asignado')).toMatch(/devuelto, perdido o dañado/i);
  });
});

describe('filtros', () => {
  const nombres: Record<string, string> = { p1: 'PEDRO PÉREZ', p2: 'ANA GÓMEZ' };
  const nombre = (id: string | null | undefined) => nombres[id ?? ''] ?? '';
  const lista: AsignacionBase[] = [
    asig({ id: '1', personal_id: 'p1', tipo: 'equipo_electronico', descripcion: 'Laptop Lenovo', serial: 'SN-99', fecha_asignacion: '2026-01-15' }),
    asig({ id: '2', personal_id: 'p2', tipo: 'dotacion', descripcion: 'Uniforme completo', retornable: false, fecha_asignacion: '2026-02-20' }),
    asig({ id: '3', personal_id: 'p1', tipo: 'linea_telefonica', descripcion: 'Plan corporativo', numero_linea: '0414-1112233', fecha_asignacion: '2026-03-05', estado: 'devuelto' }),
    asig({ id: '4', personal_id: 'p2', tipo: 'material_oficina', descripcion: 'Resmas de papel', retornable: false, historico: true, fecha_asignacion: '2025-11-01' }),
  ];

  it('sin filtros devuelve todo', () => {
    expect(filtrarAsignaciones(lista, FILTRO_ASIGNACIONES_VACIO, nombre)).toHaveLength(4);
  });

  it('filtra por trabajador', () => {
    const r = filtrarAsignaciones(lista, { ...FILTRO_ASIGNACIONES_VACIO, personalId: 'p1' }, nombre);
    expect(r.map((x) => x.id)).toEqual(['1', '3']);
  });

  it('filtra por tipo y por estado', () => {
    expect(filtrarAsignaciones(lista, { ...FILTRO_ASIGNACIONES_VACIO, tipo: 'dotacion' }, nombre)).toHaveLength(1);
    expect(filtrarAsignaciones(lista, { ...FILTRO_ASIGNACIONES_VACIO, estado: 'devuelto' }, nombre)).toHaveLength(1);
  });

  it('solo pendientes deja fuera lo devuelto y lo que no retorna', () => {
    const r = filtrarAsignaciones(lista, { ...FILTRO_ASIGNACIONES_VACIO, soloPendientes: true }, nombre);
    expect(r.map((x) => x.id)).toEqual(['1']);
  });

  it('solo históricas deja las que ya existían antes del sistema', () => {
    const r = filtrarAsignaciones(lista, { ...FILTRO_ASIGNACIONES_VACIO, soloHistoricas: true }, nombre);
    expect(r.map((x) => x.id)).toEqual(['4']);
  });

  it('el rango de fechas mira la fecha de asignación', () => {
    const r = filtrarAsignaciones(lista, { ...FILTRO_ASIGNACIONES_VACIO, desde: '2026-01-01', hasta: '2026-02-28' }, nombre);
    expect(r.map((x) => x.id)).toEqual(['1', '2']);
  });

  it('el texto busca en descripción, serial, línea, tipo y nombre', () => {
    const buscar = (texto: string) => filtrarAsignaciones(lista, { ...FILTRO_ASIGNACIONES_VACIO, texto }, nombre).map((x) => x.id);
    expect(buscar('lenovo')).toEqual(['1']);
    expect(buscar('SN-99')).toEqual(['1']);
    expect(buscar('1112233')).toEqual(['3']);
    expect(buscar('ana')).toEqual(['2', '4']);
  });

  it('el texto ignora los acentos en los dos sentidos', () => {
    const buscar = (texto: string) => filtrarAsignaciones(lista, { ...FILTRO_ASIGNACIONES_VACIO, texto }, nombre).map((x) => x.id);
    expect(buscar('telefonica')).toEqual(['3']);   // sin acento encuentra «telefónica»
    expect(buscar('PÉREZ')).toEqual(['1', '3']);
    expect(buscar('perez')).toEqual(['1', '3']);
  });

  it('una asignación sin fecha solo aparece cuando no hay rango puesto', () => {
    const sinFecha = asig({ fecha_asignacion: '' });
    expect(enRango(sinFecha, '', '')).toBe(true);
    expect(enRango(sinFecha, '2026-01-01', '')).toBe(false);
  });

  it('hayFiltro reconoce cualquier filtro puesto', () => {
    expect(hayFiltro(FILTRO_ASIGNACIONES_VACIO)).toBe(false);
    expect(hayFiltro({ ...FILTRO_ASIGNACIONES_VACIO, texto: '  ' })).toBe(false);
    expect(hayFiltro({ ...FILTRO_ASIGNACIONES_VACIO, texto: 'laptop' })).toBe(true);
    expect(hayFiltro({ ...FILTRO_ASIGNACIONES_VACIO, soloPendientes: true })).toBe(true);
    expect(hayFiltro({ ...FILTRO_ASIGNACIONES_VACIO, desde: '2026-01-01' })).toBe(true);
  });
});

describe('resumen para las tarjetas', () => {
  const lista: AsignacionBase[] = [
    asig({ id: '1', personal_id: 'p1' }),
    asig({ id: '2', personal_id: 'p1', tipo: 'herramienta' }),
    asig({ id: '3', personal_id: 'p2' }),
    asig({ id: '4', personal_id: 'p3', estado: 'devuelto' }),
    asig({ id: '5', personal_id: 'p4', tipo: 'dotacion', retornable: false }),
  ];

  it('cuenta lo pendiente y las personas que lo tienen', () => {
    const r = resumenAsignaciones(lista);
    expect(r.pendientes).toBe(3);
    // p1 tiene dos cosas pendientes pero es UNA persona.
    expect(r.personasConPendientes).toBe(2);
    expect(r.total).toBe(5);
    expect(r.cerradas).toBe(1);
  });

  it('una lista vacía da todo en cero, sin romperse', () => {
    expect(resumenAsignaciones([])).toEqual({ pendientes: 0, personasConPendientes: 0, total: 0, cerradas: 0 });
  });

  it('la lista de deudores va de mayor a menor', () => {
    expect(pendientesPorPersona(lista)).toEqual([
      { personalId: 'p1', pendientes: 2 },
      { personalId: 'p2', pendientes: 1 },
    ]);
  });

  it('el conteo por tipo respeta el orden del catálogo y omite los vacíos', () => {
    expect(conteoPorTipo(lista)).toEqual([
      { tipo: 'dotacion', label: 'Dotación / Uniformes', cantidad: 1 },
      { tipo: 'equipo_electronico', label: 'Equipo electrónico', cantidad: 3 },
      { tipo: 'herramienta', label: 'Herramienta', cantidad: 1 },
    ]);
  });
});

describe('rangos rápidos', () => {
  it('se calculan contra la fecha que se le pase, no contra hoy', () => {
    const r = rangosRapidos(new Date(2026, 2, 15)); // 15 de marzo de 2026
    expect(r[0]).toEqual({ label: 'Este mes', desde: '2026-03-01', hasta: '2026-03-31' });
    expect(r[1]).toEqual({ label: 'Mes pasado', desde: '2026-02-01', hasta: '2026-02-28' });
    expect(r[3]).toEqual({ label: 'Este año', desde: '2026-01-01', hasta: '2026-12-31' });
  });

  it('el mes pasado de enero es diciembre del año anterior', () => {
    const r = rangosRapidos(new Date(2026, 0, 10));
    expect(r[1]).toEqual({ label: 'Mes pasado', desde: '2025-12-01', hasta: '2025-12-31' });
  });
});
