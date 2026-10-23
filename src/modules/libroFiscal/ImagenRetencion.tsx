/* ============================================================
   Golden Touch · Retenciones · Una imagen del bucket privado (logo, firma, sello)
   Se pide la URL firmada al mostrarla; sin ruta, el recuadro queda en blanco,
   igual que en el comprobante.
   ============================================================ */
import { useEffect, useState } from 'react';
import { urlImagen } from './entes.repository';

export function ImagenRetencion({ ruta, alt, ancho = 96, alto = 64, vacio = 'Sin imagen' }: {
  ruta: string | null | undefined;
  alt: string;
  ancho?: number;
  alto?: number;
  vacio?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  useEffect(() => {
    let vivo = true;
    setUrl(null); setFallo(false);
    if (ruta) urlImagen(ruta).then((u) => { if (vivo) setUrl(u); }).catch(() => { if (vivo) setFallo(true); });
    return () => { vivo = false; };
  }, [ruta]);
  return (
    <div style={{
      width: ancho, height: alto, border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-md)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', overflow: 'hidden', flex: '0 0 auto',
    }}>
      {url
        ? <img src={url} alt={alt} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        : <span className="muted" style={{ fontSize: '.68rem', textAlign: 'center', padding: '.2rem' }}>{ruta ? (fallo ? 'No se pudo abrir' : '…') : vacio}</span>}
    </div>
  );
}
