/* ============================================================
   MGG · RRHH · Minutas · detalle

   La minuta en solo lectura, sección por sección y con los nombres del papel,
   más la galería de adjuntos (subida en tanda, visor con zoom y rotación) y los
   botones de imprimir, editar y borrar. Editar abre el editor; acá no se cambia
   ningún campo de la minuta.
   ============================================================ */
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ConfirmDialog, Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { date } from '@/shared/lib/format';
import { previewArchivo } from '@/shared/lib/reportePreview';
import type { Minuta, MinutaAdjunto } from '@/shared/lib/types';
import {
  ACEPTA_ADJUNTO, borrarAdjunto, errorArchivoAdjunto, listAdjuntos, subirAdjunto, urlAdjunto,
} from './minutaAdjuntos.repository';
import { generarMinutaPdf } from './minutaPdf';
import { borrarMinuta } from './minutas.repository';
import {
  dimensionesVisor, escalaSiguiente, esImagenAdjunto, giroSiguiente, repartirTanda,
} from './minutaVisor';

interface MinutaDetalleModalProps {
  minuta: Minuta;
  canWrite: boolean;
  actor: string;
  onClose: () => void;
  onEditar: () => void;
  onBorrada: () => void;
}

const msg = (e: unknown, def: string) => (e instanceof Error ? e.message : def);

const peso = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: '1rem' }}>
      <h4 style={{ margin: '0 0 .4rem' }}>{titulo}</h4>
      {children}
    </section>
  );
}

const Vacio = () => <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>—</p>;

/** Texto libre que respeta los saltos de línea. */
const Texto = ({ valor }: { valor: string | null | undefined }) =>
  valor?.trim()
    ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{valor}</p>
    : <Vacio />;

const Lista = ({ items }: { items: string[] }) => {
  const con = items.filter((s) => s.trim());
  return con.length === 0
    ? <Vacio />
    : <ol style={{ margin: 0, paddingLeft: '1.3rem' }}>{con.map((s, i) => <li key={i}>{s}</li>)}</ol>;
};

const pct = (n: number | null) => (n === null || n === undefined ? '—' : `${n} %`);

/** Visor de una imagen con zoom y rotación. */
function VisorImagen({ url, nombre, onClose }: { url: string; nombre: string; onClose: () => void }) {
  const [escala, setEscala] = useState(1);
  const [giro, setGiro] = useState(0);
  /** Proporción natural y ancho disponible, conocidos al cargar la imagen. */
  const [medida, setMedida] = useState<{ nw: number; nh: number; base: number } | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);
  const dim = medida ? dimensionesVisor(giro, escala, medida.base, medida.nw, medida.nh) : null;
  return (
    <Modal
      title={nombre} size="xl" onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" title="Alejar" aria-label="Alejar"
            onClick={() => setEscala((e) => escalaSiguiente(e, -1))}>−</button>
          <span className="muted" style={{ minWidth: '3.5rem', textAlign: 'center' }}>{Math.round(escala * 100)} %</span>
          <button type="button" className="btn btn-ghost" title="Acercar" aria-label="Acercar"
            onClick={() => setEscala((e) => escalaSiguiente(e, 1))}>+</button>
          <button type="button" className="btn btn-ghost" title="Rotar" aria-label="Rotar"
            onClick={() => setGiro(giroSiguiente)}>⟳</button>
          <button type="button" className="btn btn-ghost"
            onClick={() => { setEscala(1); setGiro(0); }}>Restablecer</button>
        </>
      }
    >
      <div ref={contenedor} style={{ overflow: 'auto', maxHeight: '70vh', padding: '1rem' }}>
        {/* La caja mide lo que ocupa la imagen YA girada y la imagen gira sobre su
            centro dentro de ella: así el scroll llega a todas partes. Con un simple
            transform, una foto apaisada girada 90° sobresale y se recorta. */}
        <div style={dim ? { position: 'relative', width: dim.caja.w, height: dim.caja.h, margin: '0 auto' } : undefined}>
          <img src={url} alt={nombre}
            onLoad={(e) => {
              const im = e.currentTarget;
              const ancho = (contenedor.current?.clientWidth ?? im.naturalWidth) - 32;
              setMedida({ nw: im.naturalWidth, nh: im.naturalHeight, base: Math.max(1, ancho) });
            }}
            style={dim
              ? {
                  position: 'absolute', left: '50%', top: '50%', width: dim.img.w, height: dim.img.h,
                  maxWidth: 'none', transform: `translate(-50%, -50%) rotate(${giro}deg)`, transition: 'transform .15s',
                }
              : { maxWidth: '100%' }} />
        </div>
      </div>
    </Modal>
  );
}

export function MinutaDetalleModal({
  minuta, canWrite, actor, onClose, onEditar, onBorrada,
}: MinutaDetalleModalProps) {
  const [adjuntos, setAdjuntos] = useState<MinutaAdjunto[]>([]);
  const [cargando, setCargando] = useState(true);
  /** Enlaces firmados de las miniaturas, por id de adjunto. */
  const [miniaturas, setMiniaturas] = useState<Record<string, string>>({});
  const [subiendo, setSubiendo] = useState(false);
  const [visor, setVisor] = useState<{ url: string; nombre: string } | null>(null);
  const [porQuitar, setPorQuitar] = useState<MinutaAdjunto | null>(null);
  const [confirmaBorrar, setConfirmaBorrar] = useState(false);
  const [imprimiendo, setImprimiendo] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const recargar = useCallback(async () => {
    try {
      const lista = await listAdjuntos(minuta.id);
      setAdjuntos(lista);
      // Miniaturas: hay que firmar para poder mostrarlas. Si una no se puede
      // firmar, queda con el ícono; no tumba la lista.
      const pares = await Promise.all(lista.filter((a) => esImagenAdjunto(a.tipo)).map(async (a) => {
        try { return [a.id, await urlAdjunto(a.path)] as const; } catch { return null; }
      }));
      setMiniaturas(Object.fromEntries(pares.filter((p): p is readonly [string, string] => p !== null)));
    } catch (e) {
      toast(msg(e, 'No se pudieron cargar los adjuntos'), 'error');
    } finally { setCargando(false); }
  }, [minuta.id]);

  useEffect(() => { void recargar(); }, [recargar]);

  /** Subida en tanda: un archivo rechazado muestra su motivo y los demás siguen. */
  async function subirVarios(files: FileList) {
    const { validos, rechazados } = repartirTanda(Array.from(files), errorArchivoAdjunto);
    for (const r of rechazados) toast(`${r.nombre}: ${r.motivo}`, 'error');
    if (validos.length === 0) return;
    setSubiendo(true);
    try {
      for (const f of validos) {
        try {
          await subirAdjunto(minuta.id, f, actor);
        } catch (e) {
          toast(`${f.name}: ${msg(e, 'no se pudo subir')}`, 'error');
        }
      }
      await recargar();
    } finally { setSubiendo(false); }
  }

  /** El enlace se pide al abrir: dura 10 min y el modal puede llevar abierto más. */
  async function abrir(a: MinutaAdjunto) {
    try {
      const url = await urlAdjunto(a.path);
      if (esImagenAdjunto(a.tipo)) setVisor({ url, nombre: a.nombre });
      else previewArchivo(url, a.nombre);
    } catch (e) {
      toast(msg(e, 'No se pudo abrir el archivo'), 'error');
    }
  }

  async function quitarAdjunto(a: MinutaAdjunto) {
    setPorQuitar(null);
    try {
      await borrarAdjunto(a);
      await recargar();
    } catch (e) {
      toast(msg(e, 'No se pudo borrar el adjunto'), 'error');
    }
  }

  async function adjuntosParaPdf() {
    if (!minuta.anexar_adjuntos_pdf) return [];
    const out: { nombre: string; dataUrl?: string; tipo?: string }[] = [];
    let fallidas = 0;
    for (const a of adjuntos) {
      // Los PDF no se fusionan: el generador solo necesita el nombre para listarlos.
      if (!esImagenAdjunto(a.tipo)) { out.push({ nombre: a.nombre, tipo: a.tipo }); continue; }
      try {
        const url = await urlAdjunto(a.path);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, rej) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => rej(fr.error);
          fr.readAsDataURL(blob);
        });
        out.push({ nombre: a.nombre, dataUrl, tipo: a.tipo });
      } catch { fallidas += 1; /* esa imagen no va al PDF; el resto sí */ }
    }
    if (fallidas > 0) {
      toast(`${fallidas === 1 ? 'Una imagen no se pudo anexar' : `${fallidas} imágenes no se pudieron anexar`} al PDF y quedó fuera.`, 'error');
    }
    return out;
  }

  function alSoltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setArrastrando(false);
    if (!canWrite || subiendo) return;
    if (e.dataTransfer.files.length > 0) void subirVarios(e.dataTransfer.files);
  }

  async function imprimir() {
    setImprimiendo(true);
    try {
      await generarMinutaPdf(minuta, { adjuntos: await adjuntosParaPdf() });
    } catch (e) {
      toast(msg(e, 'No se pudo generar el PDF'), 'error');
    } finally { setImprimiendo(false); }
  }

  async function borrar() {
    setConfirmaBorrar(false);
    setBorrando(true);
    try {
      await borrarMinuta(minuta.id);
      toast('Minuta borrada', 'success');
      onBorrada();
    } catch (e) {
      toast(msg(e, 'No se pudo borrar la minuta'), 'error');
      setBorrando(false);
    }
  }

  const participantes = minuta.participantes ?? [];
  const acuerdos = minuta.acuerdos ?? [];
  const avances = minuta.avances ?? [];

  return (
    <>
      <Modal
        title={`Minuta ${minuta.numero}`} size="xl" onClose={onClose}
        footer={
          <>
            <button type="button" className="btn btn-ghost" disabled={imprimiendo} onClick={() => void imprimir()}>
              {imprimiendo ? 'Generando…' : '🖨 Imprimir esta minuta'}
            </button>
            {canWrite && (
              <button type="button" className="btn btn-ghost" onClick={onEditar}>✎ Editar</button>
            )}
            {canWrite && (
              <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }}
                disabled={borrando} onClick={() => setConfirmaBorrar(true)}>🗑 Borrar</button>
            )}
          </>
        }
      >
        <Seccion titulo="Datos de la reunión">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '.5rem' }}>
            <div><small className="muted">Fecha</small><div>{date(minuta.fecha)}</div></div>
            <div><small className="muted">Hora de inicio</small><div>{minuta.hora_inicio || '—'}</div></div>
            <div><small className="muted">Lugar</small><div>{minuta.lugar || '—'}</div></div>
            <div><small className="muted">Estado</small><div>{minuta.estado === 'finalizada' ? 'Finalizada' : 'Borrador'}</div></div>
          </div>
          <div style={{ marginTop: '.5rem' }}>
            <small className="muted">Objetivo</small>
            <Texto valor={minuta.objetivo} />
          </div>
        </Seccion>

        <Seccion titulo="Orden del día"><Lista items={minuta.orden_dia ?? []} /></Seccion>

        <Seccion titulo="Participantes">
          {participantes.length === 0 ? <Vacio /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Nombre</th><th>Cargo</th></tr></thead>
              <tbody>{participantes.map((p, i) => (
                <tr key={i}><td>{p.nombre || '—'}</td><td>{p.cargo || '—'}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Seccion>

        <Seccion titulo="Acuerdos y compromisos">
          {acuerdos.length === 0 ? <Vacio /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Responsable</th><th>Actividad</th><th>Fecha de compromiso</th></tr></thead>
              <tbody>{acuerdos.map((a, i) => (
                <tr key={i}>
                  <td>{a.responsable || '—'}</td>
                  <td style={{ whiteSpace: 'pre-wrap' }}>{a.actividad || '—'}</td>
                  <td>{date(a.fecha_compromiso)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Seccion>

        <Seccion titulo="Otros asuntos"><Texto valor={minuta.otros_asuntos} /></Seccion>

        <Seccion titulo="Próxima reunión">
          <div style={{ marginBottom: '.4rem' }}>
            <small className="muted">Fecha</small> <strong>{date(minuta.proxima_fecha)}</strong>
          </div>
          <small className="muted">Puntos a tratar</small>
          <Lista items={minuta.proximos_puntos ?? []} />
        </Seccion>

        <Seccion titulo="Seguimiento de avances">
          {avances.length === 0 ? <Vacio /> : (
            <div className="table-wrap"><table className="table">
              <thead><tr>
                <th>Actividad</th><th>Responsable</th><th>Fecha programada</th><th>Fecha de revisión</th>
                <th>% inicial</th><th>Revisión final</th><th>% avance</th>
              </tr></thead>
              <tbody>{avances.map((a, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'pre-wrap' }}>{a.actividad || '—'}</td>
                  <td>{a.responsable || '—'}</td>
                  <td>{date(a.fecha_programada)}</td>
                  <td>{date(a.revision_fecha)}</td>
                  <td>{pct(a.pct_inicial)}</td>
                  <td style={{ whiteSpace: 'pre-wrap' }}>{a.revision_final || '—'}</td>
                  <td>{pct(a.pct_avance)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Seccion>

        <Seccion titulo="Observaciones"><Texto valor={minuta.observaciones} /></Seccion>

        <Seccion titulo="Adjuntos">
          <div
            onDragOver={(e) => { if (canWrite) { e.preventDefault(); setArrastrando(true); } }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={alSoltar}
            style={{
              border: `2px dashed ${arrastrando ? 'var(--primary, #2563eb)' : 'transparent'}`,
              borderRadius: 8, padding: '.4rem',
              background: arrastrando ? 'rgba(37,99,235,.06)' : undefined,
            }}>
          {canWrite && (
            <p className="muted" style={{ fontSize: '.8rem', margin: '0 0 .4rem' }}>
              Arrastrá archivos acá o usá el botón para elegirlos.
            </p>
          )}
          {canWrite && (
            <div style={{ marginBottom: '.5rem' }}>
              <input ref={input} type="file" accept={ACEPTA_ADJUNTO} multiple style={{ display: 'none' }}
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) void subirVarios(files);
                  e.target.value = '';
                }} />
              <button type="button" className="btn btn-sm btn-ghost" disabled={subiendo}
                onClick={() => input.current?.click()}>
                {subiendo ? 'Subiendo…' : '📎 Añadir adjuntos'}
              </button>
            </div>
          )}

          {cargando && <p className="muted" style={{ fontSize: '.85rem' }}>Cargando adjuntos…</p>}
          {!cargando && adjuntos.length === 0 && (
            <p className="muted" style={{ fontSize: '.85rem', margin: 0 }}>Esta minuta no tiene adjuntos.</p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '.6rem' }}>
            {adjuntos.map((a) => {
              const thumb = miniaturas[a.id];
              return (
                <div key={a.id} className="tira" style={{ padding: '.5rem' }}>
                  <button type="button" onClick={() => void abrir(a)} title="Abrir"
                    style={{
                      all: 'unset', cursor: 'pointer', display: 'grid', placeItems: 'center',
                      width: '100%', height: '100px', overflow: 'hidden',
                    }}>
                    {thumb
                      ? <img src={thumb} alt={a.nombre} loading="lazy"
                          style={{ maxWidth: '100%', maxHeight: '100px', objectFit: 'contain' }}
                          onError={() => setMiniaturas((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== a.id)))} />
                      : <span style={{ fontSize: '2.2rem' }}>{esImagenAdjunto(a.tipo) ? '🖼' : '📄'}</span>}
                  </button>
                  <div style={{ fontSize: '.75rem', wordBreak: 'break-word', marginTop: '.3rem' }}>{a.nombre}</div>
                  <div className="muted" style={{ fontSize: '.7rem' }}>{peso(a.bytes)}</div>
                  {canWrite && (
                    <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }}
                      title="Quitar adjunto" aria-label="Quitar adjunto"
                      onClick={() => setPorQuitar(a)}>🗑</button>
                  )}
                </div>
              );
            })}
          </div>
          {minuta.anexar_adjuntos_pdf && (
            <small className="muted" style={{ display: 'block', marginTop: '.4rem' }}>
              Las imágenes se anexan al PDF al imprimir y los PDF se listan por nombre.
            </small>
          )}
          </div>
        </Seccion>
      </Modal>

      {visor && <VisorImagen url={visor.url} nombre={visor.nombre} onClose={() => setVisor(null)} />}

      {porQuitar && (
        <ConfirmDialog
          title="Quitar adjunto" danger confirmText="Sí, borrar"
          message={<>El archivo <strong>{porQuitar.nombre}</strong> se borra del servidor y no se puede recuperar.</>}
          onConfirm={() => { void quitarAdjunto(porQuitar); }}
          onCancel={() => setPorQuitar(null)}
        />
      )}

      {confirmaBorrar && (
        <ConfirmDialog
          title="Borrar minuta" danger confirmText="Sí, borrar"
          message={<>Vas a borrar la minuta <strong>{minuta.numero}</strong>. Se borra también con todos sus adjuntos y no se puede recuperar.</>}
          onConfirm={() => { void borrar(); }}
          onCancel={() => setConfirmaBorrar(false)}
        />
      )}
    </>
  );
}
