import { describe, expect, it } from 'vitest';
import type { Personal } from '@/shared/lib/types';
import { EMPRESA_POR_DEFECTO } from './empresa';
import { formDePersona } from './PersonalTab';

describe('cuenta bancaria nómina en el formulario de personal', () => {
  const persona: Personal = {
    id: 'p1',
    nombre: 'PRUEBA',
    apellido: 'PRUEBA',
    sueldo_base: 100,
    activo: true,
    created_at: '2026-01-01T00:00:00Z',
  };

  it('no copia la cuenta de transferencia de datos bancarios', () => {
    const conTransferencia: Personal = {
      ...persona,
      datos_pago: {
        cuentas: [{
          id: 'c1',
          tipo: 'transferencia',
          banco: '0163',
          cuenta: '0163-0204-3138-0100054967',
          principal: true,
        }],
      },
    };
    expect(formDePersona(conTransferencia, EMPRESA_POR_DEFECTO).ficha_bancaria?.cuenta_nomina).toBe('');
  });

  it('vacía una cuenta guardada que es copia de la transferencia', () => {
    const copiada: Personal = {
      ...persona,
      datos_pago: {
        cuentas: [{ id: 'c1', tipo: 'transferencia', cuenta: '0163-0204-3138-0100054967' }],
        ficha_bancaria: { cuenta_nomina: '0163020431380100054967' },
      },
    };
    expect(formDePersona(copiada, EMPRESA_POR_DEFECTO).ficha_bancaria?.cuenta_nomina).toBe('');
  });

  it('respeta una cuenta nómina escrita expresamente en la ficha', () => {
    const conNomina: Personal = {
      ...persona,
      datos_pago: { ficha_bancaria: { cuenta_nomina: '01630405123456789012' } },
    };
    expect(formDePersona(conNomina, EMPRESA_POR_DEFECTO).ficha_bancaria?.cuenta_nomina).toBe(
      '01630405123456789012',
    );
  });
});
