import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Supabase falso: cada from() toma la siguiente respuesta de la cola y anota lo pedido; el storage anota subidas y borrados. */
const cola: Array<{ data: unknown; error: unknown }> = [];
const llamadas: { tabla: string; metodos: unknown[][] }[] = [];
const subidas: { ruta: string; opciones: unknown }[] = [];
const borrados: string[][] = [];
let errorSubida: { message: string } | null = null;
const rpc = vi.fn();

function consulta(tabla: string) {
  const reg = { tabla, metodos: [] as unknown[][] };
  llamadas.push(reg);
  const resp = cola.shift() ?? { data: [], error: null };
  const q: Record<string, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resp).then(ok, ko);
      return (...args: unknown[]) => { reg.metodos.push([prop, ...args]); return q; };
    },
  });
  return q;
}

// Sin R2: entes escribe el puente de R1 (las pruebas de R2 cubren el otro camino).
vi.mock('./disponibilidad', () => ({ r2Disponible: async () => false, tablaDisponible: async () => false }));

vi.mock('@/shared/lib/supabase', () => ({
  supabase: {
    from: (t: string) => consulta(t),
    rpc: (...a: unknown[]) => rpc(...a),
    storage: {
      from: () => ({
        upload: async (ruta: string, _f: unknown, opciones: unknown) => { subidas.push({ ruta, opciones }); return { error: errorSubida }; },
        remove: async (rutas: string[]) => { borrados.push(rutas); return { error: null }; },
        createSignedUrl: async (ruta: string) => ({ data: { signedUrl: `https://firmada/${ruta}` }, error: null }),
      }),
    },
  },
}));

import {
  aEnte, activarEnte, crearEnte, faltaEnEnte, faltaEnImagen, fijarImpuestosEnte, nombreSeguro, rutaLogoEnte,
  subirImagenAgente, subirLogoEnte, versionVigente,
} from './entes.repository';
import {
  agregarActividad, bajaActividad, faltaEnActividad, filtrarPerfiles, guardarPerfil, pideLicencia, sujetoDelPerfil,
  unirPerfiles, type PerfilNuevo,
} from './perfilesFiscales.repository';
import { condicionVigente, faltaEnCondicion, registrarCondicion, type CondicionRegistrada } from './agenteCondiciones.repository';
import { errorRetencion } from './erroresRetencion';

// Datos inventados: ningún proveedor, RIF ni ente real más allá de la semilla pública.
const png = (nombre = 'Logo Alcaldía.png', size = 2000, type = 'image/png') => {
  const f = new File(['x'], nombre, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

beforeEach(() => { cola.length = 0; llamadas.length = 0; subidas.length = 0; borrados.length = 0; errorSubida = null; rpc.mockReset(); });

describe('entes: reglas y lectura', () => {
  it('municipal lleva estado y municipio; estadal, el estado; nombre de 3 letras', () => {
    expect(faltaEnEnte({ nombre: 'Alcaldía', tipo: 'municipal', estado: 'Bolívar' })).toMatch(/municipio/);
    expect(faltaEnEnte({ nombre: 'Gobernación', tipo: 'estadal' })).toMatch(/estado/);
    expect(faltaEnEnte({ nombre: 'AB', tipo: 'nacional' })).toMatch(/3 letras/);
    expect(faltaEnEnte({ nombre: 'SENIAT', tipo: 'nacional' })).toBeNull();
  });

  it('mapea el ente con sus impuestos activos (en orden) y sus logos (el más nuevo primero)', () => {
    const e = aEnte({
      id: 'e-1', nombre: 'SENIAT', tipo: 'nacional', activo: true, desde: '2026-10-16',
      retencion_ente_impuestos: [{ impuesto_clave: 'IGTF', activo: true }, { impuesto_clave: 'IVA', activo: true }, { impuesto_clave: 'ISLR', activo: false }],
      retencion_ente_logos: [{ id: 'l-1', ruta: 'entes/e-1/2026-01-01-a.png', desde: '2026-01-01', activo: true }, { id: 'l-2', ruta: 'entes/e-1/2026-10-01-b.png', desde: '2026-10-01', activo: true }],
    });
    expect(e.impuestos).toEqual(['IVA', 'IGTF']);
    expect(e.logos.map((l) => l.id)).toEqual(['l-2', 'l-1']);
  });

  it('el logo vigente es el activo más nuevo con «desde» hasta la fecha: un comprobante viejo conserva el suyo', () => {
    const v = [
      { id: 'a', desde: '2026-01-01', activo: true },
      { id: 'b', desde: '2026-10-01', activo: true },
      { id: 'c', desde: '2026-09-01', activo: false },
    ];
    expect(versionVigente(v, '2026-09-15')?.id).toBe('a');
    expect(versionVigente(v, '2026-10-16')?.id).toBe('b');
    expect(versionVigente(v, '2025-12-31')).toBeNull();
  });
});

describe('entes: escritura', () => {
  it('crear: inserta con .select(id), luego los impuestos; un nacional no guarda territorio', async () => {
    cola.push({ data: [{ id: 'e-9' }], error: null });                 // insert ente
    cola.push({ data: [{ id: 'i-1' }, { id: 'i-2' }], error: null });  // upsert impuestos
    cola.push({ data: [], error: null });                              // desactivar los demás
    const id = await crearEnte({ nombre: ' SENIAT ', tipo: 'nacional', estado: 'Bolívar', impuestos: ['IVA', 'ISLR'] });
    expect(id).toBe('e-9');
    const ins = llamadas[0].metodos.find((m) => m[0] === 'insert')?.[1] as Record<string, unknown>;
    expect(ins).toMatchObject({ nombre: 'SENIAT', tipo: 'nacional', estado: null, municipio: null });
    expect(llamadas[0].metodos).toContainEqual(['select', 'id']);
    expect(llamadas[1].tabla).toBe('retencion_ente_impuestos');
    expect(llamadas[1].metodos.find((m) => m[0] === 'upsert')?.[2]).toEqual({ onConflict: 'ente_id,impuesto_clave' });
    expect(llamadas[2].metodos).toContainEqual(['not', 'impuesto_clave', 'in', '(IVA,ISLR)']);
  });

  it('crear sin permiso (0 filas) avisa; con nombre repetido, lo dice', async () => {
    cola.push({ data: [], error: null });
    await expect(crearEnte({ nombre: 'SENIAT', tipo: 'nacional', impuestos: [] })).rejects.toThrow('sin permiso');
    cola.push({ data: null, error: { code: '23505', message: 'duplicate key' } });
    await expect(crearEnte({ nombre: 'SENIAT', tipo: 'nacional', impuestos: [] })).rejects.toThrow('Ya hay un ente');
  });

  it('si fallan los impuestos, el ente queda creado y el aviso lo dice', async () => {
    cola.push({ data: [{ id: 'e-9' }], error: null });
    cola.push({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(crearEnte({ nombre: 'SENIAT', tipo: 'nacional', impuestos: ['IVA'] })).rejects.toThrow('quedó creado, pero sin sus impuestos');
  });

  it('sin impuestos elegidos, desactiva todos los activos del ente', async () => {
    cola.push({ data: [], error: null });
    await fijarImpuestosEnte('e-1', []);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].metodos).toContainEqual(['update', { activo: false }]);
    expect(llamadas[0].metodos.some((m) => m[0] === 'not')).toBe(false);
  });

  it('desactivar pide motivo, pone «hasta» y exige que el update toque la fila', async () => {
    await expect(activarEnte('e-1', false, ' ')).rejects.toThrow('por qué');
    cola.push({ data: [], error: null });
    await expect(activarEnte('e-1', false, 'Ya no cobra el ISAE')).rejects.toThrow('sin permiso');
    const upd = llamadas[0].metodos.find((m) => m[0] === 'update')?.[1] as Record<string, unknown>;
    expect(upd.activo).toBe(false);
    expect(upd.hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('logos e imágenes del agente', () => {
  it('imagen: PNG o JPG hasta 1 MB; nombre seguro en la ruta', () => {
    expect(faltaEnImagen({ type: 'image/gif', size: 10 })).toMatch(/PNG o JPG/);
    expect(faltaEnImagen({ type: 'image/png', size: 1024 * 1024 + 1 })).toMatch(/1 MB/);
    expect(faltaEnImagen({ type: 'image/jpeg', size: 1024 * 1024 })).toBeNull();
    expect(nombreSeguro('Logo Alcaldía (1).PNG')).toBe('logo-alcaldia-1.png');
    expect(rutaLogoEnte('e-1', '2026-10-16', 'Logo Alcaldía.png')).toBe('entes/e-1/2026-10-16-logo-alcaldia.png');
  });

  it('sube sin reemplazar y guarda la versión con .select(id)', async () => {
    cola.push({ data: [{ id: 'l-1' }], error: null });
    const id = await subirLogoEnte('e-1', png(), '2026-10-16', 'Logo nuevo');
    expect(id).toBe('l-1');
    expect(subidas[0]).toEqual({ ruta: 'entes/e-1/2026-10-16-logo-alcaldia.png', opciones: { upsert: false, contentType: 'image/png' } });
    expect(llamadas[0].metodos.find((m) => m[0] === 'insert')?.[1]).toMatchObject({ ente_id: 'e-1', ruta: 'entes/e-1/2026-10-16-logo-alcaldia.png', desde: '2026-10-16' });
    expect(borrados).toHaveLength(0);
  });

  it('si la versión no se guarda (error o 0 filas), borra el archivo subido', async () => {
    cola.push({ data: null, error: { code: '23505', message: 'duplicate key' } });
    await expect(subirLogoEnte('e-1', png(), '2026-10-16')).rejects.toThrow('esa fecha');
    expect(borrados).toEqual([['entes/e-1/2026-10-16-logo-alcaldia.png']]);
    cola.push({ data: [], error: null });
    await expect(subirLogoEnte('e-1', png(), '2026-10-17')).rejects.toThrow('sin permiso');
    expect(borrados).toHaveLength(2);
  });

  it('una imagen inválida o un archivo que ya existe no llega a la tabla', async () => {
    await expect(subirLogoEnte('e-1', png('a.gif', 10, 'image/gif'), '2026-10-16')).rejects.toThrow('PNG o JPG');
    errorSubida = { message: 'The resource already exists' };
    await expect(subirLogoEnte('e-1', png(), '2026-10-16')).rejects.toThrow('esa fecha');
    expect(llamadas).toHaveLength(0);
  });

  it('la firma de la empresa lleva quién firma; va en agente/<clase>/', async () => {
    await expect(subirImagenAgente('firma', png('firma.png'), '2026-10-16')).rejects.toThrow('quien firma');
    cola.push({ data: [{ id: 'f-1' }], error: null });
    await subirImagenAgente('firma', png('firma.png'), '2026-10-16', { firmante: 'Persona de prueba, Administración' });
    expect(subidas[0].ruta).toBe('agente/firma/2026-10-16-firma.png');
    expect(llamadas[0].metodos.find((m) => m[0] === 'insert')?.[1]).toMatchObject({ clase: 'firma', firmante: 'Persona de prueba, Administración' });
  });
});

describe('perfiles fiscales', () => {
  const proveedores = [
    { id: 'p-1', razon_social: 'Beta Servicios', rif: 'J-00000001-0', telefono: '0000-0000001', numero_administracion: null, estado: 'activo' },
    { id: 'p-2', razon_social: 'Alfa Suministros', rif: 'J-00000002-0', telefono: '0000-0000002', numero_administracion: '0000-0000099', estado: 'activo' },
    { id: 'p-3', razon_social: 'Gamma Inactiva', rif: 'J-00000003-0', estado: 'inactivo' },
    { id: 'p-4', razon_social: 'Delta Completa', rif: 'V-00000004-0', estado: 'activo' },
  ];
  const estados = [
    { proveedor_id: 'p-2', perfil_id: 'pf-2', sujeto: 'PJD', tipo_contribuyente: 'ordinario', licencia_estado: 'por_solicitar', actividades: 0, faltan: ['actividad'], completo: false },
    { proveedor_id: 'p-4', perfil_id: 'pf-4', sujeto: 'PNR', tipo_contribuyente: 'especial', licencia_estado: 'vigente', actividades: 2, faltan: [], completo: true },
  ];

  it('une proveedores activos con la vista; sin fila cuenta como sin perfil; teléfono de administración primero', () => {
    const f = unirPerfiles(proveedores, estados);
    expect(f.map((x) => x.proveedorId)).toEqual(['p-1', 'p-2', 'p-4']);
    expect(f[0]).toMatchObject({ perfilId: null, faltan: ['perfil', 'actividad'], completo: false, telefonoAdministracion: '0000-0000001' });
    expect(f[1]).toMatchObject({ sujeto: 'pj_domiciliada', telefonoAdministracion: '0000-0000099' });
    expect(f[2]).toMatchObject({ sujeto: 'pn_residente', completo: true });
  });

  it('incompletos primero (más faltas antes), luego por nombre; filtros por texto, tipo y licencia', () => {
    const f = unirPerfiles(proveedores, estados);
    expect(filtrarPerfiles(f).map((x) => x.razonSocial)).toEqual(['Beta Servicios', 'Alfa Suministros', 'Delta Completa']);
    expect(filtrarPerfiles(f, { soloIncompletos: true })).toHaveLength(2);
    expect(filtrarPerfiles(f, { texto: 'j000000020' }).map((x) => x.proveedorId)).toEqual(['p-2']);
    expect(filtrarPerfiles(f, { tipoContribuyente: 'especial' }).map((x) => x.proveedorId)).toEqual(['p-4']);
    expect(filtrarPerfiles(f, { licencia: 'por_solicitar' }).map((x) => x.proveedorId)).toEqual(['p-2']);
  });

  it('el teléfono va junto a la licencia cuando hay que pedirla', () => {
    expect(pideLicencia({ perfilId: null, licenciaEstado: null })).toBe(true);
    expect(pideLicencia({ perfilId: 'pf', licenciaEstado: 'por_solicitar' })).toBe(true);
    expect(pideLicencia({ perfilId: 'pf', licenciaEstado: 'vigente' })).toBe(false);
  });

  const perfil = (over: Partial<PerfilNuevo> = {}): PerfilNuevo => ({
    tipoPersona: 'juridica', residente: true, tipoContribuyente: 'ordinario', esAgenteRetencion: false,
    licenciaEstado: 'por_solicitar', ...over,
  });

  it('el sujeto sale de persona y residencia, como en la base', () => {
    expect(sujetoDelPerfil({ tipoPersona: 'natural', residente: false })).toBe('pn_no_residente');
    expect(sujetoDelPerfil({ tipoPersona: 'juridica', residente: true })).toBe('pj_domiciliada');
  });

  it('guardar es siempre una versión nueva (insert, nunca update) con desde y motivo', async () => {
    cola.push({ data: [{ id: 'pf-9' }], error: null });
    await guardarPerfil('p-1', perfil({ licenciaTipo: ' Licencia de actividad ' }), '2026-10-16', ' Alta del perfil ');
    const m = llamadas[0].metodos;
    expect(llamadas[0].tabla).toBe('retencion_contraparte_perfiles');
    expect(m.some((x) => x[0] === 'update')).toBe(false);
    expect(m.find((x) => x[0] === 'insert')?.[1]).toMatchObject({
      proveedor_id: 'p-1', tipo_persona: 'juridica', residente: true, licencia_tipo: 'Licencia de actividad', motivo: 'Alta del perfil', desde: '2026-10-16',
    });
    expect((m.find((x) => x[0] === 'insert')?.[1] as Record<string, unknown>).sujeto).toBeUndefined();  // lo calcula la base
  });

  it('sin motivo, licencia vigente sin número o fecha mala: no llega a la base', async () => {
    await expect(guardarPerfil('p-1', perfil(), '2026-10-16', '')).rejects.toThrow('motivo');
    await expect(guardarPerfil('p-1', perfil({ licenciaEstado: 'vigente' }), '2026-10-16', 'x')).rejects.toThrow('su número');
    await expect(guardarPerfil('p-1', perfil(), '16/10/2026', 'x')).rejects.toThrow('desde qué fecha');
    expect(llamadas).toHaveLength(0);
  });

  it('un «desde» no posterior a la vigente (RET_PERFIL_DESDE) se explica con la fecha', async () => {
    cola.push({ data: null, error: { code: 'P0001', message: 'RET_PERFIL_DESDE: la versión nueva tiene que empezar después del 05/10/2026.' } });
    await expect(guardarPerfil('p-1', perfil(), '2026-10-01', 'Cambio')).rejects.toThrow('después del 05/10/2026');
  });

  it('actividades: CIIU o código de ordenanza con su alcaldía; la principal quita la marca anterior', async () => {
    expect(faltaEnActividad({})).toMatch(/CIIU/);
    expect(faltaEnActividad({ ordenanzaCodigo: '1.2' })).toMatch(/alcaldía/);
    expect(faltaEnActividad({ ciiuCodigo: '4510', enteId: 'e-1' })).toMatch(/ordenanza/);
    cola.push({ data: [], error: null });                 // quitar principal
    cola.push({ data: [{ id: 'a-1' }], error: null });    // insert
    await agregarActividad('p-1', { ciiuCodigo: ' 4510 ', principal: true });
    expect(llamadas[0].metodos).toContainEqual(['update', { principal: false }]);
    expect(llamadas[1].metodos.find((x) => x[0] === 'insert')?.[1]).toMatchObject({ ciiu_codigo: '4510', ente_id: null, principal: true });
  });

  it('una actividad repetida se explica; la baja no borra (activa=false, hasta) y exige filas', async () => {
    cola.push({ data: null, error: { code: '23505', message: 'duplicate key' } });
    await expect(agregarActividad('p-1', { ciiuCodigo: '4510' })).rejects.toThrow('ya está cargada');
    cola.push({ data: [], error: null });
    await expect(bajaActividad('a-1', '2026-10-16')).rejects.toThrow('sin permiso');
    expect(llamadas[1].metodos.find((x) => x[0] === 'update')?.[1]).toMatchObject({ activa: false, principal: false, hasta: '2026-10-16' });
  });
});

describe('régimen de la empresa por impuesto', () => {
  it('especial va sin impuesto; agente, con impuesto; motivo y fechas', () => {
    expect(faltaEnCondicion({ impuestoClave: 'IVA', condicion: 'contribuyente_especial', valor: true, desde: '2026-10-16', motivo: 'x' })).toMatch(/de la empresa/);
    expect(faltaEnCondicion({ impuestoClave: null, condicion: 'agente_retencion', valor: true, desde: '2026-10-16', motivo: 'x' })).toMatch(/impuesto/);
    expect(faltaEnCondicion({ impuestoClave: 'IVA', condicion: 'agente_retencion', valor: true, desde: '2026-10-16', hasta: '2026-10-01', motivo: 'x' })).toMatch(/anterior/);
    expect(faltaEnCondicion({ impuestoClave: 'IVA', condicion: 'agente_retencion', valor: true, desde: '2026-10-16', motivo: ' ' })).toMatch(/motivo/);
  });

  it('registra con .select(id); 0 filas es sin permiso', async () => {
    cola.push({ data: [{ id: 'c-1' }], error: null });
    await registrarCondicion({ impuestoClave: 'IVA', condicion: 'agente_retencion', valor: true, desde: '2026-10-07', motivo: 'Designación', fuente: 'Providencia de prueba' });
    expect(llamadas[0].metodos.find((x) => x[0] === 'insert')?.[1]).toMatchObject({ impuesto_clave: 'IVA', condicion: 'agente_retencion', valor: true });
    cola.push({ data: [], error: null });
    await expect(registrarCondicion({ impuestoClave: null, condicion: 'contribuyente_especial', valor: false, desde: '2026-10-16', motivo: 'x' })).rejects.toThrow('sin permiso');
  });

  it('el valor vigente en una fecha, del historial', () => {
    const c = (id: string, desde: string, valor: boolean, hasta: string | null = null): CondicionRegistrada => ({
      id, impuestoClave: 'IVA', condicion: 'agente_retencion', valor, desde, hasta, motivo: 'x', fuente: null, actualizadoEn: null, actualizadoPor: null,
    });
    const xs = [c('a', '2026-01-01', false), c('b', '2026-10-07', true)];
    expect(condicionVigente(xs, 'IVA', 'agente_retencion', '2026-09-30')?.id).toBe('a');
    expect(condicionVigente(xs, 'IVA', 'agente_retencion', '2026-10-16')?.valor).toBe(true);
    expect(condicionVigente(xs, 'ISLR', 'agente_retencion', '2026-10-16')).toBeNull();
  });
});

describe('traductor: textos propios de cada pantalla', () => {
  it('23505 y 23514 con texto propio; sin texto propio, un texto genérico en español (no «régimen», D41)', () => {
    expect(errorRetencion({ code: '23505', message: 'x' }, 'd', { unico: 'Ya existe.' }).message).toBe('Ya existe.');
    expect(errorRetencion({ code: '23514', message: 'x' }, 'd', { regla: 'No cumple.' }).message).toBe('No cumple.');
    expect(errorRetencion({ code: '23514', message: 'x' }).message).toMatch(/no cumple una regla de la base/);
    expect(errorRetencion({ code: 'P0001', message: 'RET_PERFIL_DESDE' }).message).toMatch(/después de la vigente/);
  });
});
