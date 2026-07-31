import { useEffect, useRef, useState } from 'react';

/* ============================================================
   Detección de despliegue REAL (cambió el bundle que corre el
   navegador), no de cualquier commit.
   El build emite `version.json` con una HUELLA del contenido
   servido (nombres hasheados de los .js/.css). El cliente lee
   esa huella al cargar (línea base = lo que corre esta pestaña)
   y la consulta cada minuto; si difiere de la línea base, se
   publicó una versión nueva del front → se avisa. Un commit que
   solo toca manual/SQL/docs NO cambia la huella → no se avisa.
   ============================================================ */

const POLL_MS = 60_000; // un chequeo por minuto

export function useVersionCheck(): { hayActualizacion: boolean } {
  const [hayActualizacion, setHay] = useState(false);
  const baseline = useRef<string | null>(null); // huella que corre esta pestaña
  const detectado = useRef(false);

  useEffect(() => {
    // En dev no hay version.json ni despliegues: no tiene sentido chequear.
    if (!import.meta.env.PROD) return;
    let timer: number | undefined;

    async function chequear() {
      if (detectado.current) return;
      try {
        const url = `${import.meta.env.BASE_URL}version.json?ts=${Date.now()}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { version?: string };
        const remota = (data?.version ?? '').trim();
        if (!remota) return;
        if (baseline.current === null) {
          baseline.current = remota; // primera lectura = versión que corre esta pestaña
          return;
        }
        if (remota !== baseline.current) {
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
  }, []);

  return { hayActualizacion };
}
