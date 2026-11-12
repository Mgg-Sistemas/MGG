/* ============================================================
   Entregas del almacén para mantenimiento · pantallas de Maquinaria
   (12-11-2026, traído de Golden Touch). PC y teléfono usan las mismas piezas:
     · EntregasAlmacenAviso: «📦 N entregas del almacén por registrar».
     · EntregasAlmacenModal: la lista; al tocar una se ve el detalle.
     · DetalleEntrega: qué entregó el almacén (con fotos de la salida) y
       los botones Registrar mantenimiento / Rechazar.
     · RegistrarEntregaForm: qué se hizo, fecha, horómetro, fotos… → bitácora.
     · FotosMiniatura: miniaturas que se abren en el visor del sistema.
     · AvisoFaltaMigracion: si la base todavía no tiene la tabla.
   ============================================================ */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { useRealtime } from '@/shared/lib/useRealtime';
import { dateTime } from '@/shared/lib/format';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import { listEquipos, reiniciarMantenimientoDeEquipo, type MaquinariaEquipo } from './maquinariaEquipos.repository';
import { TIPOS_MANTENIMIENTO, etiquetaTipoMant } from './maquinariaMant.repository';
import {
  errorRegistroEntrega, esFotoImagen, hoyVE, lineaItem, resumenEntrega, type EntregaAlmacen, type FotoArchivo,
} from './entregasAlmacen';
import {
  MAX_FOTOS_MANTENIMIENTO, MSG_FALTA_MIGRACION, entregasDisponibles, fotosSalidaDeEntrega, listEntregasPendientes,
  rechazarEntrega, registrarEntrega, subirFotosMantenimiento, urlsFotos,
} from './entregasAlmacen.repository';

const errMsg = (e: unknown, d: string) => (e instanceof Error ? e.message : (e as { message?: string })?.message ?? d);
const esImagen = (f: File) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);

/** ¿Está aplicada la migración de entregas? null mientras se pregunta. */
export function useEntregasDisponibles(): boolean | null {
  const [v, setV] = useState<boolean | null>(null);
  useEffect(() => {
    let vivo = true;
    entregasDisponibles().then((x) => { if (vivo) setV(x); }).catch(() => { if (vivo) setV(true); });
    return () => { vivo = false; };
  }, []);
  return v;
}

/** Aviso cuando la base todavía no tiene las entregas del almacén. */
export function AvisoFaltaMigracion({ compacto = false }: { compacto?: boolean }) {
  return (
    <div className={`aviso warning${compacto ? ' sm' : ''}`} style={{ margin: '.5rem 0' }}>
      <span className="aviso-icono">⚠</span>
      <div>
        <strong>Entregas a Maquinaria todavía no disponibles.</strong> {MSG_FALTA_MIGRACION} Mientras tanto, la salida se registra normal.
      </div>
    </div>
  );
}

/** Opciones del buscador de máquinas (activas). */
export function opcionesMaquinas(equipos: MaquinariaEquipo[]) {
  return equipos.map((x) => ({
    value: x.id,
    label: x.equipo,
    hint: [x.tipo, x.placa].filter(Boolean).join(' · ') || undefined,
    keywords: [x.placa ?? '', x.serial ?? '', x.marca ?? '', x.modelo ?? '', x.ubicacion ?? ''].filter(Boolean),
  }));
}

/** Las máquinas activas (para elegir a cuál va el material). */
export function useMaquinasActivas(habilitado = true): { equipos: MaquinariaEquipo[]; error: string | null } {
  const [equipos, setEquipos] = useState<MaquinariaEquipo[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!habilitado || equipos.length) return;
    let vivo = true;
    listEquipos()
      .then((xs) => { if (vivo) setEquipos(xs.filter((x) => x.activo !== false)); })
      .catch(() => { if (vivo) setError('No se pudo cargar la lista de máquinas.'); });
    return () => { vivo = false; };
  }, [habilitado, equipos.length]);
  return { equipos, error };
}

/** Pendientes + realtime. */
export function useEntregasPendientes(habilitado = true) {
  const [entregas, setEntregas] = useState<EntregaAlmacen[]>([]);
  const [cargando, setCargando] = useState(true);
  const cargar = useCallback(async () => {
    if (!habilitado) { setCargando(false); return; }
    try { setEntregas(await listEntregasPendientes()); }
    catch { /* sin permiso o sin red: el aviso simplemente no sale */ }
    finally { setCargando(false); }
  }, [habilitado]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_entregas_almacen'], () => { void cargar(); }, { enabled: habilitado });
  return { entregas, cargando, recargar: cargar };
}

/** Miniaturas de fotos (de la salida o del mantenimiento); al tocar, vista previa en el visor. */
export function FotosMiniatura({ fotos, etiqueta }: { fotos: FotoArchivo[]; etiqueta?: string }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const clave = fotos.map((f) => `${f.bucket ?? ''}:${f.path}`).join('|');
  useEffect(() => {
    let vivo = true;
    if (!fotos.length) { setUrls({}); return; }
    void urlsFotos(fotos).then((u) => { if (vivo) setUrls(u); });
    return () => { vivo = false; };
    // `clave` resume `fotos`: así no se vuelve a firmar en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);
  if (!fotos.length) return null;
  async function ver(f: FotoArchivo) {
    const u = urls[f.path];
    if (!u) return;
    try { await previewFileUrl(u, f.filename || 'foto', etiqueta ?? 'Foto'); }
    catch (e) { toast(errMsg(e, 'No se pudo abrir la foto'), 'error'); }
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem' }}>
      {fotos.map((f) => (
        <button key={`${f.bucket ?? ''}:${f.path}`} type="button" title={`Ver ${f.filename}`} aria-label={`Ver ${f.filename}`}
          onClick={() => void ver(f)} disabled={!urls[f.path]}
          style={{ width: 64, height: 64, padding: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-1)', cursor: 'pointer' }}>
          {urls[f.path] && esFotoImagen(f)
            ? <img src={urls[f.path]} alt={f.filename} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <span className="muted" style={{ fontSize: urls[f.path] ? '1.4rem' : '.7rem' }}>{urls[f.path] ? '📄' : '…'}</span>}
        </button>
      ))}
    </div>
  );
}

/** Las fotos de la salida de una entrega, al día (el teléfono deja sumar fotos después de guardar). */
export function FotosSalidaEntrega({ entrega, titulo = 'Fotos de la salida' }: { entrega: EntregaAlmacen; titulo?: string }) {
  const [fotos, setFotos] = useState<FotoArchivo[]>(entrega.fotos);
  useEffect(() => {
    let vivo = true;
    void fotosSalidaDeEntrega(entrega).then((xs) => { if (vivo) setFotos(xs); });
    return () => { vivo = false; };
  }, [entrega]);
  if (!fotos.length) return null;
  return (
    <div style={{ marginTop: '.5rem' }}>
      <div className="muted" style={{ fontSize: '.75rem', marginBottom: '.25rem' }}>{titulo}</div>
      <FotosMiniatura fotos={fotos} etiqueta={`${entrega.codigo} · salida del almacén`} />
    </div>
  );
}

/** Aviso destacado de entregas pendientes (no sale si no hay ninguna). */
export function EntregasAlmacenAviso({ canWrite, abrirAlCargar = false, compacto = false }: {
  canWrite: boolean; abrirAlCargar?: boolean; compacto?: boolean;
}) {
  const { entregas, cargando, recargar } = useEntregasPendientes();
  const [abierto, setAbierto] = useState(false);
  const [yaAbrio, setYaAbrio] = useState(false);
  useEffect(() => {
    if (abrirAlCargar && !yaAbrio && !cargando && entregas.length) { setAbierto(true); setYaAbrio(true); }
  }, [abrirAlCargar, yaAbrio, cargando, entregas.length]);
  if (!entregas.length && !abierto) return null;
  return (
    <>
      {entregas.length > 0 && (
        <button type="button" className="card" onClick={() => setAbierto(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '.75rem', width: '100%', textAlign: 'left', cursor: 'pointer',
            borderLeft: '4px solid var(--warning)', marginBottom: compacto ? '.6rem' : '1rem', padding: compacto ? '.6rem .75rem' : '.75rem 1rem' }}>
          <span style={{ fontSize: compacto ? '1.3rem' : '1.6rem' }} aria-hidden>📦</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong>{entregas.length} {entregas.length === 1 ? 'entrega del almacén' : 'entregas del almacén'} por registrar</strong>
            <span className="muted" style={{ display: 'block', fontSize: '.82rem' }}>{resumenEntrega(entregas[0])}{entregas.length > 1 ? ' y más…' : ''}</span>
          </span>
          <span className="btn btn-primary btn-sm">Ver</span>
        </button>
      )}
      {abierto && <EntregasAlmacenModal entregas={entregas} canWrite={canWrite}
        onClose={() => setAbierto(false)} onCambio={() => void recargar()} />}
    </>
  );
}

export function EntregasAlmacenModal({ entregas, canWrite, onClose, onCambio }: {
  entregas: EntregaAlmacen[]; canWrite: boolean; onClose: () => void; onCambio: () => void;
}) {
  const [sel, setSel] = useState<EntregaAlmacen | null>(null);
  return (
    <Modal title={`📦 Entregas del almacén por registrar · ${entregas.length}`} size="lg" onClose={onClose}>
      {!entregas.length && <p className="muted">No hay entregas pendientes. 👍</p>}
      <div style={{ display: 'grid', gap: '.5rem' }}>
        {entregas.map((e) => (
          <button key={e.id} type="button" className="card" onClick={() => setSel(e)}
            style={{ textAlign: 'left', cursor: 'pointer', margin: 0, padding: '.7rem .9rem' }}>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <strong className="mono">{e.codigo}</strong>
              <span className="badge warning">Pendiente</span>
              <span className="badge">{e.origen === 'pc' ? '🖥 PC' : '📱 Teléfono'}</span>
              <span className="muted" style={{ fontSize: '.78rem', marginLeft: 'auto' }}>{dateTime(e.created_at)}</span>
            </div>
            <div style={{ marginTop: '.3rem' }}>{resumenEntrega(e)}</div>
            <div className="muted" style={{ fontSize: '.8rem' }}>{e.items.map(lineaItem).join(' · ')}</div>
          </button>
        ))}
      </div>
      {sel && <DetalleEntrega entrega={sel} canWrite={canWrite}
        onClose={() => setSel(null)} onListo={() => { setSel(null); onCambio(); }} />}
    </Modal>
  );
}

export function DetalleEntrega({ entrega: e, canWrite, onClose, onListo }: {
  entrega: EntregaAlmacen; canWrite: boolean; onClose: () => void; onListo: () => void;
}) {
  const [modo, setModo] = useState<'ver' | 'registrar' | 'rechazar'>('ver');
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function rechazar() {
    if (motivo.trim().length < 3) { toast('Escribe el motivo del rechazo.', 'error'); return; }
    setGuardando(true);
    try {
      await rechazarEntrega(e.id, motivo.trim());
      toast(`Entrega ${e.codigo} rechazada: vuelve al almacén como devolución.`, 'success');
      onListo();
    } catch (err) { toast(errMsg(err, 'No se pudo rechazar'), 'error'); }
    finally { setGuardando(false); }
  }

  return (
    <Modal title={`📦 ${e.codigo} · ${e.equipo_nombre}`} size="lg" onClose={onClose}>
      <div className="card" style={{ background: 'var(--bg-1)', marginBottom: '.75rem' }}>
        <div style={{ fontWeight: 700, marginBottom: '.25rem' }}>{resumenEntrega(e)}</div>
        <div className="muted" style={{ fontSize: '.82rem' }}>
          {dateTime(e.created_at)} · {e.origen === 'pc' ? 'Salida de la PC' : 'Salida del teléfono'}{e.ref_codigo ? ` · ${e.ref_codigo}` : ''}{e.almacen ? ` · ${e.almacen}` : ''}
        </div>
        <ul style={{ margin: '.5rem 0 0', paddingLeft: '1.1rem' }}>
          {e.items.map((i, k) => <li key={`${i.producto_id}-${k}`}>{lineaItem(i)}</li>)}
        </ul>
        {e.tipo_sugerido && <div style={{ marginTop: '.4rem', fontSize: '.85rem' }}>Para: <strong>{etiquetaTipoMant(e.tipo_sugerido)}</strong></div>}
        {e.nota && <div style={{ marginTop: '.3rem', fontSize: '.85rem' }}>Nota del almacén: {e.nota}</div>}
        <FotosSalidaEntrega entrega={e} />
      </div>

      {e.estado !== 'pendiente' ? (
        <p className="muted">Esta entrega ya se atendió ({e.estado}).</p>
      ) : !canWrite ? (
        <p className="muted">Solo quien tiene permiso de escritura en Maquinaria puede registrarla o rechazarla.</p>
      ) : modo === 'ver' ? (
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-danger" onClick={() => setModo('rechazar')}>↩ Rechazar y devolver</button>
          <button type="button" className="btn btn-success" onClick={() => setModo('registrar')}>🔧 Registrar mantenimiento</button>
        </div>
      ) : modo === 'rechazar' ? (
        <div className="card">
          <div className="form-row">
            <label htmlFor="ema-rechazo-motivo">Motivo del rechazo *</label>
            <textarea id="ema-rechazo-motivo" className="input" rows={3} value={motivo} onChange={(ev) => setMotivo(ev.target.value)}
              placeholder="Ej.: ese filtro no es de esta máquina; no se usó…" />
            <small className="muted">La entrega vuelve al almacén como devolución: el almacenista le da entrada al inventario.</small>
          </div>
          <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setModo('ver')} disabled={guardando}>Volver</button>
            <button type="button" className="btn btn-danger" onClick={() => void rechazar()} disabled={guardando}>{guardando ? 'Rechazando…' : 'Rechazar entrega'}</button>
          </div>
        </div>
      ) : (
        <RegistrarEntregaForm entrega={e} onCancel={() => setModo('ver')} onListo={onListo} />
      )}
    </Modal>
  );
}

const TIPOS_ELEGIBLES = TIPOS_MANTENIMIENTO.filter((t) => t.value !== 'lectura');
const leerNum = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

function RegistrarEntregaForm({ entrega: e, onCancel, onListo }: {
  entrega: EntregaAlmacen; onCancel: () => void; onListo: () => void;
}) {
  const { equipos } = useMaquinasActivas();
  const [equipoId, setEquipoId] = useState(e.equipo_id);
  const [tipos, setTipos] = useState<string[]>(e.tipo_sugerido ? [e.tipo_sugerido] : []);
  const [fecha, setFecha] = useState(() => hoyVE());
  const [horometro, setHorometro] = useState('');
  const [kilometraje, setKilometraje] = useState('');
  const [aceite, setAceite] = useState('');
  const [refrigerante, setRefrigerante] = useState('');
  const [trabajo, setTrabajo] = useState('');
  const [mecanico, setMecanico] = useState('');
  const [ubicacion, setUbicacion] = useState<string | null>(null);
  const [observacion, setObservacion] = useState('');
  const [fotos, setFotos] = useState<File[]>([]);
  const [reiniciar, setReiniciar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const previas = useMemo(() => fotos.map((f) => URL.createObjectURL(f)), [fotos]);
  useEffect(() => () => { previas.forEach((u) => URL.revokeObjectURL(u)); }, [previas]);
  const equipo = equipos.find((x) => x.id === equipoId);
  // Mientras no se escriba, la ubicación es la de la ficha de la máquina elegida.
  const ubicacionFinal = ubicacion ?? equipo?.ubicacion ?? '';
  // La máquina elegida por el almacén aparece aunque ya no esté activa.
  const opciones = useMemo(() => {
    const os = opcionesMaquinas(equipos);
    return os.some((o) => o.value === e.equipo_id) ? os : [{ value: e.equipo_id, label: e.equipo_nombre, hint: undefined, keywords: [] }, ...os];
  }, [equipos, e.equipo_id, e.equipo_nombre]);

  const alternar = (t: string) => setTipos((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]));

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    const problema = errorRegistroEntrega({ tipos, fecha, horometro, kilometraje });
    if (problema) { toast(problema, 'error'); return; }
    setGuardando(true);
    try {
      const subidas = fotos.length ? await subirFotosMantenimiento(equipoId, fotos) : [];
      await registrarEntrega(e.id, {
        equipoId, fecha, tipos,
        horometro: leerNum(horometro), kilometraje: leerNum(kilometraje), aceiteLts: leerNum(aceite), refrigeranteLts: leerNum(refrigerante),
        trabajo: trabajo.trim() || tipos.map((t) => TIPOS_MANTENIMIENTO.find((x) => x.value === t)?.label ?? t).join(', '),
        mecanico: mecanico.trim() || null, ubicacion: ubicacionFinal.trim() || null, observacion: observacion.trim() || null,
        fotos: subidas,
      });
      if (reiniciar) {
        try { await reiniciarMantenimientoDeEquipo(equipoId); }
        catch (err) { toast(`Quedó en la bitácora, pero no se pudo reiniciar el contador: ${errMsg(err, 'error')}`, 'warning'); }
      }
      toast(`Mantenimiento registrado en la bitácora de ${equipo?.equipo ?? e.equipo_nombre}.`, 'success');
      onListo();
    } catch (err) { toast(errMsg(err, 'No se pudo registrar'), 'error'); }
    finally { setGuardando(false); }
  }

  return (
    <form className="card" onSubmit={(ev) => void guardar(ev)}>
      <div className="form-row">
        <label htmlFor="ema-maquina">Máquina</label>
        <SearchSelect id="ema-maquina" value={equipoId} onChange={(v) => { if (v) setEquipoId(v); }} options={opciones} placeholder="🔍 Busca la máquina…" />
        {equipoId !== e.equipo_id && <small style={{ color: 'var(--warning)' }}>Cambiaste la máquina que eligió el almacén ({e.equipo_nombre}).</small>}
      </div>
      <div className="form-row">
        <label>¿Qué se hizo? * <span className="muted">(puedes marcar varios)</span></label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem' }}>
          {TIPOS_ELEGIBLES.map((t) => (
            <button key={t.value} type="button" className={`btn btn-sm ${tipos.includes(t.value) ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={tipos.includes(t.value)} onClick={() => alternar(t.value)}>{t.icon} {t.label}</button>
          ))}
        </div>
      </div>
      <div className="form-grid">
        <div className="form-row"><label htmlFor="ema-fecha">Fecha en que se hizo *</label><input id="ema-fecha" className="input" type="date" value={fecha} max={hoyVE()} onChange={(ev) => setFecha(ev.target.value)} /></div>
        <div className="form-row"><label htmlFor="ema-horometro">Horómetro (lectura)</label><input id="ema-horometro" className="input mono" inputMode="decimal" value={horometro} onChange={(ev) => setHorometro(ev.target.value)} /></div>
        <div className="form-row"><label htmlFor="ema-km">Kilometraje</label><input id="ema-km" className="input mono" inputMode="decimal" value={kilometraje} onChange={(ev) => setKilometraje(ev.target.value)} /></div>
      </div>
      <div className="form-grid">
        <div className="form-row"><label htmlFor="ema-aceite">Aceite (Lts)</label><input id="ema-aceite" className="input mono" inputMode="decimal" value={aceite} onChange={(ev) => setAceite(ev.target.value)} /></div>
        <div className="form-row"><label htmlFor="ema-refrigerante">Refrigerante (Lts)</label><input id="ema-refrigerante" className="input mono" inputMode="decimal" value={refrigerante} onChange={(ev) => setRefrigerante(ev.target.value)} /></div>
        <div className="form-row"><label htmlFor="ema-mecanico">Mecánico / taller</label><input id="ema-mecanico" className="input" value={mecanico} onChange={(ev) => setMecanico(ev.target.value.toUpperCase())} /></div>
      </div>
      <div className="form-row">
        <label htmlFor="ema-trabajo">Trabajo realizado</label>
        <input id="ema-trabajo" className="input" value={trabajo} onChange={(ev) => setTrabajo(ev.target.value)} placeholder="Ej.: cambio de filtros de aceite y combustible, aceite 15W40" />
      </div>
      <div className="form-grid">
        <div className="form-row"><label htmlFor="ema-ubicacion">Ubicación</label><input id="ema-ubicacion" className="input" value={ubicacionFinal} onChange={(ev) => setUbicacion(ev.target.value.toUpperCase())} /></div>
        <div className="form-row"><label htmlFor="ema-observacion">Observación</label><input id="ema-observacion" className="input" value={observacion} onChange={(ev) => setObservacion(ev.target.value)} /></div>
      </div>
      <div className="form-row">
        <label htmlFor="ema-fotos">Fotos del mantenimiento ({fotos.length}/{MAX_FOTOS_MANTENIMIENTO}) · opcional</label>
        {fotos.length < MAX_FOTOS_MANTENIMIENTO && (
          <input id="ema-fotos" className="input" type="file" accept="image/*" multiple
            onChange={(ev) => {
              const nuevas = Array.from(ev.target.files ?? []).filter(esImagen);
              setFotos((xs) => [...xs, ...nuevas].slice(0, MAX_FOTOS_MANTENIMIENTO));
              ev.target.value = '';
            }} />
        )}
        {fotos.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', marginTop: '.35rem' }}>
            {fotos.map((f, i) => (
              <div key={`${f.name}-${i}`} style={{ position: 'relative', width: 64, height: 64 }}>
                <img src={previas[i]} alt={f.name} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                <button type="button" className="btn btn-xs btn-ghost" aria-label={`Quitar ${f.name}`}
                  style={{ position: 'absolute', top: -6, right: -6, padding: '0 .3rem', background: 'var(--bg-1)' }}
                  onClick={() => setFotos((xs) => xs.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <label style={{ display: 'flex', gap: '.4rem', alignItems: 'center', fontSize: '.88rem', margin: '.25rem 0 .75rem' }}>
        <input type="checkbox" checked={reiniciar} onChange={(ev) => setReiniciar(ev.target.checked)} />
        Fue el servicio preventivo: reiniciar el contador del próximo servicio
      </label>
      <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={guardando}>Volver</button>
        <button type="submit" className="btn btn-success" disabled={guardando}>{guardando ? 'Guardando…' : '✓ Guardar en la bitácora'}</button>
      </div>
    </form>
  );
}
