/* ============================================================
   Golden Touch · Retenciones · Parámetros: Perfiles fiscales de proveedores (R1)
   Lista de proveedores (los incompletos primero, con lo que les falta) y el
   perfil de cada uno por versiones. La ficha del proveedor (razón social, RIF,
   teléfonos) es de solo lectura aquí: se corrige en Proveedores.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { useRealtime } from '@/shared/lib/useRealtime';
import { etiquetaActividad } from '@/modules/proveedores/actividadesEconomicas';
import { useActividadesEconomicas } from '@/modules/proveedores/actividadesEconomicas.repository';
import { labelSujeto } from './retencionesCalculo';
import { paginar } from './listas';
import { Paginador } from './ListaControles';
import { listEntes, type Ente } from './entes.repository';
import { codigosDeEnte, r4Disponible, type CodigoClasificacion } from './clasificaciones.repository';
import {
  ESTADOS_LICENCIA, TEXTO_FALTA, agregarActividad, anotarPerfil, bajaActividad, faltaEnActividad, faltaEnPerfil,
  filtrarPerfiles, guardarPerfil, listActividades, listPerfiles, marcarPrincipal, perfilVigente, pideLicencia,
  sujetoDelPerfil, versionesPerfil, type ActividadContraparte, type EstadoLicencia, type FilaPerfil,
  type PerfilFiscal, type PerfilNuevo, type TipoContribuyente,
} from './perfilesFiscales.repository';
import {
  LABEL_LICENCIA, TIPOS_CONTRIBUYENTE, desdeMinimo, fechaCorta, filtrarPorCompleto, labelContribuyente,
  perfilInicial, sugerenciaDistinta, type FiltroCompleto,
} from './parametrosR1';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { listTiposLicencia } from './retencionesFiscal.repository';
import { normalizarCodigo, pistaClave } from './parametrosNumeros';
import { rotuloAutor, rotuloMotivo } from './rotulos';

/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;
const mensaje = (e: unknown, d: string) => (e instanceof Error ? e.message : d);

export function ParametrosPerfiles({ puedeEditar, onIrALicencias }: {
  puedeEditar: boolean;
  /** Lleva a Parámetros › Tipos de licencia (cuando el catálogo está vacío). */
  onIrALicencias?: () => void;
}) {
  const [filas, setFilas] = useState<FilaPerfil[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<FiltroCompleto>('todos');
  const [pag, setPag] = useState(1);
  const [tam, setTam] = useState(25);
  const [abierto, setAbierto] = useState<FilaPerfil | null>(null);

  const cargar = useCallback(async () => {
    try { setFilas(await listPerfiles()); setError(null); } catch (e) { setError(mensaje(e, 'No se pudieron leer los perfiles.')); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['retencion_contraparte_perfiles', 'retencion_contraparte_actividades', 'proveedores'], () => { void cargar(); });
  useEffect(() => { setPag(1); }, [q, filtro]);

  const visibles = useMemo(() => filtrarPorCompleto(filtrarPerfiles(filas ?? [], { texto: q }), filtro), [filas, q, filtro]);
  const pagina = paginar(visibles, pag, tam);
  const incompletos = (filas ?? []).filter((f) => !f.completo).length;

  return (
    <div>
      <p className="muted" style={{ fontSize: '.84rem', marginTop: 0 }}>
        Los datos fiscales de cada proveedor que deciden qué se le retiene. Cada cambio es una versión desde una fecha: las retenciones ya registradas conservan los datos con que se emitieron.
      </p>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.5rem' }}>
        <input className="input" style={{ flex: '1 1 240px', maxWidth: 360 }} placeholder="Buscar proveedor o RIF" aria-label="Buscar proveedor o RIF"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <div role="group" aria-label="Estado del perfil" style={{ display: 'flex', gap: '.3rem' }}>
          {([['todos', 'Todos'], ['incompletos', `Incompletos (${incompletos})`], ['completos', 'Completos']] as [FiltroCompleto, string][]).map(([k, l]) => (
            <button key={k} type="button" className={`btn btn-sm ${filtro === k ? 'btn-primary' : ''}`} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>{l}</button>
          ))}
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          {error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()}>Reintentar</button>
        </div>
      )}
      {!filas && !error && <p className="muted">Leyendo los proveedores…</p>}
      {filas && visibles.length === 0 && <p className="muted">Ningún proveedor coincide.</p>}

      {pagina.filas.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: '.82rem', width: '100%' }}>
            <thead>
              <tr><th>Proveedor</th><th>Sujeto</th><th>Contribuyente</th><th>Actividades</th><th>Licencia</th><th>Falta</th><th aria-label="Acciones" /></tr>
            </thead>
            <tbody>
              {pagina.filas.map((r) => (
                <tr key={r.proveedorId}>
                  <td><strong>{r.razonSocial}</strong><div className="muted mono" style={{ fontSize: '.74rem' }}>{r.rif ?? 'Sin RIF'}</div></td>
                  <td>{r.sujeto ? labelSujeto(r.sujeto) : '—'}</td>
                  <td>{labelContribuyente(r.tipoContribuyente)}</td>
                  <td>{r.actividades}</td>
                  <td>
                    {r.licenciaEstado ? LABEL_LICENCIA[r.licenciaEstado] : '—'}
                    {r.licenciaVence && <div className="muted" style={{ fontSize: '.74rem' }}>Vence {fechaCorta(r.licenciaVence)}</div>}
                    {pideLicencia(r) && (
                      <div style={{ fontSize: '.74rem' }}>
                        {r.telefonoAdministracion ? <>Administración: <a href={`tel:${r.telefonoAdministracion}`}>{r.telefonoAdministracion}</a></> : <span className="muted">Sin teléfono de administración</span>}
                      </div>
                    )}
                  </td>
                  <td>
                    {r.completo ? <span style={{ color: 'var(--success)' }}>Completo</span>
                      : r.faltan.map((f) => <span key={f} className="lfv8-pill falta" style={{ marginRight: '.2rem' }}>{TEXTO_FALTA[f]}</span>)}
                  </td>
                  <td><button type="button" className="btn btn-sm" onClick={() => setAbierto(r)}>{puedeEditar ? 'Editar' : 'Ver'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Paginador pagina={pagina} tam={tam} unidad="proveedores" onPagina={setPag} onTam={(t) => { setTam(t); setPag(1); }} />
        </div>
      )}

      {abierto && (
        <PerfilFiscalModal fila={abierto} puedeEditar={puedeEditar} onIrALicencias={onIrALicencias}
          onClose={() => setAbierto(null)} onCambio={() => void cargar()} />
      )}
    </div>
  );
}

export function PerfilFiscalModal({ fila, puedeEditar, onClose, onCambio, onIrALicencias }: {
  fila: FilaPerfil;
  puedeEditar: boolean;
  onClose: () => void;
  onCambio: () => void;
  /** Lleva a Parámetros › Tipos de licencia (cuando el catálogo está vacío). */
  onIrALicencias?: () => void;
}) {
  const [versiones, setVersiones] = useState<PerfilFiscal[] | null>(null);
  const [actividades, setActividades] = useState<ActividadContraparte[]>([]);
  const [municipales, setMunicipales] = useState<Ente[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<PerfilNuevo>(perfilInicial(null));
  const [desde, setDesde] = useState(hoyIso());
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  // El tipo de licencia tiene que estar activo en el catálogo (la base lo exige): se ofrece la lista y se avisa antes.
  const [tiposLicencia, setTiposLicencia] = useState<string[] | null>(null);
  useEffect(() => {
    listTiposLicencia().then((ts) => setTiposLicencia(ts.filter((t) => t.activo).map((t) => t.nombre))).catch(() => setTiposLicencia(null));
  }, []);

  const recargar = useCallback(async () => {
    try {
      const [vs, acts, entes] = await Promise.all([versionesPerfil(fila.proveedorId), listActividades(fila.proveedorId), listEntes()]);
      setVersiones(vs); setActividades(acts);
      setMunicipales(entes.filter((e) => e.tipo === 'municipal' && e.activo));
      setError(null);
      return vs;
    } catch (e) {
      setError(mensaje(e, 'No se pudo leer el perfil.'));
      return null;
    }
  }, [fila.proveedorId]);

  useEffect(() => {
    void recargar().then((vs) => {
      if (!vs) return;
      const vig = perfilVigente(vs);
      setForm(perfilInicial(vig));
      const minimo = desdeMinimo(vs[0] ?? null);
      setDesde(minimo && minimo > hoyIso() ? minimo : hoyIso());
      setMotivo(vs.length ? '' : 'Alta del perfil');
    });
  }, [recargar]);

  const vigente = versiones ? perfilVigente(versiones) : null;
  const minimo = desdeMinimo(versiones?.[0] ?? null);
  const sugerencia = sugerenciaDistinta(fila.rif, form);
  const falta = faltaEnPerfil(form, desde, motivo, tiposLicencia) ?? (minimo && desde < minimo ? `La versión nueva tiene que empezar el ${fechaCorta(minimo)} o después.` : null);
  const set = (patch: Partial<PerfilNuevo>) => setForm((f) => ({ ...f, ...patch }));

  async function guardar() {
    if (falta) { setError(falta); return; }
    setGuardando(true); setError(null);
    try {
      await guardarPerfil(fila.proveedorId, form, desde, motivo);
      toast('Perfil fiscal guardado.', 'success');
      onCambio();
      const vs = await recargar();
      if (vs) { setMotivo(''); const m = desdeMinimo(vs[0] ?? null); if (m) setDesde(m > hoyIso() ? m : hoyIso()); }
    } catch (e) {
      setError(mensaje(e, 'No se pudo guardar el perfil.'));
    } finally {
      setGuardando(false);
    }
  }

  async function marcarSolicitado() {
    if (!vigente) return;
    try {
      await anotarPerfil(vigente.id, { datosSolicitadosEn: new Date().toISOString() });
      toast('Anotado: datos pedidos hoy al proveedor.', 'success');
      onCambio(); void recargar();
    } catch (e) { toast(mensaje(e, 'No se pudo anotar.'), 'error'); }
  }

  return (
    <Modal title={`Perfil fiscal · ${fila.razonSocial}`} size="xl" onClose={() => !guardando && onClose()}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cerrar</button>
          {puedeEditar && (
            <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={guardando || !!falta || !versiones}>
              {guardando ? 'Guardando…' : vigente ? 'Guardar versión nueva' : 'Guardar perfil'}
            </button>
          )}
        </>
      )}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}>{error}</div>}

      {/* Ficha del proveedor: solo lectura */}
      <div className="card" style={{ marginBottom: '.6rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '.84rem' }}>
            <strong>{fila.razonSocial}</strong> · <span className="mono">{fila.rif ?? 'Sin RIF'}</span>
            <div className="muted">Teléfono de administración: {fila.telefonoAdministracion ?? '—'}</div>
            {fila.actividadFicha && <div className="muted">En la ficha figura la actividad «{fila.actividadFicha}» (texto: búscala en el catálogo abajo).</div>}
          </div>
          <a className="btn btn-sm btn-ghost" href="#/app/proveedores">Corregir en Proveedores</a>
        </div>
        {vigente && (
          <div className="muted" style={{ fontSize: '.78rem', marginTop: '.3rem' }}>
            Perfil vigente desde {fechaCorta(vigente.desde)} · {rotuloAutor(vigente.actualizadoPor)}
            {vigente.datosSolicitadosEn && ` · datos pedidos el ${fechaCorta(vigente.datosSolicitadosEn)}`}
            {puedeEditar && <button type="button" className="btn btn-sm btn-ghost" onClick={() => void marcarSolicitado()}>Anotar: datos pedidos hoy</button>}
          </div>
        )}
      </div>

      {!versiones && !error && <p className="muted">Leyendo el perfil…</p>}

      {versiones && (
        <fieldset disabled={!puedeEditar || guardando} style={{ border: 0, padding: 0, margin: 0 }}>
          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
            <div className="form-row" style={{ flex: '1 1 160px' }}>
              <label>Tipo de contribuyente</label>
              <select className="select" value={form.tipoContribuyente} onChange={(e) => set({ tipoContribuyente: e.target.value as TipoContribuyente })}>
                {TIPOS_CONTRIBUYENTE.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <div className="form-row" style={{ flex: '1 1 200px' }}>
              <label>Persona</label>
              <div style={{ display: 'flex', gap: '.8rem', alignItems: 'center', minHeight: 36 }}>
                <label style={{ display: 'inline-flex', gap: '.3rem' }}><input type="radio" checked={form.tipoPersona === 'juridica'} onChange={() => set({ tipoPersona: 'juridica' })} /> Jurídica</label>
                <label style={{ display: 'inline-flex', gap: '.3rem' }}><input type="radio" checked={form.tipoPersona === 'natural'} onChange={() => set({ tipoPersona: 'natural' })} /> Natural</label>
              </div>
            </div>
            <div className="form-row" style={{ flex: '1 1 200px' }}>
              <label>{form.tipoPersona === 'juridica' ? 'Domiciliada en el país' : 'Residente en el país'}</label>
              <select className="select" value={form.residente ? 'si' : 'no'} onChange={(e) => set({ residente: e.target.value === 'si' })}>
                <option value="si">Sí</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
          <p style={{ fontSize: '.84rem', margin: '0 0 .3rem' }}>Sujeto para el ISLR: <strong>{labelSujeto(sujetoDelPerfil(form))}</strong></p>
          {sugerencia && (
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.4rem' }}>
              <small className="hint muted">Según la letra del RIF sería «{labelSujeto(sugerencia.sujeto)}». Verifícalo: el porcentaje del ISLR cambia con el sujeto.</small>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => set({ tipoPersona: sugerencia.tipo, residente: sugerencia.residencia === 'residente' })}>Usar la sugerencia</button>
            </div>
          )}
          <label style={{ display: 'inline-flex', gap: '.4rem', alignItems: 'center', fontSize: '.86rem', marginBottom: '.5rem' }}>
            <input type="checkbox" checked={form.esAgenteRetencion} onChange={(e) => set({ esAgenteRetencion: e.target.checked })} />
            El proveedor es agente de retención
          </label>

          <div className="card" style={{ margin: '.3rem 0' }}>
            <strong style={{ fontSize: '.86rem' }}>Licencia de actividad económica</strong>
            <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginTop: '.3rem' }}>
              <div className="form-row" style={{ flex: '1 1 150px', margin: 0 }}>
                <label>Estado</label>
                <select className="select" value={form.licenciaEstado} onChange={(e) => set({ licenciaEstado: e.target.value as EstadoLicencia })}>
                  {ESTADOS_LICENCIA.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select>
              </div>
              <div className="form-row" style={{ flex: '1 1 160px', margin: 0 }}>
                <label>Tipo</label>
                {tiposLicencia && tiposLicencia.length === 0 ? (
                  <small className="hint" style={{ color: 'var(--warning)' }}>
                    Primero carga los tipos de licencia en Parámetros › Tipos de licencia.
                    {onIrALicencias && <> <button type="button" className="btn btn-sm btn-ghost" onClick={onIrALicencias}>Ir a Tipos de licencia</button></>}
                  </small>
                ) : (
                  <>
                    <input className="input" list="tipos-licencia" value={form.licenciaTipo ?? ''} onChange={(e) => set({ licenciaTipo: e.target.value })} />
                    <datalist id="tipos-licencia">{(tiposLicencia ?? []).map((t) => <option key={t} value={t} />)}</datalist>
                  </>
                )}
              </div>
              <div className="form-row" style={{ flex: '1 1 140px', margin: 0 }}>
                <label>Número{form.licenciaEstado === 'vigente' ? ' (obligatorio)' : ''}</label>
                <input className="input mono" value={form.licenciaNumero ?? ''} onChange={(e) => set({ licenciaNumero: e.target.value })} />
              </div>
              <div className="form-row" style={{ flex: '1 1 140px', margin: 0 }}>
                <label>Vence</label>
                <input className="input" type="date" min="2000-01-01" max="2100-12-31" value={form.licenciaVence ?? ''} onChange={(e) => set({ licenciaVence: e.target.value || null })} />
              </div>
              <div className="form-row" style={{ flex: '2 1 200px', margin: 0 }}>
                <label>Alcaldía que la emite</label>
                <select className="select" value={form.licenciaEnteId ?? ''} onChange={(e) => set({ licenciaEnteId: e.target.value || null })}>
                  <option value="">—</option>
                  {municipales.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                </select>
              </div>
            </div>
            {form.licenciaEstado === 'por_solicitar' && (
              <small className="hint muted">Para pedirla: {fila.telefonoAdministracion ?? 'el proveedor no tiene teléfono de administración en su ficha'}.</small>
            )}
          </div>

          <div className="form-row">
            <label>Observación</label>
            <input className="input" value={form.observacion ?? ''} onChange={(e) => set({ observacion: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
            <div className="form-row" style={{ flex: '0 1 170px' }}>
              <label>Vigente desde</label>
              <input className="input" type="date" value={desde} min={minimo ?? undefined} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="form-row" style={{ flex: '2 1 260px' }}>
              <label>Motivo del cambio</label>
              <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
          </div>
          {falta && <small className="hint" style={{ color: 'var(--warning)' }}>{falta}</small>}
        </fieldset>
      )}

      {versiones && (
        <Actividades proveedorId={fila.proveedorId} actividades={actividades} municipales={municipales}
          puedeEditar={puedeEditar} onCambio={() => { onCambio(); void recargar(); }} />
      )}

      {versiones && versiones.length > 0 && (
        <details style={{ marginTop: '.6rem' }}>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: '.82rem' }}>Versiones del perfil ({versiones.length})</summary>
          <table className="table" style={{ fontSize: '.78rem', width: '100%', marginTop: '.3rem' }}>
            <thead><tr><th>Desde</th><th>Hasta</th><th>Sujeto</th><th>Contribuyente</th><th>Licencia</th><th>Motivo</th><th>Quién</th></tr></thead>
            <tbody>
              {versiones.map((v) => (
                <tr key={v.id}>
                  <td>{fechaCorta(v.desde)}</td><td>{v.hasta ? fechaCorta(v.hasta) : '—'}</td>
                  <td>{v.sujeto ? labelSujeto(v.sujeto) : '—'}</td><td>{labelContribuyente(v.tipoContribuyente)}</td>
                  <td>{LABEL_LICENCIA[v.licenciaEstado]}{v.licenciaNumero ? ` · ${v.licenciaNumero}` : ''}</td>
                  <td>{rotuloMotivo(v.motivo) || '—'}</td><td>{rotuloAutor(v.actualizadoPor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </Modal>
  );
}

function Actividades({ proveedorId, actividades, municipales, puedeEditar, onCambio }: {
  proveedorId: string;
  actividades: ActividadContraparte[];
  municipales: Ente[];
  puedeEditar: boolean;
  onCambio: () => void;
}) {
  const { actividades: catalogo } = useActividadesEconomicas();
  const [ciiu, setCiiu] = useState('');
  const [enteId, setEnteId] = useState('');
  const [ordenanza, setOrdenanza] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [principal, setPrincipal] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  // R4: con la alcaldía elegida, sus códigos se eligen de su clasificación (la base vincula el código solo).
  const [conR4, setConR4] = useState(false);
  const [codigosEnte, setCodigosEnte] = useState<CodigoClasificacion[]>([]);
  useEffect(() => { r4Disponible().then(setConR4).catch(() => setConR4(false)); }, []);
  useEffect(() => {
    let vivo = true;
    if (conR4 && enteId) codigosDeEnte(enteId).then((xs) => { if (vivo) setCodigosEnte(xs); }).catch(() => { if (vivo) setCodigosEnte([]); });
    else setCodigosEnte([]);
    return () => { vivo = false; };
  }, [conR4, enteId]);
  const opcionesEnte = useMemo(() => codigosEnte.map((c) => ({ value: c.codigo, label: `${c.codigo} · ${c.descripcion}` })), [codigosEnte]);
  function elegirCodigoEnte(codigo: string) {
    setOrdenanza(codigo);
    const c = codigosEnte.find((x) => x.codigo === codigo);
    if (c && !descripcion.trim()) setDescripcion(c.descripcion);
  }

  const opciones = useMemo(() => catalogo.filter((a) => a.activa).map((a) => ({ value: a.codigo, label: etiquetaActividad(a) })), [catalogo]);
  const nombreCiiu = (c: string | null) => (c ? catalogo.find((a) => a.codigo === c)?.descripcion ?? '' : '');
  const nombreEnte = (id: string | null) => municipales.find((m) => m.id === id)?.nombre ?? '';
  const activas = actividades.filter((a) => a.activa);
  const nueva = { ciiuCodigo: ciiu, enteId: enteId || null, ordenanzaCodigo: ordenanza, descripcion, principal: principal || activas.length === 0 };
  const falta = faltaEnActividad(nueva);
  const pistaOrdenanza = pistaClave(ordenanza, normalizarCodigo(ordenanza));

  async function hacer(fn: () => Promise<unknown>, ok: string) {
    setTrabajando(true);
    try { await fn(); toast(ok, 'success'); onCambio(); return true; } catch (e) { toast(mensaje(e, 'No se pudo guardar.'), 'error'); return false; } finally { setTrabajando(false); }
  }

  async function agregar() {
    const hecho = await hacer(() => agregarActividad(proveedorId, nueva), 'Actividad agregada.');
    if (hecho) { setCiiu(''); setEnteId(''); setOrdenanza(''); setDescripcion(''); setPrincipal(false); }
  }

  return (
    <div className="card" style={{ marginTop: '.6rem' }}>
      <strong style={{ fontSize: '.9rem' }}>Actividades económicas</strong>
      {activas.length === 0 && <p className="muted" style={{ fontSize: '.82rem' }}>Sin actividades: el perfil queda incompleto.</p>}
      {activas.map((a) => (
        <div key={a.id} style={{ display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.3rem 0', borderBottom: '1px solid var(--border)', fontSize: '.82rem' }}>
          <div style={{ flex: 1 }}>
            {a.principal && <strong>Principal · </strong>}
            {a.ciiuCodigo && <span className="mono">{a.ciiuCodigo}</span>} {nombreCiiu(a.ciiuCodigo)}
            {a.ordenanzaCodigo && <span> · Ordenanza {a.ordenanzaCodigo}{a.enteId ? ` (${nombreEnte(a.enteId)})` : ''}</span>}
            {a.descripcion && <div className="muted">{a.descripcion}</div>}
            <div className="muted" style={{ fontSize: '.74rem' }}>Desde {fechaCorta(a.desde)}</div>
          </div>
          {puedeEditar && !a.principal && (
            <button type="button" className="btn btn-sm btn-ghost" disabled={trabajando}
              onClick={() => void hacer(() => marcarPrincipal(proveedorId, a.id), 'Actividad principal cambiada.')}>Hacer principal</button>
          )}
          {puedeEditar && (
            <button type="button" className="btn btn-sm btn-ghost" disabled={trabajando}
              onClick={() => { if (window.confirm('¿Dar de baja esta actividad desde hoy? Queda en el historial.')) void hacer(() => bajaActividad(a.id), 'Actividad dada de baja.'); }}>Dar de baja</button>
          )}
        </div>
      ))}

      {puedeEditar && (
        <div style={{ marginTop: '.5rem' }}>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-row" style={{ flex: '3 1 280px', margin: 0 }}>
              <label>Actividad CIIU</label>
              <SearchSelect value={ciiu} onChange={setCiiu} options={opciones} placeholder="Buscar en el catálogo de actividades…" />
            </div>
            <div className="form-row" style={{ flex: '2 1 200px', margin: 0 }}>
              <label>Alcaldía (para el código de su ordenanza)</label>
              <select className="select" value={enteId} onChange={(e) => setEnteId(e.target.value)}>
                <option value="">—</option>
                {municipales.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </div>
            <div className="form-row" style={{ flex: '1 1 140px', margin: 0 }}>
              <label>Código de la ordenanza</label>
              {opcionesEnte.length
                ? <SearchSelect value={ordenanza} onChange={elegirCodigoEnte} options={opcionesEnte} placeholder="Buscar en la clasificación de la alcaldía…" />
                : <input className="input mono" value={ordenanza} onChange={(e) => setOrdenanza(e.target.value)} />}
              {pistaOrdenanza && <small className="hint muted">{pistaOrdenanza}</small>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '.4rem' }}>
            <div className="form-row" style={{ flex: '3 1 280px', margin: 0 }}>
              <label>Descripción</label>
              <input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
            </div>
            <label style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center', fontSize: '.84rem', minHeight: 36 }}>
              <input type="checkbox" checked={principal || activas.length === 0} disabled={activas.length === 0} onChange={(e) => setPrincipal(e.target.checked)} /> Principal
            </label>
            <button type="button" className="btn" onClick={() => void agregar()} disabled={!!falta || trabajando}>Agregar actividad</button>
          </div>
          {falta && <small className="hint" style={{ color: ciiu || ordenanza || enteId ? 'var(--warning)' : undefined }}>{falta}</small>}
        </div>
      )}
    </div>
  );
}
