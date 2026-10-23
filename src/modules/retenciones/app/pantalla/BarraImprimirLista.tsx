/* ============================================================
   MGG · Retenciones v8 · «🖨 Imprimir lista / PDF», CSV y Excel

   La barra de la maqueta (v7-3-registro-comprobante.js:427,
   v7BarraImprimirLista), en el Libro (v8-3-listas.js:270) y en Realizadas
   (v8-3-listas.js:229): sale lo que muestra la lista, con sus filtros.
   ============================================================ */

import { useState, type ReactNode } from 'react';
import { toast } from '@/shared/ui/Toast';
import { usePuerta, type RetencionPracticada } from '../datos/puerta';
import { descargarCsv, descargarExcel, rangoDeFilas, tablaLibro } from './exportarLibro';

export function BarraImprimirLista({ filas, children }: { filas: RetencionPracticada[]; children?: ReactNode }) {
  const puerta = usePuerta();
  const [imprimiendo, setImprimiendo] = useState(false);
  const rango = rangoDeFilas(filas);
  const nombre = rango ? `libro-retenciones-${rango.desde}-a-${rango.hasta}` : 'libro-retenciones';
  const imprimir = () => {
    if (!puerta.imprimirLibro || !rango) return;
    setImprimiendo(true);
    puerta.imprimirLibro(filas, rango)
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo generar el libro en PDF.', 'error'))
      .finally(() => setImprimiendo(false));
  };
  const excel = () => {
    descargarExcel(tablaLibro(filas), `Libro de retenciones · ${filas.length} retención(es)`, `${nombre}.xlsx`)
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo generar el Excel.', 'error'));
  };
  return (
    <div className="rv8-v7-lista-barra">
      <div className="rv8-v7-imprimir-lista">
        {puerta.imprimirLibro && (
          <button type="button" className="rv8-btn" disabled={!filas.length || imprimiendo} onClick={imprimir}>🖨 Imprimir lista / PDF</button>
        )}
        <button type="button" className="rv8-btn" disabled={!filas.length} onClick={() => descargarCsv(tablaLibro(filas), `${nombre}.csv`)}>CSV</button>
        <button type="button" className="rv8-btn" disabled={!filas.length} onClick={excel}>Excel</button>
        {children}
        <span className="rv8-huella">Sale lo que muestra la lista, con sus filtros. Cada retención se imprime como su comprobante, con «🖨 Comprobante».</span>
      </div>
    </div>
  );
}
