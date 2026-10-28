/* ============================================================
   MGG · Roles y Permisos › «Usuarios autorizados para:»
   Lista de usuarios que pueden APROBAR Órdenes de Compra, Órdenes
   de Salida, o ambas, con su firma cargada para estamparla en las
   órdenes que aprueben. Todo se guarda solo (sin botón Guardar).
   Quitar a alguien NO borra lo que ya aprobó.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { useSession } from '@/modules/auth/authStore';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Usuario } from '@/shared/lib/types';
import { listUsuarios } from './usuarios.repository';
import {
  useAutorizados, guardarAutorizado, quitarAutorizado, prepararFirma,
} from './autorizados.repository';
import { OPCIONES_AUTORIZACION, resumenAutorizacion, type PermisoAutorizado, type UsuarioAutorizado } from './autorizados';

type Alcance = 'oc' | 'salidas' | 'ambas';
const ALCANCES: { key: Alcance; label: string; detalle: string }[] = [
  { key: 'oc', label: 'Aprobar órdenes de compra', detalle: 'Solo firma/aprueba las OC.' },
  { key: 'salidas', label: 'Aprobar salidas', detalle: 'Solo aprueba órdenes de salida, traslados y salidas temporales.' },
  { key: 'ambas', label: 'Ambas opciones', detalle: 'Aprueba órdenes de compra y salidas.' },
];
const flagsDe = (a: Alcance) => ({ aprobar_oc: a !== 'salidas', aprobar_salidas: a !== 'oc' });

type Firma = { dataUrl: string; w: number; h: number };

export function UsuariosAutorizadosPanel({ readOnly = false }: { readOnly?: boolean; actorEmail?: string }) {
  const { user } = useSession();
  const actor = user?.email ?? 'sistema';
  const lista = useAutorizados();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [agregar, setAgregar] = useState(false);
  const [aQuitar, setAQuitar] = useState<UsuarioAutorizado | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [firmaPara, setFirmaPara] = useState<string | null>(null);

  const cargarUsuarios = () => { listUsuarios().then(setUsuarios).catch(() => undefined); };
  useEffect(cargarUsuarios, []);
  useRealtime(['usuarios'], cargarUsuarios);

  const porEmail = useMemo(() => {
    const m = new Map<string, Usuario>();
    usuarios.forEach((u) => { if (u.email) m.set(u.email.toLowerCase(), u); });
    return m;
  }, [usuarios]);
  const nombreDe = (email: string) => {
    const u = porEmail.get(email.toLowerCase());
    const n = u ? [u.nombre, u.apellido].filter(Boolean).join(' ').trim() : '';
    return (n || email).toUpperCase();
  };

  async function cambiarOpcion(a: UsuarioAutorizado, permiso: PermisoAutorizado) {
    const next = { aprobar_oc: a.aprobar_oc, aprobar_salidas: a.aprobar_salidas };
    if (permiso === 'oc') next.aprobar_oc = !next.aprobar_oc; else next.aprobar_salidas = !next.aprobar_salidas;
    if (!next.aprobar_oc && !next.aprobar_salidas) {
      toast('Debe quedar al menos una opción. Para quitarle todo, usa «Quitar».', 'info');
      return;
    }
    setBusy(a.email);
    try {
      await guardarAutorizado({ email: a.email, ...next }, actor);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo guardar la autorización', 'error');
    } finally { setBusy(null); }
  }

  function pedirFirma(email: string) {
    setFirmaPara(email);
    fileRef.current?.click();
  }

  async function onArchivoFirma(file: File | undefined) {
    const email = firmaPara;
    if (fileRef.current) fileRef.current.value = '';
    setFirmaPara(null);
    if (!file || !email) return;
    setBusy(email);
    try {
      const f = await prepararFirma(file);
      await guardarAutorizado({ email, firma: f.dataUrl, firma_w: f.w, firma_h: f.h }, actor);
      notify(`Firma cargada para ${nombreDe(email)}`, 'success', { link: '#/app/usuarios' });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cargar la firma', 'error');
    } finally { setBusy(null); }
  }

  async function borrarFirma(a: UsuarioAutorizado) {
    setBusy(a.email);
    try {
      await guardarAutorizado({ email: a.email, firma: null, firma_w: null, firma_h: null }, actor);
      toast('Firma quitada. Sus órdenes nuevas saldrán sin firma cargada.', 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo quitar la firma', 'error');
    } finally { setBusy(null); }
  }

  async function confirmarQuitar(a: UsuarioAutorizado) {
    try {
      await quitarAutorizado(a.email);
      notify(`${nombreDe(a.email)} ya no está autorizado para aprobar`, 'success', { link: '#/app/usuarios' });
      setAQuitar(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo quitar', 'error');
    }
  }

  const yaEnLista = new Set((lista ?? []).map((a) => a.email.toLowerCase()));

  return (
    <section className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem', borderTop: '3px solid var(--primary, #ff8a00)' }} aria-labelledby="autorizados-titulo">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.75rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
        <div>
          <h3 id="autorizados-titulo" style={{ margin: 0 }}>✅ Usuarios autorizados para:</h3>
          <p className="muted" style={{ margin: '.25rem 0 0', fontSize: '.84rem', maxWidth: 720 }}>
            Solo estos usuarios (y el administrador) pueden <strong>aprobar órdenes de compra</strong> y/o{' '}
            <strong>órdenes de salida</strong>. Su firma cargada se estampa en las órdenes que aprueben.
            Las aprobaciones ya realizadas no cambian.
          </p>
        </div>
        {!readOnly && (
          <button id="autorizados-agregar" type="button" className="btn btn-primary" onClick={() => setAgregar(true)}>
            + Agregar usuario autorizado
          </button>
        )}
      </div>

      <input
        ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }}
        onChange={(e) => void onArchivoFirma(e.target.files?.[0])} aria-label="Archivo de firma"
      />

      {lista === null ? (
        <p className="muted" style={{ margin: 0 }}>Cargando usuarios autorizados…</p>
      ) : !lista.length ? (
        <p className="muted" style={{ margin: 0 }}>
          Aún no hay usuarios autorizados: solo el administrador puede aprobar. Usa «+ Agregar usuario autorizado».
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.84rem' }}>
            <thead>
              <tr>
                <th>USUARIO</th>
                {OPCIONES_AUTORIZACION.map((o) => (
                  <th key={o.key} style={{ textAlign: 'center' }}>{o.icono} {o.label}</th>
                ))}
                <th style={{ textAlign: 'center' }}>FIRMA</th>
                {!readOnly && <th />}
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => {
                const ocupado = busy === a.email;
                return (
                  <tr key={a.email}>
                    <td>
                      <strong>{nombreDe(a.email)}</strong>
                      <div className="muted" style={{ fontSize: '.74rem' }}>{a.email} · {resumenAutorizacion(a)}</div>
                    </td>
                    {OPCIONES_AUTORIZACION.map((o) => {
                      const marcado = o.key === 'oc' ? a.aprobar_oc : a.aprobar_salidas;
                      return (
                        <td key={o.key} style={{ textAlign: 'center' }}>
                          <input
                            id={`aut-${o.key}-${a.email}`} type="checkbox" checked={marcado}
                            disabled={readOnly || ocupado} onChange={() => void cambiarOpcion(a, o.key)}
                            aria-label={`${o.label} · ${nombreDe(a.email)}`}
                          />
                        </td>
                      );
                    })}
                    <td style={{ textAlign: 'center' }}>
                      {a.firma ? (
                        <img
                          src={a.firma} alt={`Firma de ${nombreDe(a.email)}`}
                          style={{ maxHeight: 44, maxWidth: 140, background: '#fff', borderRadius: 6, padding: 2, border: '1px solid var(--border)' }}
                        />
                      ) : <span className="muted" style={{ fontSize: '.76rem' }}>Sin firma</span>}
                      {!readOnly && (
                        <div style={{ display: 'flex', gap: '.3rem', justifyContent: 'center', marginTop: '.3rem', flexWrap: 'wrap' }}>
                          <button id={`aut-firma-${a.email}`} type="button" className="btn btn-sm btn-ghost" disabled={ocupado} onClick={() => pedirFirma(a.email)}>
                            {ocupado ? '…' : a.firma ? '✎ Cambiar' : '⬆ Cargar firma'}
                          </button>
                          {a.firma && (
                            <button type="button" className="btn btn-sm btn-ghost" disabled={ocupado} onClick={() => void borrarFirma(a)} title="Quitar la firma cargada">✕</button>
                          )}
                        </div>
                      )}
                    </td>
                    {!readOnly && (
                      <td style={{ textAlign: 'right' }}>
                        <button
                          id={`aut-quitar-${a.email}`}
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          style={{ color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.4)', borderRadius: '9999px', padding: '0.2rem 0.75rem' }}
                          disabled={ocupado}
                          onClick={() => setAQuitar(a)}
                        >
                          Quitar
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {agregar && (
        <AgregarAutorizadoModal
          usuarios={usuarios.filter((u) => u.email && u.estado === 'activo' && !yaEnLista.has(u.email.toLowerCase()))}
          actor={actor}
          onClose={() => setAgregar(false)}
          onGuardado={(email) => {
            setAgregar(false);
            notify(`${nombreDe(email)} quedó autorizado para aprobar`, 'success', { link: '#/app/usuarios' });
          }}
        />
      )}

      {aQuitar && (
        <ConfirmDialog
          title="Quitar usuario autorizado"
          message={`${nombreDe(aQuitar.email)} ya no podrá aprobar órdenes de compra ni de salida. Lo que ya aprobó se conserva con su firma. ¿Continuar?`}
          confirmText="Quitar"
          danger
          onCancel={() => setAQuitar(null)}
          onConfirm={() => void confirmarQuitar(aQuitar)}
        />
      )}
    </section>
  );
}

function AgregarAutorizadoModal({
  usuarios, actor, onClose, onGuardado,
}: {
  usuarios: Usuario[];
  actor: string;
  onClose: () => void;
  onGuardado: (email: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [alcance, setAlcance] = useState<Alcance>('ambas');
  const [firma, setFirma] = useState<Firma | null>(null);
  const [guardando, setGuardando] = useState(false);

  const opciones = usuarios
    .map((u) => ({
      value: u.email.toLowerCase(),
      label: [u.nombre, u.apellido].filter(Boolean).join(' ').trim() || u.email,
      hint: u.email,
      keywords: [String(u.role ?? ''), u.departamento ?? ''],
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es'));

  async function elegirFirma(file: File | undefined) {
    if (!file) return;
    try { setFirma(await prepararFirma(file)); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo leer la firma', 'error'); }
  }

  async function guardar() {
    if (!email) { toast('Elige el usuario', 'error'); return; }
    setGuardando(true);
    try {
      await guardarAutorizado({
        email, ...flagsDe(alcance),
        ...(firma ? { firma: firma.dataUrl, firma_w: firma.w, firma_h: firma.h } : {}),
      }, actor);
      onGuardado(email);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo agregar', 'error');
    } finally { setGuardando(false); }
  }

  return (
    <Modal
      title="+ Agregar usuario autorizado"
      compact
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button id="autorizado-guardar" type="button" className="btn btn-primary" disabled={guardando || !email} onClick={() => void guardar()}>
            {guardando ? 'Guardando…' : 'Autorizar'}
          </button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: '1rem' }}>
        <label style={{ display: 'grid', gap: '.35rem' }}>
          <span style={{ fontWeight: 600 }}>Usuario</span>
          <SearchSelect
            id="autorizado-usuario" options={opciones} value={email} onChange={setEmail}
            placeholder="Buscar usuario por nombre o correo…" emptyText="No hay usuarios activos sin autorizar"
          />
        </label>

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '.45rem' }}>
          <legend style={{ fontWeight: 600, marginBottom: '.35rem' }}>Podrá:</legend>
          {ALCANCES.map((o) => (
            <label
              key={o.key} htmlFor={`autorizado-alcance-${o.key}`}
              style={{
                display: 'flex', gap: '.6rem', alignItems: 'flex-start', cursor: 'pointer', padding: '.6rem .75rem',
                borderRadius: 10, border: `1px solid ${alcance === o.key ? 'var(--primary, #ff8a00)' : 'var(--border)'}`,
                background: alcance === o.key ? 'color-mix(in srgb, var(--primary, #ff8a00) 8%, transparent)' : undefined,
                transition: 'border-color .15s, background .15s',
              }}
            >
              <input id={`autorizado-alcance-${o.key}`} type="radio" name="autorizado-alcance" checked={alcance === o.key} onChange={() => setAlcance(o.key)} />
              <span>
                <strong>{o.label}</strong>
                <small className="muted" style={{ display: 'block' }}>{o.detalle}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <div style={{ display: 'grid', gap: '.4rem' }}>
          <span style={{ fontWeight: 600 }}>Firma <small className="muted" style={{ fontWeight: 400 }}>(PNG o JPG; el fondo blanco se vuelve transparente)</small></span>
          <input id="autorizado-firma" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void elegirFirma(e.target.files?.[0])} />
          {firma && (
            <img src={firma.dataUrl} alt="Vista previa de la firma" style={{ maxHeight: 90, maxWidth: 260, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: 4 }} />
          )}
          {!firma && <small className="muted">Puedes cargarla ahora o después desde la lista.</small>}
        </div>
      </div>
    </Modal>
  );
}
