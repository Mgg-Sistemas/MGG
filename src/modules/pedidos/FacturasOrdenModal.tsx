/* ============================================================
   MGG · Compras · «🧾 Factura» de una OC recibida (11-11-2026)

   Dos bloques: FACTURAS DELIVERY (las que subió el delivery con «CARGAR
   FACTURA») y FACTURAS ALMACÉN (las que cargó el almacenista al recepcionar).
   Cada archivo se ve en miniatura; al tocarlo se abre la vista previa con
   descargar e imprimir. También se puede descargar o imprimir directo.
   ============================================================ */
import { useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { previewArchivo } from '@/shared/lib/reportePreview';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Orden } from '@/shared/lib/types';
import { facturasDeOrden, type ArchivoFactura, type FacturasDeOrden } from './facturasOrden.repository';

async function descargar(f: ArchivoFactura) {
  try {
    const blob = await (await fetch(f.url)).blob();
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u; a.download = f.filename || 'factura';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 2000);
  } catch {
    window.open(f.url, '_blank', 'noopener,noreferrer');
  }
}

/** Imprime una o varias imágenes en una sola hoja (un PDF se abre en su vista previa para imprimir). */
function imprimir(archivos: ArchivoFactura[], titulo: string) {
  const imgs = archivos.filter((f) => !f.esPdf);
  const pdf = archivos.find((f) => f.esPdf);
  if (!imgs.length && pdf) { previewArchivo(pdf.url, pdf.filename); return; }
  const w = window.open('', '_blank');
  if (!w) { toast('El navegador bloqueó la ventana de impresión.', 'error'); return; }
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title>
    <style>body{margin:0;font:12px system-ui}h1{font-size:14px;margin:8px}figure{margin:0 0 8px;page-break-inside:avoid;text-align:center}
    img{max-width:100%;max-height:95vh;object-fit:contain}figcaption{font-size:11px;color:#555}@media print{h1{display:none}}</style></head>
    <body><h1>${esc(titulo)}</h1>${imgs.map((f) => `<figure><img src="${f.url}" alt=""><figcaption>${esc(f.filename)}</figcaption></figure>`).join('')}
    <script>Promise.all([...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))).then(()=>{window.focus();window.print();});</script>
    </body></html>`);
  w.document.close();
  if (pdf) toast('Los PDF se imprimen desde su vista previa.', 'info');
}

function Bloque({ titulo, archivos, vacio, oc }: { titulo: string; archivos: ArchivoFactura[]; vacio: string; oc: string }) {
  return (
    <div className="card" style={{ marginBottom: '.8rem' }}>
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
        <span>{titulo} ({archivos.length})</span>
        {archivos.length > 0 && (
          <span style={{ display: 'inline-flex', gap: '.35rem' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => imprimir(archivos, `${titulo} · ${oc}`)}>🖨 Imprimir todas</button>
          </span>
        )}
      </div>
      {!archivos.length ? <p className="hint muted" style={{ margin: 0 }}>{vacio}</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '.6rem' }}>
          {archivos.map((f) => (
            <div key={f.path} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '.4rem', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
              <button type="button" onClick={() => previewArchivo(f.url, f.filename)} title="Vista previa"
                style={{ border: 0, padding: 0, background: 'var(--surface-2)', borderRadius: 6, height: 140, cursor: 'zoom-in', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {f.esPdf
                  ? <span style={{ fontSize: '2.4rem' }}>📄</span>
                  : <img src={f.url} alt={f.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </button>
              <small style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.filename}>{f.filename}</small>
              {f.detalle && <small className="muted">{f.detalle}</small>}
              <span style={{ display: 'flex', gap: '.25rem' }}>
                <button type="button" className="btn btn-xs btn-ghost" onClick={() => void descargar(f)}>⬇ Descargar</button>
                <button type="button" className="btn btn-xs btn-ghost" onClick={() => imprimir([f], `${titulo} · ${oc}`)}>🖨 Imprimir</button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FacturasOrdenModal({ orden, onClose }: { orden: Orden; onClose: () => void }) {
  const [data, setData] = useState<FacturasDeOrden | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const oc = orden.oc_codigo ?? orden.codigo;

  useEffect(() => {
    let vivo = true;
    facturasDeOrden(orden)
      .then((d) => { if (vivo) setData(d); })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudieron cargar las facturas'); });
    return () => { vivo = false; };
  }, [orden, tick]);
  useRealtime(['delivery_pedidos', 'ordenes'], () => setTick((t) => t + 1));

  return (
    <Modal title={`🧾 Factura · ${oc}`} size="lg" onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      {error && <div className="aviso danger sm" style={{ marginBottom: '.6rem' }}>{error}</div>}
      {!data && !error ? <p className="hint muted">Cargando facturas…</p> : data && (
        <>
          <Bloque titulo="🛵 FACTURAS DELIVERY" archivos={data.delivery} oc={oc}
            vacio="El delivery no cargó factura (es opcional)." />
          <Bloque titulo="🏬 FACTURAS ALMACÉN" archivos={data.almacen} oc={oc}
            vacio="El almacén no cargó factura en la recepción (las recepciones anteriores al 11-11-2026 no la pedían)." />
          {data.alFinalizar && (
            <Bloque titulo="📎 Soporte adjunto a la OC" archivos={[data.alFinalizar]} oc={oc} vacio="" />
          )}
          <p className="hint muted" style={{ margin: 0, fontSize: '.76rem' }}>Toca una miniatura para verla en grande; desde ahí también se descarga o imprime.</p>
        </>
      )}
    </Modal>
  );
}
