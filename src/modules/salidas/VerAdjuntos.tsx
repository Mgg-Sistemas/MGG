/* ============================================================
   MGG · Salidas · Adjuntos en el detalle (solo lectura)

   Los papeles de una solicitud, para mirarlos. Va en el detalle y en la
   pantalla de aprobación: quien autoriza necesita ver la foto del material
   antes de firmar, sin tener que entrar a editar la solicitud.

   El enlace se pide al tocar y no al abrir la pantalla: son enlaces firmados
   que caducan a los 10 minutos, así que pedir los cuatro de entrada gastaría
   cuatro viajes al servidor para enlaces que en su mayoría nadie va a usar.
   ============================================================ */
import { useState } from 'react';
import { iconoAdjunto, type AdjuntoSalida } from './adjuntosSalida';
import { urlAdjuntoSalida, urlDescargaAdjuntoSalida } from './adjuntosSalida.repository';

export function VerAdjuntos({ adjuntos, vacio }: {
  adjuntos: AdjuntoSalida[] | null | undefined;
  /** Qué decir cuando no hay ninguno. `null` esconde el bloque entero. */
  vacio?: string | null;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lista = adjuntos ?? [];

  if (!lista.length) {
    return vacio === null ? null : <span className="muted">{vacio ?? 'Sin adjuntos'}</span>;
  }

  async function abrir(a: AdjuntoSalida, descargar: boolean) {
    setOcupado(a.path + (descargar ? ':d' : ''));
    setError(null);
    try {
      const url = descargar ? await urlDescargaAdjuntoSalida(a) : await urlAdjuntoSalida(a.path);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el adjunto.');
    } finally { setOcupado(null); }
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
        {lista.map((a) => (
          <span key={a.path} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
            <button type="button" className="btn-link" style={{ padding: 0 }}
              disabled={ocupado === a.path} onClick={() => void abrir(a, false)} title="Ver">
              {iconoAdjunto(a)} {ocupado === a.path ? 'abriendo…' : a.filename}
            </button>
            <button type="button" className="btn-link" style={{ padding: 0 }}
              disabled={ocupado === `${a.path}:d`} onClick={() => void abrir(a, true)} title="Descargar">↓</button>
          </span>
        ))}
      </div>
      {error && <small style={{ color: 'var(--danger)' }}>{error}</small>}
    </div>
  );
}
