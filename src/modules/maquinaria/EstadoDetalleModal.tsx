import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { VistaPrevia, Dato } from '@/shared/ui/VistaPrevia';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { previewArchivo } from '@/shared/lib/reportePreview';
import { mensajeError } from '@/shared/lib/errores';
import { date as fmtDate, dateTime } from '@/shared/lib/format';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';
import { ESTADOS_EQUIPO, ORDEN_ESTADOS, diasDesde, estadoEfectivo, estadoExigeMotivo, ordenAbierta, servicioPorId, etiquetaServicio, textoHace } from './flota';
import {
  listEventosEstado, listOrdenesServicio, editarEventoEstado, eliminarEventoEstado, type EventoEstado, type OrdenServicio,
} from './flota.repository';
import { listDocumentosEquipo, BUCKET_DOCUMENTOS, type DocumentoEquipo } from './maquinariaDocumentos.repository';
import { nombreDescargaDocumento } from './documentosEquipo';
import { bloquesNotas, documentoInforme, esEventoInforme, imagenesDocumentos } from './flotaDetalle';
import { supabase } from '@/shared/lib/supabase';
import { AccionConEquipo } from './AccionConEquipo';
import { abrirInformeTecnico, verDocumentoEquipo } from './documentosVisor';
import { EstadoEquipoModal, type ModoEstado } from './EstadoEquipoModal';

const etiqueta = (e: string | null | undefined) => (e && e in ESTADOS_EQUIPO ? ESTADOS_EQUIPO[e as keyof typeof ESTADOS_EQUIPO].label : e ?? '—');

/** Chip-botón «📄 Informe técnico»: abre el PDF sin pasar por el detalle. */
export function ChipInforme({ equipoId, className = '' }: { equipoId: string; className?: string }) {
  return (
    <button type="button" className={`flo-chip flo-chip-btn tone-info ${className}`}
      onClick={(e) => { e.stopPropagation(); void abrirInformeTecnico(equipoId); }}
      title="Abrir el PDF del informe técnico">
      📄 Informe técnico
    </button>
  );
}

type Imagen = DocumentoEquipo & { url: string | null };

/**
 * Detalle del estado de un equipo: quién es (foto y datos), en qué estado está y desde
 * cuándo, el motivo completo del cambio, las notas (donde va el informe técnico), sus
 * documentos con el informe a un toque, las órdenes en curso y los accesos para actuar.
 * Se abre desde «Averías y estados» (tarjetas e historial) y desde el expediente.
 */
export function EstadoDetalleModal({ equipo, evento, enExpediente = false, onClose, onCambio }: {
  equipo: MaquinariaEquipo;
  /** El cambio de estado tocado. Si no viene, se muestra el último del equipo. */
  evento?: EventoEstado | null;
  /** Dentro del expediente no hace falta «Abrir expediente». */
  enExpediente?: boolean;
  onClose: () => void;
  onCambio?: () => void;
}) {
  const { can } = usePermissions();
  const canWrite = can('maquinaria', 'escritura');
  const [docs, setDocs] = useState<DocumentoEquipo[]>([]);
  const [imagenes, setImagenes] = useState<Imagen[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenServicio[]>([]);
  const [ultimo, setUltimo] = useState<EventoEstado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [accion, setAccion] = useState<'orden' | 'elegir_estado' | null>(null);
  const [modoEstado, setModoEstado] = useState<ModoEstado | null>(null);
  const [editarEv, setEditarEv] = useState(false);
  const [borrarEv, setBorrarEv] = useState(false);

  const firmadas = useRef(new Map<string, string>());
  const cargar = useCallback(async () => {
    // El último cambio se carga siempre: dice si el tocado es el vigente (al borrarlo, el equipo vuelve atrás).
    const [d, o, ev] = await Promise.all([
      listDocumentosEquipo(equipo.id),
      listOrdenesServicio(equipo.id).catch(() => [] as OrdenServicio[]),
      listEventosEstado(equipo.id).catch(() => [] as EventoEstado[]),
    ]);
    setDocs(d);
    setOrdenes(o.filter((x) => ordenAbierta(x.estado)));
    setUltimo(ev[0] ?? null);
    // Solo se firman las imágenes nuevas: un refresco en vivo no hace parpadear las miniaturas.
    const imgs = imagenesDocumentos(d);
    const faltan = imgs.map((x) => x.path).filter((p) => !firmadas.current.has(p));
    if (faltan.length) {
      const { data } = await supabase.storage.from(BUCKET_DOCUMENTOS).createSignedUrls(faltan, 3600);
      faltan.forEach((p, i) => { const u = data?.[i]?.signedUrl; if (u) firmadas.current.set(p, u); });
    }
    setImagenes(imgs.map((x) => ({ ...x, url: firmadas.current.get(x.path) ?? null })));
  }, [equipo.id]);

  useEffect(() => {
    cargar().catch((e) => toast(mensajeError(e, 'No se pudo cargar el detalle'), 'error')).finally(() => setCargando(false));
  }, [cargar]);
  useRealtime(['maquinaria_documentos', 'maquinaria_ordenes_servicio', 'maquinaria_estado_eventos'], () => { void cargar().catch(() => {}); });

  const ev = evento ?? ultimo;
  const esVigente = !!ev && ultimo?.id === ev.id;
  const estado = estadoEfectivo(equipo);
  const st = ESTADOS_EQUIPO[estado];
  const informe = documentoInforme(docs);
  const fotoPrincipal = imagenes.find((i) => /equipo/i.test(i.nombre) && i.url) ?? imagenes.find((i) => i.url) ?? null;
  const notas = bloquesNotas(equipo.notas);
  const otrosDocs = docs.filter((d) => d.id !== informe?.id && !imagenes.some((i) => i.id === d.id));
  const deInforme = esEventoInforme(ev);
  const dias = diasDesde(equipo.estado_desde ?? null);
  const listo = () => { onCambio?.(); void cargar().catch(() => {}); };

  const opcionesEstado: { modo: ModoEstado; label: string; clase: string }[] = [
    ...(estado !== 'operativa' ? [{ modo: 'operativa' as const, label: estado === 'retirada' ? '✅ Reactivar (operativa)' : '✅ Volver a operativa', clase: 'btn-success' }] : []),
    ...(estado !== 'retirada' && estado !== 'averiada' && estado !== 'parada' ? [{ modo: 'averia' as const, label: '🔴 Reportar avería', clase: '' }] : []),
    ...(estado !== 'retirada' && estado !== 'espera' ? [{ modo: 'espera' as const, label: '⏳ Esperando instrucciones', clase: '' }] : []),
    ...(estado !== 'retirada' ? [{ modo: 'retirar' as const, label: '⬛ Retirar de servicio', clase: 'btn-danger' }] : []),
  ];

  return (
    <Modal title={`${st.icon} ${equipo.equipo} · detalle`} size="lg" onClose={onClose}
      footer={<>
        {!enExpediente && <Link className="btn btn-ghost" to={`/app/maquinaria/equipo/${equipo.id}`} onClick={onClose}>📂 Abrir expediente</Link>}
        {canWrite && estado !== 'retirada' && <button type="button" className="btn" onClick={() => setAccion('orden')}>🔧 Nueva orden</button>}
        {canWrite && <button type="button" className="btn" onClick={() => setAccion('elegir_estado')}>🔁 Cambiar estado</button>}
        <button type="button" className="btn btn-primary" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="flo flo-det">
        {/* Equipo */}
        <section className="flo-det-eq" aria-label="Equipo">
          {fotoPrincipal?.url ? (
            <button type="button" className="flo-det-foto" onClick={() => previewArchivo(fotoPrincipal.url as string, nombreDescargaDocumento(fotoPrincipal.nombre, fotoPrincipal.archivo))} aria-label={`Ver ${fotoPrincipal.nombre.toLowerCase()} en grande`}>
              <img src={fotoPrincipal.url} alt={`${equipo.equipo}: ${fotoPrincipal.nombre}`} />
            </button>
          ) : <div className="flo-det-foto sin" aria-hidden="true">🚜</div>}
          <div style={{ minWidth: 0 }}>
            <div className="flo-code">{equipo.equipo}</div>
            {equipo.tipo && <div className="flo-tipo">{equipo.tipo}</div>}
            <dl className="flo-det-datos">
              <div><dt>Marca</dt><dd>{equipo.marca || '—'}</dd></div>
              <div><dt>Modelo</dt><dd>{[equipo.modelo, equipo.anio].filter(Boolean).join(' · ') || '—'}</dd></div>
              <div><dt>Serial / PIN</dt><dd>{equipo.serial || '—'}</dd></div>
              <div><dt>Placa</dt><dd>{equipo.placa || '—'}</dd></div>
            </dl>
          </div>
        </section>

        {/* Estado y motivo */}
        <section className={`flo-det-card tone-${st.tono}`} aria-label="Estado">
          <div className="flo-det-fila">
            <span className={`flo-chip lg tone-${st.tono}`}>{st.icon} {st.label}</span>
            <span className="muted">{equipo.estado_desde ? `desde ${fmtDate(equipo.estado_desde)} · ${textoHace(dias)}` : 'sin fecha de inicio'}</span>
            {deInforme && <ChipInforme equipoId={equipo.id} />}
          </div>
          {ev ? (
            <>
              <p className="flo-det-cambio">{etiqueta(ev.estado_anterior)} → {etiqueta(ev.estado)}</p>
              <dl className="flo-det-motivo">
                <div><dt>Motivo</dt><dd>{ev.motivo || equipo.estado_nota || 'Sin motivo escrito.'}</dd></div>
                {ev.material && <div><dt>Falta</dt><dd>{ev.material}</dd></div>}
                {ev.nota && <div><dt>Nota</dt><dd>{ev.nota}</dd></div>}
                <div><dt>Registró</dt><dd>{ev.actor_name || ev.actor || '—'} · {dateTime(ev.created_at)}</dd></div>
              </dl>
              {canWrite && (
                <div className="flo-det-fila">
                  <button type="button" className="btn btn-sm" onClick={() => setEditarEv(true)}>✎ Editar motivo</button>
                  {ev.orden_servicio_id
                    ? <small className="muted">Lo registró una orden de servicio: se corrige o se borra desde la orden.</small>
                    : <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setBorrarEv(true)}>🗑 Borrar este cambio</button>}
                </div>
              )}
            </>
          ) : equipo.estado_nota ? (
            <dl className="flo-det-motivo"><div><dt>Motivo</dt><dd>{equipo.estado_nota}</dd></div></dl>
          ) : !cargando && <p className="muted" style={{ margin: 0, fontSize: '.84rem' }}>Sin cambios de estado registrados.</p>}
        </section>

        {/* Notas del equipo (informe técnico) */}
        <section className="flo-det-sec" aria-label="Notas del equipo">
          <h4>📝 Notas del equipo</h4>
          {notas.length ? notas.map((b, i) => (
            <div key={i} className="flo-det-notas">
              {b.titulo && <strong>{b.titulo}</strong>}
              {b.lineas.map((l, k) => <p key={k}>{l}</p>)}
            </div>
          )) : <p className="muted flo-det-vacio">Sin notas.</p>}
        </section>

        {/* Documentos */}
        <section className="flo-det-sec" aria-label="Documentos del equipo">
          <h4>📎 Documentos</h4>
          {cargando ? <p className="muted flo-det-vacio">Cargando…</p> : (
            <>
              {informe && (
                <div className="flo-det-informe">
                  <span className="ico" aria-hidden="true">📄</span>
                  <div style={{ minWidth: 0 }}><strong>{informe.nombre}</strong><small>{dateTime(informe.updated_at ?? informe.created_at)}{informe.subido_por_nombre || informe.subido_por ? ` · ${informe.subido_por_nombre || informe.subido_por}` : ''}</small></div>
                  <button type="button" className="btn btn-primary" onClick={() => void verDocumentoEquipo(informe)}>👁 Ver informe</button>
                </div>
              )}
              {imagenes.length > 0 && (
                <ul className="flo-det-fotos">
                  {imagenes.map((im) => (
                    <li key={im.id}>
                      {im.url ? (
                        <button type="button" onClick={() => previewArchivo(im.url as string, nombreDescargaDocumento(im.nombre, im.archivo))} aria-label={`Ver ${im.nombre.toLowerCase()} en grande`}>
                          <img src={im.url} alt={im.nombre} loading="lazy" />
                        </button>
                      ) : <span className="muted">Sin vista</span>}
                      <span>{im.nombre}</span>
                    </li>
                  ))}
                </ul>
              )}
              {otrosDocs.map((d) => (
                <div key={d.id} className="flo-det-informe otro">
                  <span className="ico" aria-hidden="true">📎</span>
                  <div style={{ minWidth: 0 }}><strong>{d.nombre}</strong><small>{d.archivo ?? ''}</small></div>
                  <button type="button" className="btn" onClick={() => void verDocumentoEquipo(d)}>👁 Ver</button>
                </div>
              ))}
              {!docs.length && <p className="muted flo-det-vacio">Sin documentos cargados.</p>}
            </>
          )}
        </section>

        {/* Órdenes en curso */}
        <section className="flo-det-sec" aria-label="Órdenes de servicio en curso">
          <h4>🔧 Órdenes de servicio en curso</h4>
          {ordenes.length ? (
            <ul className="flo-det-ordenes">
              {ordenes.map((o) => {
                const s = servicioPorId(o.tipo);
                const est = ORDEN_ESTADOS[o.estado];
                return (
                  <li key={o.id}>
                    <Link to={`/app/maquinaria/equipo/${equipo.id}?tab=servicios`} onClick={onClose}>
                      <span><strong>{s?.icon} {o.codigo}</strong> · {etiquetaServicio(o.tipo, o.trabajos)} · {fmtDate(o.created_at)}</span>
                      {est && <span className={`flo-chip tone-${est.tono}`}>{est.icon} {est.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : <p className="muted flo-det-vacio">{cargando ? 'Cargando…' : 'Ninguna orden en curso.'}</p>}
        </section>
      </div>

      {accion === 'orden' && (
        <AccionConEquipo accion="orden" equipos={[equipo]} equipoInicial={equipo.id} onClose={() => setAccion(null)} onDone={listo} />
      )}
      {accion === 'elegir_estado' && (
        <Modal compact title={`🔁 Cambiar estado · ${equipo.equipo}`} onClose={() => setAccion(null)}
          footer={<button type="button" className="btn btn-ghost" onClick={() => setAccion(null)}>Cancelar</button>}>
          <div className="flo flo-det-opciones">
            <p className="muted" style={{ margin: 0, fontSize: '.84rem' }}>Hoy está <strong>{st.label.toLowerCase()}</strong>. Elige el nuevo estado: antes de guardar verás qué cambia.</p>
            {opcionesEstado.map((o) => (
              <button key={o.modo} type="button" className={`btn ${o.clase}`} onClick={() => { setAccion(null); setModoEstado(o.modo); }}>{o.label}</button>
            ))}
          </div>
        </Modal>
      )}
      {modoEstado && <EstadoEquipoModal equipo={equipo} modo={modoEstado} onClose={() => setModoEstado(null)} onSaved={listo} />}
      {editarEv && ev && <EditarEventoModal equipo={equipo} evento={ev} onClose={() => setEditarEv(false)} onSaved={listo} />}
      {borrarEv && ev && (
        <ConfirmDialog title="Borrar cambio de estado" danger confirmText="Borrar"
          message={esVigente
            ? <>Es el <strong>estado vigente</strong> del equipo: al borrarlo, el equipo vuelve a <strong>«{etiqueta(ev.estado_anterior ?? 'operativa')}»</strong>. No se puede deshacer; queda en la auditoría.</>
            : 'Sale del historial. El estado actual del equipo no cambia. No se puede deshacer; queda en la auditoría.'}
          preview={<VistaPrevia><Dato label="Equipo">{equipo.equipo}</Dato><Dato label="Cambio">{`${etiqueta(ev.estado_anterior)} → ${etiqueta(ev.estado)}`}</Dato><Dato label="Motivo">{ev.motivo ?? undefined}</Dato><Dato label="Fecha">{dateTime(ev.created_at)}</Dato><Dato label="Registró">{ev.actor_name || ev.actor || undefined}</Dato></VistaPrevia>}
          onCancel={() => setBorrarEv(false)}
          onConfirm={() => {
            setBorrarEv(false);
            void eliminarEventoEstado(ev.id)
              .then(() => { toast(esVigente ? `Cambio borrado: ${equipo.equipo} vuelve a «${etiqueta(ev.estado_anterior ?? 'operativa')}».` : 'Cambio de estado borrado.', 'success'); listo(); })
              .catch((e) => toast(mensajeError(e, 'No se pudo borrar el cambio de estado'), 'error'));
          }} />
      )}
    </Modal>
  );
}

/** Corrige el motivo, lo que falta y la nota de un cambio de estado (el estado en sí no se cambia). */
function EditarEventoModal({ equipo, evento, onClose, onSaved }: {
  equipo: MaquinariaEquipo; evento: EventoEstado; onClose: () => void; onSaved: () => void;
}) {
  const [motivo, setMotivo] = useState(evento.motivo ?? '');
  const [material, setMaterial] = useState(evento.material ?? '');
  const [nota, setNota] = useState(evento.nota ?? '');
  const [saving, setSaving] = useState(false);
  const falta = estadoExigeMotivo(evento.estado) && motivo.trim().length < 3;
  const conMaterial = evento.estado === 'averiada' || evento.estado === 'parada' || !!evento.material;

  async function guardar() {
    setSaving(true);
    try {
      await editarEventoEstado(evento.id, motivo.trim() || null, conMaterial ? material.trim() || null : evento.material, nota.trim() || null);
      toast('Cambio de estado corregido.', 'success');
      onSaved();
      onClose();
    } catch (e) { toast(mensajeError(e, 'No se pudo guardar'), 'error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal compact title={`✎ Editar cambio de estado · ${equipo.equipo}`} onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={() => void guardar()} disabled={saving || falta}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
      </>}>
      <div className="flo" style={{ display: 'grid', gap: '.7rem' }}>
        <p className="muted" style={{ margin: 0, fontSize: '.84rem' }}>{etiqueta(evento.estado_anterior)} → <strong>{etiqueta(evento.estado)}</strong> · {dateTime(evento.created_at)}. El estado no se cambia aquí: para eso usa «🔁 Cambiar estado».</p>
        <div className="form-row" style={{ marginBottom: 0 }}><label htmlFor="ev-motivo">Motivo{estadoExigeMotivo(evento.estado) ? '' : ' (opcional)'}</label>
          <textarea id="ev-motivo" className="textarea" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        {conMaterial && (
          <div className="form-row" style={{ marginBottom: 0 }}><label htmlFor="ev-material">Lo que falta (opcional)</label>
            <input id="ev-material" className="input" value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Caucho, aceite, repuesto…" />
          </div>
        )}
        <div className="form-row" style={{ marginBottom: 0 }}><label htmlFor="ev-nota">Nota (opcional)</label>
          <textarea id="ev-nota" className="textarea" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} />
        </div>
        {falta && <div className="aviso warning sm"><span className="aviso-icono">⚠️</span><div>Escribe el motivo (al menos 3 letras).</div></div>}
      </div>
    </Modal>
  );
}
