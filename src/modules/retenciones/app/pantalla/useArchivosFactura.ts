/* ============================================================
   MGG · Retenciones v8 · Los archivos de la factura de una página

   Realizadas y el Libro muestran «📎 Factura» o «📎 Sin archivo» como en la
   maqueta (v8BotonFactura). Sus filas no traen el archivo de Compras: se leen
   por la puerta, solo los documentos de la página visible. Sin el método en la
   puerta, devuelve null y el botón no se muestra.
   ============================================================ */

import { useEffect, useMemo, useState } from 'react';
import { usePuerta, type ArchivoFactura } from '../datos/puerta';

export function useArchivosFactura(docs: readonly { kind: string; id: string | null }[]): Map<string, ArchivoFactura[]> | null {
  const puerta = usePuerta();
  const clave = useMemo(() => [...new Set(docs.filter((d) => d.id).map((d) => `${d.kind}:${d.id}`))].sort().join('|'), [docs]);
  const [mapa, setMapa] = useState<Map<string, ArchivoFactura[]> | null>(null);
  useEffect(() => {
    if (!puerta.archivosDeDocumentos || !clave) { setMapa(null); return; }
    let vivo = true;
    const lista = clave.split('|').map((x) => { const i = x.indexOf(':'); return { kind: x.slice(0, i), id: x.slice(i + 1) }; });
    puerta.archivosDeDocumentos(lista)
      .then((m) => { if (vivo) setMapa(m); })
      .catch(() => { if (vivo) setMapa(null); });
    return () => { vivo = false; };
  }, [puerta, clave]);
  return mapa;
}
