/* ============================================================
   MGG · Documentación · Formato de envío de documentación
   Histórico de NOTAS DE ENVÍO con correlativo (N° 0001, 0002…):
   crear, imprimir (PDF con vista previa, firmas a mano), marcar
   «Recibida conforme» con la copia firmada escaneada, o anular.
   Una nota nunca se borra: el correlativo queda completo.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { dateTime } from '@/shared/lib/format';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  listNotasEnvio, listDestinatarios, marcarRecibida, anularNotaEnvio, urlArchivoDocumentacion, type Actor, type Destinatario, type NotaEnvio,
} from './documentacion.repository';
import { ESTADO_ENVIO_LABEL, cantidadTexto, estadoEnvio, norm, numeroEnvio, type EstadoEnvio } from './notaEnvio';
import { NotaEnvioForm } from './NotaEnvioForm';

const COLOR_ESTADO: Record<EstadoEnvio, string> = {
  emitido: 'var(--warning)',
  recibido: 'var(--success)',
  anulado: 'var(--danger)',
};
const fechaVe = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const unicos = (xs: Array<string | null>) => Array.from(new Set(xs.filter((x): x is string => !!x && !!x.trim()))).sort((a, b) => a.localeCompare(b, 'es'));

async function imprimir(n: NotaEnvio) {
  const { descargarNotaEnvioPdf } = await import('./notaEnvioPdf');
  await descargarNotaEnvioPdf(n);
}

export function NotasEnvioPanel({ canWrite, actor }: { canWrite: boolean; actor: Actor }) {
  const [notas, setNotas] = useState<NotaEnvio[]>([]);
  const [destinatarios, setDestinatarios] = useState<Destinatario[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<'' | EstadoEnvio>('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [form, setForm] = useState<NotaEnvio | 'nueva' | null>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [ns, ds] = await Promise.all([listNotasEnvio(), listDestinatarios().catch(() => [] as Destinatario[])]);
      setNotas(ns); setDestinatarios(ds);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudieron cargar las notas', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['notas_envio', 'destinatarios_documentacion'], () => { void cargar(); });

  // Lo ya usado, para autocompletar la próxima nota: los destinatarios guardados
  // más lo que aparece en las notas (atención, condición).
  const sugerencias = useMemo(() => ({
    razon: unicos([...destinatarios.map((d) => d.razon_social), ...notas.map((n) => n.razon_social)]),
    porRazon: Object.fromEntries([
      ...notas.map((n) => [n.razon_social, { rif: n.rif, direccion: n.direccion, atencion_a: n.atencion_a }] as const),
      ...destinatarios.map((d) => [d.razon_social, { rif: d.rif, direccion: d.direccion, atencion_a: d.atencion_a }] as const),
    ]) as Record<string, { rif: string | null; direccion: string | null; atencion_a: string | null }>,
    atencion: unicos([...destinatarios.map((d) => d.atencion_a), ...notas.map((n) => n.atencion_a)]),
    condicion: unicos(notas.map((n) => n.condicion)),
  }), [notas, destinatarios]);

  const filtradas = useMemo(() => {
    const t = norm(q);
    return notas.filter((n) => {
      if (estado && estadoEnvio(n) !== estado) return false;
      if (desde && n.fecha < desde) return false;
      if (hasta && n.fecha > hasta) return false;
      if (t) {
        const hay = norm([numeroEnvio(n.numero), n.codigo, n.razon_social, n.rif, n.atencion_a, n.condicion, n.entregado_por, n.nota,
          ...n.items.map((r) => r.descripcion)].join(' '));
        if (!t.split(/\s+/).every((p) => hay.includes(p))) return false;
      }
      return true;
    });
  }, [notas, q, estado, desde, hasta]);

  const detalle = detalleId ? notas.find((n) => n.id === detalleId) ?? null : null;

  async function imprimirNota(n: NotaEnvio) {
    setPdfBusy(true);
    try { await imprimir(n); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
    finally { setPdfBusy(false); }
  }

  const proximo = notas.length ? Math.max(...notas.map((n) => n.numero)) + 1 : 1;

  return (
    <>
      <div className="card" style={{ marginBottom: '.75rem' }}>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-row" style={{ margin: 0, flex: '1 1 220px' }}>
            <label htmlFor="ne-buscar">Buscar</label>
            <input id="ne-buscar" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="N°, destinatario, atención, concepto…" />
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label htmlFor="ne-estado">Estado</label>
            <select id="ne-estado" className="select" value={estado} onChange={(e) => setEstado(e.target.value as '' | EstadoEnvio)}>
              <option value="">Todos</option>
              {(Object.keys(ESTADO_ENVIO_LABEL) as EstadoEnvio[]).map((k) => <option key={k} value={k}>{ESTADO_ENVIO_LABEL[k]}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label htmlFor="ne-desde">Desde</label>
            <input id="ne-desde" className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label htmlFor="ne-hasta">Hasta</label>
            <input id="ne-hasta" className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <span className="muted" style={{ fontSize: '.8rem', marginLeft: 'auto' }}>{filtradas.length} de {notas.length}</span>
          {canWrite && (
            <button className="btn btn-primary" onClick={() => setForm('nueva')} title={`La próxima nota sale con el N° ${numeroEnvio(proximo)} (aprox.)`}>
              ＋ Nueva nota de envío
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.86rem' }}>
            <thead>
              <tr><th>N°</th><th>Fecha</th><th>Cliente / departamento</th><th>Atención a</th><th style={{ textAlign: 'right' }}>Renglones</th><th style={{ textAlign: 'right' }}>Total</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
              {!loading && !filtradas.length && (
                <tr><td colSpan={8}><EmptyState icon="📨" message={notas.length ? 'Ninguna nota coincide con los filtros' : 'Aún no hay notas de envío'} /></td></tr>
              )}
              {!loading && filtradas.map((n) => {
                const est = estadoEnvio(n);
                return (
                  <tr key={n.id} style={{ cursor: 'pointer' }} onClick={() => setDetalleId(n.id)}>
                    <td className="mono"><strong>{numeroEnvio(n.numero)}</strong></td>
                    <td>{fechaVe(n.fecha)}</td>
                    <td>{n.razon_social}{n.rif && <div className="muted" style={{ fontSize: '.74rem' }}>{n.rif}</div>}</td>
                    <td>{n.atencion_a ?? '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{n.items.length}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{cantidadTexto(n.total_cantidad)}</td>
                    <td><span className="badge" style={{ color: COLOR_ESTADO[est] }}>{ESTADO_ENVIO_LABEL[est]}</span></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-sm btn-ghost" disabled={pdfBusy} onClick={() => void imprimirNota(n)} title="Imprimir la nota (vista previa)">🖨 PDF</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <NotaEnvioForm
          nota={form === 'nueva' ? null : form} sugerencias={sugerencias} actor={actor}
          onClose={() => setForm(null)}
          onSaved={async (n) => { setForm(null); await cargar(); setDetalleId(n.id); }}
        />
      )}
      {detalle && (
        <NotaDetalle
          n={detalle} canWrite={canWrite} actor={actor} pdfBusy={pdfBusy}
          onImprimir={() => void imprimirNota(detalle)}
          onEditar={() => { setDetalleId(null); setForm(detalle); }}
          onClose={() => setDetalleId(null)}
          onChanged={() => void cargar()}
        />
      )}
    </>
  );
}

function NotaDetalle({ n, canWrite, actor, pdfBusy, onImprimir, onEditar, onClose, onChanged }: {
  n: NotaEnvio; canWrite: boolean; actor: Actor; pdfBusy: boolean;
  onImprimir: () => void; onEditar: () => void; onClose: () => void; onChanged: () => void;
}) {
  const est = estadoEnvio(n);
  const [modo, setModo] = useState<'ver' | 'recibir' | 'anular'>('ver');
  const [recibidoPor, setRecibidoPor] = useState(n.recibido_por ?? n.atencion_a ?? '');
  const [copia, setCopia] = useState<File | null>(null);
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  const fila = (k: string, v: ReactNode) => <div className="detail-row"><div className="k">{k}</div><div className="v">{v}</div></div>;

  async function guardarRecibida() {
    setSaving(true);
    try { await marcarRecibida(n, recibidoPor, copia); toast(`Nota N° ${numeroEnvio(n.numero)} recibida conforme`, 'success'); setModo('ver'); onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); }
    finally { setSaving(false); }
  }
  async function guardarAnulacion() {
    setSaving(true);
    try { await anularNotaEnvio(n, motivo, actor.email); toast(`Nota N° ${numeroEnvio(n.numero)} anulada`, 'success'); setModo('ver'); onChanged(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo anular', 'error'); }
    finally { setSaving(false); }
  }
  async function verCopia() {
    if (!n.recibido_path) return;
    try { await previewFileUrl(await urlArchivoDocumentacion(n.recibido_path), n.recibido_nombre ?? 'copia-firmada', 'Copia firmada'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir la copia', 'error'); }
  }

  const footer = modo === 'recibir' ? (
    <>
      <button className="btn btn-ghost" onClick={() => setModo('ver')} disabled={saving}>Volver</button>
      <button className="btn btn-primary" onClick={() => void guardarRecibida()} disabled={saving}>{saving ? 'Guardando…' : '✓ Marcar recibida conforme'}</button>
    </>
  ) : modo === 'anular' ? (
    <>
      <button className="btn btn-ghost" onClick={() => setModo('ver')} disabled={saving}>Volver</button>
      <button className="btn btn-danger" onClick={() => void guardarAnulacion()} disabled={saving || !motivo.trim()}>{saving ? 'Anulando…' : 'Anular nota'}</button>
    </>
  ) : (
    <>
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      {canWrite && est !== 'anulado' && <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} onClick={() => setModo('anular')}>Anular</button>}
      {canWrite && est === 'emitido' && <button className="btn btn-ghost" onClick={onEditar}>✎ Editar</button>}
      {canWrite && est !== 'anulado' && <button className="btn btn-ghost" onClick={() => setModo('recibir')}>{est === 'recibido' ? '📎 Cambiar copia firmada' : '✓ Recibida conforme'}</button>}
      <button className="btn btn-primary" onClick={onImprimir} disabled={pdfBusy}>{pdfBusy ? 'Generando…' : '🖨 Imprimir PDF'}</button>
    </>
  );

  return (
    <Modal title={`Nota de envío N° ${numeroEnvio(n.numero)}`} size="lg" onClose={onClose} footer={footer}>
      <div style={{ display: 'grid', gap: '.15rem', marginBottom: '.75rem' }}>
        {fila('Estado', <span className="badge" style={{ color: COLOR_ESTADO[est] }}>{ESTADO_ENVIO_LABEL[est]}</span>)}
        {fila('Fecha', fechaVe(n.fecha))}
        {fila('Cliente / departamento', `${n.razon_social}${n.rif ? ` · ${n.rif}` : ''}`)}
        {n.direccion && fila('Dirección', n.direccion)}
        {n.atencion_a && fila('Atención a', n.atencion_a)}
        {n.condicion && fila('Condición', n.condicion)}
        {n.entregado_por && n.entregado_por !== '—' && fila('Entregado por', n.entregado_por)}
        {n.nota && fila('Observaciones', n.nota)}
        {fila('Creada', `${dateTime(n.created_at)} · ${n.actor_name ?? n.actor ?? '—'}`)}
        {est === 'recibido' && fila('Recibida', <>
          {n.recibido_en ? dateTime(n.recibido_en) : '—'}{n.recibido_por ? ` · ${n.recibido_por}` : ''}
          {n.recibido_path && <> <button className="btn btn-sm btn-ghost" onClick={() => void verCopia()}>📎 Ver copia firmada</button></>}
        </>)}
        {est === 'anulado' && fila('Anulada', `${n.anulada_en ? dateTime(n.anulada_en) : '—'} · ${n.anulada_por ?? ''} · ${n.anulada_motivo ?? ''}`)}
      </div>

      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.86rem' }}>
          <thead><tr><th style={{ width: 50 }}>Ítem</th><th>Descripción / concepto</th><th style={{ textAlign: 'right' }}>Cant.</th></tr></thead>
          <tbody>
            {n.items.map((r, i) => (
              <tr key={i}><td className="mono">{String(i + 1).padStart(2, '0')}</td><td>{r.descripcion}</td><td className="mono" style={{ textAlign: 'right' }}>{cantidadTexto(r.cantidad)}</td></tr>
            ))}
            <tr><td></td><td style={{ textAlign: 'right' }}><strong>Total {n.total_etiqueta}</strong></td><td className="mono" style={{ textAlign: 'right' }}><strong>{cantidadTexto(n.total_cantidad)}</strong></td></tr>
          </tbody>
        </table>
      </div>

      {modo === 'recibir' && (
        <div className="card" style={{ marginTop: '.75rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>Recibida conforme</div>
          <div className="form-row">
            <label htmlFor="ne-recibido-por">Recibido por</label>
            <input id="ne-recibido-por" className="input" value={recibidoPor} onChange={(e) => setRecibidoPor(e.target.value)} />
          </div>
          <div className="form-row">
            <label htmlFor="ne-copia">Copia firmada escaneada (PDF o foto, opcional)</label>
            <input id="ne-copia" className="input" type="file" accept="application/pdf,image/*" onChange={(e) => setCopia(e.target.files?.[0] ?? null)} />
          </div>
        </div>
      )}
      {modo === 'anular' && (
        <div className="card" style={{ marginTop: '.75rem', borderColor: 'var(--danger)' }}>
          <div className="form-row">
            <label htmlFor="ne-motivo">Motivo de la anulación *</label>
            <textarea id="ne-motivo" className="input" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
            <small className="muted">La nota queda en el histórico marcada como anulada; su N° no se vuelve a usar.</small>
          </div>
        </div>
      )}
    </Modal>
  );
}
