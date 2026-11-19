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
import { Iniciales } from '@/shared/ui/Iniciales';
import { useSession } from '@/modules/auth/authStore';
import { useRealtime } from '@/shared/lib/useRealtime';
import { mensajeError } from '@/shared/lib/errores';
import type { Usuario } from '@/shared/lib/types';
import { colorRol, listUsuarios } from './usuarios.repository';
import {
  useAutorizados, guardarAutorizado, quitarAutorizado, prepararFirma,
} from './autorizados.repository';
import { OPCIONES_AUTORIZACION, tienePermiso, type PermisoAutorizado, type UsuarioAutorizado } from './autorizados';

type Alcance = 'oc' | 'salidas' | 'ambas';
const ALCANCES: { key: Alcance; label: string; detalle: string }[] = [
  { key: 'oc', label: 'Aprobar órdenes de compra', detalle: 'Solo firma/aprueba las OC.' },
  { key: 'salidas', label: 'Aprobar salidas', detalle: 'Solo aprueba órdenes de salida, traslados y salidas temporales.' },
  { key: 'ambas', label: 'Ambas opciones', detalle: 'Aprueba órdenes de compra y salidas.' },
];
const flagsDe = (a: Alcance) => ({ aprobar_oc: a !== 'salidas', aprobar_salidas: a !== 'oc' });

type Firma = { dataUrl: string; w: number; h: number };

export function UsuariosAutorizadosPanel({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useSession();
  const actor = user?.email ?? 'sistema';
  const lista = useAutorizados();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [agregar, setAgregar] = useState(false);
  const [aQuitar, setAQuitar] = useState<UsuarioAutorizado | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /* Plegado por defecto: se recuerda en localStorage */
  const [abierto, setAbierto] = useState(() => {
    try { return localStorage.getItem('mgg.usuarios.v1.autorizados') === 'abierto'; }
    catch { return false; }
  });
  const cambiarAbierto = (v: boolean) => {
    setAbierto(v);
    try { localStorage.setItem('mgg.usuarios.v1.autorizados', v ? 'abierto' : 'cerrado'); }
    catch { /* no es crítico */ }
  };
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
    return n || email;
  };

  async function cambiarOpcion(a: UsuarioAutorizado, permiso: PermisoAutorizado) {
    const next = { aprobar_oc: a.aprobar_oc, aprobar_salidas: a.aprobar_salidas, aprobar_despachos: !!a.aprobar_despachos };
    if (permiso === 'oc') next.aprobar_oc = !next.aprobar_oc;
    else if (permiso === 'salidas') next.aprobar_salidas = !next.aprobar_salidas;
    else next.aprobar_despachos = !next.aprobar_despachos;
    if (!next.aprobar_oc && !next.aprobar_salidas && !next.aprobar_despachos) {
      toast('Debe quedar al menos una opción. Para quitarle todo, usa «Quitar».', 'info');
      return;
    }
    setBusy(a.email);
    try {
      await guardarAutorizado({ email: a.email, ...next }, actor);
    } catch (e) { toast(mensajeError(e, 'No se pudo guardar la autorización'), 'error'); }
    finally { setBusy(null); }
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
    } catch (e) { toast(mensajeError(e, 'No se pudo cargar la firma'), 'error'); }
    finally { setBusy(null); }
  }

  async function borrarFirma(a: UsuarioAutorizado) {
    setBusy(a.email);
    try {
      await guardarAutorizado({ email: a.email, firma: null, firma_w: null, firma_h: null }, actor);
      toast('Firma quitada. Sus órdenes nuevas saldrán sin firma cargada.', 'info');
    } catch (e) { toast(mensajeError(e, 'No se pudo quitar la firma'), 'error'); }
    finally { setBusy(null); }
  }

  async function confirmarQuitar(a: UsuarioAutorizado) {
    try {
      await quitarAutorizado(a.email);
      notify(`${nombreDe(a.email)} ya no está autorizado para aprobar`, 'success', { link: '#/app/usuarios' });
      setAQuitar(null);
    } catch (e) { toast(mensajeError(e, 'No se pudo quitar'), 'error'); }
  }

  const yaEnLista = new Set((lista ?? []).map((a) => a.email.toLowerCase()));
  const sinFirma = (lista ?? []).filter((a) => !a.firma).length;

  return (
    <section className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem', borderTop: '3px solid var(--primary, #ff8a00)' }} aria-labelledby="autorizados-titulo">
      <button
        type="button" className="aut-head" aria-expanded={abierto}
        aria-controls="autorizados-cuerpo" onClick={() => cambiarAbierto(!abierto)}
      >
        <span className="aut-head-flecha" aria-hidden="true">▸</span>
        <h3 id="autorizados-titulo">✅ Quién puede aprobar</h3>
        <span className="aut-head-resumen">
          {lista === null ? (
            <span className="muted" style={{ fontSize: '.78rem' }}>Cargando…</span>
          ) : !lista.length ? (
            <span className="badge danger">Nadie autorizado</span>
          ) : (
            <>
              <span className="badge">{lista.length} autorizado(s)</span>
              {sinFirma > 0
                ? <span className="badge warning">⚠ {sinFirma} sin firma</span>
                : <span className="badge success">✓ Todos con firma</span>}
            </>
          )}
        </span>
      </button>

      {abierto && (
      <div id="autorizados-cuerpo" className="aut-cuerpo">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.75rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
        <p className="muted" style={{ margin: 0, fontSize: '.84rem', maxWidth: 720 }}>
          Solo estos usuarios pueden <strong>aprobar órdenes de compra</strong> y/o
          <strong> órdenes de salida</strong>. Su firma cargada se estampa en las órdenes que aprueben.
          Las aprobaciones ya realizadas no cambian.
        </p>
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
          Aún no hay usuarios autorizados: nadie puede aprobar (tampoco el administrador). Usa «+ Agregar usuario autorizado».
        </p>
      ) : (
        <>
          <div className="aut-resumen">
            <span className="badge">{lista.length} autorizado(s)</span>
            {sinFirma > 0
              ? <span className="badge warning">⚠ {sinFirma} sin firma cargada</span>
              : <span className="badge success">✓ Todos con firma</span>}
          </div>

          <div className="aut-grid">
            {lista.map((a) => {
              const ocupado = busy === a.email;
              const nombre = nombreDe(a.email);
              const u = porEmail.get(a.email.toLowerCase());
              return (
                <article key={a.email} className={`aut-ficha${a.firma ? '' : ' sin-firma'}`}>
                  <header className="aut-persona">
                    <Iniciales
                      nombre={u?.nombre ?? nombre} apellido={u?.apellido} respaldo={a.email}
                      color={colorRol(u?.role)}
                    />
                    <div className="aut-persona-datos">
                      <span className="aut-persona-nombre">{nombre}</span>
                      <span className="aut-persona-correo">{a.email}</span>
                    </div>
                    {!readOnly && (
                      <button
                        id={`aut-quitar-${a.email}`} type="button" className="btn btn-sm btn-danger"
                        disabled={ocupado} onClick={() => setAQuitar(a)}
                        aria-label={`Quitar a ${nombre} de los autorizados`}
                      >
                        Quitar
                      </button>
                    )}
                  </header>

                  <div>
                    <div className="aut-bloque-titulo">Puede aprobar</div>
                    <div className="aut-opciones">
                      {OPCIONES_AUTORIZACION.map((o) => {
                        const marcado = tienePermiso(a, o.key);
                        return (
                          <label
                            key={o.key} htmlFor={`aut-${o.key}-${a.email}`}
                            className={`aut-opcion${readOnly ? ' quieta' : ''}`}
                          >
                            <input
                              id={`aut-${o.key}-${a.email}`} type="checkbox" checked={marcado}
                              disabled={readOnly || ocupado} onChange={() => void cambiarOpcion(a, o.key)}
                              aria-label={`${o.label} · ${nombre}`}
                            />
                            <span>{o.icono} {o.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="aut-bloque-titulo">Firma que se estampa</div>
                    <div className="aut-firma">
                      {a.firma ? (
                        <span className="aut-firma-lienzo">
                          <img src={a.firma} alt={`Firma de ${nombre}`} />
                        </span>
                      ) : (
                        <span className="aut-firma-vacio">Sin firma cargada</span>
                      )}
                      {!readOnly && (
                        <div className="aut-firma-acciones">
                          <button id={`aut-firma-${a.email}`} type="button" className="btn btn-sm btn-ghost" disabled={ocupado} onClick={() => pedirFirma(a.email)}>
                            {ocupado ? '…' : a.firma ? '✎ Cambiar' : '⬆ Cargar firma'}
                          </button>
                          {a.firma && (
                            <button type="button" className="btn btn-sm btn-ghost" disabled={ocupado} onClick={() => void borrarFirma(a)} title="Quitar la firma cargada">
                              ✕ Quitar firma
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {!a.firma && (
                      <small className="muted" style={{ fontSize: '.74rem' }}>
                        Lo que apruebe saldrá sin firma estampada.
                      </small>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
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

interface AgregarProps {
  usuarios: Usuario[];
  actor: string;
  onClose: () => void;
  onGuardado: (email: string) => void;
}

function AgregarAutorizadoModal({ usuarios, actor, onClose, onGuardado }: AgregarProps) {
  const [email, setEmail] = useState('');
  const [alcance, setAlcance] = useState<Alcance>('ambas');
  const [firma, setFirma] = useState<Firma | null>(null);
  const [guardando, setGuardando] = useState(false);

  const opciones = useMemo(
    () => usuarios.map((u) => ({
      value: (u.email ?? '').toLowerCase(),
      label: [u.nombre, u.apellido].filter(Boolean).join(' ') ? `${[u.nombre, u.apellido].filter(Boolean).join(' ')} (${u.email})` : (u.email ?? ''),
    })),
    [usuarios],
  );

  async function elegirFirma(file: File | undefined) {
    if (!file) return;
    try { setFirma(await prepararFirma(file)); }
    catch (e) { toast(mensajeError(e, 'No se pudo leer la firma'), 'error'); }
  }

  async function guardar() {
    if (!email) { toast('Elige un usuario', 'error'); return; }
    setGuardando(true);
    try {
      await guardarAutorizado({
        email, ...flagsDe(alcance),
        firma: firma?.dataUrl ?? null, firma_w: firma?.w ?? null, firma_h: firma?.h ?? null,
      }, actor);
      onGuardado(email);
    } catch (e) {
      toast(mensajeError(e, 'No se pudo agregar'), 'error');
    } finally { setGuardando(false); }
  }

  return (
    <Modal
      title="Agregar usuario autorizado" size="md" onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => void guardar()} disabled={guardando || !email}>
            {guardando ? 'Guardando…' : 'Autorizar'}
          </button>
        </>
      }
    >
      <div className="form-row">
        <label>Usuario *</label>
        {opciones.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: '.84rem' }}>
            No hay más usuarios activos disponibles para autorizar.
          </p>
        ) : (
          <SearchSelect
            options={opciones} value={email} onChange={setEmail}
            placeholder="Buscar por nombre o correo…" disabled={guardando}
          />
        )}
      </div>

      <div className="form-row">
        <label>¿Qué puede aprobar?</label>
        <div style={{ display: 'grid', gap: '.4rem' }}>
          {ALCANCES.map((a) => (
            <label key={a.key} className="rol-opcion" style={{ cursor: 'pointer' }}>
              <input
                type="radio" name="aut-alcance" checked={alcance === a.key}
                onChange={() => setAlcance(a.key)} disabled={guardando}
              />
              <span>
                <strong>{a.label}</strong>
                <small className="muted">{a.detalle}</small>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="form-row">
        <label>Firma manuscrita (opcional)</label>
        <p className="muted" style={{ marginTop: 0, fontSize: '.8rem' }}>
          PNG con fondo transparente. Se estampará en las órdenes que apruebe. Si no se carga ahora, se puede subir después.
        </p>
        <input
          type="file" accept="image/png,image/jpeg,image/webp" disabled={guardando}
          onChange={(e) => void elegirFirma(e.target.files?.[0])}
        />
        {firma && (
          <div style={{ marginTop: '.6rem', textAlign: 'center' }}>
            <span className="aut-firma-lienzo" style={{ display: 'inline-grid' }}>
              <img src={firma.dataUrl} alt="Vista previa de la firma" />
            </span>
            <div className="muted" style={{ fontSize: '.74rem', marginTop: '.2rem' }}>
              {firma.w} × {firma.h} px
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
