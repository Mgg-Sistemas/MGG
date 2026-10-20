/* ============================================================
   MGG · Retenciones v8 · La marca «2.1» de lo que necesita la base nueva

   Componente común (Master, 20/10 13:41): una pastilla chica «2.1», al lado
   del control (no dentro del botón), con el texto completo en el title. Solo
   se pinta en local (import.meta.env.DEV): en producción lo que necesita la
   base de Retenciones (paquete 2.1) no se muestra.
   ============================================================ */

import './rv8-marca21.css';

export const TEXTO_PAQUETE21 = 'Requiere la base de Retenciones (paquete 2.1)';

export function MarcaPaquete21({ texto = TEXTO_PAQUETE21 }: { texto?: string }) {
  if (!import.meta.env.DEV) return null;
  return <span className="rv8-marca21" title={texto} aria-label={texto}>2.1</span>;
}
