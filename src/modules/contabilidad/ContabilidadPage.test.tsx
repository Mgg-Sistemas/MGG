/* La página renderizada a HTML estático (sin navegador). Los efectos no corren en el
   render de servidor: se ve el armazón (menús y barra de estado), no los datos. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/auth/authStore', () => ({ useSession: () => ({ user: { email: 'prueba@ejemplo.test' } }) }));

import { ContabilidadPage } from './ContabilidadPage';

const html = renderToStaticMarkup(<ContabilidadPage />);

describe('página de Contabilidad', () => {
  it('los menús siguen la barra de Galac, en su orden, más Auxiliares y Otros e Integración (sin NIIF ni Conciliación por ahora)', () => {
    const menus = [...html.matchAll(/<button role="tab"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
    expect(menus).toEqual(['Compañía', 'Comprobante', 'Cuenta', 'Balances', 'Informes', 'Período', 'Cerrar Período', 'Auxiliares y Otros', 'Integración']);
  });

  it('la barra de estado de Galac muestra Compañía, Período y Usuario', () => {
    const t = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(t).toMatch(/Compañía: …/);
    expect(t).toMatch(/Período: …/);
    expect(t).toMatch(/Usuario: prueba@ejemplo\.test/);
  });

  it('avisa que es una maqueta sobre datos simulados', () => {
    expect(html).toContain('Datos simulados en este navegador');
  });
});
