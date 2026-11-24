/* La página renderizada a HTML estático (sin navegador). Los efectos no corren en el
   render de servidor: se ve el armazón (menús y barra de estado), no los datos. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/auth/authStore', () => ({ useSession: () => ({ user: { email: 'prueba@ejemplo.test' } }) }));

import { ContabilidadPage } from './ContabilidadPage';

const html = renderToStaticMarkup(<ContabilidadPage />);

describe('página de Contabilidad', () => {
  it('los menús presentan la cinta contable en terminología clara y profesional', () => {
    const menus = [...html.matchAll(/<button role="tab"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
    expect(menus).toEqual([
      'Comprobantes',
      '📊 Reporte Dinámico',
      'Por Contabilizar',
      'Plan de Cuentas',
      'Estados Financieros',
      'Libros Contables',
      'Períodos Mensuales',
      'Cierre de Ejercicio',
      'Terceros y Centros',
      'Parámetros Empresa',
    ]);
  });

  it('la barra de estado muestra Compañía, Período y Usuario', () => {
    const t = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(t).toMatch(/Compañía: …/);
    expect(t).toMatch(/Período: …/);
    expect(t).toMatch(/Usuario: prueba@ejemplo\.test/);
  });

  it('no muestra avisos técnicos de maqueta ni insignias confusas para el usuario', () => {
    expect(html).not.toContain('Datos simulados en este navegador');
    expect(html).not.toContain('Base de datos en vivo');
  });
});
