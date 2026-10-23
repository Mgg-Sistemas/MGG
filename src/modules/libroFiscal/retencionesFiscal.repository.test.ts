import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Supabase falso: cada `from()` toma la siguiente respuesta de la cola y anota
   las llamadas que le hicieron, para comprobar qué se le pidió a la base. */
type Resp = { data: unknown; error: unknown };
const cola: Resp[] = [];
const llamadas: { tabla: string; metodos: unknown[][] }[] = [];
const rpc = vi.fn();

function consulta(tabla: string, resp: Resp) {
  const registro = { tabla, metodos: [] as unknown[][] };
  llamadas.push(registro);
  const q: Record<string, unknown> = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (ok: (v: Resp) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resp).then(ok, ko);
      return (...args: unknown[]) => { registro.metodos.push([prop, ...args]); return q; };
    },
  });
  return q;
}

// Sin R3 (valores del JSON) y con V2R (la base numera): las pruebas de v2rV3r cubren el camino sin V2R.
vi.mock('./disponibilidad', () => ({ tablaDisponible: async () => false, r2Disponible: async () => false, v2rDisponible: async () => true }));

vi.mock('@/shared/lib/supabase', () => ({
  supabase: {
    from: (tabla: string) => consulta(tabla, cola.shift() ?? { data: [], error: null }),
    rpc: (...args: unknown[]) => rpc(...args),
    storage: { from: () => ({ upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: { signedUrl: 'x' }, error: null }) }) },
  },
}));

import { rifValido } from '@/shared/lib/rif';
import { EMPRESA_NOMBRE, EMPRESA_RIF } from '@/shared/lib/empresa';
import { CONFIG_RETENCION_DEFECTO } from './retencionesCalculo';
import {
  SIN_PERMISO, aRetencion, anularRetencion, conceptosDeFilaGt, conceptosLocales, configDeJson, direccionDeGt,
  errorPorcentajesIva, guardarConfigRetencion,
  filaGtDeNueva, jsonDeConfig, llevaNumeroPropio, marcarDeclarada, registrarRetencion, rolAGt,
  sujetoAGt, sujetoDeGt, tipoAGt, tipoDeGt, tiposLicenciaDeJson, type NuevaRetencion,
} from './retencionesFiscal.repository';

// Datos inventados. El RIF se arma con el dígito verificador que acepte la validación de GT.
const RIF = (() => {
  for (let d = 0; d <= 9; d += 1) if (rifValido(`J-00000001-${d}`)) return `J-00000001-${d}`;
  throw new Error('sin RIF de prueba');
})();

const nueva = (over: Partial<NuevaRetencion> = {}): NuevaRetencion => ({
  tipo: 'iva', direccion: 'practicada', docKind: 'manual',
  contraparteRif: RIF, contraparteNombre: 'Proveedor de prueba', facturaNumero: '000123',
  facturaFecha: '2026-10-05', periodo: '202610', quincena: 1, moneda: 'Bs',
  baseImponible: 1000, alicuota: 16, impuesto: 160, porcentaje: 75, montoRetenido: 120,
  actor: 'prueba@ejemplo.com', ...over,
});

beforeEach(() => { cola.length = 0; llamadas.length = 0; rpc.mockReset(); });

describe('traducciones entre el módulo y las tablas de GT', () => {
  it('el impuesto va en MAYÚSCULAS y el estadal se llama ESTADAL', () => {
    expect(tipoAGt('iva')).toBe('IVA');
    expect(tipoAGt('regional')).toBe('ESTADAL');
    expect(tipoDeGt('ESTADAL')).toBe('regional');
    expect(tipoDeGt('IGTF')).toBe('igtf');
  });

  it('la retención recibida mapea al rol sufrida en GT', () => {
    expect(rolAGt('recibida')).toBe('sufrida');
    expect(rolAGt('practicada')).toBe('practicada');
    expect(direccionDeGt('sufrida')).toBe('recibida');
  });

  it('los sujetos del ISLR; «cualquier sujeto» no tiene columna', () => {
    expect(sujetoAGt('pn_residente')).toBe('PNR');
    expect(sujetoAGt('todos')).toBeNull();
    expect(sujetoDeGt('PJND')).toBe('pj_no_domiciliada');
  });

  it('una fila de GT se lee con su documento, su estado y su concepto', () => {
    const r = aRetencion({
      id: 'r-1', rol: 'practicada', tipo: 'ESTADAL', estado: 'anulada', declarada_at: null,
      orden_id: null, compra_directa_id: 'cd-1', comprobante_periodo: '202610', comprobante_nro: '20261000000001',
      concepto_codigo: '001', sujeto: 'PNR', base: 100, monto: 1, monto_bs: 1, anulada_motivo: 'Error de carga',
    });
    expect(r.tipo).toBe('regional');
    expect(r.anulada).toBe(true);
    expect(r.estado).toBe('registrada');
    expect(r.docKind).toBe('compra_directa');
    expect(r.docId).toBe('cd-1');
    expect(r.conceptoId).toBe('001:PNR');
    expect(r.contraparteSujeto).toBe('pn_residente');
  });

  it('una declarada que después se anuló sigue diciendo que se declaró', () => {
    const r = aRetencion({ id: 'r-2', rol: 'practicada', tipo: 'IVA', estado: 'anulada', declarada_at: '2026-10-10T00:00:00Z' });
    expect(r.anulada).toBe(true);
    expect(r.estado).toBe('declarada');
  });
});

describe('la configuración es el JSON de Parámetros', () => {
  it('sin datos: agente de IVA sí, especial no, y los datos de la empresa', () => {
    const c = configDeJson(null);
    expect(c.esAgenteRetencionIva).toBe(true);
    expect(c.esContribuyenteEspecial).toBe(false);
    expect(c.rif).toBe(EMPRESA_RIF);
    expect(c.razonSocial).toBe(EMPRESA_NOMBRE);
  });

  it('lee las dos marcas y la UT', () => {
    const c = configDeJson({ agente_retencion_iva: false, contribuyente_especial: true, unidad_tributaria: 43, iva_retencion: 75 });
    expect(c.esAgenteRetencionIva).toBe(false);
    expect(c.esContribuyenteEspecial).toBe(true);
    expect(c.valorUt).toBe(43);
  });

  it('la retención de IVA solo admite 75% y 100% (C-1); los dos son dato', () => {
    expect(errorPorcentajesIva({ pctIvaGeneral: 75, pctIvaEspecial: 100 })).toBeNull();
    expect(errorPorcentajesIva({ pctIvaGeneral: 100, pctIvaEspecial: 100 })).toBeNull();
    expect(errorPorcentajesIva({ pctIvaGeneral: 50, pctIvaEspecial: 100 })).toContain('75% o 100%');
    expect(jsonDeConfig({ ...CONFIG_RETENCION_DEFECTO, pctIvaEspecial: 75 }, null).iva_retencion_especial).toBe(75);
    expect(configDeJson({ iva_retencion_especial: 75 }).pctIvaEspecial).toBe(75);
  });

  it('no guarda un porcentaje de IVA fuera de la norma, y no llega a la base', async () => {
    await expect(guardarConfigRetencion({ ...CONFIG_RETENCION_DEFECTO, pctIvaGeneral: 60 })).rejects.toThrow('75% o 100%');
    expect(llamadas).toHaveLength(0);
  });

  it('al guardar conserva las claves que este módulo no maneja', () => {
    const previo = { iva_alicuota: 16, municipal_alicuota: 1, estadal_alicuota: 1, otra_clave: 'x' };
    const j = jsonDeConfig({ ...CONFIG_RETENCION_DEFECTO, valorUt: 43 }, previo);
    expect(j.municipal_alicuota).toBe(1);
    expect(j.estadal_alicuota).toBe(1);
    expect(j.iva_alicuota).toBe(16);
    expect(j.otra_clave).toBe('x');
    expect(j.unidad_tributaria).toBe(43);
    expect(j.agente_retencion_iva).toBe(true);
  });
});

describe('el catálogo de GT: un código, un porcentaje por sujeto', () => {
  const fila = { codigo: '001', concepto: 'Honorarios profesionales', pjd: 5, pjnd: 34, pnr: 3, pnnr: null, base_pct: 100, activo: true, orden: 1 };

  it('ofrece un concepto por cada sujeto con porcentaje; el vacío no se ofrece', () => {
    const cs = conceptosDeFilaGt(fila);
    expect(cs.map((c) => c.id)).toEqual(['001:PJD', '001:PJND', '001:PNR']);
  });

  it('solo la persona natural residente lleva sustraendo y mínimo de 83,3334 UT', () => {
    const cs = conceptosDeFilaGt(fila);
    expect(cs.find((c) => c.id === '001:PNR')).toMatchObject({ aplicaSustraendo: true, baseMinimaUt: 83.3334, porcentaje: 3 });
    expect(cs.find((c) => c.id === '001:PJD')).toMatchObject({ aplicaSustraendo: false, baseMinimaUt: 0, porcentaje: 5 });
  });

  it('el ISAE y el timbre estadal salen de las alícuotas de Parámetros', () => {
    const [municipal, regional] = conceptosLocales({ municipal_alicuota: 1, estadal_alicuota: 0.5, municipio: 'Municipio de prueba' });
    expect(municipal).toMatchObject({ tipo: 'municipal', porcentaje: 1 });
    expect(municipal.nombre).toContain('Municipio de prueba');
    expect(regional).toMatchObject({ tipo: 'regional', porcentaje: 0.5 });
  });
});

describe('la fila que se escribe en el libro', () => {
  it('el ISAE del registro suelto guarda el municipio; los demás impuestos no (D41)', () => {
    expect(filaGtDeNueva(nueva({ tipo: 'municipal', municipio: ' Caroní ' }), { entero: 1, texto: 'x' }).municipio).toBe('Caroní');
    expect(filaGtDeNueva(nueva({ tipo: 'iva', municipio: 'Caroní' }), { entero: 1, texto: 'x' }).municipio).toBeNull();
  });

  it('una recibida no lleva proveedor (la contraparte es un cliente) y guarda RIF y nombre', () => {
    const f = filaGtDeNueva(nueva({ direccion: 'recibida', contraparteId: 'cliente-1' }), { entero: null, texto: 'A-1' });
    expect(f.rol).toBe('sufrida');
    expect(f.proveedor_id).toBeNull();
    expect(f.razon_social).toBe('Proveedor de prueba');
    expect(f.comprobante_nro).toBe('A-1');
  });

  it('el documento de origen va en su columna, y los montos también en Bs', () => {
    const f = filaGtDeNueva(nueva({ docKind: 'oc', docId: 'oc-1', tipo: 'regional', moneda: 'USD', tasa: 40, montoRetenido: 10, baseImponible: 1000 }), { entero: 1, texto: '20261000000001' });
    expect(f.tipo).toBe('ESTADAL');
    expect(f.orden_id).toBe('oc-1');
    expect(f.compra_directa_id).toBeNull();
    expect(f.monto_bs).toBe(400);
    expect(f.base_bs).toBe(40000);
    expect(f.iva_monto).toBeNull();
  });

  it('numera toda practicada menos el IGTF; las recibidas no', () => {
    expect(llevaNumeroPropio({ direccion: 'practicada', tipo: 'islr' })).toBe(true);
    expect(llevaNumeroPropio({ direccion: 'practicada', tipo: 'igtf' })).toBe(false);
    expect(llevaNumeroPropio({ direccion: 'recibida', tipo: 'iva' })).toBe(false);
  });
});

describe('registrar: el número de una practicada lo pone la base (V2)', () => {
  it('practica un IVA: no pide ni arma el número; lo lee de la fila devuelta', async () => {
    cola.push({ data: [], error: null });                                    // doble registro: nada
    cola.push({ data: { id: 'r-9', rol: 'practicada', tipo: 'IVA', estado: 'registrada', comprobante_nro: '20261000000007', numero: 7, numero_origen: 'sistema' }, error: null });
    const r = await registrarRetencion(nueva(), CONFIG_RETENCION_DEFECTO);
    expect(rpc).not.toHaveBeenCalled();
    const insert = llamadas[1].metodos.find((m) => m[0] === 'insert')?.[1] as Record<string, unknown>;
    expect(insert.comprobante_nro).toBeNull();
    expect(insert.numero).toBeNull();
    expect(insert.tipo).toBe('IVA');
    expect(r.numeroComprobante).toBe('20261000000007');
    expect(r.numeroOrigen).toBe('sistema');
  });

  it('ISLR: la base le da 10 dígitos continuos y la fila llega así', async () => {
    cola.push({ data: [], error: null });
    cola.push({ data: { id: 'r-8', rol: 'practicada', tipo: 'ISLR', estado: 'registrada', comprobante_nro: '0000000031', numero: 31, numero_origen: 'sistema' }, error: null });
    const r = await registrarRetencion(nueva({ tipo: 'islr' }), CONFIG_RETENCION_DEFECTO);
    expect(r.numeroComprobante).toBe('0000000031');
  });

  it('un número dado viaja tal cual; con otro formato se rechaza antes de tocar la base', async () => {
    cola.push({ data: [], error: null });
    cola.push({ data: { id: 'r-7', rol: 'practicada', tipo: 'ISLR', estado: 'registrada', comprobante_nro: '0000000120', numero_origen: 'dado' }, error: null });
    await registrarRetencion(nueva({ tipo: 'islr', numeroComprobante: '0000000120' }), CONFIG_RETENCION_DEFECTO);
    const insert = llamadas[1].metodos.find((m) => m[0] === 'insert')?.[1] as Record<string, unknown>;
    expect(insert.comprobante_nro).toBe('0000000120');
    llamadas.length = 0;
    cola.push({ data: [], error: null });
    await expect(registrarRetencion(nueva({ tipo: 'islr', numeroComprobante: '20261000000120' }), CONFIG_RETENCION_DEFECTO))
      .rejects.toThrow('10 dígitos');
    expect(llamadas.some((l) => l.metodos.some((m) => m[0] === 'insert'))).toBe(false);
  });

  it('RET_NUMERO_FORMATO de la base se explica con los dos formatos', async () => {
    cola.push({ data: [], error: null });
    cola.push({ data: null, error: { code: 'P0001', message: 'RET_NUMERO_FORMATO: el comprobante de ISLR lleva 10 dígitos.' } });
    await expect(registrarRetencion(nueva(), CONFIG_RETENCION_DEFECTO)).rejects.toThrow('10 dígitos');
  });

  it('operacion_numero (ISAE) se lee como dato informativo', () => {
    expect(aRetencion({ id: 'r-1', rol: 'practicada', tipo: 'MUNICIPAL', operacion_numero: 4 }).operacionNumero).toBe(4);
    expect(aRetencion({ id: 'r-1', rol: 'practicada', tipo: 'IVA' }).operacionNumero).toBeNull();
  });

  it('el doble registro busca solo lo no anulado, con el rol y el impuesto de GT', async () => {
    cola.push({ data: [], error: null });
    cola.push({ data: { id: 'r-9', rol: 'practicada', tipo: 'IVA', estado: 'registrada' }, error: null });
    await registrarRetencion(nueva(), CONFIG_RETENCION_DEFECTO);
    const m = llamadas[0].metodos;
    expect(m).toContainEqual(['eq', 'rol', 'practicada']);
    expect(m).toContainEqual(['eq', 'tipo', 'IVA']);
    expect(m).toContainEqual(['neq', 'estado', 'anulada']);
  });

  it('si la factura ya tiene una retención vigente, no inserta', async () => {
    cola.push({ data: [{ id: 'r-1', rol: 'practicada', tipo: 'IVA', estado: 'registrada', rif: RIF, factura_nro: '000123' }], error: null });
    await expect(registrarRetencion(nueva(), CONFIG_RETENCION_DEFECTO)).rejects.toThrow('ya tiene una retención');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('el IGTF practicado sin ser especial se rechaza sin tocar la base', async () => {
    await expect(registrarRetencion(nueva({ tipo: 'igtf' }), CONFIG_RETENCION_DEFECTO)).rejects.toThrow('contribuyente especial');
    expect(rpc).not.toHaveBeenCalled();
    expect(llamadas).toHaveLength(0);
  });

  it('sin factura, sin monto o con un RIF mal escrito no toca la base', async () => {
    await expect(registrarRetencion(nueva({ facturaNumero: '' }), CONFIG_RETENCION_DEFECTO)).rejects.toThrow('N° de factura');
    await expect(registrarRetencion(nueva({ montoRetenido: 0 }), CONFIG_RETENCION_DEFECTO)).rejects.toThrow('debe llevar el motivo');
    await expect(registrarRetencion(nueva({ contraparteRif: 'J-12' }), CONFIG_RETENCION_DEFECTO)).rejects.toThrow('RIF');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('un monto 0 CON motivo sí se registra (D19): deja constancia de por qué no se retiene', async () => {
    cola.push({ data: [], error: null });                        // doble registro: nada
    cola.push({ data: { id: 'r-0', rol: 'practicada', tipo: 'ISLR', estado: 'registrada', monto: 0, descripcion: 'No supera el mínimo exento' }, error: null });
    const r = await registrarRetencion(nueva({ tipo: 'islr', montoRetenido: 0, observacion: 'No supera el mínimo exento' }), CONFIG_RETENCION_DEFECTO);
    expect(r.montoRetenido).toBe(0);
    const insert = llamadas[1].metodos.find((m) => m[0] === 'insert')?.[1] as Record<string, unknown>;
    expect(insert.monto).toBe(0);
    expect(insert.descripcion).toBe('No supera el mínimo exento');
  });

  it('una recibida no pide número: guarda el del comprobante del cliente', async () => {
    cola.push({ data: [], error: null });
    cola.push({ data: { id: 'r-3', rol: 'sufrida', tipo: 'IVA', estado: 'registrada', comprobante_nro: 'C-55' }, error: null });
    await registrarRetencion(nueva({ direccion: 'recibida', numeroComprobante: 'C-55' }), CONFIG_RETENCION_DEFECTO);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('el número repetido de un comprobante se explica', async () => {
    cola.push({ data: [], error: null });
    cola.push({ data: null, error: { code: '23505', message: 'duplicate key' } });
    await expect(registrarRetencion(nueva({ direccion: 'recibida', numeroComprobante: 'C-55' }), CONFIG_RETENCION_DEFECTO))
      .rejects.toThrow('mismo número');
  });

  it('la fila guarda la UT con la que se calculó (VU)', async () => {
    cola.push({ data: [], error: null });
    cola.push({ data: { id: 'r-5', rol: 'sufrida', tipo: 'ISLR', estado: 'registrada' }, error: null });
    await registrarRetencion(nueva({ direccion: 'recibida', tipo: 'islr', numeroComprobante: 'C-56' }), { ...CONFIG_RETENCION_DEFECTO, valorUt: 43 });
    const insert = llamadas[1].metodos.find((m) => m[0] === 'insert')?.[1] as Record<string, unknown>;
    expect(insert.valor_ut).toBe(43);
  });

  it('una recibida anulada no impide volver a registrarla con el mismo número del cliente (VF)', async () => {
    cola.push({ data: [], error: null });                        // la búsqueda deja fuera las anuladas
    cola.push({ data: { id: 'r-4', rol: 'sufrida', tipo: 'IVA', estado: 'registrada', comprobante_nro: 'C-55' }, error: null });
    const r = await registrarRetencion(nueva({ direccion: 'recibida', numeroComprobante: 'C-55' }), CONFIG_RETENCION_DEFECTO);
    expect(llamadas[0].metodos).toContainEqual(['neq', 'estado', 'anulada']);
    expect(r.numeroComprobante).toBe('C-55');
  });

  it('serie manual sin número (V2 · RET_NUMERO_FALTA): mensaje legible', async () => {
    cola.push({ data: [], error: null });
    cola.push({ data: null, error: { code: 'P0001', message: 'RET_NUMERO_FALTA: la serie es manual.' } });
    await expect(registrarRetencion(nueva(), CONFIG_RETENCION_DEFECTO)).rejects.toThrow('escribe el número del comprobante');
  });

  it('numero_origen (V2) se lee como dato informativo', () => {
    expect(aRetencion({ id: 'r-1', rol: 'practicada', tipo: 'IVA', numero_origen: 'dado' }).numeroOrigen).toBe('dado');
    expect(aRetencion({ id: 'r-1', rol: 'practicada', tipo: 'IVA' }).numeroOrigen).toBeNull();
  });
});

describe('un cambio que no toca ninguna fila no es un éxito', () => {
  it('anular sin permiso avisa en vez de callar', async () => {
    cola.push({ data: [], error: null });
    await expect(anularRetencion('r-1', 'Error de carga')).rejects.toThrow(SIN_PERMISO);
  });

  it('anular pone el estado y el motivo; no borra', async () => {
    cola.push({ data: [{ id: 'r-1' }], error: null });
    await anularRetencion('r-1', 'Error de carga');
    const m = llamadas[0].metodos;
    expect(m.find((x) => x[0] === 'update')?.[1]).toMatchObject({ estado: 'anulada', anulada_motivo: 'Error de carga' });
    expect(m.some((x) => x[0] === 'delete')).toBe(false);
  });

  it('sin motivo no se anula', async () => {
    await expect(anularRetencion('r-1', '  ')).rejects.toThrow('Motivo de anulación requerido');
  });

  it('declarar sin permiso también avisa', async () => {
    cola.push({ data: [], error: null });
    await expect(marcarDeclarada('r-1', true, 'prueba@ejemplo.com')).rejects.toThrow(SIN_PERMISO);
  });
});

describe('tipos de licencia en el JSON de parámetros', () => {
  it('lee los válidos y descarta lo que no tiene forma', () => {
    expect(tiposLicenciaDeJson({ licencia_tipos: [
      { id: 'a', nombre: ' Permanente ', activo: true },
      { id: 'b', nombre: 'Provisional', activo: false },
      { id: 'c', nombre: '' },
      { nombre: 'sin id' },
      'texto suelto',
    ] })).toEqual([
      { id: 'a', nombre: 'Permanente', activo: true },
      { id: 'b', nombre: 'Provisional', activo: false },
    ]);
  });
  it('sin la clave, la lista está vacía', () => {
    expect(tiposLicenciaDeJson({})).toEqual([]);
    expect(tiposLicenciaDeJson(null)).toEqual([]);
  });
});
