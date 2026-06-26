import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { dateTime } from '@/shared/lib/format';
import type { AdjuntoFactura } from './compras.repository';

/**
 * Gestor de FACTURAS (PDF o imagen) de una compra/servicio directo ya finalizado:
 * ver las actuales, quitar las anteriores y cargar nuevas. Guarda con `onSave`.
 */
export function FacturasModal({ title, facturas, urlFor, onSave, onClose }: {
  title: string;
  facturas: AdjuntoFactura[];
  urlFor: (path: string) => Promise<string>;
  onSave: (nuevos: File[], quitar: string[]) => Promise<void>;
  onClose: () => void;
}) {
  // Las que se conservan (se pueden ir quitando) y las nuevas a subir.
  const [actuales, setActuales] = useState<AdjuntoFactura[]>(facturas);
  const [quitar, setQuitar] = useState<string[]>([]);
  const [nuevos, setNuevos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  function quitarActual(path: string) {
    setActuales((prev) => prev.filter((a) => a.path !== path));
    setQuitar((prev) => (prev.includes(path) ? prev : [...prev, path]));
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const elegidos = Array.from(e.target.files ?? []);
    const validos: File[] = [];
    for (const f of elegidos) {
      if (f.type && f.type !== 'application/pdf' && !f.type.startsWith('image/')) {
        toast(`"${f.name}": debe ser PDF o imagen`, 'error'); continue;
      }
      if (f.size > 10 * 1024 * 1024) { toast(`"${f.name}": no puede superar 10 MB`, 'error'); continue; }
      validos.push(f);
    }
    setNuevos((prev) => {
      const key = (f: File) => `${f.name}-${f.size}`;
      const ya = new Set(prev.map(key));
      return [...prev, ...validos.filter((f) => !ya.has(key(f)))];
    });
    e.target.value = '';
  }

  async function abrir(path: string) {
    try { window.open(await urlFor(path), '_blank', 'noopener'); }
    catch { toast('No se pudo abrir la factura', 'error'); }
  }

  async function guardar() {
    if (!quitar.length && !nuevos.length) { onClose(); return; }
    setSaving(true);
    try {
      await onSave(nuevos, quitar);
      toast('Facturas actualizadas', 'success');
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudieron guardar las facturas', 'error'); setSaving(false); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button className="btn btn-primary" onClick={guardar} disabled={saving}>{saving ? 'Guardando…' : 'Guardar facturas'}</button>
    </>
  );

  return (
    <Modal title={title} size="md" onClose={onClose} footer={footer}>
      <div className="form-row">
        <label>Facturas actuales</label>
        {actuales.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
            {actuales.map((a) => (
              <div key={a.path} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', justifyContent: 'space-between', border: '1px solid var(--border)', borderRadius: 6, padding: '.35rem .55rem' }}>
                <button className="btn btn-sm btn-ghost" onClick={() => abrir(a.path)} title="Abrir factura" style={{ padding: 0 }}>📎 {a.filename}</button>
                <span style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  <span className="muted" style={{ fontSize: '.72rem' }}>{dateTime(a.at)}</span>
                  <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)', padding: '0 .35rem' }} onClick={() => quitarActual(a.path)} title="Quitar esta factura">✕</button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>Sin facturas. Cargá una abajo.</p>
        )}
      </div>

      <div className="form-row">
        <label>Cargar nuevas facturas <span className="muted" style={{ fontWeight: 400 }}>(PDF o imagen · varias)</span></label>
        <input className="input" type="file" accept="application/pdf,image/*" multiple onChange={handleFiles} />
        {nuevos.length > 0 && (
          <div style={{ marginTop: '.35rem', display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
            {nuevos.map((f, i) => (
              <div key={`${f.name}-${i}`} className="muted" style={{ fontSize: '.78rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                ✓ {f.name} ({(f.size / 1024).toFixed(0)} KB)
                <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)', padding: '0 .35rem' }} onClick={() => setNuevos((prev) => prev.filter((_, k) => k !== i))} title="Quitar">✕</button>
              </div>
            ))}
          </div>
        )}
        <small className="muted" style={{ fontSize: '.72rem', marginTop: '.25rem' }}>PDF o imágenes · máximo 10 MB c/u.</small>
      </div>
    </Modal>
  );
}
