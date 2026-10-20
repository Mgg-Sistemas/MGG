/* ============================================================
   MGG · Retenciones · Impresión · Ver e imprimir una hoja

   «Imprimir desde la página» (decisión del usuario, 16/10): la hoja fiel al
   ejemplar se ve en la vista previa, con la marca «Vista previa · sin
   validez para entrega», y «Imprimir» saca solo la hoja, sin la marca, sin
   encabezado ni pie del navegador (@page sin margen) y en la orientación
   elegida (horizontal por defecto, R3-2).
   La copia que se imprime vive fuera de pantalla en #retenciones-imprimir
   (hojas.css): al imprimir, todo lo demás se oculta con display: none, nunca
   con visibility (si no, salen hojas en blanco).
   VistaImpresion sirve a los comprobantes y a las relaciones.
   ============================================================ */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '@/shared/ui/Modal';
import { FORMATO_COMPROBANTE, FORMATO_FABRICA } from './formatos';
import { PaginaComprobante } from './HojasComprobante';
import type { DatosComprobante, Orientacion } from './tipos';
import { escalaPara, useAncho } from './useAncho';
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

/**
 * La vista previa y la impresión de una hoja. `hoja(orientación)` dibuja la
 * hoja; `marco` dice si la vista previa va en el marco de una hoja carta
 * (comprobante) o se desplaza a lo largo. `previa`, si se da, reemplaza a la
 * hoja en la pantalla (la relación, cortada en páginas).
 */
export function VistaImpresion({ titulo, hoja, marco, previa, ejemplo, onCerrar }: {
  titulo: string; hoja: (o: Orientacion) => ReactNode; marco: boolean; previa?: (o: Orientacion) => ReactNode;
  /** Datos inventados: la marca «EJEMPLO» en pantalla y también en cada hoja impresa. */
  ejemplo?: boolean; onCerrar: () => void;
}) {
  const [orientacion, setOrientacion] = useState<Orientacion>('horizontal');
  const caja = useRef<HTMLDivElement>(null);
  const escala = escalaPara(useAncho(caja, 1056), orientacion === 'vertical' ? 816 : 1056);
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
      <div className="rv8-vc-marco" ref={caja}>
        {previa ? previa(orientacion) : marco ? (
          // La hoja carta, reducida al ancho disponible (en el teléfono, entera a la vista)
          <div className="rv8-vc-escalada" style={{ width: (orientacion === 'vertical' ? 816 : 1056) * escala, height: (orientacion === 'vertical' ? 1055 : 815) * escala }}>
            <div className={`hv8-marco rv8-vc-${orientacion}`} style={{ transform: `scale(${escala})`, transformOrigin: 'top left' }}>
              <div className="marca-agua v8" aria-hidden="true"><span>{ejemplo ? 'EJEMPLO' : 'Vista previa · sin validez para entrega'}</span></div>
              {hoja(orientacion)}
            </div>
          </div>
        ) : (
          <div className={`rv8-vc-larga rv8-vc-larga-${orientacion}`}>
            <div className="marca-agua v8" aria-hidden="true"><span>{ejemplo ? 'EJEMPLO' : 'Vista previa · sin validez para entrega'}</span></div>
            {hoja(orientacion)}
          </div>
        )}
      </div>
      {ejemplo && <p className="rv8-vc-ejemplo" role="note">EJEMPLO · solo en local · datos inventados</p>}
      {createPortal(
        <div id="retenciones-imprimir" aria-hidden="true">
          {ejemplo && <div className="rv8-marca-ejemplo"><span>EJEMPLO</span></div>}
          <div className="ri-hoja">{hoja(orientacion)}</div>
        </div>,
        document.body,
      )}
    </Modal>
  );
}

export function VistaComprobante({ datos, titulo, onCerrar }: { datos: DatosComprobante; titulo: string; onCerrar: () => void }) {
  const formato = FORMATO_FABRICA[FORMATO_COMPROBANTE[datos.impuesto]];
  return <VistaImpresion titulo={titulo} marco onCerrar={onCerrar} hoja={(o) => <PaginaComprobante datos={datos} formato={formato} orientacion={o} />} />;
}
