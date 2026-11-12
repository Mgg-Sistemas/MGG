/* ============================================================
   Imágenes de referencia de la Solicitud de Pedido (SP) · 12-11-2026
   Se ven como MINIATURAS y al tocarlas se abren en el visor del sistema
   (vista previa con Descargar / Imprimir). Antes era un botón «Ver imagen»
   que abría el enlace en otra pestaña DESPUÉS de pedirlo al servidor y el
   navegador lo bloqueaba (sobre todo en el teléfono): no se veía nada.
   ============================================================ */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import { toast } from '@/shared/ui/Toast';
import type { OfertaAdjunto } from '@/shared/lib/types';
import { urlAdjuntoOc } from './pedidos.repository';

const MINI: CSSProperties = {
  width: 72, height: 72, objectFit: 'cover', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg-1)', display: 'block',
};

function abrir(url: string, filename: string) {
  void previewFileUrl(url, filename || 'imagen.jpg', 'Imagen de la solicitud').catch(() => {
    toast('No se pudo mostrar la imagen', 'error');
  });
}

/** Miniatura de una imagen (URL ya lista). Si no carga, queda el nombre como botón. */
function Miniatura({ url, filename, children }: { url: string | null; filename: string; children?: ReactNode }) {
  const [rota, setRota] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="btn btn-ghost" title={`Ver ${filename}`} disabled={!url}
        style={{ padding: 0, borderRadius: 8, lineHeight: 0 }}
        onClick={() => { if (url) abrir(url, filename); }}>
        {url && !rota
          ? <img src={url} alt={filename} loading="lazy" style={MINI} onError={() => setRota(true)} />
          : <span style={{ ...MINI, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', lineHeight: 1 }}>{url ? '📷' : '…'}</span>}
      </button>
      {children}
    </div>
  );
}

/** Imágenes YA SUBIDAS de la SP (bucket de adjuntos de OC). */
export function ImagenesSolicitud({ imagenes, quitar }: {
  imagenes: OfertaAdjunto[];
  /** En edición: botón ✕ para quitar una imagen. */
  quitar?: (path: string) => void;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const clave = imagenes.map((a) => a.path).join('|');
  useEffect(() => {
    let vivo = true;
    void Promise.all(imagenes.map(async (a) => [a.path, await urlAdjuntoOc(a.path).catch(() => '')] as const))
      .then((pares) => { if (vivo) setUrls(Object.fromEntries(pares.filter(([, u]) => u))); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);
  if (!imagenes.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.45rem' }}>
      {imagenes.map((a) => (
        <Miniatura key={a.path} url={urls[a.path] ?? null} filename={a.filename || 'imagen.jpg'}>
          {quitar && <BotonQuitar onClick={() => quitar(a.path)} />}
        </Miniatura>
      ))}
    </div>
  );
}

/** Imágenes elegidas en el formulario que TODAVÍA no se guardaron. */
export function ImagenesPorSubir({ archivos, quitar }: { archivos: File[]; quitar: (i: number) => void }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const us = archivos.map((f) => URL.createObjectURL(f));
    setUrls(us);
    return () => { us.forEach((u) => URL.revokeObjectURL(u)); };
  }, [archivos]);
  if (!archivos.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.45rem' }}>
      {archivos.map((f, i) => (
        <Miniatura key={`${f.name}-${i}`} url={urls[i] ?? null} filename={f.name}>
          <BotonQuitar onClick={() => quitar(i)} />
        </Miniatura>
      ))}
    </div>
  );
}

function BotonQuitar({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" title="Quitar" onClick={onClick}
      style={{
        position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%',
        border: 'none', background: 'var(--danger)', color: '#fff', fontSize: '.7rem', lineHeight: '20px',
        padding: 0, cursor: 'pointer',
      }}>✕</button>
  );
}
