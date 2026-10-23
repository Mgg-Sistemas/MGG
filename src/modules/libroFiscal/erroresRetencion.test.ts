import { describe, expect, it } from 'vitest';
import { codigoRet, errorRetencion, errorStorage } from './erroresRetencion';

describe('errores de la base en texto de pantalla', () => {
  it('reconoce el código RET_* dentro del mensaje', () => {
    expect(codigoRet('RET_NUMERO_FALTA: la serie es manual')).toBe('RET_NUMERO_FALTA');
    expect(codigoRet('duplicate key')).toBeNull();
    expect(codigoRet(undefined)).toBeNull();
  });

  it('RET_NUMERO_FALTA (V2, serie manual) pide escribir el número', () => {
    const e = errorRetencion({ code: 'P0001', message: 'RET_NUMERO_FALTA: la serie de IVA se numera a mano.' });
    expect(e.message).toContain('escribe el número del comprobante');
    expect(e.message).not.toContain('RET_');
  });

  it('los rechazos de la serie (V2) llegan como texto, sin el código', () => {
    const casos: Array<[string, string]> = [
      ['RET_NUMERO_NO_ES_EL_ULTIMO', 'la última retención de su serie'],
      ['RET_NUMERO_NO_EDITABLE', 'declarada o anulada'],
      ['RET_NUMERO_NO_SE_QUITA', 'no se puede quitar'],
      ['RET_SERIE_LLENA', 'último número'],
    ];
    for (const [codigo, texto] of casos) {
      const e = errorRetencion({ code: 'P0001', message: `${codigo}: detalle de la base.` });
      expect(e.message).toContain(texto);
      expect(e.message).not.toContain('RET_');
    }
  });

  it('permiso por su código; el régimen solo cuando lo dice la base; un único sin nombre no es «número de comprobante»', () => {
    expect(errorRetencion({ code: '42501', message: 'permission denied' }).message).toContain('permiso');
    const regimen = 'La empresa no puede retener IVA: no está marcada como agente de retención de IVA.';
    expect(errorRetencion({ code: '23514', message: regimen }).message).toBe(regimen);
    expect(errorRetencion({ code: '23514', message: 'check_violation' }).message).not.toMatch(/régimen/);
    expect(errorRetencion({ code: '23505', message: 'duplicate key' }).message).not.toMatch(/comprobante/);
    expect(errorRetencion({ code: '23505', message: 'duplicate key value violates unique constraint "retenciones_comprobante_propio_uk"' }).message).toContain('ya se dio');
  });

  it('un código que no está en la lista deja el texto de la base; sin texto, el de respaldo', () => {
    expect(errorRetencion({ code: 'P0001', message: 'RET_ALGO_NUEVO: detalle de la base' }).message).toBe('Detalle de la base');
    expect(errorRetencion({ code: 'P0001' }, 'No se pudo.').message).toBe('No se pudo.');
  });

  it('documentos (VF): tipo y factura afectada de una nota', () => {
    expect(errorRetencion({ code: 'P0001', message: 'RET_DOCUMENTO_TIPO: x' }).message).toContain('nota de crédito');
    expect(errorRetencion({ code: 'P0001', message: 'RET_DOCUMENTO_AFECTADO: x' }).message).toContain('la factura que ajusta');
  });

  it('R9: un CHECK de forma o rango dice qué dato no cumple, no «régimen»', () => {
    const chk = (c: string) => errorRetencion({ code: '23514', message: `new row for relation "retenciones" violates check constraint "${c}"` }).message;
    expect(chk('retenciones_porcentajes')).toMatch(/0 a 100/);
    expect(chk('retenciones_forma')).toMatch(/1 a 30 caracteres/);
    expect(chk('retenciones_montos_no_negativos')).toMatch(/negativos/);
    expect(chk('retenciones_valor_ut_positivo')).toMatch(/UT/);
    expect(chk('retenciones_periodo_forma')).toMatch(/AAAAMM/);
    expect(chk('retencion_documentos_moneda')).toMatch(/Bs o USD/);
    expect(chk('retencion_entes_rif_forma')).toMatch(/RIF del ente/);
    expect(chk('retencion_contraparte_perfiles_licencia_vence_rango')).toMatch(/licencia/);
    expect(chk('retencion_documentos_forma')).toMatch(/número y el control/);
    for (const c of ['retenciones_forma', 'retenciones_moneda', 'retencion_ente_logos_desde_rango']) expect(chk(c)).not.toMatch(/régimen/);
  });

  it('R9: el texto propio de la pantalla no tapa una regla de forma conocida; una desconocida sí lo usa', () => {
    expect(errorRetencion({ code: '23514', message: 'violates check constraint "retenciones_quincena"' }, 'x', { regla: 'Texto de la pantalla' }).message).toBe('La quincena es 1 o 2.');
    expect(errorRetencion({ code: '23514', message: 'violates check constraint "otra_cosa"' }, 'x', { regla: 'Texto de la pantalla' }).message).toBe('Texto de la pantalla');
  });

  it('R8 y R9: licencia fuera del catálogo y formato', () => {
    expect(errorRetencion({ code: 'P0001', message: 'RET_LICENCIA_TIPO: x' }).message).toMatch(/Tipos de licencia/);
    expect(errorRetencion({ code: 'P0001', message: 'RET_FORMATO_FORMA: x' }).message).toMatch(/objeto/);
    expect(errorRetencion({ code: 'P0001', message: 'RET_FORMATO_DESDE: la versión nueva del formato tiene que empezar después del 05/10/2026. Para corregir la vigente, edítela.' }).message)
      .toBe('La versión nueva del formato tiene que empezar después del 05/10/2026, que es cuando empezó la vigente. Para corregir la vigente, edítala.');
  });

  it('Lote 3: los únicos por nombre de índice dicen qué ya existe', () => {
    const uni = (n: string) => errorRetencion({ code: '23505', message: `duplicate key value violates unique constraint "${n}"` }).message;
    expect(uni('retencion_formatos_abierto')).toMatch(/formato ya tiene una versión vigente/);
    expect(uni('retencion_supuestos_codigo_unico_sin_mayusculas')).toMatch(/sin distinguir mayúsculas/);
    expect(uni('retencion_entes_unico')).toMatch(/ente/);
    expect(uni('retencion_clasificacion_codigos_clasificacion_id_codigo_key')).toMatch(/código ya existe/);
    expect(uni('retencion_tarifas_pkey')).toMatch(/tarifa/);
    expect(uni('otra_tabla_pkey')).toBe('Ya existe uno con esa clave.');
  });

  it('Lote 3: 23502, 23503, 22P02 y fechas en español; nada en inglés', () => {
    expect(errorRetencion({ code: '23502', message: 'null value in column "motivo" of relation "retencion_formatos" violates not-null constraint' }).message).toBe('Falta el motivo.');
    expect(errorRetencion({ code: '23502', message: 'null value in column "otra_cosa" violates not-null constraint' }).message).toBe('Falta «otra cosa».');
    expect(errorRetencion({ code: '23503', message: 'insert or update on table "retencion_formatos" violates foreign key constraint "retencion_formatos_impuesto_clave_fkey"' }).message).toMatch(/impuesto no existe/);
    expect(errorRetencion({ code: '23503', message: 'update or delete on table "x" violates foreign key constraint "y"' }).message).toMatch(/No se puede borrar/);
    expect(errorRetencion({ code: '22P02', message: 'invalid input syntax for type uuid: "x"' }).message).toMatch(/formato inválido/);
    expect(errorRetencion({ code: '22007', message: 'invalid input syntax for type date' }).message).toBe('Una fecha no es válida.');
    for (const c of ['23502', '23503', '22P02', '22007', '23514', '23505']) {
      expect(errorRetencion({ code: c, message: 'violates something in english' }).message).not.toMatch(/violates|null value|invalid input/);
    }
  });

  it('Lote 3: claves de R9 y enlaces de P03', () => {
    const chk = (c: string) => errorRetencion({ code: '23514', message: `violates check constraint "${c}"` }).message;
    expect(chk('retencion_clasificacion_codigos_forma')).toMatch(/mayúsculas/);
    expect(chk('retencion_contraparte_actividades_ordenanza_forma')).toMatch(/ordenanza/);
    expect(errorRetencion({ code: 'P0001', message: 'RET_ENLACE_PRINCIPAL: x' }).message).toMatch(/orden principal/);
    expect(errorRetencion({ code: 'P0001', message: 'RET_ENLACE_CON_ARCHIVO: x' }).message).toMatch(/archivo/);
    expect(errorRetencion({ code: 'P0001', message: 'RET_ORIGEN_OTRO_PROVEEDOR: esa orden es de otro proveedor.' }).message).toBe('Esa orden es de otro proveedor.');
  });

  it('Storage en español: permiso, tamaño, tipo', () => {
    expect(errorStorage({ message: 'new row violates row-level security policy' }, 'el logo').message).toMatch(/sin permiso/);
    expect(errorStorage({ message: 'Payload too large' }, 'el logo').message).toBe('El logo es demasiado grande.');
    expect(errorStorage({ message: 'invalid mime type' }, 'la firma').message).toMatch(/tipo permitido/);
    expect(errorStorage({ message: 'algo raro' }, 'el sello').message).toBe('No se pudo subir el sello. Vuelve a intentarlo.');
  });
});
