/* ============================================================
   MGG · Usuarios > Roles y Permisos · «Usuarios autorizados para:»
   (28-10-2026)

   Lista de usuarios que pueden APROBAR órdenes de compra, salidas o ambas.
   Con «+ Agregar usuario» se elige la persona y lo que podrá aprobar; cada
   casilla se guarda sola. A cada uno se le carga su firma escaneada (PNG/JPG),
   que se estampa en las órdenes que apruebe.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Usuario } from '@/shared/lib/types';
import { listUsuarios } from './usuarios.repository';
import {
  OPCIONES_APROBACION,
  listAutorizados,
  guardarAutorizado,
  quitarAutorizado,
  subirFirma,
  quitarFirma,
  firmaDataUrlDePath,
  resumenAutorizacion,
  type PermisoAprobacion,
  type UsuarioAutorizado,
} from './autorizados.repository';

function nombreDe(u: Usuario | undefined, id: string): string {
  if (!u) return id.slice(0, 8);
  return `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim() || u.email;
}

/** Vista previa de la firma (se baja del bucket privado). */
function FirmaPreview({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    setUrl(null);
    if (path) void firmaDataUrlDePath(path).then((u) => { if (vivo) setUrl(u); });
    return () => { vivo = false; };
  }, [path]);
  if (!path) return <span className="muted" style={{ fontSize: '.75rem' }}>Sin firma cargada</span>;
  if (!url) return <span className="muted" style={{ fontSize: '.75rem' }}>Cargando firma…</span>;
  return (
    <img src={url} alt="Firma" style={{ maxHeight: 48, maxWidth: 150, background: '#fff', borderRadius: 4, border: '1px solid var(--border)', padding: 2 }} />
  );
}

export function UsuariosAutorizadosPanel({ readOnly = false, actorEmail }: { readOnly?: boolean; actorEmail: string }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [lista, setLista] = useState<UsuarioAutorizado[]>([]);
  const [loading, setLoading] = useState(true);
  const [agregando, setAgregando] = useState(false);
  const [nuevoId, setNuevoId] = useState('');
  const [nuevoOc, setNuevoOc] = useState(true);
  const [nuevoSal, setNuevoSal] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [quitar, setQuitar] = useState<UsuarioAutorizado | null>(null);

  async function refresh() {
    try {
      const [us, au] = await Promise.all([listUsuarios(), listAutorizados()]);
      setUsuarios(us);
      setLista(au);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cargar la lista de autorizados', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, []);
  useRealtime(['usuarios_autorizados'], () => { void refresh(); });

  const porId = useMemo(() => new Map(usuarios.map((u) => [u.id, u])), [usuarios]);
  const filas = useMemo(
    () => [...lista].sort((a, b) => nombreDe(porId.get(a.usuario_id), a.usuario_id).localeCompare(nombreDe(porId.get(b.usuario_id), b.usuario_id))),
    [lista, porId],
  );
  const disponibles = useMemo(() => {
    const ya = new Set(lista.map((a) => a.usuario_id));
    return usuarios
      .filter((u) => !ya.has(u.id) && !u.archivado_en && (u.estado ?? 'activo') === 'activo')
      .sort((a, b) => nombreDe(a, a.id).localeCompare(nombreDe(b, b.id)));
  }, [usuarios, lista]);

  async function cambiar(a: UsuarioAutorizado, key: PermisoAprobacion) {
    const next = { ...a, [key]: !a[key] };
    setLista((prev) => prev.map((x) => (x.usuario_id === a.usuario_id ? next : x)));
    try {
      await guardarAutorizado(a.usuario_id, { [key]: next[key] }, actorEmail);
    } catch (e) {
      setLista((prev) => prev.map((x) => (x.usuario_id === a.usuario_id ? a : x)));
      toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error');
    }
  }

  async function agregar() {
    if (!nuevoId) { toast('Elegí el usuario.', 'warning'); return; }
    if (!nuevoOc && !nuevoSal) { toast('Marcá al menos una opción: órdenes de compra, salidas o ambas.', 'warning'); return; }
    setBusy('nuevo');
    try {
      await guardarAutorizado(nuevoId, { aprobar_oc: nuevoOc, aprobar_salidas: nuevoSal }, actorEmail);
      toast(`${nombreDe(porId.get(nuevoId), nuevoId)} autorizado para: ${resumenAutorizacion({ aprobar_oc: nuevoOc, aprobar_salidas: nuevoSal }).toLowerCase()}`, 'success');
      setAgregando(false); setNuevoId(''); setNuevoOc(true); setNuevoSal(true);
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo agregar', 'error');
    } finally { setBusy(null); }
  }

  async function onFirma(a: UsuarioAutorizado, file: File | undefined) {
    if (!file) return;
    setBusy(a.usuario_id);
    try {
      await subirFirma(a, file, actorEmail);
      toast('Firma cargada', 'success');
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo subir la firma', 'error');
    } finally { setBusy(null); }
  }

  async function onQuitarFirma(a: UsuarioAutorizado) {
    setBusy(a.usuario_id);
    try { await quitarFirma(a, actorEmail); toast('Firma quitada', 'info'); await refresh(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo quitar la firma', 'error'); }
    finally { setBusy(null); }
  }

  async function confirmarQuitar() {
    if (!quitar) return;
    const a = quitar;
    setQuitar(null);
    try { await quitarAutorizado(a); toast('Usuario quitado de la lista de autorizados', 'info'); await refresh(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo quitar', 'error'); }
  }

  return (
    <section className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem', borderTop: '3px solid var(--primary, #ff8a00)' }} aria-labelledby="autorizados-titulo">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.75rem', flexWrap: 'wrap', marginBottom: '.75rem' }}>
        <div>
          <h3 id="autorizados-titulo" style={{ margin: 0 }}>✅ Usuarios autorizados para:</h3>
          <p className="hint muted" style={{ margin: '.25rem 0 0', fontSize: '.82rem' }}>
            Solo los usuarios de esta lista pueden <strong>aprobar órdenes de compra</strong>, <strong>aprobar salidas</strong> o ambas.
            Su firma cargada se estampa en las órdenes que aprueben. Lo ya aprobado no cambia.
          </p>
        </div>
        {!readOnly && !agregando && (
          <button id="btn-agregar-autorizado" type="button" className="btn btn-primary" onClick={() => setAgregando(true)}>+ Agregar usuario</button>
        )}
      </div>

      {agregando && (
        <div className="card" style={{ padding: '.9rem', marginBottom: '.9rem', display: 'grid', gap: '.6rem', background: 'var(--surface-2, transparent)' }}>
          <label htmlFor="autorizado-nuevo" style={{ fontSize: '.82rem', fontWeight: 600 }}>Usuario</label>
          <select id="autorizado-nuevo" className="select" value={nuevoId} onChange={(e) => setNuevoId(e.target.value)}>
            <option value="">— Elegí un usuario —</option>
            {disponibles.map((u) => (
              <option key={u.id} value={u.id}>{nombreDe(u, u.id)} · {u.email}</option>
            ))}
          </select>
          <div style={{ fontSize: '.82rem', fontWeight: 600 }}>Podrá:</div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <label htmlFor="autorizado-nuevo-oc" style={{ display: 'flex', gap: '.4rem', alignItems: 'center', fontSize: '.85rem', cursor: 'pointer' }}>
              <input id="autorizado-nuevo-oc" type="checkbox" checked={nuevoOc} onChange={() => setNuevoOc((v) => !v)} /> 🧾 Aprobar órdenes de compra
            </label>
            <label htmlFor="autorizado-nuevo-sal" style={{ display: 'flex', gap: '.4rem', alignItems: 'center', fontSize: '.85rem', cursor: 'pointer' }}>
              <input id="autorizado-nuevo-sal" type="checkbox" checked={nuevoSal} onChange={() => setNuevoSal((v) => !v)} /> 📤 Aprobar salidas
            </label>
          </div>
          <small className="muted">Marcá una o las dos (ambas opciones). La firma se carga después en su renglón.</small>
          <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => { setAgregando(false); setNuevoId(''); }}>Cancelar</button>
            <button id="btn-guardar-autorizado" type="button" className="btn btn-primary" disabled={busy === 'nuevo'} onClick={() => void agregar()}>
              {busy === 'nuevo' ? 'Guardando…' : 'Agregar'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="hint muted" style={{ margin: 0 }}>Cargando autorizados…</p>
      ) : !filas.length ? (
        <p className="hint muted" style={{ margin: 0 }}>Nadie autorizado todavía: nadie puede aprobar órdenes de compra ni salidas.</p>
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.84rem' }}>
            <thead>
              <tr>
                <th>Usuario</th>
                {OPCIONES_APROBACION.map((o) => <th key={o.key} style={{ textAlign: 'center' }}>{o.icono} {o.label}</th>)}
                <th>Firma</th>
                {!readOnly && <th />}
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => {
                const u = porId.get(a.usuario_id);
                const nada = !a.aprobar_oc && !a.aprobar_salidas;
                const inactivo = !!u && ((u.estado ?? 'activo') !== 'activo' || !!u.archivado_en);
                return (
                  <tr key={a.usuario_id}>
                    <td>
                      <strong>{nombreDe(u, a.usuario_id)}</strong>
                      <div className="muted" style={{ fontSize: '.74rem' }}>{u?.email ?? '—'}</div>
                      {nada && <small style={{ color: 'var(--warning)' }}>Sin opciones marcadas: no puede aprobar nada.</small>}
                      {inactivo && <small style={{ display: 'block', color: 'var(--danger)' }}>Usuario inactivo: no puede aprobar.</small>}
                    </td>
                    {OPCIONES_APROBACION.map((o) => (
                      <td key={o.key} style={{ textAlign: 'center' }}>
                        <input
                          id={`aut-${a.usuario_id}-${o.key}`}
                          type="checkbox"
                          disabled={readOnly}
                          checked={!!a[o.key]}
                          onChange={() => void cambiar(a, o.key)}
                          aria-label={`${o.label} para ${nombreDe(u, a.usuario_id)}`}
                        />
                      </td>
                    ))}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                        <FirmaPreview path={a.firma_path} />
                        {!readOnly && (
                          <>
                            <label className="btn btn-sm btn-ghost" htmlFor={`firma-${a.usuario_id}`} style={{ cursor: 'pointer' }}>
                              {busy === a.usuario_id ? 'Subiendo…' : a.firma_path ? '↻ Cambiar' : '⬆ Cargar firma'}
                            </label>
                            <input
                              id={`firma-${a.usuario_id}`}
                              type="file"
                              accept="image/png,image/jpeg"
                              style={{ display: 'none' }}
                              disabled={busy === a.usuario_id}
                              onChange={(e) => { void onFirma(a, e.target.files?.[0]); e.target.value = ''; }}
                            />
                            {a.firma_path && (
                              <button type="button" className="btn btn-sm btn-ghost" disabled={busy === a.usuario_id} onClick={() => void onQuitarFirma(a)} title="Quitar la firma">✕</button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    {!readOnly && (
                      <td style={{ textAlign: 'right' }}>
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => setQuitar(a)} title="Quitar de la lista">🗑 Quitar</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {quitar && (
        <ConfirmDialog
          title="Quitar usuario autorizado"
          message={`${nombreDe(porId.get(quitar.usuario_id), quitar.usuario_id)} ya no podrá aprobar órdenes de compra ni salidas, y se borra su firma cargada. Lo que ya aprobó queda igual. ¿Continuar?`}
          confirmText="Quitar"
          danger
          onCancel={() => setQuitar(null)}
          onConfirm={() => void confirmarQuitar()}
        />
      )}
    </section>
  );
}
