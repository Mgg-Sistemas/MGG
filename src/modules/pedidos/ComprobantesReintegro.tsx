import { useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { mensajeError } from '@/shared/lib/errores';
import { toast } from '@/shared/ui/Toast';

export interface ComprobanteReintegro { path: string; nombre: string; tipo: 'imagen' | 'pdf' }

export function ComprobantesReintegro({ id, ordenId, archivos, canUpload, onSaved }: {
  id: string; ordenId: string; archivos: ComprobanteReintegro[]; canUpload: boolean; onSaved: () => Promise<void>;
}) {
  const [seleccion, setSeleccion] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const imagenes = archivos.filter(a => a.tipo === 'imagen').length;
  const pdfs = archivos.filter(a => a.tipo === 'pdf').length;

  async function guardar() {
    setError('');
    if (!seleccion.length) return;
    const imagenesNuevas = seleccion.filter(f => f.type.startsWith('image/'));
    const pdfsNuevos = seleccion.filter(f => f.type === 'application/pdf');
    if (imagenesNuevas.length + pdfsNuevos.length !== seleccion.length || seleccion.some(f => !f.size || f.size > 10 * 1024 * 1024)) {
      setError('Selecciona imágenes o PDF de hasta 10 MB por archivo.'); return;
    }
    if (imagenes + imagenesNuevas.length > 4 || pdfs + pdfsNuevos.length > 1) {
      setError('El reintegro admite como máximo cuatro imágenes y un PDF, incluidos los ya cargados.'); return;
    }
    setSaving(true);
    try {
      const nuevos: ComprobanteReintegro[] = [];
      for (const file of seleccion) {
        const path = `${ordenId}/reintegros/${id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)}`;
        const { error: errorSubida } = await supabase.storage.from('compras-oc').upload(path, file, { contentType: file.type, upsert: false });
        if (errorSubida) throw errorSubida;
        nuevos.push({ path, nombre: file.name, tipo: file.type === 'application/pdf' ? 'pdf' : 'imagen' });
      }
      const { error: errorGuardar } = await supabase.rpc('compras_adjuntar_comprobantes_reintegro', { p_id: id, p_archivos: nuevos });
      if (errorGuardar) throw errorGuardar;
      setSeleccion([]);
      await onSaved();
      toast('Comprobante de reintegro disponible en Tesorería', 'success');
    } catch (e) { setError(mensajeError(e, 'No se pudieron guardar los comprobantes')); }
    finally { setSaving(false); }
  }

  async function abrir(a: ComprobanteReintegro) {
    const ventana = window.open('about:blank', '_blank');
    if (ventana) ventana.opener = null;
    try {
      const { data, error: errorUrl } = await supabase.storage.from('compras-oc').createSignedUrl(a.path, 300);
      if (errorUrl || !data) throw errorUrl || new Error('Comprobante no disponible');
      if (ventana) ventana.location.href = data.signedUrl;
      else window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (e) { ventana?.close(); setError(mensajeError(e, 'No se pudo abrir el comprobante')); }
  }

  return <section className="compras-comprobantes">
    <strong>COMPROBANTE DE REINTEGRO</strong>
    <p className="muted">Cargado por Compras · {imagenes}/4 imágenes · {pdfs}/1 PDF</p>
    <div className="compras-acciones">{archivos.map(a => <button key={a.path} className="btn btn-ghost" onClick={() => void abrir(a)}>{a.tipo === 'pdf' ? '📄' : '📷'} {a.nombre}</button>)}</div>
    {!archivos.length && <p className="muted">Sin comprobantes cargados por Compras.</p>}
    {canUpload && (imagenes < 4 || pdfs < 1) && <>
      <label>Adjuntar comprobantes (hasta 10 MB cada uno)
        <input className="input" type="file" accept="image/*,application/pdf" multiple disabled={saving} onChange={e => { setSeleccion(Array.from(e.target.files || [])); setError(''); }} />
      </label>
      {seleccion.length > 0 && <button className="btn btn-primary" disabled={saving} onClick={() => void guardar()}>{saving ? 'Cargando…' : `Guardar comprobante (${seleccion.length} archivos)`}</button>}
    </>}
    {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
  </section>;
}
