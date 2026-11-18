/* ============================================================
   MGG · Delivery · editar fotos de un pedido ENTREGADO (03/11/2026)
   Lo usan el tablero de la PC (DeliveryPage) y el teléfono (DeliveryMovilView).
   Pueden: admin, quien tenga escritura en Delivery y el motorizado que lo entregó
   (la base lo vuelve a revisar en delivery_editar_fotos).
   ============================================================ */
import { useEffect, useState } from 'react';
import { ConfirmDialog, Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { previewGaleria } from '@/shared/lib/reportePreview';
import { MAX_FOTOS_DELIVERY, rotuloFotos, type FotoDelivery, type OrigenDelivery, type TipoFotoDelivery } from './delivery';
import { editarFotosDelivery, urlFotoDelivery } from './delivery.repository';

type Tipo = TipoFotoDelivery;

const SIN_FOTOS: FotoDelivery[] = [];

const esImagen = (f: File) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.name);

/** ¿Puede este usuario editar las fotos de un pedido entregado? */
export function puedeEditarFotosDelivery(
  p: { estado: string; pedido_id?: string | null; es_mio?: boolean }, admin: boolean, escritura: boolean,
): boolean {
  return p.estado === 'entregado' && !!p.pedido_id && (admin || escritura || !!p.es_mio);
}

export function EditarFotosDeliveryModal({ pedidoId, origen, titulo, fotosRecibo, fotosEntrega, fotosFactura = SIN_FOTOS, onClose, onGuardado }: {
  pedidoId: string; origen: OrigenDelivery | null | undefined; titulo: string;
  fotosRecibo: FotoDelivery[]; fotosEntrega: FotoDelivery[];
  /** 11/11/2026: fotos de la factura del proveedor (solo compras). */
  fotosFactura?: FotoDelivery[];
  onClose: () => void; onGuardado: () => void;
}) {
  const [quedan, setQuedan] = useState<Record<Tipo, FotoDelivery[]>>({ recibo: fotosRecibo, entrega: fotosEntrega, factura: fotosFactura });
  const [nuevos, setNuevos] = useState<Record<Tipo, File[]>>({ recibo: [], entrega: [], factura: [] });
  const [quitadas, setQuitadas] = useState<Record<Tipo, FotoDelivery[]>>({ recibo: [], entrega: [], factura: [] });
  const [confirmar, setConfirmar] = useState<{ tipo: Tipo; foto: FotoDelivery } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let vivo = true;
    void Promise.all([...fotosRecibo, ...fotosEntrega, ...fotosFactura].map(async (f) => [f.path, await urlFotoDelivery(f.path).catch(() => '')] as const))
      .then((xs) => { if (vivo) setUrls(Object.fromEntries(xs)); });
    return () => { vivo = false; };
  }, [fotosRecibo, fotosEntrega, fotosFactura]);

  const cambios = (['recibo', 'entrega', 'factura'] as Tipo[]).filter((t) => nuevos[t].length || quitadas[t].length);

  function agregar(tipo: Tipo, lista: FileList | null) {
    const archivos = Array.from(lista ?? []);
    if (!archivos.length) return;
    if (archivos.some((f) => !esImagen(f))) { toast('Solo se pueden subir fotos (imágenes).', 'error'); return; }
    const faltan = MAX_FOTOS_DELIVERY - quedan[tipo].length - nuevos[tipo].length;
    if (archivos.length > faltan) { toast(`Se pueden adjuntar hasta ${MAX_FOTOS_DELIVERY} fotos; te quedan ${Math.max(0, faltan)}.`, 'error'); return; }
    setNuevos((n) => ({ ...n, [tipo]: [...n[tipo], ...archivos] }));
  }

  function quitar(tipo: Tipo, foto: FotoDelivery) {
    setQuedan((q) => ({ ...q, [tipo]: q[tipo].filter((f) => f.path !== foto.path) }));
    setQuitadas((q) => ({ ...q, [tipo]: [...q[tipo], foto] }));
  }

  async function guardar() {
    if (!cambios.length) { onClose(); return; }
    setGuardando(true);
    try {
      let sinBorrar = 0;
      for (const t of cambios) {
        const r = await editarFotosDelivery(pedidoId, t, quedan[t], nuevos[t], quitadas[t]);
        sinBorrar += r.sinBorrar;
      }
      toast(sinBorrar ? `Fotos guardadas (${sinBorrar} archivo(s) no se pudieron borrar del almacenamiento).` : 'Fotos guardadas.', sinBorrar ? 'warning' : 'success');
      onGuardado();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron guardar las fotos.', 'error');
    } finally { setGuardando(false); }
  }

  const grupo = (tipo: Tipo) => {
    const total = quedan[tipo].length + nuevos[tipo].length;
    const id = `dlv-editar-${tipo}-${pedidoId}`;
    const rotulo = rotuloFotos(origen, tipo);
    const galeria = quedan[tipo].filter((f) => !!urls[f.path])
      .map((f) => ({ path: f.path, url: urls[f.path], filename: f.filename, etiqueta: `${titulo} · ${rotulo}` }));
    return (
      <div style={{ marginBottom: '1rem' }}>
        <div className="card-title" style={{ fontSize: '.9rem' }}>{rotulo} ({total}/{MAX_FOTOS_DELIVERY})</div>
        <div style={{ display: 'grid', gap: '.5rem', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
          {quedan[tipo].map((f) => (
            <div key={f.path} style={{ position: 'relative' }}>
              {urls[f.path]
                ? (
                  <button type="button" title={`Vista previa · ${f.filename}`}
                    onClick={() => previewGaleria(galeria, Math.max(0, galeria.findIndex((x) => x.path === f.path)))}
                    style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'transparent', cursor: 'zoom-in', width: '100%', display: 'block' }}>
                    <img src={urls[f.path]} alt={f.filename} style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }} />
                  </button>
                )
                : <div className="muted" style={{ height: 110, display: 'grid', placeItems: 'center', border: '1px dashed var(--border)', borderRadius: 8, fontSize: '.8rem' }}>📷</div>}
              <button type="button" className="btn btn-danger btn-sm" disabled={guardando}
                style={{ position: 'absolute', top: 4, right: 4 }} aria-label={`Quitar ${f.filename}`}
                onClick={() => setConfirmar({ tipo, foto: f })}>✕</button>
            </div>
          ))}
          {nuevos[tipo].map((f, i) => (
            <div key={`n-${i}-${f.name}`} className="muted" style={{ position: 'relative', height: 110, display: 'grid', placeItems: 'center', border: '1px dashed var(--success, #22c55e)', borderRadius: 8, fontSize: '.75rem', padding: '.3rem', textAlign: 'center', wordBreak: 'break-all' }}>
              🆕 {f.name}
              <button type="button" className="btn btn-ghost btn-sm" disabled={guardando}
                style={{ position: 'absolute', top: 4, right: 4 }} aria-label={`No agregar ${f.name}`}
                onClick={() => setNuevos((n) => ({ ...n, [tipo]: n[tipo].filter((_, k) => k !== i) }))}>✕</button>
            </div>
          ))}
        </div>
        {!total && <p className="muted" style={{ margin: '.3rem 0 0' }}>Sin fotos.</p>}
        {total < MAX_FOTOS_DELIVERY && (
          <div className="dlv-subir" style={{ marginTop: '.5rem' }}>
            <label htmlFor={id} className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>➕ Agregar fotos</label>
            <input id={id} type="file" accept="image/*" multiple disabled={guardando} style={{ display: 'none' }}
              onChange={(e) => { agregar(tipo, e.target.files); e.target.value = ''; }} />
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <Modal title={`✏ Editar fotos · ${titulo}`} size="lg" onClose={guardando ? () => {} : onClose}
        footer={<>
          <button type="button" className="btn btn-ghost" disabled={guardando} onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={guardando || !cambios.length} onClick={() => void guardar()}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </>}>
        {grupo('recibo')}
        {origen !== 'almacen' && grupo('factura')}
        {grupo('entrega')}
      </Modal>
      {confirmar && (
        <ConfirmDialog title="Quitar foto" danger confirmText="Quitar"
          message={`¿Quitar «${confirmar.foto.filename}»? Al guardar se borra el archivo y queda anotado en el historial del pedido.`}
          onCancel={() => setConfirmar(null)}
          onConfirm={() => { quitar(confirmar.tipo, confirmar.foto); setConfirmar(null); }} />
      )}
    </>
  );
}
