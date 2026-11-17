/* ============================================================
   Golden Touch · Administración · documentos de la empresa
   Los papeles legales que la empresa necesita a mano: RIF, acta constitutiva,
   actas de modificación, cédula del representante, y cualquier otro. PDF o
   imagen; se previsualizan con una URL firmada (10 min). Subir y borrar van
   detrás del permiso de escritura; ver, con solo lectura. Si la base aún no
   tiene el almacén (tabla/bucket), lo dice sin romperse.
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { EmptyState } from '@/shared/ui/EmptyState';
import { TIPO_DOCUMENTO_LABEL, type AdminRepo, type DocumentoEmpresa, type Empresa, type TipoDocumento } from './admin.repository';

const TIPOS = Object.keys(TIPO_DOCUMENTO_LABEL) as TipoDocumento[];
const fFecha = new Intl.DateTimeFormat('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
function tamanoFmt(b: number | null): string {
  if (!b || b <= 0) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentosEmpresaModal({ repo, empresa, puedeEscribir = true, onClose }: {
  repo: AdminRepo; empresa: Empresa; puedeEscribir?: boolean; onClose: () => void;
}) {
  const [docs, setDocs] = useState<DocumentoEmpresa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoDocumento>('rif');
  const [subiendo, setSubiendo] = useState(false);
  const [borrar, setBorrar] = useState<DocumentoEmpresa | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try { setDocs(await repo.listDocumentos(empresa.clave)); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron leer los documentos.'); }
    finally { setCargando(false); }
  }, [repo, empresa.clave]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function subir(file: File) {
    if (file.size > 25 * 1024 * 1024) { toast('El archivo no puede pasar de 25 MB.', 'error'); return; }
    setSubiendo(true);
    try {
      await repo.subirDocumento(empresa.clave, tipo, file);
      toast(`«${file.name}» guardado.`, 'success');
      await cargar();
    } catch (e) {
      toast(`No se pudo subir: ${e instanceof Error ? e.message : 'error'}`, 'error');
    } finally {
      setSubiendo(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function ver(d: DocumentoEmpresa) {
    try {
      const url = await repo.urlDocumento(d.path);
      if (!url) { toast('No hay vista previa para este documento.', 'info'); return; }
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast(`No se pudo abrir: ${e instanceof Error ? e.message : 'error'}`, 'error');
    }
  }

  async function confirmarBorrar() {
    if (!borrar) return;
    try { await repo.borrarDocumento(borrar); toast('Documento eliminado.', 'success'); await cargar(); }
    catch (e) { toast(`No se pudo eliminar: ${e instanceof Error ? e.message : 'error'}`, 'error'); }
    finally { setBorrar(null); }
  }

  return (
    <Modal title={`📎 Documentos · ${empresa.nombre}`} onClose={onClose}
      footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      {puedeEscribir && (
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '.8rem' }}>
          <div className="form-row" style={{ flex: '1 1 180px' }}>
            <label htmlFor="doc-tipo">Tipo de documento</label>
            <select id="doc-tipo" className="input" value={tipo} onChange={(e) => setTipo(e.target.value as TipoDocumento)}>
              {TIPOS.map((t) => <option key={t} value={t}>{TIPO_DOCUMENTO_LABEL[t]}</option>)}
            </select>
          </div>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void subir(f); }} />
          <button type="button" className="btn btn-primary" disabled={subiendo} onClick={() => fileRef.current?.click()}>
            {subiendo ? 'Subiendo…' : '⬆ Subir documento'}
          </button>
        </div>
      )}
      <p className="muted hint" style={{ marginTop: 0, fontSize: '.78rem' }}>PDF o imagen, hasta 25 MB. Se guardan en privado; la vista previa usa un enlace temporal.</p>

      {error ? (
        <div className="adm-aviso" style={{ marginTop: '.5rem' }}>
          No se pudo leer: {/relation|does not exist|bucket|not found|sesi|jwt|auth|401|permission/i.test(error)
            ? 'inicia sesión, o la base aún no tiene el almacén de documentos del módulo.'
            : error}
        </div>
      ) : cargando ? (
        <p className="muted" style={{ marginTop: '.5rem' }}>Leyendo documentos…</p>
      ) : docs.length === 0 ? (
        <EmptyState icon="📄" message={puedeEscribir ? 'Sin documentos. Suba el RIF, las actas o la cédula del representante.' : 'Esta empresa no tiene documentos cargados.'} />
      ) : (
        <div className="adm-tabla" style={{ marginTop: '.4rem' }}>
          <table>
            <thead><tr><th>Tipo</th><th>Archivo</th><th>Tamaño</th><th>Fecha</th><th aria-label="Acciones" /></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td><span className="adm-chip">{TIPO_DOCUMENTO_LABEL[d.tipo]}</span></td>
                  <td>{d.nombre}</td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{tamanoFmt(d.tamano)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{d.createdAt ? fFecha.format(new Date(d.createdAt)) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => void ver(d)}>Ver</button>
                    {puedeEscribir && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setBorrar(d)}>Borrar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {borrar && (
        <ConfirmDialog
          title="Eliminar documento"
          danger
          message={<>Se eliminará <strong>{borrar.nombre}</strong> ({TIPO_DOCUMENTO_LABEL[borrar.tipo]}). No se puede deshacer.</>}
          confirmText="Eliminar"
          onCancel={() => setBorrar(null)}
          onConfirm={() => void confirmarBorrar()}
        />
      )}
    </Modal>
  );
}
