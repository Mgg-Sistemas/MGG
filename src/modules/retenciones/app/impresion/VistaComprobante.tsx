/* ============================================================
   MGG · Retenciones · Impresión · Ver e imprimir un comprobante

   «Imprimir desde la página» (decisión del usuario, 16/10): la hoja fiel al
   ejemplar se ve en la vista previa, con la marca «Vista previa · sin
   validez para entrega», y «Imprimir» saca solo la hoja, sin la marca, sin
   encabezado ni pie del navegador (@page sin margen) y en la orientación
   elegida (horizontal por defecto, R3-2).
   La copia que se imprime vive fuera de pantalla en #retenciones-imprimir
   (hojas.css): al imprimir, todo lo demás se oculta con display: none, nunca
   con visibility (si no, salen hojas en blanco).
   ============================================================ */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '@/shared/ui/Modal';
import { FORMATO_COMPROBANTE, FORMATO_FABRICA } from './formatos';
import { PaginaComprobante } from './HojasComprobante';
import type { DatosComprobante, Orientacion } from './tipos';
import './hojas.css';
import './rv8-vista-comprobante.css';

const CLASE = 'imprimiendo-retencion';

/** Imprime lo que haya en #retenciones-imprimir, en la orientación dada, y deja la página como estaba. */
export function imprimirHojas(orientacion: Orientacion): void {
  const html = document.documentElement, body = document.body;
  const pagina = document.createElement('style');
  pagina.textContent = `@page { size: letter ${orientacion === 'vertical' ? 'portrait' : 'landscape'}; margin: 0; }`;
  document.head.appendChild(pagina);
  html.classList.add(CLASE); body.classList.add(CLASE);
  const limpiar = () => { html.classList.remove(CLASE); body.classList.remove(CLASE); pagina.remove(); window.removeEventListener('afterprint', limpiar); };
  window.addEventListener('afterprint', limpiar);
  window.print();
}

export function VistaComprobante({ datos, titulo, onCerrar }: { datos: DatosComprobante; titulo: string; onCerrar: () => void }) {
  const [orientacion, setOrientacion] = useState<Orientacion>('horizontal');
  const formato = FORMATO_FABRICA[FORMATO_COMPROBANTE[datos.impuesto]];
  // Si se cierra a mitad de una impresión, la página no queda marcada
  useEffect(() => () => { document.documentElement.classList.remove(CLASE); document.body.classList.remove(CLASE); }, []);

  const footer = (
    <>
      <span className="rv8-vc-orientacion" role="group" aria-label="Orientación">
        <span>Orientación:</span>
        {(['horizontal', 'vertical'] as const).map((o) => (
          <button key={o} type="button" className="btn btn-ghost" aria-pressed={orientacion === o} onClick={() => setOrientacion(o)}>
            {o === 'horizontal' ? 'Horizontal' : 'Vertical'}
          </button>
        ))}
      </span>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cerrar</button>
      <button type="button" className="btn btn-primary" onClick={() => imprimirHojas(orientacion)}>🖨 Imprimir</button>
    </>
  );

  return (
    <Modal title={titulo} size="xl" onClose={onCerrar} footer={footer}>
      <div className="rv8-vc-marco">
        <div className={`hv8-marco rv8-vc-${orientacion}`}>
          <div className="marca-agua v8" aria-hidden="true"><span>Vista previa · sin validez para entrega</span></div>
          <PaginaComprobante datos={datos} formato={formato} orientacion={orientacion} />
        </div>
      </div>
      {createPortal(
        <div id="retenciones-imprimir" aria-hidden="true">
          <div className="ri-hoja"><PaginaComprobante datos={datos} formato={formato} orientacion={orientacion} /></div>
        </div>,
        document.body,
      )}
    </Modal>
  );
}
