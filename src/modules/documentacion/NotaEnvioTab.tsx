import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { date, dateTime, num } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  anularNotaEnvio, crearNotaEnvio, listDestinatarios, listNotasEnvio, proximoNumeroNota,
  type Destinatario, type NotaEnvio,
} from './documentacion.repository';
import { CONDICIONES_NOTA, EMISOR_NOTA, codigoNotaEnvio, errorNotaEnvio, filtrarDestinatarios, totalNotaEnvio, type ItemNotaEnvio } from './notaEnvio';

function hoy(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Renglon = { descripcion: string; cantidad: string };
const renglonVacio = (): Renglon => ({ descripcion: '', cantidad: '' });

function aItems(rs: Renglon[]): ItemNotaEnvio[] {
  return rs.map((r) => ({ descripcion: r.descripcion, cantidad: Number(String(r.cantidad).replace(',', '.')) || 0 }));
}

async function imprimir(n: NotaEnvio) {
  try { const { notaEnvioPdf } = await import('./notaEnvioPdf'); await notaEnvioPdf(n); }
  catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
}

/**
 * Formato de envío de documentación: se emite la nota (correlativo NE-0001…),
 * se imprime y se firma A MANO (quien entrega y quien recibe). Abajo, el
 * histórico. Los destinatarios se recuerdan para la próxima.
 */
export function NotaEnvioTab({ canWrite, actor, actorName }: { canWrite: boolean; actor: string; actorName: string | null }) {
  const [notas, setNotas] = useState<NotaEnvio[]>([]);
  const [destinatarios, setDestinatarios] = useState<Destinatario[]>([]);
  const [proximo, setProximo] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [nueva, setNueva] = useState(false);
  const [ver, setVer] = useState<NotaEnvio | null>(null);
  const [anular, setAnular] = useState<NotaEnvio | null>(null);
  const [q, setQ] = useState('');
  const [soloVigentes, setSoloVigentes] = useState(true);

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true);
    try {
      const [ns, ds, px] = await Promise.all([listNotasEnvio(), listDestinatarios(), proximoNumeroNota()]);
      setNotas(ns); setDestinatarios(ds); setProximo(px);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['notas_envio', 'destinatarios_documentacion'], () => { void cargar(true); });

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return notas.filter((n) => (!soloVigentes || n.estado === 'emitida')
      && (!t || `${n.codigo} ${n.razon_social} ${n.rif ?? ''} ${n.atencion_a ?? ''} ${n.entregado_por} ${n.items.map((i) => i.descripcion).join(' ')}`.toLowerCase().includes(t)));
  }, [notas, q, soloVigentes]);

  return (
    <>
      <div className="card">
        <div className="card-title" style={{ flexWrap: 'wrap', gap: '.5rem' }}>
          <span>📨 Nota de envío de documentación</span>
          {canWrite && (
            <button className="btn btn-primary" onClick={() => setNueva(true)}>
              ＋ Nueva nota {proximo != null && <span className="mono muted" style={{ fontWeight: 400, marginLeft: '.35rem' }}>{codigoNotaEnvio(proximo)}</span>}
            </button>
          )}
        </div>
        <p className="hint muted" style={{ margin: 0, fontSize: '.84rem' }}>
          Es el papel con el que se entrega documentación a otra empresa o departamento (facturas originales, copias, contratos…).
          Lleva <strong>correlativo</strong> propio, se imprime y <strong>se firma a mano</strong>: quien entrega y quien recibe conforme (firma, sello, cédula y fecha).
          Los destinatarios quedan guardados para la próxima nota.
        </p>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="card-title" style={{ flexWrap: 'wrap', gap: '.5rem' }}>
          <span>🗂 Histórico <span className="muted mono" style={{ fontWeight: 400 }}>{visibles.length}</span></span>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por N°, empresa, persona, contenido…" style={{ width: 260 }} />
            <label style={{ display: 'flex', gap: '.3rem', alignItems: 'center', fontSize: '.82rem' }}>
              <input type="checkbox" checked={soloVigentes} onChange={(e) => setSoloVigentes(e.target.checked)} /> Ocultar anuladas
            </label>
          </div>
        </div>
        {loading ? <p className="muted">Cargando…</p> : !visibles.length ? (
          <EmptyState icon="📨" message={notas.length ? 'Ninguna nota coincide con la búsqueda.' : 'Todavía no se emitió ninguna nota de envío.'} />
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.85rem' }}>
              <thead><tr><th>N°</th><th>Fecha</th><th>Destinatario</th><th>Atención a</th><th>Contenido</th><th style={{ textAlign: 'right' }}>Total</th><th>Entregó</th><th></th></tr></thead>
              <tbody>
                {visibles.map((n) => (
                  <tr key={n.id} style={{ opacity: n.estado === 'anulada' ? 0.55 : 1 }}>
                    <td className="mono"><strong>{n.codigo}</strong>{n.estado === 'anulada' && <div><span className="badge danger" style={{ fontSize: '.62rem' }}>Anulada</span></div>}</td>
                    <td className="mono">{date(n.fecha)}</td>
                    <td><strong>{n.razon_social}</strong>{n.rif && <div className="muted mono" style={{ fontSize: '.76rem' }}>{n.rif}</div>}</td>
                    <td>{n.atencion_a ?? <span className="muted">—</span>}</td>
                    <td className="muted" style={{ fontSize: '.78rem', maxWidth: 260 }}>{n.items.map((i) => `${i.descripcion} (${num(i.cantidad)})`).join(' · ')}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{num(n.total_cantidad)}</td>
                    <td style={{ fontSize: '.8rem' }}>{n.entregado_por}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => setVer(n)}>👁</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => void imprimir(n)} title="PDF para imprimir y firmar">🖨</button>
                      {canWrite && n.estado === 'emitida' && <button className="btn btn-sm btn-ghost" onClick={() => setAnular(n)} title="Anular" style={{ color: 'var(--danger)' }}>⊘</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {nueva && (
        <NuevaNotaModal
          destinatarios={destinatarios} proximo={proximo} actor={actor} actorName={actorName}
          onClose={() => setNueva(false)}
          onSaved={(n) => { setNueva(false); setVer(n); void cargar(true); }}
        />
      )}
      {ver && (
        <Modal title={`Nota de envío ${ver.codigo}`} size="md" onClose={() => setVer(null)} footer={
          <>
            <button className="btn btn-ghost" onClick={() => setVer(null)}>Cerrar</button>
            <button className="btn btn-primary" onClick={() => void imprimir(ver)}>🖨 PDF para imprimir y firmar</button>
          </>
        }>
          <DetalleNota n={ver} />
        </Modal>
      )}
      {anular && (
        <AnularModal n={anular} actor={actor} onClose={() => setAnular(null)} onSaved={() => { setAnular(null); void cargar(true); }} />
      )}
    </>
  );
}

function DetalleNota({ n }: { n: NotaEnvio }) {
  const fila = (k: string, v: string | null | undefined) => (
    <div style={{ display: 'flex', gap: '.5rem', fontSize: '.86rem' }}><span className="muted" style={{ minWidth: 120 }}>{k}</span><strong>{v || '—'}</strong></div>
  );
  return (
    <div>
      {n.estado === 'anulada' && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem', fontSize: '.84rem' }}>
          <strong>Anulada</strong> {n.anulada_en ? dateTime(n.anulada_en) : ''} por {n.anulada_por ?? '—'}: {n.anulada_motivo}
        </div>
      )}
      <div className="card" style={{ padding: '.7rem .85rem', marginBottom: '.8rem', display: 'grid', gap: '.3rem' }}>
        {fila('Fecha', date(n.fecha))}
        {fila('Destinatario', n.razon_social)}
        {fila('RIF / C.I.', n.rif)}
        {fila('Dirección', n.direccion)}
        {fila('Atención a', n.atencion_a)}
        {fila('Condición', n.condicion)}
        {fila('Entregado por', n.entregado_por)}
        {fila('Emitida', `${dateTime(n.created_at)}${n.actor_name ? ` · ${n.actor_name}` : ''}`)}
      </div>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Item</th><th>Descripción / concepto</th><th style={{ textAlign: 'right' }}>Cantd.</th></tr></thead>
          <tbody>{n.items.map((it, i) => <tr key={i}><td className="mono">{String(i + 1).padStart(2, '0')}</td><td>{it.descripcion}</td><td className="mono" style={{ textAlign: 'right' }}>{num(it.cantidad)}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={2} style={{ textAlign: 'right', fontWeight: 700 }}>Total documentos</td><td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(n.total_cantidad)}</td></tr></tfoot>
        </table>
      </div>
      {n.nota && <p className="muted" style={{ fontSize: '.84rem' }}>Observación: {n.nota}</p>}
      <p className="hint muted" style={{ fontSize: '.78rem' }}>Las firmas (entregado por / recibido conforme) se hacen a mano sobre el papel impreso.</p>
    </div>
  );
}

function NuevaNotaModal({ destinatarios, proximo, actor, actorName, onClose, onSaved }: {
  destinatarios: Destinatario[]; proximo: number | null; actor: string; actorName: string | null;
  onClose: () => void; onSaved: (n: NotaEnvio) => void;
}) {
  const [fecha, setFecha] = useState(hoy());
  const [busca, setBusca] = useState('');
  const [razon, setRazon] = useState('');
  const [rif, setRif] = useState('');
  const [direccion, setDireccion] = useState('');
  const [atencion, setAtencion] = useState('');
  const [condicion, setCondicion] = useState('');
  const [renglones, setRenglones] = useState<Renglon[]>([renglonVacio(), renglonVacio(), renglonVacio()]);
  const [entregadoPor, setEntregadoPor] = useState(actorName ?? '');
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sugeridos = useMemo(() => filtrarDestinatarios(destinatarios, busca).slice(0, 8), [destinatarios, busca]);
  const total = totalNotaEnvio(aItems(renglones));

  function usar(d: Destinatario) {
    setRazon(d.razon_social); setRif(d.rif ?? ''); setDireccion(d.direccion ?? ''); setAtencion(d.atencion_a ?? '');
    setBusca('');
  }
  function setR(i: number, k: keyof Renglon, v: string) {
    setRenglones((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  }

  async function emitir() {
    setError(null);
    const datos = { fecha, razon_social: razon, rif, direccion, atencion_a: atencion, condicion, items: aItems(renglones), entregado_por: entregadoPor, nota };
    const err = errorNotaEnvio(datos);
    if (err) { setError(err); return; }
    setSaving(true);
    try {
      const n = await crearNotaEnvio(datos, actor, actorName);
      toast(`Nota ${n.codigo} emitida`, 'success');
      onSaved(n);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo emitir'); setSaving(false); }
  }

  return (
    <Modal title={`Nueva nota de envío${proximo != null ? ` · ${codigoNotaEnvio(proximo)}` : ''}`} size="lg" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void emitir()} disabled={saving}>{saving ? 'Emitiendo…' : '📨 Emitir nota'}</button>
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      <p className="hint muted" style={{ margin: '0 0 .6rem', fontSize: '.8rem' }}>
        Emite <strong>{EMISOR_NOTA.razonSocial}</strong> · RIF {EMISOR_NOTA.rif}. El correlativo definitivo lo asigna el sistema al emitir.
      </p>

      <div className="form-grid">
        <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        <div className="form-row">
          <label>Destinatario guardado</label>
          <input className="input" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={destinatarios.length ? 'Buscar empresa o persona ya usada…' : 'Todavía no hay destinatarios guardados'} />
          {busca.trim() && sugeridos.length > 0 && (
            <div className="card" style={{ padding: '.3rem', marginTop: '.25rem', display: 'grid', gap: '.15rem' }}>
              {sugeridos.map((d) => (
                <button key={d.id} type="button" className="btn btn-sm btn-ghost" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => usar(d)}>
                  <strong>{d.razon_social}</strong>&nbsp;<span className="muted mono">{d.rif ?? ''}</span>{d.atencion_a ? <span className="muted">&nbsp;· {d.atencion_a}</span> : null}
                </button>
              ))}
            </div>
          )}
          {!busca.trim() && destinatarios.length > 0 && (
            <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', marginTop: '.3rem' }}>
              {destinatarios.slice(0, 6).map((d) => (
                <button key={d.id} type="button" className="btn btn-sm btn-ghost" onClick={() => usar(d)} title={`Usado ${d.usos} veces`}>{d.razon_social}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: '.6rem .8rem', margin: '.4rem 0' }}>
        <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.4rem' }}>Datos del destinatario / departamento</div>
        <div className="form-grid">
          <div className="form-row"><label>Razón social *</label><input className="input" value={razon} onChange={(e) => setRazon(e.target.value)} placeholder="Empresa o departamento" /></div>
          <div className="form-row"><label>RIF / C.I.</label><input className="input" value={rif} onChange={(e) => setRif(e.target.value.toUpperCase())} placeholder="J-12345678-9" /></div>
        </div>
        <div className="form-row"><label>Dirección</label><input className="input" value={direccion} onChange={(e) => setDireccion(e.target.value)} /></div>
      </div>

      <div className="card" style={{ padding: '.6rem .8rem', margin: '.4rem 0' }}>
        <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.4rem' }}>Detalles de entrega</div>
        <div className="form-grid">
          <div className="form-row"><label>Atención a</label><input className="input" value={atencion} onChange={(e) => setAtencion(e.target.value)} placeholder="Persona que recibe" /></div>
          <div className="form-row"><label>Condición</label>
            <input className="input" list="cond-nota" value={condicion} onChange={(e) => setCondicion(e.target.value)} placeholder="Facturas originales, copias…" />
            <datalist id="cond-nota">{CONDICIONES_NOTA.map((c) => <option key={c} value={c} />)}</datalist></div>
        </div>
        <div className="form-row"><label>Entregado por *</label><input className="input" value={entregadoPor} onChange={(e) => setEntregadoPor(e.target.value)} placeholder="Quien lleva la documentación (firma a mano en el papel)" /></div>
      </div>

      <div className="card" style={{ padding: '.6rem .8rem', margin: '.4rem 0' }}>
        <div className="muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.4rem' }}>Qué se entrega</div>
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.85rem' }}>
            <thead><tr><th style={{ width: 50 }}>Item</th><th>Descripción / concepto</th><th style={{ width: 110, textAlign: 'right' }}>Cantd.</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {renglones.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{String(i + 1).padStart(2, '0')}</td>
                  <td><input className="input" value={r.descripcion} onChange={(e) => setR(i, 'descripcion', e.target.value)} placeholder="Facturas originales de …" style={{ width: '100%' }} /></td>
                  <td><input className="input mono" type="number" min={0} step="any" value={r.cantidad} onChange={(e) => setR(i, 'cantidad', e.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
                  <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => setRenglones((rs) => rs.length > 1 ? rs.filter((_, j) => j !== i) : rs)} title="Quitar renglón">✕</button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2} style={{ textAlign: 'right', fontWeight: 700 }}>Total documentos</td><td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{num(total)}</td><td></td></tr></tfoot>
          </table>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRenglones((rs) => [...rs, renglonVacio()])}>＋ Agregar renglón</button>
      </div>

      <div className="form-row"><label>Observación (opcional)</label><input className="input" value={nota} onChange={(e) => setNota(e.target.value)} /></div>
    </Modal>
  );
}

function AnularModal({ n, actor, onClose, onSaved }: { n: NotaEnvio; actor: string; onClose: () => void; onSaved: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirmar() {
    setSaving(true); setError(null);
    try { await anularNotaEnvio(n.id, motivo, actor); toast(`Nota ${n.codigo} anulada`, 'success'); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo anular'); setSaving(false); }
  }
  return (
    <Modal title={`Anular nota ${n.codigo}`} size="sm" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-danger" onClick={() => void confirmar()} disabled={saving || motivo.trim().length < 3}>{saving ? 'Anulando…' : '⊘ Anular'}</button>
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      <p className="muted" style={{ fontSize: '.86rem', marginTop: 0 }}>La nota queda en el histórico como <strong>anulada</strong> con el motivo. El correlativo no se vuelve a usar.</p>
      <div className="form-row"><label>Motivo *</label><textarea className="input" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus placeholder="Se emitió por error, se reemplaza por otra…" /></div>
    </Modal>
  );
}
