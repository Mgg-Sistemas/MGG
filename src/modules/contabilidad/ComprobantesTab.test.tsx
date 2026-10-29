/* Pruebas de componente sin navegador: se renderiza a HTML estático (react-dom/server).
   Modal usa un portal, que el render de servidor no admite: se reemplaza por uno en línea. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/ui/Modal', () => ({
  Modal: ({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) => (
    <section data-modal={title}><h2>{title}</h2>{children}<footer>{footer}</footer></section>
  ),
}));
vi.mock('@/modules/auth/authStore', () => ({ useSession: () => ({ user: { email: 'prueba@ejemplo.test' } }) }));

import { CabeceraVista, EditarComprobante, PieTotales, ReversarDialogo, type Catalogos } from './ComprobantesTab';
import { crearRepositorio } from './contabilidad.repository';
import { totalesDe } from './logica/comprobantes';
import { AlmacenSimulado } from './simulacion/almacen';
import { estadoDePrueba } from './pruebas/datosPrueba';

const e = estadoDePrueba();
const cat: Catalogos = {
  cuentas: e.cont_cuentas, centros: e.cont_centros_costo, auxiliares: e.cont_auxiliares,
  tipos: e.cont_tipos_comprobante, periodos: e.cont_periodos,
};
const nada = () => {};
const sinGrabar = async () => {};
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('ventana Comprobante (Galac §3.1)', () => {
  it('Insertar: rejilla con las columnas de Galac en su orden y número asignado al grabar', () => {
    const html = renderToStaticMarkup(<EditarComprobante modo="insertar" base={null} cat={cat} parametros={e.cont_parametros} onCerrar={nada} onGrabar={sinGrabar} />);
    const cols = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]).filter(Boolean);
    expect(cols).toEqual(['Código Cuenta', 'Fecha Ref.', 'Referencia', 'Auxiliar', 'C.C.', 'Descripción', 'Moneda', 'Debe', 'Haber']);
    expect(html).toContain('Comprobante - Insertar');
    expect(html).toContain('Se asigna al grabar');
    // Sin montos todavía: Galac lo muestra Descuadrado.
    expect(texto(html)).toMatch(/Status Descuadrado/);
  });

  it('Modificar: trae los asientos guardados, su número y el status del cuadre', async () => {
    const repo = crearRepositorio(new AlmacenSimulado(null, async () => estadoDePrueba()));
    const base = await repo.getComprobante('cbte-002'); // compra de repuestos, 02-000001
    const html = renderToStaticMarkup(<EditarComprobante modo="modificar" base={base} cat={cat} parametros={e.cont_parametros} onCerrar={nada} onGrabar={sinGrabar} />);
    expect(html).toContain('Comprobante - Modificar 02-000001');
    expect(html).toContain('value="02-000001"');
    expect((html.match(/<tr class="(activa)?"/g) ?? []).length).toBe(3);
    expect(html).toContain('value="FACT-0101"');
    expect(texto(html)).toMatch(/Diferencia Bs 0,00 \$ 0,00/);
    expect(texto(html)).toMatch(/Status Contabilizado/);
  });

  it('Insertar Copia: mismas líneas, número nuevo y sin N° Doc. Origen', async () => {
    const repo = crearRepositorio(new AlmacenSimulado(null, async () => estadoDePrueba()));
    const base = await repo.getComprobante('cbte-002');
    const html = renderToStaticMarkup(<EditarComprobante modo="copia" base={base} cat={cat} parametros={e.cont_parametros} onCerrar={nada} onGrabar={sinGrabar} />);
    expect(html).toContain('Comprobante - Insertar Copia de 02-000001');
    expect(html).toContain('Se asigna al grabar');
    expect(html).not.toContain('value="OC-EJEMPLO-0001"');
  });

  it('un descuadrado avisa que no afecta saldos; sin permiso, que no se graba', async () => {
    const repo = crearRepositorio(new AlmacenSimulado(null, async () => estadoDePrueba()));
    const base = await repo.getComprobante('cbte-010'); // provisión descuadrada a propósito
    const con = renderToStaticMarkup(<EditarComprobante modo="modificar" base={base} cat={cat} parametros={e.cont_parametros} onCerrar={nada} onGrabar={sinGrabar} />);
    expect(con).toContain('queda Descuadrado: no afecta saldos');
    const sin = renderToStaticMarkup(<EditarComprobante modo="modificar" base={base} cat={cat} parametros={{ ...e.cont_parametros, permite_descuadrados: false }} onCerrar={nada} onGrabar={sinGrabar} />);
    expect(sin).toContain('no permite grabar comprobantes descuadrados');
  });
});

describe('consulta y reverso', () => {
  it('la cabecera muestra Número, Status, Generado Por y el recuadro de moneda', () => {
    const comp = e.cont_comprobantes.find((c) => c.origen === 'reverso')!;
    const t = texto(renderToStaticMarkup(<CabeceraVista comp={comp} cat={cat} />));
    expect(t).toMatch(/Número 07-000002/);
    expect(t).toMatch(/Status Contabilizado/);
    expect(t).toMatch(/Generado Por Reverso/);
    expect(t).toMatch(/Bolívar \(Bs\) Dólar \(\$\)/);
  });

  it('el pie: una cifra por casilla en la moneda elegida y la equivalente debajo, tenue', () => {
    const t = totalesDe([{ debe_ves: 100, haber_ves: 0, debe_usd: 1, haber_usd: 0 }]);
    const enBs = renderToStaticMarkup(<PieTotales t={t} estado="descuadrado" moneda="VES" />);
    expect(texto(enBs)).toMatch(/Sub Total Debe Bs 100,00 \$ 1,00 Sub Total Haber Bs 0,00 \$ 0,00 Diferencia Bs 100,00 \$ 1,00/);
    expect(enBs).toContain('<span class="cont-equiv mono">$ 1,00</span>');
    const enUsd = texto(renderToStaticMarkup(<PieTotales t={t} estado="descuadrado" moneda="USD" />));
    expect(enUsd).toMatch(/Sub Total Debe \$ 1,00 Bs 100,00/);
  });

  it('Reversar pide el motivo y explica que el original no se borra', () => {
    const comp = e.cont_comprobantes[1];
    const t = texto(renderToStaticMarkup(<ReversarDialogo comp={comp} onCerrar={nada} onReversar={sinGrabar} />));
    expect(t).toMatch(/Motivo \(obligatorio\)/);
    expect(t).toMatch(/El original no se borra ni se modifica/);
  });
});

describe('reglas de la maqueta sobre el código', () => {
  const dir = __dirname;
  const archivos = (d: string): string[] => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? archivos(p) : [p];
  });
  const pantallas = archivos(dir).filter((p) => p.endsWith('.tsx') && !p.endsWith('.test.tsx'));

  it('hay pantallas que revisar (la reja puede fallar)', () => {
    expect(pantallas.length).toBeGreaterThanOrEqual(3);
  });

  it('una sola costura: ninguna pantalla importa simulacion/ ni supabase', () => {
    for (const p of pantallas) {
      const fuente = readFileSync(p, 'utf8');
      expect(fuente, p).not.toMatch(/from '\.\/simulacion|from '\.\.\/simulacion|shared\/lib\/supabase/);
    }
    const repo = readFileSync(join(dir, 'contabilidad.repository.ts'), 'utf8');
    expect(repo).toMatch(/from '\.\/simulacion\/almacen'/);
  });

  it('no hay Eliminar comprobante: solo Reversar (usuario, 20/10 12:15)', () => {
    const fuente = readFileSync(join(dir, 'ComprobantesTab.tsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(fuente).not.toMatch(/Eliminar|eliminarComprobante/);
    expect(fuente).toMatch(/Reversar/);
  });
});
