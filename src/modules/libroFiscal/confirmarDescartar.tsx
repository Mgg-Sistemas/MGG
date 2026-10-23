/* ============================================================
   Golden Touch · Libro fiscal · Proteger lo no guardado (R3-8)

   El Modal de GT no se cierra con Escape ni con clic fuera. Falta avisar
   cuando se cierra un formulario CON cambios sin guardar: este hook marca el
   formulario como «sucio» en el primer cambio y, al pedir cerrar, pregunta si
   se descartan. Al guardar con éxito no se pregunta: ahí se cierra directo.
   ============================================================ */
import { useState, type ReactNode } from 'react';
import { Modal } from '@/shared/ui/Modal';

export function useDescartar(onClose: () => void, bloqueado = false): {
  marcarSucio: () => void;
  pedirCierre: () => void;
  dialogo: ReactNode;
} {
  const [sucio, setSucio] = useState(false);
  const [preguntando, setPreguntando] = useState(false);

  const pedirCierre = () => {
    if (bloqueado) return;
    if (sucio) setPreguntando(true);
    else onClose();
  };

  const dialogo = preguntando ? (
    <Modal title="Cambios sin guardar" compact onClose={() => setPreguntando(false)}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={() => setPreguntando(false)}>Seguir editando</button>
          <button type="button" className="btn btn-danger" onClick={() => { setPreguntando(false); onClose(); }}>Descartar</button>
        </>
      )}>
      <p style={{ margin: 0 }}>Hay cambios sin guardar. ¿Descartarlos?</p>
    </Modal>
  ) : null;

  return { marcarSucio: () => setSucio(true), pedirCierre, dialogo };
}
