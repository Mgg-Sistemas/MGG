import { useEffect, useRef, useState } from 'react';

/* ============================================================
   Detección de despliegue real (cambio en la rama main).
   El build hornea VITE_APP_VERSION (hash del commit) y emite
   `version.json`. El cliente consulta ese archivo cada minuto;
   si la versión del servidor difiere de la horneada, hubo un
   despliegue nuevo → se avisa. Si el cron solo hizo un pull sin
   cambios, el hash es el mismo y no se avisa nada.
   ============================================================ */

const POLL_MS = 60_000; // un chequeo por minuto

export function useVersionCheck(): { hayActualizacion: boolean } {
  const actual = (import.meta.env.VITE_APP_VERSION ?? '').trim();
  const [hayActualizacion, setHay] = useState(false);
  const detectado = useRef(false);

  useEffect(() => {
    // Sin versión horneada (modo dev) no tiene sentido chequear.
    if (!actual) return;
    let timer: number | undefined;

    async function chequear() {
      if (detectado.current) return;
      try {
        const url = `${import.meta.env.BASE_URL}version.json?ts=${Date.now()}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { version?: string };
        const remota = (data?.version ?? '').trim();
        if (remota && remota !== actual) {
          detectado.current = true; // ya lo sabemos; dejamos de consultar
          setHay(true);
        }
      } catch {
        /* offline o version.json ausente: se reintenta en el próximo ciclo */
      }
    }

    function loop() {
      void chequear();
      timer = window.setTimeout(loop, POLL_MS);
    }

    // También al volver el foco a la pestaña (vuelve de estar minimizada).
    const onFocus = () => { if (!detectado.current) void chequear(); };
    window.addEventListener('focus', onFocus);
    loop();

    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [actual]);

  return { hayActualizacion };
}
