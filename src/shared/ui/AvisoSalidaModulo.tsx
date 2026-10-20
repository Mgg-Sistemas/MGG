import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { cancelarSalida, confirmarSalida, useMinimizadas } from '@/shared/lib/minimizadas';

/**
 * Aviso al salir de un módulo con pestañas minimizadas (20-10-2026). Quien navega llama antes a
 * intentarSalir(destino); si hay pestañas, deja el destino pendiente y este aviso pregunta.
 */
export function AvisoSalidaModulo() {
  const { salida, modulo, items } = useMinimizadas();
  const navigate = useNavigate();
  if (salida === null) return null;
  return (
    <ConfirmDialog
      title="Salir del módulo"
      danger
      confirmText="Salir y perderlas"
      message={
        <>
          <p style={{ margin: 0, fontWeight: 700 }}>¿Seguro que quieres salirte del módulo de {modulo}?</p>
          <p style={{ margin: '.5rem 0 .25rem' }}>Perderás las pestañas minimizadas:</p>
          <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
            {items.map((it) => <li key={it.id}>{it.titulo}</li>)}
          </ul>
        </>
      }
      onConfirm={() => { const destino = confirmarSalida(); if (destino) navigate(destino); }}
      onCancel={cancelarSalida}
    />
  );
}
