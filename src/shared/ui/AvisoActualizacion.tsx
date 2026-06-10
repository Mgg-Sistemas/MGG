import { useState } from 'react';
import { useVersionCheck } from '@/shared/lib/useVersionCheck';

/**
 * Banner global que aparece SOLO cuando se detecta un despliegue real
 * (cambio en la rama main ya publicado). Invita a guardar el progreso y
 * recargar para tomar la última versión. Mantiene los estilos del sistema.
 */
export function AvisoActualizacion() {
  const { hayActualizacion } = useVersionCheck();
  const [oculto, setOculto] = useState(false);
  if (!hayActualizacion || oculto) return null;

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <span className="update-banner__icon" aria-hidden="true">🔄</span>
      <div className="update-banner__text">
        <strong>El sistema se actualizó.</strong>{' '}
        Guardá tu progreso y recargá para usar la última versión.
      </div>
      <button className="btn btn-primary update-banner__btn" onClick={() => window.location.reload()}>
        Actualizar ahora
      </button>
      <button
        type="button"
        className="update-banner__close"
        title="Ocultar (recordá recargar luego)"
        aria-label="Ocultar aviso"
        onClick={() => setOculto(true)}
      >
        ✕
      </button>
    </div>
  );
}
