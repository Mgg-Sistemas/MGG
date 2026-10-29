import { useEffect, useState } from 'react';
import { obtenerUrlAdjunto, type AdjuntoFacturaItem } from './adjuntosBuzon';

/**
 * Miniatura de un soporte del buzón. Resuelve un enlace FIRMADO y temporal:
 * el bucket es privado, así que las facturas no van por URL pública (daría 403).
 * Mientras llega el enlace muestra un marcador; si no se pudo firmar, queda
 * como «no disponible» en vez de un enlace roto.
 */
export function AdjuntoThumb({ adj }: { adj: AdjuntoFacturaItem }) {
  const [url, setUrl] = useState('');
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'error'>('cargando');
  const esImg = adj.tipo === 'imagen';
  const nombre = adj.nombreOriginal || adj.nombre;

  useEffect(() => {
    let vivo = true;
    setEstado('cargando');
    obtenerUrlAdjunto(adj.path)
      .then((u) => {
        if (!vivo) return;
        if (u) {
          setUrl(u);
          setEstado('listo');
        } else {
          setEstado('error');
        }
      })
      .catch(() => {
        if (vivo) setEstado('error');
      });
    return () => {
      vivo = false;
    };
  }, [adj.path]);

  if (estado !== 'listo') {
    return (
      <div className="buzon-thumb-item buzon-thumb-pdf" title={nombre} aria-busy={estado === 'cargando'}>
        <span aria-hidden>{estado === 'cargando' ? '⏳' : '⚠️'}</span>
        <small>{estado === 'cargando' ? 'Cargando…' : 'No disponible'}</small>
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="buzon-thumb-item"
      title={nombre}
      style={{ textDecoration: 'none' }}
    >
      {esImg ? (
        <img src={url} alt={nombre} />
      ) : (
        <div className="buzon-thumb-pdf">
          <span aria-hidden>📄</span>
          <small>{nombre}</small>
        </div>
      )}
    </a>
  );
}
