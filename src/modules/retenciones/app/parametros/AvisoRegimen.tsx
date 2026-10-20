/* ============================================================
   MGG · Retenciones v8 · El aviso de régimen

   El de la maqueta (v8-2-ajustes.js, v8AvisoRegimen): mientras la empresa no
   diga desde cuándo es agente de retención, la retención de IVA se propone
   sin comprobar esa fecha. «Configurar el régimen» abre ⚙ Parámetros en el
   régimen.
   La fecha «desde» del régimen necesita la base de Retenciones (paquete 2.1):
   hoy el régimen solo guarda «contribuyente especial: sí o no». Por eso el
   aviso se ve solo en local, con su marca; en producción no aparece.
   ============================================================ */

import { MarcaPaquete21 } from '../comun/MarcaPaquete21';
import './rv8-parametros.css';

export function AvisoRegimen({ onConfigurar }: { onConfigurar: () => void }) {
  if (!import.meta.env.DEV) return null;
  return (
    <div role="status">
      <p className="rv8-alerta-media rv8-aviso-reg">
        <span>
          <b>Configure desde cuándo la empresa es agente de retención.</b> Mientras no se configure, la retención de IVA se propone sin comprobar esa fecha.
          <MarcaPaquete21 />
        </span>
        <button type="button" className="btn" onClick={onConfigurar}>Configurar el régimen</button>
      </p>
    </div>
  );
}
