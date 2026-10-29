/* Pruebas de componente sin navegador (render de servidor): el armazón del menú Integración.
   Contabilizar y su oráculo los prueba simulacion/integracionBd.test.ts. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/auth/authStore', () => ({ useSession: () => ({ user: { email: 'prueba@ejemplo.test' } }) }));

import type { DocumentoIntegracion } from './contabilidad.repository';
import { EtiquetaIntegracion, IntegracionTab } from './IntegracionTab';

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const fila = (estado: DocumentoIntegracion['integracion']['estado'], extra: Partial<DocumentoIntegracion> = {}): DocumentoIntegracion => ({
  integracion: {
    id: 'int-P-1', origen_modulo: 'tesoreria', origen_tabla: 'hechos_simulados', origen_id: 'P-1', evento: 'gasto_caja', fecha: '2026-10-02',
    estado, comprobante_id: null, error: estado === 'error' ? 'Falta el mapeo caja «X».' : null,
    created_at: '2026-10-02T18:00:00-04:00', created_by: 'simulacion', updated_at: null, updated_by: null,
  },
  documento: null, regla: null, comprobante: null, debe: null, ...extra,
});

describe('menú Integración', () => {
  it('trae Por contabilizar, Reglas de Contabilización y Mapeos', () => {
    expect(texto(renderToStaticMarkup(<IntegracionTab />))).toMatch(/Por contabilizar Reglas de Contabilización Mapeos/);
  });

  it('el status de cada documento: Pendiente, Error (con el motivo) y Contabilizado con su número', () => {
    expect(texto(renderToStaticMarkup(<EtiquetaIntegracion fila={fila('pendiente')} />))).toContain('Pendiente');
    const err = renderToStaticMarkup(<EtiquetaIntegracion fila={fila('error')} />);
    expect(err).toContain('Error');
    expect(err).toContain('title="Falta el mapeo caja «X».');
    expect(texto(renderToStaticMarkup(<EtiquetaIntegracion fila={fila('contabilizado', { comprobante: { id: 'c', codigo: '10-000002' } })} />)))
      .toContain('Contabilizado · 10-000002');
  });
});
