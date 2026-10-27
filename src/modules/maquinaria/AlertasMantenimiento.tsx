/* ============================================================
   Golden Touch · Control de Maquinaria · Alertas de mantenimiento (26/10/2026)

   Banner resaltado (igual al «DINERO POR ENTRAR» de Acopio) con los equipos que
   tienen el servicio PRÓXIMO o VENCIDO. Al tocarlo se abre la lista ordenada por
   urgencia y, con permiso de escritura, cada equipo se puede RESPONDER: si se hará
   o no el mantenimiento y por qué. La respuesta queda en la base (bitácora del
   equipo) y se puede mandar por WhatsApp con el formato
   «ALERTA MANTENIMIENTO - RETRASADO / PRÓXIMO».

   Lo montan la vista de PC y la del teléfono con esta API:
     <AlertasMantenimientoBanner items actor actorName canWrite compacto? onChanged? />
     <RespuestaAlertaModal item actor actorName onClose onSaved? />
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { CompartirWhatsapp } from '@/shared/ui/CompartirWhatsapp';
import { useRealtime } from '@/shared/lib/useRealtime';
import { mensajeError } from '@/shared/lib/errores';
import { num as fmtNum, dateTime } from '@/shared/lib/format';
import { quienSync, useQuien } from '@/shared/lib/directorioUsuarios';
import { frecuenciaHrs, type AvisoServicio } from './flota';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';
import {
  registrarRespuestaAlerta, ultimasRespuestasPorEquipo, TABLAS_ALERTAS_MANT, type RespuestaAlerta,
} from './alertasMantenimiento.repository';
import { textoAlertaMantenimientoWhatsapp } from './maquinariaWhatsapp';

export interface EquipoConAviso {
  equipo: MaquinariaEquipo;
  aviso: AvisoServicio;
  /** Lectura vigente en la unidad del aviso (horómetro si `aviso.unidad === 'h'`, km si es 'km'). */
  lectura: number | null;
}

/* ───────── Helpers ───────── */

/** Frecuencia del servicio en la unidad del aviso (horas: la del equipo o 250 por defecto). */
function frecuenciaDe(item: EquipoConAviso): number | null {
  if (item.aviso.unidad === 'h') return frecuenciaHrs(item.equipo);
  const km = Number(item.equipo.mantenimiento_cada_km);
  return km > 0 ? km : null;
}

/** «pasado por 55 h» (vencido) o «faltan 12 h» (próximo). */
function textoRestante(nivel: 'proximo' | 'vencido', restante: number | null, unidad: 'h' | 'km'): string {
  if (restante == null) return '';
  return nivel === 'vencido' ? `pasado por ${fmtNum(Math.abs(restante))} ${unidad}` : `faltan ${fmtNum(restante)} ${unidad}`;
}

/** «Horómetro 4.305 h · cada 250 h» (la parte neutra del resumen del contador). */
function textoContador(unidad: 'h' | 'km', lectura: number | null, frecuencia: number | null): string {
  const nombre = unidad === 'h' ? 'Horómetro' : 'Kilometraje';
  const partes = [
    lectura != null ? `${nombre} ${fmtNum(lectura)} ${unidad}` : `${nombre} sin lectura`,
    frecuencia != null ? `cada ${fmtNum(frecuencia)} ${unidad}` : '',
  ].filter(Boolean);
  return partes.join(' · ');
}

const nivelAviso = (a: AvisoServicio): 'proximo' | 'vencido' => (a.nivel === 'vencido' ? 'vencido' : 'proximo');

const ROJO_SUAVE = 'rgba(239,68,68,.18)';
const AMBAR = 'var(--warning, #f59e0b)';
const AMBAR_SUAVE = 'rgba(245,158,11,.18)';

/** Variante roja del pulso `alert-presione` (theme.css solo trae la verde y la ámbar). */
const ESTILO_PULSO_ROJO = `
.alert-mant-danger { position: relative; animation: alertPulseMant 1.6s ease-in-out infinite; }
.alert-mant-danger::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  box-shadow: 0 0 0 0 rgba(239,68,68,.55); animation: alertRingMant 1.6s ease-out infinite; }
@keyframes alertPulseMant { 0%, 100% { border-color: var(--danger); } 50% { border-color: #f87171; } }
@keyframes alertRingMant { 0% { box-shadow: 0 0 0 0 rgba(239,68,68,.55); } 100% { box-shadow: 0 0 0 12px rgba(239,68,68,0); } }
@media (prefers-reduced-motion: reduce) { .alert-mant-danger, .alert-mant-danger::after { animation: none; } }
`;

/* ───────── Banner ───────── */

export function AlertasMantenimientoBanner({ items, actor, actorName, canWrite, compacto = false, onChanged }: {
  items: EquipoConAviso[];
  actor: string;
  actorName: string | null;
  canWrite: boolean;
  /** Teléfono: paddings y letras más chicas. */
  compacto?: boolean;
  /** Se avisa cuando se registró una respuesta (para que la página recargue si quiere). */
  onChanged?: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const vencidos = items.filter((i) => i.aviso.nivel === 'vencido').length;
  const proximos = items.filter((i) => i.aviso.nivel === 'proximo').length;
  const total = vencidos + proximos;
  const hayVencidos = vencidos > 0;

  const color = hayVencidos ? 'var(--danger)' : AMBAR;
  const suave = hayVencidos ? ROJO_SUAVE : AMBAR_SUAVE;
  const clasePulso = total ? (hayVencidos ? ' alert-presione alert-mant-danger' : ' alert-presione-warn') : '';

  const subtitulo = total
    ? `${vencidos} equipo${vencidos === 1 ? '' : 's'} con servicio vencido · ${proximos} próximo${proximos === 1 ? '' : 's'} · toca para responder`
    : 'Sin equipos próximos ni vencidos';

  return (
    <>
      {hayVencidos && <style>{ESTILO_PULSO_ROJO}</style>}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`card${clasePulso}`}
        aria-label={total ? `Alertas de mantenimiento: ${subtitulo}` : 'Alertas de mantenimiento'}
        style={{
          width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: compacto ? '.6rem' : '1rem',
          padding: compacto ? '.55rem .75rem' : undefined,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: compacto ? '.6rem' : '1rem',
          borderColor: total ? color : 'var(--border)',
          borderWidth: total ? 2 : 1,
          background: total ? `linear-gradient(135deg, ${suave}, var(--surface))` : 'var(--surface)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: compacto ? '.5rem' : '.7rem', minWidth: 0 }}>
          <span style={{ fontSize: compacto ? '1.25rem' : '1.5rem' }}>{total ? '🚨' : '🔧'}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, letterSpacing: '.02em', color: total ? color : undefined, fontSize: compacto ? '.86rem' : undefined }}>
              {total ? '🚨 ¡ALERTA DE MANTENIMIENTO!' : 'ALERTAS DE MANTENIMIENTO'}
            </div>
            <div className="muted" style={{ fontSize: compacto ? '.7rem' : '.78rem' }}>
              {total ? subtitulo : 'ALERTAS DE MANTENIMIENTO · Sin equipos próximos ni vencidos'}
            </div>
          </div>
        </div>
        {total > 0 && (
          <span className="badge" style={{ background: color, color: hayVencidos ? '#fff' : '#1f1300', fontWeight: 700, flexShrink: 0 }}>
            {total}
          </span>
        )}
      </button>

      {open && (
        <ListaAlertasModal items={items} actor={actor} actorName={actorName} canWrite={canWrite}
          onClose={() => setOpen(false)} onChanged={onChanged} />
      )}
    </>
  );
}

/* ───────── Lista de equipos en alerta ───────── */

function ListaAlertasModal({ items, actor, actorName, canWrite, onClose, onChanged }: {
  items: EquipoConAviso[];
  actor: string;
  actorName: string | null;
  canWrite: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const quien = useQuien();
  const [ultimas, setUltimas] = useState<Map<string, RespuestaAlerta>>(new Map());
  const [respondiendo, setRespondiendo] = useState<EquipoConAviso | null>(null);
  const [wspAbierto, setWspAbierto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try { setUltimas(await ultimasRespuestasPorEquipo()); }
    catch (e) { toast(mensajeError(e, 'No se pudieron cargar las respuestas'), 'error'); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime([...TABLAS_ALERTAS_MANT], () => { void cargar(); });

  // Más urgente primero: el que más se pasó del intervalo (ratio sin tope).
  const ordenados = useMemo(() => [...items].sort((a, b) => b.aviso.ratio - a.aviso.ratio), [items]);

  return (
    <Modal title="🚨 Alertas de mantenimiento" size="lg" onClose={onClose}
      footer={<button className="btn btn-ghost" onClick={onClose}>Cerrar</button>}>
      {!ordenados.length ? (
        <p className="muted" style={{ margin: 0 }}>No hay equipos con servicio próximo ni vencido.</p>
      ) : (
        <div style={{ display: 'grid', gap: '.75rem' }}>
          {ordenados.map((it) => {
            const nivel = nivelAviso(it.aviso);
            const vencido = nivel === 'vencido';
            const color = vencido ? 'var(--danger)' : AMBAR;
            const frecuencia = frecuenciaDe(it);
            const ult = ultimas.get(it.equipo.id) ?? null;
            return (
              <div key={it.equipo.id} className="card" style={{ margin: 0, borderColor: color }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.6rem', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                      <strong>{it.equipo.equipo}</strong>
                      {it.equipo.placa && <span className="badge mono">{it.equipo.placa}</span>}
                      <span className="badge" style={{ background: color, color: vencido ? '#fff' : '#1f1300', fontWeight: 700 }}>
                        {vencido ? 'VENCIDO' : 'PRÓXIMO'}
                      </span>
                    </div>
                    <div style={{ fontSize: '.84rem', marginTop: '.25rem' }}>
                      {textoContador(it.aviso.unidad, it.lectura, frecuencia)}
                      {' · '}
                      <strong style={{ color }}>{textoRestante(nivel, it.aviso.restante, it.aviso.unidad)}</strong>
                    </div>
                  </div>
                  {canWrite && (
                    <button type="button" className="btn btn-primary" onClick={() => setRespondiendo(it)}>
                      ✍ Responder
                    </button>
                  )}
                </div>

                {/* Última respuesta registrada para este equipo */}
                {ult ? (
                  <div style={{ marginTop: '.55rem', paddingTop: '.5rem', borderTop: '1px dashed var(--border)', fontSize: '.8rem' }}>
                    <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ color: ult.decision === 'hara' ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
                        {ult.decision === 'hara' ? '✅ Sí hará' : '❌ No hará'}
                      </span>
                      <span>· {ult.mensaje}</span>
                      <span className="muted">· {quien(ult.actor_name, ult.actor) || '—'} · {dateTime(ult.created_at)}</span>
                      {ult.texto_whatsapp && (
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setWspAbierto(wspAbierto === ult.id ? null : ult.id)}>
                          {wspAbierto === ult.id ? '✕ Ocultar' : '📲 WhatsApp'}
                        </button>
                      )}
                    </div>
                    {wspAbierto === ult.id && ult.texto_whatsapp && (
                      <div style={{ marginTop: '.5rem' }}><CompartirWhatsapp texto={ult.texto_whatsapp} /></div>
                    )}
                  </div>
                ) : (
                  <div className="muted" style={{ marginTop: '.45rem', fontSize: '.76rem' }}>Sin respuesta registrada todavía.</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {respondiendo && (
        <RespuestaAlertaModal item={respondiendo} actor={actor} actorName={actorName}
          onClose={() => setRespondiendo(null)}
          onSaved={() => { void cargar(); onChanged?.(); }} />
      )}
    </Modal>
  );
}

/* ───────── Responder a la alerta ───────── */

export function RespuestaAlertaModal({ item, actor, actorName, onClose, onSaved }: {
  item: EquipoConAviso;
  actor: string;
  actorName: string | null;
  onClose: () => void;
  onSaved?: (r: RespuestaAlerta) => void;
}): JSX.Element {
  const [decision, setDecision] = useState<'hara' | 'no_hara' | null>(null);
  const [mensaje, setMensaje] = useState('');
  const [saving, setSaving] = useState(false);
  /** Respuesta ya guardada cuando se eligió «Guardar y enviar»: se muestra el botón de WhatsApp. */
  const [guardada, setGuardada] = useState<RespuestaAlerta | null>(null);

  const nivel = nivelAviso(item.aviso);
  const vencido = nivel === 'vencido';
  const color = vencido ? 'var(--danger)' : AMBAR;
  const frecuencia = frecuenciaDe(item);
  const responsable = quienSync(actorName, actor) || actor;

  // Vista previa del texto que se va a guardar y enviar (se arma con lo que se va escribiendo).
  const texto = useMemo(() => textoAlertaMantenimientoWhatsapp({
    equipo: item.equipo.equipo,
    placa: item.equipo.placa,
    nivel,
    unidad: item.aviso.unidad,
    lectura: item.lectura,
    frecuencia,
    restante: item.aviso.restante,
    decision: decision ?? 'hara',
    mensaje: mensaje.trim() || '…',
    responsable,
    fecha: new Date().toISOString(),
  }), [item, nivel, frecuencia, decision, mensaje, responsable]);

  const listo = decision != null && mensaje.trim().length >= 3;

  async function guardar(enviar: boolean) {
    if (!decision) { toast('Elige si se hará o no el mantenimiento.', 'error'); return; }
    if (mensaje.trim().length < 3) { toast('Escribe el mensaje (mínimo 3 letras).', 'error'); return; }
    setSaving(true);
    try {
      const r = await registrarRespuestaAlerta({
        equipoId: item.equipo.id,
        nivel,
        unidad: item.aviso.unidad,
        lectura: item.lectura,
        frecuencia,
        restante: item.aviso.restante,
        decision,
        mensaje,
        textoWhatsapp: texto,
      }, actor, actorName);
      toast('Respuesta registrada en la bitácora del equipo', 'success');
      onSaved?.(r);
      if (enviar) setGuardada(r);
      else onClose();
    } catch (e) { toast(mensajeError(e, 'No se pudo guardar la respuesta'), 'error'); }
    finally { setSaving(false); }
  }

  const opcion = (valor: 'hara' | 'no_hara', etiqueta: string, tono: string) => {
    const activa = decision === valor;
    return (
      <button type="button" className="card" onClick={() => setDecision(valor)} disabled={!!guardada}
        aria-pressed={activa}
        style={{
          margin: 0, cursor: 'pointer', textAlign: 'left', fontWeight: 700, fontSize: '.95rem',
          borderColor: activa ? tono : 'var(--border)', borderWidth: activa ? 2 : 1,
          background: activa ? `linear-gradient(135deg, ${valor === 'hara' ? 'rgba(34,197,94,.18)' : ROJO_SUAVE}, var(--surface))` : 'var(--surface)',
          color: activa ? tono : undefined,
        }}>
        {etiqueta}
      </button>
    );
  };

  return (
    <Modal title={`${vencido ? '🚨' : '⚠️'} Responder alerta · ${item.equipo.equipo}`} size="md" onClose={onClose}
      footer={guardada ? (
        <button className="btn btn-primary" onClick={onClose}>Listo</button>
      ) : (
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-ghost" onClick={() => void guardar(false)} disabled={saving || !listo}>Guardar sin enviar</button>
          <button className="btn btn-primary" onClick={() => void guardar(true)} disabled={saving || !listo}>
            {saving ? 'Guardando…' : '📲 Guardar y enviar por WhatsApp'}
          </button>
        </>
      )}>
      {/* Datos del equipo y del aviso */}
      <div className="card" style={{ margin: '0 0 .75rem', borderColor: color, background: `linear-gradient(135deg, ${vencido ? ROJO_SUAVE : AMBAR_SUAVE}, var(--surface))` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <strong>{item.equipo.equipo}</strong>
          {item.equipo.placa && <span className="badge mono">{item.equipo.placa}</span>}
          <span className="badge" style={{ background: color, color: vencido ? '#fff' : '#1f1300', fontWeight: 700 }}>
            {vencido ? 'MANTENIMIENTO VENCIDO' : 'MANTENIMIENTO PRÓXIMO'}
          </span>
        </div>
        <div style={{ fontSize: '.86rem', marginTop: '.3rem' }}>
          {textoContador(item.aviso.unidad, item.lectura, frecuencia)}
          {' · '}
          <strong style={{ color }}>{textoRestante(nivel, item.aviso.restante, item.aviso.unidad)}</strong>
        </div>
        {[item.equipo.tipo, item.equipo.marca, item.equipo.modelo].some(Boolean) && (
          <div className="muted" style={{ fontSize: '.76rem', marginTop: '.2rem' }}>
            {[item.equipo.tipo, item.equipo.marca, item.equipo.modelo].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>

      {guardada ? (
        <>
          <p style={{ margin: '0 0 .6rem', fontSize: '.86rem' }}>
            Respuesta guardada. Ahora mándala al grupo:
          </p>
          <CompartirWhatsapp texto={guardada.texto_whatsapp ?? texto} />
        </>
      ) : (
        <>
          <div className="form-row">
            <label>¿Se hará el mantenimiento?</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.6rem' }}>
              {opcion('hara', '✅ Sí, se hará el mantenimiento', 'var(--success)')}
              {opcion('no_hara', '❌ No se hará por ahora', 'var(--danger)')}
            </div>
          </div>

          <div className="form-row">
            <label>Mensaje <span className="muted">(obligatorio)</span></label>
            <textarea className="input" rows={3} value={mensaje} onChange={(e) => setMensaje(e.target.value)}
              placeholder="Ej.: se programa para el viernes con el mecánico; faltan filtros" />
          </div>

          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Vista previa del mensaje de WhatsApp</label>
            <pre className="mono" style={{
              margin: 0, padding: '.6rem .75rem', fontSize: '.78rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)',
            }}>{texto}</pre>
            <small className="muted">Responsable: {responsable}. Se guarda tal cual en la bitácora del equipo.</small>
          </div>
        </>
      )}
    </Modal>
  );
}
