/* ============================================================
   MGG · Vista previa para las confirmaciones

   Un «¿Eliminar este registro?» a secas obliga a confiar en que uno tocó el
   botón de la fila correcta. Este recuadro va debajo del mensaje y MUESTRA lo
   que está en juego —la foto, los datos de la fila, lo que se borra con ella—
   así la decisión se toma mirando, no recordando.

   Uso:
     <VistaPrevia titulo="Se va a eliminar">
       <Dato label="Cédula">{p.cedula}</Dato>
       <Dato label="Cargo">{p.cargo}</Dato>
     </VistaPrevia>
   ============================================================ */
import type { ReactNode } from 'react';

export function VistaPrevia({
  titulo = 'Lo que se va a borrar', foto, children, pie,
}: {
  titulo?: string;
  /** Miniatura opcional a la izquierda (`<img className="confirm-preview-foto">`). */
  foto?: ReactNode;
  children: ReactNode;
  /** Renglón al pie, para lo que no es un par etiqueta/valor (un aviso, un total). */
  pie?: ReactNode;
}) {
  return (
    <div className="confirm-preview">
      <div className="confirm-preview-titulo">{titulo}</div>
      <div className="confirm-preview-cuerpo">
        {foto}
        <dl className="confirm-datos">{children}</dl>
      </div>
      {pie}
    </div>
  );
}

/**
 * Un par etiqueta/valor. Un valor vacío NO se dibuja: en una vista previa,
 * media docena de renglones en «—» tapan los tres que importan.
 */
export function Dato({ label, children }: { label: string; children?: ReactNode }) {
  if (children === null || children === undefined || children === '' || children === false) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}
