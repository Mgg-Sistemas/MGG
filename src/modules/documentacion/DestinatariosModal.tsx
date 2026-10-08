/* ============================================================
   MGG · Documentación · Catálogo de destinatarios de la nota de envío
   Empresas / departamentos con su RIF, dirección, persona de atención y
   teléfono. Lista buscable; agregar, editar y borrar con confirmación.
   Si viene `onElegir`, cada fila tiene «Usar» (llena el formulario).
   ============================================================ */
import { useMemo, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { crearDestinatario, editarDestinatario, eliminarDestinatario, type Destinatario } from './documentacion.repository';
import { filtrarDestinatarios } from './notaEnvio';
import type { DatosDestinatario } from './catalogoDocumentacion';

export function DestinatariosModal({ destinatarios, canWrite, actor, onClose, onChanged, onElegir }: {
  destinatarios: Destinatario[]; canWrite: boolean; actor: string;
  onClose: () => void; onChanged: () => void | Promise<void>;
  onElegir?: (d: Destinatario) => void;
}) {
  const [q, setQ] = useState('');
  const [form, setForm] = useState<Destinatario | 'nuevo' | null>(null);
  const [borrar, setBorrar] = useState<Destinatario | null>(null);
  const visibles = useMemo(() => filtrarDestinatarios(destinatarios, q), [destinatarios, q]);

  async function confirmarBorrar() {
    if (!borrar) return;
    try { await eliminarDestinatario(borrar.id); toast('Destinatario eliminado', 'success'); setBorrar(null); await onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <Modal title="📇 Destinatarios" size="lg" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Razón social, RIF, atención, dirección…" style={{ flex: '1 1 240px' }} />
        <span className="muted" style={{ fontSize: '.8rem' }}>{visibles.length} de {destinatarios.length}</span>
        {canWrite && <button className="btn btn-primary" onClick={() => setForm('nuevo')}>＋ Agregar destinatario</button>}
      </div>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Razón social / departamento</th><th>RIF / C.I.</th><th>Atención a</th><th>Dirección</th><th></th></tr></thead>
          <tbody>
            {!visibles.length && <tr><td colSpan={5}><EmptyState icon="📇" message={destinatarios.length ? 'Ningún destinatario coincide' : 'Todavía no hay destinatarios guardados'} /></td></tr>}
            {visibles.map((d) => (
              <tr key={d.id}>
                <td>
                  <strong>{d.razon_social}</strong>
                  {d.telefono && <div className="muted" style={{ fontSize: '.74rem' }}>☎ {d.telefono}</div>}
                  {d.usos > 0 && <div className="muted" style={{ fontSize: '.72rem' }}>{d.usos} nota(s)</div>}
                </td>
                <td className="mono">{d.rif ?? <span className="muted">—</span>}</td>
                <td>{d.atencion_a ?? <span className="muted">—</span>}</td>
                <td className="muted" style={{ fontSize: '.78rem' }}>{d.direccion ?? '—'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {onElegir && <button className="btn btn-sm btn-primary" onClick={() => onElegir(d)}>Usar</button>}
                  {canWrite && <button className="btn btn-sm btn-ghost" title="Editar" onClick={() => setForm(d)}>✎</button>}
                  {canWrite && <button className="btn btn-sm btn-ghost" title="Eliminar" onClick={() => setBorrar(d)}>🗑️</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <DestinatarioForm destinatario={form === 'nuevo' ? null : form} actor={actor}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await onChanged(); }} />
      )}
      {borrar && (
        <ConfirmDialog title="Eliminar destinatario"
          message={`¿Eliminar «${borrar.razon_social}» del catálogo? Las notas ya emitidas conservan sus datos tal como se imprimieron.`}
          confirmText="Eliminar" danger onConfirm={() => void confirmarBorrar()} onCancel={() => setBorrar(null)} />
      )}
    </Modal>
  );
}

function DestinatarioForm({ destinatario, actor, onClose, onSaved }: {
  destinatario: Destinatario | null; actor: string; onClose: () => void; onSaved: () => void;
}) {
  const [razon, setRazon] = useState(destinatario?.razon_social ?? '');
  const [rif, setRif] = useState(destinatario?.rif ?? '');
  const [direccion, setDireccion] = useState(destinatario?.direccion ?? '');
  const [atencion, setAtencion] = useState(destinatario?.atencion_a ?? '');
  const [telefono, setTelefono] = useState(destinatario?.telefono ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    const input: DatosDestinatario = { razon_social: razon, rif, direccion, atencion_a: atencion, telefono };
    try {
      if (destinatario) await editarDestinatario(destinatario.id, input); else await crearDestinatario(input, actor);
      toast(destinatario ? 'Destinatario actualizado' : 'Destinatario agregado', 'success');
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal title={destinatario ? `Editar · ${destinatario.razon_social}` : 'Agregar destinatario'} size="md" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="destinatario-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
    </>}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      <form id="destinatario-form" onSubmit={submit}>
        <div className="form-row"><label>Razón social / departamento *</label><input className="input" value={razon} onChange={(e) => setRazon(e.target.value)} autoFocus /></div>
        <div className="form-grid">
          <div className="form-row"><label>RIF / C.I.</label><input className="input mono" value={rif} onChange={(e) => setRif(e.target.value.toUpperCase())} placeholder="J-12345678-9" /></div>
          <div className="form-row"><label>Teléfono</label><input className="input" value={telefono} onChange={(e) => setTelefono(e.target.value)} /></div>
        </div>
        <div className="form-row"><label>Atención a</label><input className="input" value={atencion} onChange={(e) => setAtencion(e.target.value)} placeholder="Persona que recibe habitualmente" /></div>
        <div className="form-row"><label>Dirección</label><input className="input" value={direccion} onChange={(e) => setDireccion(e.target.value)} /></div>
      </form>
    </Modal>
  );
}
