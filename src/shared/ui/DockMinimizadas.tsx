import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  MAX_MINIMIZADAS, descartarDesdeBarra, restaurarDesdeBarra, restauraConVentanaAbierta,
  useMinimizadas, useVentanasVisibles,
} from '@/shared/lib/minimizadas';

/**
 * Barra inferior con las pestañas minimizadas del módulo (máx. MAX_MINIMIZADAS). Va una sola vez
 * en AppShell: sirve a toda ventana de cualquier módulo, y el aviso de salida usa la misma lista.
 */
export function DockMinimizadas() {
  const { items, salida } = useMinimizadas();
  const abiertas = useVentanasVisibles();
  // Con el aviso de salida abierto la barra se esconde: no se restaura nada a mitad de la pregunta.
  const hay = items.length > 0 && salida === null;

  // Deja libre el pie de las ventanas mientras la barra está a la vista (ver theme.css).
  useEffect(() => {
    if (!hay) return;
    document.body.classList.add('dock-activo');
    return () => document.body.classList.remove('dock-activo');
  }, [hay]);

  if (!hay) return null;
  return createPortal(
    <div className="dock-min" role="toolbar" aria-label="Pestañas minimizadas">
      <span className="dock-min-cuenta" title={`Hasta ${MAX_MINIMIZADAS} pestañas minimizadas`}>
        — {items.length}/{MAX_MINIMIZADAS}
      </span>
      {items.map((it) => {
        // Con otra ventana a la vista, restaurar esta quedaría debajo: se pide cerrar o minimizar la abierta.
        const bloqueado = abiertas > 0 && !restauraConVentanaAbierta(it.id);
        return (
          <span key={it.id} className="dock-min-pill">
            <button
              type="button"
              className="dock-min-abrir"
              disabled={bloqueado}
              onClick={() => restaurarDesdeBarra(it.id)}
              title={bloqueado ? 'Cierra o minimiza la ventana abierta para restaurar esta pestaña' : `Restaurar ${it.titulo}`}
            >
              {it.titulo}
            </button>
            <button
              type="button"
              className="dock-min-cerrar"
              onClick={() => descartarDesdeBarra(it.id)}
              title="Descartar esta pestaña minimizada"
              aria-label={`Descartar ${it.titulo}`}
            >
              ✕
            </button>
          </span>
        );
      })}
    </div>,
    document.body,
  );
}
