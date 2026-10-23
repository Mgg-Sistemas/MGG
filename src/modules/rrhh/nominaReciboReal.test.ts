/* Genera de verdad los recibos con jsPDF (sin visor) y lee su contenido: con la tasa del Real el
   recibo de la bonificación lleva las columnas en R$; sin ella sale como siempre (23-10-2026). */
import { describe, it, expect, vi } from 'vitest';

const capturado: { doc: { output: (t: string) => ArrayBuffer; getNumberOfPages: () => number } | null } = { doc: null };
vi.mock('@/shared/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/shared/lib/pdfLogo', () => ({ loadLogoDataUrl: () => Promise.resolve(null) }));
vi.mock('@/shared/lib/reportPreview', () => ({
  previewPdfDoc: (doc: typeof capturado.doc) => { capturado.doc = doc; },
}));

import { descargarNominaReciboPdf } from './nominaReciboPdf';
import type { NominaRenglon } from '@/shared/lib/types';

const renglon = {
  id: 'r1', periodo_id: 'p1', personal_id: 'pe1', empresa: 'MGG', nombre: 'ANA PEREZ', cargo: 'Operadora', departamento: 'Planta',
  sueldo_base_mensual: 500, dias_trabajados: 11, dias_descanso: 4, salario_bruto: 250, asignaciones: 20, viaticos: 15,
  deduc_prestamos: 30, deduc_anticipos: 10, estado: 'por_pagar',
} as unknown as NominaRenglon;

async function generar(extra: Record<string, unknown>) {
  capturado.doc = null;
  await descargarNominaReciboPdf([renglon], {
    periodo: { codigo: 'NOM-1', tipo: 'quincena', periodo_desde: '2026-10-01', periodo_hasta: '2026-10-15', tasa_bcv: 189.55, ...extra },
    cedulas: { pe1: 'V-12345678' },
  });
  const doc = capturado.doc!;
  // Los textos del PDF van sin comprimir en el contenido de cada hoja: se leen como latin1.
  return { paginas: doc.getNumberOfPages(), texto: Buffer.from(doc.output('arraybuffer')).toString('latin1') };
}

describe('recibos generados · moneda de pago de la empresa', () => {
  it('con la tasa del Real el recibo de la bonificación lleva columnas, neto y tasa en R$', async () => {
    const { paginas, texto } = await generar({ tasa_brl: 5.0428, tasa_brl_fecha: '2026-10-23' });
    expect(paginas).toBe(2); // 1/2 bolívares + 2/2 bonificación, una hoja cada uno
    expect(texto).toContain('DEVENGADO R$');
    expect(texto).toContain('DESCUENTO R$');
    expect(texto).toContain('R$ 1.008,56'); // bono 200 $ x 5,0428
    expect(texto).toContain('R$ 806,85'); // neto 160 $ x 5,0428 menos descuentos redondeados
    expect(texto).toContain('1 $ = R$ 5,0428');
    expect(texto).toContain('Real brasile');
  });

  it('sin tasa del Real (empresa en dólares) no aparece nada del Real', async () => {
    const { paginas, texto } = await generar({});
    expect(paginas).toBe(2);
    expect(texto).not.toContain('R$');
    expect(texto).not.toContain('Real brasile');
    expect(texto).toContain('DEVENGADO $');
  });
});
