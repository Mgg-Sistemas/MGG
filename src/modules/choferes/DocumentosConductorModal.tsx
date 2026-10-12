/* ============================================================
   MGG · Choferes / Conductores · Documentos del conductor (ventana)

   Por cada tipo (licencia, certificado médico, seguro) se ve el documento
   VIGENTE —quién lo subió, cuándo y hasta cuándo vale—, se puede ver, subir
   uno nuevo (el anterior pasa al histórico) y desplegar las versiones
   anteriores. «Otros documentos» admite varios, cada uno con su nombre.
   ============================================================ */
import { useMemo, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { FechaVe } from '@/shared/ui/FechaVe';
import { toast } from '@/shared/ui/Toast';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import { megas } from '@/modules/rrhh/documentosPersonal';
import {
  TIPOS_DOCUMENTO_CHOFER, eliminarDocumentoChofer, subirDocumentoChofer, urlDocumentoChofer,
  type Conductor, type DocumentoChofer, type TipoDocumentoChofer,
} from './choferes.repository';
import { BadgeVence } from './ExpedienteTab';
import { fechaHora, nombreConductor } from './ChoferesPage';

export function DocumentosConductorModal({ conductor, documentos, sinInstalar, canWrite, actor, actorName, hoy, onClose, onChanged }: {
  conductor: Conductor; documentos: DocumentoChofer[]; sinInstalar: boolean; canWrite: boolean;
  actor: string; actorName: string | null; hoy: string; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<DocumentoChofer | null>(null);
  const [abrirHist, setAbrirHist] = useState<Set<string>>(new Set());
  // Formulario de subida por tipo: archivo + vence (+ etiqueta en «otros»).
  const [form, setForm] = useState<Record<string, { file: File | null; vence: string; etiqueta: string }>>({});
  const f = (k: string) => form[k] ?? { file: null, vence: '', etiqueta: '' };
  const setF = (k: string, patch: Partial<{ file: File | null; vence: string; etiqueta: string }>) => setForm((x) => ({ ...x, [k]: { ...f(k), ...patch } }));

  const porTipo = useMemo(() => {
    const m = new Map<TipoDocumentoChofer, DocumentoChofer[]>();
    for (const d of documentos) m.set(d.tipo, [...(m.get(d.tipo) ?? []), d]);
    for (const v of m.values()) v.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return m;
  }, [documentos]);

  async function ver(d: DocumentoChofer) {
    try { await previewFileUrl(await urlDocumentoChofer(d.path), d.nombre, d.etiqueta || TIPOS_DOCUMENTO_CHOFER.find((t) => t.key === d.tipo)?.label || 'Documento'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir', 'error'); }
  }

  async function subir(tipo: TipoDocumentoChofer) {
    const v = f(tipo);
    if (!v.file) { toast('Elige el archivo (PDF o imagen).', 'warning'); return; }
    setSubiendo(tipo);
    try {
      await subirDocumentoChofer(conductor, tipo, v.file, { etiqueta: v.etiqueta, vence: v.vence || null, actor, actorName });
      toast('Documento subido; el anterior quedó en el histórico', 'success');
      setForm((x) => ({ ...x, [tipo]: { file: null, vence: '', etiqueta: '' } }));
      await onChanged();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo subir', 'error'); }
    finally { setSubiendo(null); }
  }

  async function confirmarBorrar() {
    const d = borrar; setBorrar(null);
    if (!d) return;
    try { await eliminarDocumentoChofer(d); toast('Documento eliminado', 'success'); await onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  const toggleHist = (k: string) => setAbrirHist((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  function Fila({ d, vigente }: { d: DocumentoChofer; vigente: boolean }) {
    return (
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', padding: '.35rem .5rem', borderRadius: 6, background: vigente ? 'rgba(41,192,129,.08)' : 'transparent', fontSize: '.84rem' }}>
        <span style={{ flex: '1 1 200px', minWidth: 0 }}>
          <strong style={{ overflowWrap: 'anywhere' }}>{d.nombre}</strong>{d.tamano ? <span className="muted"> · {megas(d.tamano)}</span> : null}
          <div className="muted" style={{ fontSize: '.74rem' }}>Subido {fechaHora(d.created_at)}{d.subido_por_nombre ? ` por ${d.subido_por_nombre}` : d.subido_por ? ` por ${d.subido_por}` : ''}</div>
        </span>
        {d.vence && <BadgeVence vence={d.vence} hoy={hoy} />}
        <button className="btn btn-sm btn-ghost" onClick={() => void ver(d)}>👁 Ver</button>
        {canWrite && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setBorrar(d)} title="Eliminar este archivo">🗑</button>}
      </div>
    );
  }

  function Subida({ tipo, conEtiqueta }: { tipo: TipoDocumentoChofer; conEtiqueta?: boolean }) {
    const v = f(tipo);
    return (
      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '.4rem', padding: '.45rem .5rem', border: '1px dashed var(--border)', borderRadius: 6 }}>
        {conEtiqueta && (
          <div className="form-row" style={{ margin: 0, flex: '1 1 160px' }}><label style={{ fontSize: '.72rem' }}>Nombre del documento</label>
            <input className="input" value={v.etiqueta} onChange={(e) => setF(tipo, { etiqueta: e.target.value })} placeholder="Antecedentes, curso de manejo defensivo…" /></div>
        )}
        <div className="form-row" style={{ margin: 0, flex: '1 1 200px' }}><label style={{ fontSize: '.72rem' }}>Archivo (PDF o imagen, máx. 10 MB)</label>
          <input className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setF(tipo, { file: e.target.files?.[0] ?? null })} /></div>
        <div className="form-row" style={{ margin: 0, flex: '0 1 150px' }}><label style={{ fontSize: '.72rem' }}>Vence (opcional)</label>
          <FechaVe value={v.vence} onChange={(iso) => setF(tipo, { vence: iso })} /></div>
        <button className="btn btn-sm btn-primary" onClick={() => void subir(tipo)} disabled={subiendo === tipo || !v.file}>{subiendo === tipo ? 'Subiendo…' : '⬆ Subir'}</button>
      </div>
    );
  }

  return (
    <Modal title={`📁 Documentos · ${nombreConductor(conductor)}`} size="lg" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      {sinInstalar && (
        <div className="aviso warning" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">⚠</span>
          <div><strong>Los documentos todavía no están instalados en la base.</strong> Hay que ejecutar <code>supabase/sql/choferes-documentos.sql</code> en el editor SQL de Supabase y recargar.</div></div>
      )}
      <p className="muted" style={{ fontSize: '.82rem', marginTop: 0 }}>
        Cada subida reemplaza al documento vigente de su tipo y guarda el anterior en el histórico, con fecha y quién lo subió. Si pones la fecha de vencimiento, se actualiza también en el expediente.
      </p>
      <div style={{ display: 'grid', gap: '.7rem' }}>
        {TIPOS_DOCUMENTO_CHOFER.map((t) => {
          const lista = porTipo.get(t.key) ?? [];
          if (t.key === 'otro') {
            const vigentes = lista.filter((d) => d.vigente);
            const hist = lista.filter((d) => !d.vigente);
            return (
              <div key={t.key} className="card" style={{ padding: '.6rem .75rem' }}>
                <div className="card-title">{t.icon} {t.label} <span className="muted" style={{ fontWeight: 400 }}>· {vigentes.length}</span></div>
                {!vigentes.length && <div className="muted" style={{ fontSize: '.82rem' }}>Sin otros documentos.</div>}
                {vigentes.map((d) => <div key={d.id}><div style={{ fontSize: '.78rem', fontWeight: 700, marginTop: '.3rem' }}>{d.etiqueta}</div><Fila d={d} vigente /></div>)}
                {!!hist.length && (
                  <div style={{ marginTop: '.3rem' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => toggleHist(t.key)}>🕓 {hist.length} versión(es) anterior(es) {abrirHist.has(t.key) ? '▴' : '▾'}</button>
                    {abrirHist.has(t.key) && hist.map((d) => <div key={d.id}><div className="muted" style={{ fontSize: '.72rem', marginTop: '.2rem' }}>{d.etiqueta}</div><Fila d={d} vigente={false} /></div>)}
                  </div>
                )}
                {canWrite && !sinInstalar && <Subida tipo={t.key} conEtiqueta />}
              </div>
            );
          }
          const vigente = lista.find((d) => d.vigente) ?? null;
          const hist = lista.filter((d) => d.id !== vigente?.id);
          const venceExp = conductor[t.campoVence as 'licencia_vence'];
          return (
            <div key={t.key} className="card" style={{ padding: '.6rem .75rem' }}>
              <div className="card-title" style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {t.icon} {t.label}
                <span style={{ marginLeft: 'auto' }}><BadgeVence vence={venceExp} hoy={hoy} /></span>
              </div>
              {vigente
                ? <Fila d={vigente} vigente />
                : <div className="muted" style={{ fontSize: '.82rem' }}>Todavía no se ha subido {t.label.toLowerCase()}.{venceExp ? ' El vencimiento del expediente se cargó a mano.' : ''}</div>}
              {!!hist.length && (
                <div style={{ marginTop: '.3rem' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => toggleHist(t.key)}>🕓 Histórico: {hist.length} versión(es) anterior(es) · última subida {fechaHora(lista[0].created_at)} {abrirHist.has(t.key) ? '▴' : '▾'}</button>
                  {abrirHist.has(t.key) && hist.map((d) => <Fila key={d.id} d={d} vigente={false} />)}
                </div>
              )}
              {canWrite && !sinInstalar && <Subida tipo={t.key} />}
            </div>
          );
        })}
      </div>
      {borrar && (
        <ConfirmDialog title="Eliminar documento" danger confirmText="Sí, eliminar"
          message={`Se borra el archivo «${borrar.nombre}» (subido ${fechaHora(borrar.created_at)}). ${borrar.vigente ? 'Si hay una versión anterior, vuelve a ser la vigente.' : 'Es una versión del histórico.'}`}
          onConfirm={() => { void confirmarBorrar(); }} onCancel={() => setBorrar(null)} />
      )}
    </Modal>
  );
}
