import { describe, expect, it } from 'vitest';
import { labelClave, labelTipoEnte } from './parametrosR1';
import { labelImpuesto } from './retencionesCalculo';
import { cambiosTexto, lineaHistorial } from './parametrosR2';
import { nombreColumna } from './erroresRetencion';
import { faltaEnValor } from './parametros.repository';
import { ENTEROS_IMPUESTO, faltaEnEnteros, leerSupuestoNumeros, noSeEntiende } from './parametrosNumeros';
import { ROTULO_ORDEN } from './rotulos';
import type { TipoEnte } from './entes.repository';

/** Ninguna clave técnica a la vista: ni «_» ni la clave en MAYÚSCULAS tal cual. */
const sinClave = (t: string) => expect(t).not.toMatch(/_/);

describe('pantallas de Retenciones: las palabras del usuario (21/10)', () => {
  it('impuestos: MUNICIPAL se dice «ISAE (municipal)» y una clave nueva nunca sale cruda', () => {
    expect(labelClave('MUNICIPAL')).toBe('ISAE (municipal)');
    expect(labelClave('IVA')).toBe('IVA');
    sinClave(labelClave('TIMBRE_X'));
    sinClave(labelImpuesto('otro_impuesto'));
    expect(labelImpuesto(null)).toBe('—');
    expect(labelImpuesto('municipal')).toBe('ISAE (actividades económicas)');
    sinClave(labelTipoEnte('ente_raro' as TipoEnte));
  });

  it('historial sembrado: «Sistema (carga inicial)», «Carga inicial del sistema» y la tabla en palabras', () => {
    const l = lineaHistorial({ tabla: 'retencion_impuesto_versiones', actor: 'postgres', motivo: 'Valor de arranque (R2; antes V1). Vale también para fechas anteriores.' });
    expect(l).toEqual({ que: 'Cambio de valores vigentes', quien: 'Sistema (carga inicial)', motivo: 'Carga inicial del sistema' });
    expect(lineaHistorial({ tabla: 'retencion_impuestos', actor: 'ana@ejemplo.com', motivo: null }))
      .toEqual({ que: 'Datos del impuesto', quien: 'ana@ejemplo.com', motivo: 'Sin motivo' });
    expect(lineaHistorial({ actor: null, motivo: 'Carga inicial R3: UT vigente' }).motivo).toBe('Carga inicial del sistema');
  });

  it('qué cambió: las columnas en palabras, sin las de control', () => {
    expect(nombreColumna('desde')).toBe('la fecha «desde»');
    expect(nombreColumna('pct')).toBe('el %');
    const t = cambiosTexto({ antes: { serie_inicial: 1, updated_at: 'a', nombre: 'A' }, despues: { serie_inicial: 2, updated_at: 'b', nombre: 'A' } });
    sinClave(t);
    expect(t).toMatch(/el primer número de la serie/);
    expect(t).not.toMatch(/updated/);
  });

  it('un valor de Parámetros se nombra por su nombre, no por su clave', () => {
    expect(faltaEnValor({ ambito: 'impuesto', clave: 'pct_retencion' }, null, '2026-10-21', 'x')).toBe('«% de retención» es de un impuesto: indica cuál.');
    expect(faltaEnValor({ ambito: 'general', clave: 'minimo_isae', nombre: 'Mínimo del ISAE' }, 'IVA', '2026-10-21', 'x')).toBe('«Mínimo del ISAE» es general: va sin impuesto.');
  });

  it('«Orden» se dice «Posición en la lista» también en los avisos', () => {
    expect(ENTEROS_IMPUESTO.orden.campo).toBe(ROTULO_ORDEN.toLowerCase().replace(/^p/, 'la p'));
    expect(faltaEnEnteros({ orden: NaN })).toBe(noSeEntiende('la posición en la lista'));
    expect(leerSupuestoNumeros('75', 'x')).toEqual({ error: noSeEntiende('la posición en la lista') });
  });
});
