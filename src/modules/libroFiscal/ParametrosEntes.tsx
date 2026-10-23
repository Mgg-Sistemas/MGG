/* ============================================================
   Golden Touch · Retenciones · Parámetros: Entes y logos (R1)
   Quién crea y cobra cada impuesto, su territorio, sus impuestos y su logo
   por versiones. Todo se guarda en la base al momento; nada se borra.
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  CLAVES_IMPUESTO, activarEnte, opcionesImpuestoEnte, crearEnte, desactivarLogoEnte, editarEnte, enteRepetido, faltaEnEnte, faltaEnImagen,
  fijarImpuestosEnte, leerRifEnte, listEntes, subirLogoEnte, versionVigente, type ClaveImpuesto, type Ente, type TipoEnte,
} from './entes.repository';
import { formatearRif, normalizarRif } from '@/shared/lib/rif';
import { faltaEnFechaRango } from './parametrosNumeros';
import { TIPOS_ENTE, fechaCorta, labelClave, labelTipoEnte, territorio } from './parametrosR1';
import { ImagenRetencion } from './ImagenRetencion';
import { hoyVenezuela } from '@/shared/lib/rangosFecha';
import { rotuloAutor, rotuloMotivo } from './rotulos';
import { ListaChecksAcordeon } from './SupuestosIvaAcordeon';

/** Hoy en Venezuela (no en UTC: después de las 20:00 ya sería mañana). */
const hoyIso = hoyVenezuela;
const mensaje = (e: unknown, d: string) => (e instanceof Error ? e.message : d);

export function ParametrosEntes({ puedeEditar }: { puedeEditar: boolean }) {
  const [entes, setEntes] = useState<Ente[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<Ente | 'nuevo' | null>(null);
  const [cambiarEstado, setCambiarEstado] = useState<Ente | null>(null);

  const cargar = useCallback(async () => {
    try { setEntes(await listEntes()); setError(null); } catch (e) { setError(mensaje(e, 'No se pudieron leer los entes.')); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['retencion_entes', 'retencion_ente_impuestos', 'retencion_ente_logos'], () => { void cargar(); });

  const abierto = editando && editando !== 'nuevo' ? entes?.find((e) => e.id === editando.id) ?? editando : editando;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        <p className="muted" style={{ fontSize: '.84rem', margin: 0 }}>
          Quién crea y cobra cada impuesto. El comprobante lleva el logo del ente vigente a su fecha de emisión.
        </p>
        {puedeEditar && <button type="button" className="btn btn-primary" onClick={() => setEditando('nuevo')}>Nuevo ente</button>}
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          {error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()}>Reintentar</button>
        </div>
      )}
      {!entes && !error && <p className="muted">Leyendo los entes…</p>}
      {entes && entes.length === 0 && <p className="muted">No hay entes cargados.</p>}

      {entes && entes.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ fontSize: '.84rem', width: '100%' }}>
            <thead>
              <tr><th>Logo vigente</th><th>Ente</th><th>Tipo</th><th>Territorio</th><th>Impuestos</th><th>Estado</th><th aria-label="Acciones" /></tr>
            </thead>
            <tbody>
              {entes.map((e) => (
                <tr key={e.id} style={e.activo ? undefined : { opacity: 0.6 }}>
                  <td><ImagenRetencion ruta={versionVigente(e.logos)?.ruta} alt={`Logo de ${e.nombre}`} ancho={72} alto={44} vacio="Sin logo" /></td>
                  <td><strong>{e.nombre}</strong>{e.rif && <div className="muted mono" style={{ fontSize: '.74rem' }}>{formatearRif(e.rif)}</div>}</td>
                  <td>{labelTipoEnte(e.tipo)}</td>
                  <td>{territorio(e)}</td>
                  <td>{e.impuestos.length ? e.impuestos.map(labelClave).join(', ') : <span className="muted">Ninguno</span>}</td>
                  <td>{e.activo ? 'Activo' : `Inactivo${e.hasta ? ` desde ${fechaCorta(e.hasta)}` : ''}`}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn btn-sm" onClick={() => setEditando(e)}>{puedeEditar ? 'Editar' : 'Ver'}</button>
                    {puedeEditar && (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCambiarEstado(e)}>{e.activo ? 'Desactivar' : 'Activar'}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {abierto && (
        <EnteModal ente={abierto === 'nuevo' ? null : abierto} entes={entes ?? []} puedeEditar={puedeEditar}
          onClose={() => setEditando(null)} onCambio={() => void cargar()} />
      )}
      {cambiarEstado && (
        <EstadoEnteModal ente={cambiarEstado} onClose={() => setCambiarEstado(null)} onHecho={() => { setCambiarEstado(null); void cargar(); }} />
      )}
    </div>
  );
}

function EstadoEnteModal({ ente, onClose, onHecho }: { ente: Ente; onClose: () => void; onHecho: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const activar = !ente.activo;
  async function confirmar() {
    setGuardando(true);
    try {
      await activarEnte(ente.id, activar, motivo);
      toast(activar ? 'Ente activado.' : 'Ente desactivado.', 'success');
      onHecho();
    } catch (e) {
      toast(mensaje(e, 'No se pudo cambiar el ente.'), 'error');
      setGuardando(false);
    }
  }
  return (
    <Modal title={`${activar ? 'Activar' : 'Desactivar'} ${ente.nombre}`} compact onClose={() => !guardando && onClose()}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void confirmar()} disabled={guardando || !motivo.trim()}>
            {guardando ? 'Guardando…' : activar ? 'Activar' : 'Desactivar'}
          </button>
        </>
      )}>
      {!activar && <p style={{ fontSize: '.86rem' }}>No se borra: los comprobantes emitidos con este ente lo conservan. Deja de ofrecerse desde hoy.</p>}
      <div className="form-row">
        <label>Motivo</label>
        <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
      </div>
    </Modal>
  );
}

function EnteModal({ ente, entes, puedeEditar, onClose, onCambio }: {
  ente: Ente | null;
  /** Para avisar antes de mandar si el nombre ya existe (la base no distingue mayúsculas). */
  entes: Ente[];
  puedeEditar: boolean;
  onClose: () => void;
  onCambio: () => void;
}) {
  const [nombre, setNombre] = useState(ente?.nombre ?? '');
  const [tipo, setTipo] = useState<TipoEnte>(ente?.tipo ?? 'municipal');
  const [estado, setEstado] = useState(ente?.estado ?? '');
  const [municipio, setMunicipio] = useState(ente?.municipio ?? '');
  const [rif, setRif] = useState(ente?.rif ?? '');
  const [impuestos, setImpuestos] = useState<ClaveImpuesto[]>(ente?.impuestos ?? []);
  const [motivo, setMotivo] = useState('');
  const [logo, setLogo] = useState<File | null>(null);
  const [logoDesde, setLogoDesde] = useState(hoyIso());
  const [logoMotivo, setLogoMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opciones, setOpciones] = useState<{ clave: ClaveImpuesto; nombre: string | null }[]>(CLAVES_IMPUESTO.map((clave) => ({ clave, nombre: null })));
  useEffect(() => { opcionesImpuestoEnte().then(setOpciones).catch(() => { /* quedan las cinco de siempre */ }); }, []);

  const falta = faltaEnEnte({ nombre, tipo, estado, municipio, rif }) ?? enteRepetido({ nombre, tipo }, entes, ente?.id);
  const faltaLogo = logo ? faltaEnImagen(logo) ?? faltaEnFechaRango(logoDesde, 'la fecha «vale desde» del logo') : null;
  // El RIF se guarda sin guiones y, si le falta el dígito verificador, completo: se dice antes.
  const rifLeido = leerRifEnte(rif);
  const rifPista = 'valor' in rifLeido && rifLeido.valor && rifLeido.valor !== normalizarRif(rif) ? `Se guardará como: ${formatearRif(rifLeido.valor)}` : null;
  const toggleImp = (c: ClaveImpuesto) => setImpuestos((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]));

  async function guardar() {
    if (falta) { setError(falta); return; }
    if (faltaLogo) { setError(faltaLogo); return; }
    setGuardando(true); setError(null);
    try {
      if (ente) {
        await editarEnte(ente.id, { nombre, tipo, estado, municipio, rif, ...(motivo.trim() ? { motivo } : {}) });
        await fijarImpuestosEnte(ente.id, impuestos, motivo.trim() || `Impuestos de ${nombre.trim()}`);
        toast('Ente guardado.', 'success');
      } else {
        const id = await crearEnte({ nombre, tipo, estado, municipio, rif, impuestos, motivo });
        if (logo) {
          try {
            await subirLogoEnte(id, logo, logoDesde, logoMotivo || 'Logo inicial');
          } catch (e) {
            onCambio();
            setError(`El ente quedó creado, pero el logo no: ${mensaje(e, 'error')}. Cárgalo desde «Editar».`);
            setGuardando(false);
            return;
          }
        }
        toast('Ente creado.', 'success');
      }
      onCambio();
      onClose();
    } catch (e) {
      onCambio();
      setError(mensaje(e, 'No se pudo guardar el ente.'));
      setGuardando(false);
    }
  }

  return (
    <Modal title={ente ? ente.nombre : 'Nuevo ente'} size="lg" onClose={() => !guardando && onClose()}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={guardando}>{puedeEditar ? 'Cancelar' : 'Cerrar'}</button>
          {puedeEditar && (
            <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={guardando || !!falta || !!faltaLogo}>
              {guardando ? 'Guardando…' : ente ? 'Guardar cambios' : 'Crear ente'}
            </button>
          )}
        </>
      )}>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}>{error}</div>}
      <fieldset disabled={!puedeEditar || guardando} style={{ border: 0, padding: 0, margin: 0 }}>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          <div className="form-row" style={{ flex: '2 1 240px' }}>
            <label>Nombre</label>
            <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Alcaldía del Municipio…" />
          </div>
          <div className="form-row" style={{ flex: '1 1 140px' }}>
            <label>Tipo</label>
            <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as TipoEnte)}>
              {TIPOS_ENTE.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ flex: '1 1 150px' }}>
            <label>RIF</label>
            <input className="input mono" value={rif} onChange={(e) => setRif(e.target.value)} placeholder="G-XXXXXXXX-X" />
            {'error' in rifLeido
              ? <small className="hint" style={{ color: 'var(--warning)' }}>{rifLeido.error}</small>
              : rifPista && <small className="hint muted">{rifPista}</small>}
          </div>
        </div>
        {tipo !== 'nacional' && (
          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
            <div className="form-row" style={{ flex: '1 1 180px' }}>
              <label>Estado</label>
              <input className="input" value={estado} onChange={(e) => setEstado(e.target.value)} />
            </div>
            {tipo === 'municipal' && (
              <div className="form-row" style={{ flex: '1 1 180px' }}>
                <label>Municipio</label>
                <input className="input" value={municipio} onChange={(e) => setMunicipio(e.target.value)} />
              </div>
            )}
          </div>
        )}
        <div className="form-row">
          <ListaChecksAcordeon
            titulo="Impuestos que crea o cobra"
            conteoMarcados={impuestos.length}
            conteoTotal={opciones.length}
            inicialAbierto={impuestos.length > 0}
          >
            <div style={{ display: 'flex', gap: '.8rem', flexWrap: 'wrap' }}>
              {opciones.map(({ clave, nombre }) => (
                <label key={clave} style={{ display: 'inline-flex', gap: '.3rem', alignItems: 'center', fontSize: '.86rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={impuestos.includes(clave)} onChange={() => toggleImp(clave)} /> {nombre ?? labelClave(clave)}
                </label>
              ))}
            </div>
          </ListaChecksAcordeon>
        </div>
        <div className="form-row">
          <label>{ente ? 'Motivo del cambio' : 'Nota del alta'}</label>
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>

        {puedeEditar && (falta || faltaLogo) && <small className="hint" style={{ color: 'var(--warning)', display: 'block' }}>{falta ?? faltaLogo}</small>}

        {!ente && (
          <div className="card" style={{ marginTop: '.4rem' }}>
            <strong style={{ fontSize: '.86rem' }}>Logo inicial</strong>
            <LogoForm archivo={logo} onArchivo={setLogo} desde={logoDesde} onDesde={setLogoDesde} motivo={logoMotivo} onMotivo={setLogoMotivo} />
          </div>
        )}
      </fieldset>

      {ente && <HistorialLogos ente={ente} puedeEditar={puedeEditar} onCambio={onCambio} />}
    </Modal>
  );
}

function LogoForm({ archivo, onArchivo, desde, onDesde, motivo, onMotivo }: {
  archivo: File | null; onArchivo: (f: File | null) => void;
  desde: string; onDesde: (v: string) => void;
  motivo: string; onMotivo: (v: string) => void;
}) {
  const falta = archivo ? faltaEnImagen(archivo) : null;
  const faltaDesde = faltaEnFechaRango(desde, 'la fecha «vale desde» del logo');
  return (
    <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '.4rem' }}>
      <div className="form-row" style={{ flex: '2 1 220px', margin: 0 }}>
        <label>Imagen (PNG o JPG, hasta 1 MB)</label>
        <input className="input" type="file" accept="image/png,image/jpeg" onChange={(e) => onArchivo(e.target.files?.[0] ?? null)} />
        {falta && <small style={{ color: 'var(--danger)' }}>{falta}</small>}
      </div>
      <div className="form-row" style={{ flex: '1 1 140px', margin: 0 }}>
        <label>Vale desde</label>
        <input className="input" type="date" value={desde} min="2000-01-01" max="2100-12-31" onChange={(e) => onDesde(e.target.value)} />
        {faltaDesde && <small style={{ color: 'var(--danger)' }}>{faltaDesde}</small>}
      </div>
      <div className="form-row" style={{ flex: '2 1 200px', margin: 0 }}>
        <label>Motivo</label>
        <input className="input" value={motivo} onChange={(e) => onMotivo(e.target.value)} placeholder="Ej.: logo nuevo de la alcaldía" />
      </div>
    </div>
  );
}

function HistorialLogos({ ente, puedeEditar, onCambio }: { ente: Ente; puedeEditar: boolean; onCambio: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [desde, setDesde] = useState(hoyIso());
  const [motivo, setMotivo] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const vigente = versionVigente(ente.logos);

  const faltaSubir = !archivo ? 'Elige la imagen del logo.' : faltaEnImagen(archivo) ?? faltaEnFechaRango(desde, 'la fecha «vale desde» del logo') ?? (desde ? null : 'Indica desde qué fecha vale el logo.');

  async function subir() {
    if (!archivo || faltaSubir) { if (faltaSubir) toast(faltaSubir, 'error'); return; }
    setSubiendo(true);
    try {
      await subirLogoEnte(ente.id, archivo, desde, motivo);
      toast('Logo cargado.', 'success');
      setArchivo(null); setMotivo('');
      onCambio();
    } catch (e) {
      toast(mensaje(e, 'No se pudo cargar el logo.'), 'error');
    } finally {
      setSubiendo(false);
    }
  }

  async function desactivar(id: string) {
    const m = window.prompt('¿Por qué se desactiva esta versión del logo?');
    if (!m?.trim()) return;
    try { await desactivarLogoEnte(id, m); toast('Versión del logo desactivada.', 'success'); onCambio(); } catch (e) { toast(mensaje(e, 'No se pudo desactivar.'), 'error'); }
  }

  return (
    <div className="card" style={{ marginTop: '.6rem' }}>
      <strong style={{ fontSize: '.9rem' }}>Logos</strong>
      {ente.logos.length === 0 && <p className="muted" style={{ fontSize: '.82rem' }}>Sin logo: el comprobante deja el recuadro en blanco.</p>}
      {ente.logos.map((l) => (
        <div key={l.id} style={{ display: 'flex', gap: '.6rem', alignItems: 'center', padding: '.3rem 0', borderBottom: '1px solid var(--border)', opacity: l.activo ? 1 : 0.55 }}>
          <ImagenRetencion ruta={l.ruta} alt={`Logo desde ${fechaCorta(l.desde)}`} ancho={72} alto={44} />
          <div style={{ flex: 1, fontSize: '.82rem' }}>
            Desde {fechaCorta(l.desde)}{vigente?.id === l.id && <strong> · vigente</strong>}{!l.activo && ' · desactivado'}
            <div className="muted" style={{ fontSize: '.74rem' }}>{[l.nombreArchivo, rotuloMotivo(l.motivo), rotuloAutor(l.actualizadoPor)].filter(Boolean).join(' · ')}</div>
          </div>
          {puedeEditar && l.activo && <button type="button" className="btn btn-sm btn-ghost" onClick={() => void desactivar(l.id)}>Desactivar</button>}
        </div>
      ))}
      {puedeEditar && (
        <>
          <p style={{ fontSize: '.84rem', margin: '.6rem 0 0', fontWeight: 600 }}>Cargar logo nuevo desde…</p>
          <LogoForm archivo={archivo} onArchivo={setArchivo} desde={desde} onDesde={setDesde} motivo={motivo} onMotivo={setMotivo} />
          <button type="button" className="btn" style={{ marginTop: '.5rem' }} onClick={() => void subir()}
            disabled={!!faltaSubir || subiendo}>{subiendo ? 'Subiendo…' : 'Cargar logo'}</button>
          {faltaSubir && !archivo && <small className="hint muted" style={{ marginLeft: '.5rem' }}>{faltaSubir}</small>}
        </>
      )}
    </div>
  );
}
