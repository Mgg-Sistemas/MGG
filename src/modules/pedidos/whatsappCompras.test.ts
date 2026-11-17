import { describe, expect, test } from 'vitest';
import { resumenCompras, type FilaReporteCompras } from './comprasMoldeable';
import { textoWhatsappCompras } from './whatsappCompras';

function filaOrd(over: Partial<FilaReporteCompras> = {}): FilaReporteCompras {
  return {
    id: 'f', ambito: 'ordenes', tipo_compra: 'orden', fecha: '2026-11-05', codigo: 'OC',
    departamento: 'Mina', proveedor: '—', estado: 'pagada', estado_rotulo: 'Pagada',
    clase_estado: 'finalizada', categoria: '', categoria_gasto: null, nombre_item: '',
    cantidad: null, moneda_original: 'USD', monto_original: 0, monto_usd: 0, monto_bs: 0,
    pagado_usd: 0, pagado_bs: 0, ...over,
  };
}
function filaItem(over: Partial<FilaReporteCompras> = {}): FilaReporteCompras {
  return filaOrd({ ambito: 'items', categoria: 'Ferretería', nombre_item: 'Ítem', cantidad: 1, ...over });
}

describe('whatsappCompras', () => {
  test('incluye totales, titular de depto e ítem top', () => {
    const r = resumenCompras(
      [filaOrd({ departamento: 'Mina', monto_usd: 100, monto_bs: 4000, clase_estado: 'finalizada' })],
      [filaItem({ categoria: 'Ferretería', nombre_item: 'Tornillo', monto_usd: 20, cantidad: 10 })],
      [],
      40,
    );
    const txt = textoWhatsappCompras(r, { desde: '2026-11-01', hasta: '2026-11-10', tasaBcv: 40 });
    expect(txt).toContain('Reporte de Compras');
    expect(txt).toContain('Mina');
    expect(txt).toContain('$ 100');
    expect(txt).toContain('Tornillo');
  });

  test('sin datos no rompe', () => {
    const r = resumenCompras([], [], [], 0);
    const txt = textoWhatsappCompras(r, { desde: '2026-11-01', hasta: '2026-11-10' });
    expect(txt).toContain('Reporte de Compras');
  });
});
