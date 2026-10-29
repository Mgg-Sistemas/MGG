/* Las listas de la ventana «Auxiliares y Otros»: columnas, filas en texto, Buscar y páginas. */
import { describe, expect, it } from 'vitest';
import { estadoDePrueba } from '../pruebas/datosPrueba';
import { FILAS_POR_PAGINA, TABLAS_CATALOGO, columnasDe, filasDe, filtrarFilas, paginar, type DatosCatalogos } from './listasCatalogos';
import type { ContCambio } from '../tipos';

const cambio = (x: Partial<ContCambio>): ContCambio => ({
  id: 'c1', fecha: '2026-07-01', moneda: 'USD', tasa_ves: 36.5, fuente: 'manual', activo: true,
  created_at: '', created_by: null, updated_at: null, updated_by: null, ...x,
});

async function datos(): Promise<DatosCatalogos> {
  const e = await estadoDePrueba();
  return {
    auxiliares: e.cont_auxiliares, cambios: [cambio({}), cambio({ id: 'c2', fecha: '2026-07-02', tasa_ves: 36.6125, activo: false })],
    centros: e.cont_centros_costo, monedas: e.cont_monedas, monedasLocales: e.cont_monedas_locales, paises: e.cont_paises,
    tipos: e.cont_tipos_comprobante,
  };
}

describe('ventana de tablas de Galac', () => {
  it('el panel trae las 7 tablas en el orden de Galac', () => {
    expect(TABLAS_CATALOGO.map((t) => t.titulo)).toEqual(['Auxiliar', 'Cambio', 'Centro De Costos', 'Moneda', 'Moneda Local', 'País', 'Tipo de Comprobante']);
  });

  it('cada fila tiene tantas celdas como columnas su tabla', async () => {
    const d = await datos();
    for (const { clave } of TABLAS_CATALOGO) {
      for (const f of filasDe(clave, d)) expect(f.celdas).toHaveLength(columnasDe(clave).length);
    }
  });

  it('Cambio: la más reciente primero, la tasa con hasta 4 decimales y la fecha dd/mm/aaaa', async () => {
    const filas = filasDe('cambio', await datos());
    expect(filas.map((f) => f.celdas)).toEqual([
      ['USD', '02/07/2026', '36,6125', 'Inactivo'],
      ['USD', '01/07/2026', '36,50', 'Activo'],
    ]);
  });

  it('los tipos del sistema se marcan; los del usuario no', async () => {
    const filas = filasDe('tipo', await datos());
    expect(filas.find((f) => f.celdas[0] === '93')?.sistema).toBe(true);
    expect(filas.find((f) => f.celdas[0] === '10')?.sistema).toBe(false);
  });

  it('Buscar ignora acentos y mayúsculas; los inactivos solo si se piden', async () => {
    const filas = filasDe('cambio', await datos());
    expect(filtrarFilas(filas, '', false)).toHaveLength(1);
    expect(filtrarFilas(filas, '', true)).toHaveLength(2);
    expect(filtrarFilas(filas, 'inactivo', true).map((f) => f.id)).toEqual(['c2']);
    const tipos = filasDe('tipo', await datos());
    const conAcento = tipos.find((f) => /[áéíóú]/i.test(f.celdas[1]));
    if (conAcento) {
      const sin = conAcento.celdas[1].normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
      expect(filtrarFilas(tipos, sin, true).map((f) => f.id)).toContain(conAcento.id);
    }
  });

  it('páginas de 20, sin pasarse del final', () => {
    const lista = Array.from({ length: FILAS_POR_PAGINA * 2 + 3 }, (_, i) => i);
    expect(paginar(lista, 0)).toMatchObject({ paginas: 3, pagina: 0 });
    expect(paginar(lista, 9)).toMatchObject({ pagina: 2, filas: [40, 41, 42] });
    expect(paginar([], 0)).toMatchObject({ paginas: 1, pagina: 0, filas: [] });
  });
});
