/* MGG · Aviso de hora del equipo mal puesta (05-11-2026). Ver shared/lib/relojEquipo.ts. */
import { useEffect, useState } from 'react';
import { DESFASE_AVISO_MS, medirDesfaseReloj, textoDesfase } from '@/shared/lib/relojEquipo';

export function AvisoReloj({ style }: { style?: React.CSSProperties }) {
  const [desfase, setDesfase] = useState<number | null>(null);
  useEffect(() => {
    let vivo = true;
    void medirDesfaseReloj().then((d) => { if (vivo) setDesfase(d); });
    return () => { vivo = false; };
  }, []);
  if (desfase == null || Math.abs(desfase) < DESFASE_AVISO_MS) return null;
  return (
    <div className="aviso warning" role="alert" style={{ marginBottom: '1rem', ...style }}>
      <span className="aviso-icono">⏰</span>
      <div>
        <strong>La hora de este equipo está {textoDesfase(desfase)}.</strong> Con la hora mal el sistema no puede mantener la sesión abierta
        y te devuelve a la pantalla de entrada. Corrígela en Windows: <em>Configuración → Hora e idioma → «Establecer la hora automáticamente»</em> y
        «Sincronizar ahora»; después recarga la página.
      </div>
    </div>
  );
}
