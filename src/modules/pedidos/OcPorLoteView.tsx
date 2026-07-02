import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { date, money } from '@/shared/lib/format';
import { listOcPorLote, nextCodigoChecklist, type OcLoteRow } from './ocLote.repository';
import { aprobarOcsEnLote, anularOrden, reabrirOcAOfertas } from './pedidos.repository';
// descargarChecklistOcPdf se importa dinámicamente (al generar) para no cargar jsPDF al abrir la vista.
import { enviarChecklistAMultiples } from './enviarChecklist';

/** Checklist "OC por lote": relación de OC por confirmar. Aprobar en lote + PDF/correo. */
export function OcPorLoteView() {
  const { user } = useSession();
  // Modifica/anula OC: el administrador o quien tenga FULL CONTROL de Pedidos/Compras.
  const { isAdmin: esAdmin, can } = usePermissions();
  const isAdmin = esAdmin || can('pedidos', 'full');
  // APROBAR una OC es exclusivo del rol administrador (no basta con el control total).
  const soloAdmin = esAdmin;
  const [rows, setRows] = useState<OcLoteRow[]>([]);
  const [incluirPagadas, setIncluirPagadas] = useState(false);
  const [loading, setLoading] = useState(true);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [correoOpen, setCorreoOpen] = useState(false);
  const [confirmAprob, setConfirmAprob] = useState(false);
  const [aprobando, setAprobando] = useState(false);
  const [confirmModificar, setConfirmModificar] = useState(false);
  const [anularOpen, setAnularOpen] = useState(false);
  const [motivoAnular, setMotivoAnular] = useState('');
  const [confirmarAnular, setConfirmarAnular] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll(ids: string[], all: boolean) {
    setSel(() => (all ? new Set<string>() : new Set(ids)));
  }
  const seleccionadas = (list: OcLoteRow[]) => list.filter((r) => sel.has(r.orden.id));

  const reload = useCallback(async () => {
    setLoading(true);
    try { setRows(await listOcPorLote(incluirPagadas)); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar la relación', 'error'); }
    finally { setLoading(false); }
  }, [incluirPagadas]);

  useEffect(() => { void reload(); }, [reload]);
  // Realtime: si otro usuario confirma/anula una OC, la relación se actualiza al instante.
  useRealtime(['ordenes'], () => { void reload(); });

  // Genera (una vez) el código de checklist y lo reutiliza para PDF y correo.
  const ensureCodigo = useCallback(async () => {
    if (codigo) return codigo;
    const c = await nextCodigoChecklist();
    setCodigo(c);
    return c;
  }, [codigo]);

  const total = useMemo(() => rows.reduce((a, r) => a + (Number(r.orden.total) || 0), 0), [rows]);

  async function pdf() {
    const elegidas = seleccionadas(rows);
    if (!elegidas.length) { toast('Seleccioná al menos una orden para el PDF', 'error'); return; }
    try {
      const { descargarChecklistOcPdf } = await import('./checklistOcPdf');
      await descargarChecklistOcPdf(elegidas, await ensureCodigo());
    }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  // Aprobar en lote: solo las seleccionadas que estén "por confirmar" (oc_creada).
  const porConfirmar = (list: OcLoteRow[]) => seleccionadas(list).filter((r) => r.orden.estado === 'oc_creada');
  async function aprobar() {
    if (!soloAdmin) { toast('Solo el administrador puede aprobar las órdenes de compra.', 'error'); return; }
    const elegidas = porConfirmar(rows);
    if (!elegidas.length) { toast('No hay órdenes por confirmar seleccionadas', 'error'); return; }
    setAprobando(true);
    try {
      const n = await aprobarOcsEnLote(elegidas.map((r) => r.orden), user?.email ?? 'sistema');
      notify(`${n} orden(es) de compra confirmada(s) · cada una sigue su flujo según la condición de pago`, 'success', { link: '#/app/pedidos' });
      setSel(new Set());
      setConfirmAprob(false);
      await reload();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo aprobar', 'error'); }
    finally { setAprobando(false); }
  }

  // Modificar en lote: cada OC seleccionada (oc_creada) vuelve a la etapa de ofertas.
  async function modificarLote() {
    if (!isAdmin) { toast('Solo el administrador puede modificar las órdenes de compra.', 'error'); return; }
    const elegidas = porConfirmar(rows);
    if (!elegidas.length) { toast('No hay órdenes por confirmar seleccionadas', 'error'); return; }
    setProcesando(true);
    try {
      for (const r of elegidas) await reabrirOcAOfertas(r.orden, user?.email ?? 'sistema');
      notify(`${elegidas.length} OC reabierta(s) para re-elegir oferta`, 'info', { link: '#/app/pedidos' });
      setSel(new Set());
      setConfirmModificar(false);
      await reload();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo modificar', 'error'); }
    finally { setProcesando(false); }
  }

  // Anular en lote: cada OC seleccionada (oc_creada) pasa a estado ANULADA.
  async function anularLote() {
    if (!isAdmin) { toast('Solo el administrador puede anular las órdenes de compra.', 'error'); return; }
    const elegidas = porConfirmar(rows);
    if (!elegidas.length) { toast('No hay órdenes por confirmar seleccionadas', 'error'); return; }
    if (!motivoAnular.trim()) { toast('Indicá el motivo de la anulación', 'error'); return; }
    setConfirmarAnular(false);
    setProcesando(true);
    try {
      for (const r of elegidas) await anularOrden(r.orden, user?.email ?? 'sistema', motivoAnular.trim());
      notify(`${elegidas.length} OC anulada(s)`, 'warning', { link: '#/app/pedidos' });
      setSel(new Set());
      setAnularOpen(false);
      setMotivoAnular('');
      await reload();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo anular', 'error'); }
    finally { setProcesando(false); }
  }

  return (
    <div>
      <div className="filterbar" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {isAdmin && (
            <>
              {soloAdmin && (
                <button className="btn btn-primary" onClick={() => { if (!porConfirmar(rows).length) { toast('Seleccioná al menos una OC por confirmar', 'error'); return; } setConfirmAprob(true); }}>✔ Aprobar en lote ({porConfirmar(rows).length})</button>
              )}
              <button className="btn btn-ghost" onClick={() => { if (!porConfirmar(rows).length) { toast('Seleccioná al menos una OC por confirmar', 'error'); return; } setConfirmModificar(true); }} title="Reabrir las OC seleccionadas para re-elegir oferta">✎ Modificar ({porConfirmar(rows).length})</button>
              <button className="btn btn-danger" onClick={() => { if (!porConfirmar(rows).length) { toast('Seleccioná al menos una OC por confirmar', 'error'); return; } setAnularOpen(true); }} title="Anular las OC seleccionadas">⊘ Anular ({porConfirmar(rows).length})</button>
            </>
          )}
          <button className="btn btn-ghost" onClick={pdf}>↓ PDF ({sel.size})</button>
          <button className="btn btn-ghost" onClick={() => { if (!sel.size) { toast('Seleccioná al menos una orden', 'error'); return; } setCorreoOpen(true); }}>✉ Enviar por correo</button>
          <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', fontSize: '.85rem' }}>
            <input type="checkbox" checked={incluirPagadas} onChange={(e) => setIncluirPagadas(e.target.checked)} /> Incluir confirmadas
          </label>
        </div>
        <div className="muted" style={{ fontSize: '.85rem' }}>
          {rows.length} orden(es) · Total <strong className="mono">{money(total)}</strong>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ textAlign: 'center', padding: '.6rem', borderBottom: '1px solid var(--border)' }}>
          <div style={{ color: 'var(--brand, #ff8a00)', fontSize: '.95rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.02em' }}>
            ÓRDENES DE COMPRA PENDIENTES
          </div>
        </div>
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead>
              <tr>
                <th style={{ width: 32 }}><input type="checkbox" checked={rows.length > 0 && sel.size === rows.length} onChange={() => toggleAll(rows.map((r) => r.orden.id), sel.size === rows.length)} title="Seleccionar todas" /></th>
                <th>Item</th><th>N°ODC</th><th>Solicitado por</th><th>Proveedor</th>
                <th>Descripción</th><th style={{ textAlign: 'right' }}>Monto $</th>
                <th>Fecha de compra</th><th>Fecha de firma</th><th style={{ textAlign: 'center' }}>Estatus</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
              {!loading && !rows.length && <tr><td colSpan={10}><EmptyState message="Sin compras pendientes por confirmar" icon="🧾" /></td></tr>}
              {!loading && rows.map((r, i) => (
                <tr key={r.orden.id}>
                  <td><input type="checkbox" checked={sel.has(r.orden.id)} onChange={() => toggle(r.orden.id)} /></td>
                  <td className="mono">{i + 1}</td>
                  <td className="mono">{r.orden.oc_codigo ?? r.orden.codigo}</td>
                  <td>{r.orden.solicitante || r.orden.solicitante_email}</td>
                  <td>{r.proveedorNombre}</td>
                  <td style={{ maxWidth: 320 }}>{r.descripcion}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(r.orden.total)}</td>
                  <td className="muted">{r.orden.oc_creada_en ? date(r.orden.oc_creada_en) : '—'}</td>
                  <td className="muted">{r.orden.oc_aprobada_en ? date(r.orden.oc_aprobada_en) : '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{
                      display: 'inline-block', padding: '.2rem .5rem', borderRadius: 6, fontSize: '.72rem', fontWeight: 700, color: '#fff',
                      background: r.pagado ? 'var(--success, #16a05a)' : 'var(--danger, #c81e1e)',
                    }}>{r.pagado ? 'CONFIRMADA' : 'PENDIENTE POR CONFIRMAR'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {correoOpen && (
        <CorreoModal rows={seleccionadas(rows)} ensureCodigo={ensureCodigo} onClose={() => setCorreoOpen(false)} />
      )}

      {confirmAprob && (
        <ConfirmDialog
          title="Aprobar órdenes de compra en lote"
          message={`Vas a confirmar ${porConfirmar(rows).length} orden(es) de compra. Pasarán a Tesorería como pendientes por pagar. ¿Continuar?`}
          confirmText={aprobando ? 'Aprobando…' : 'Aprobar en lote'}
          onConfirm={aprobar}
          onCancel={() => !aprobando && setConfirmAprob(false)}
        />
      )}

      {confirmModificar && (
        <ConfirmDialog
          title="Modificar órdenes de compra en lote"
          message={`Vas a reabrir ${porConfirmar(rows).length} orden(es) de compra a “Pendiente · cargar ofertas” para re-elegir la oferta ganadora. ¿Continuar?`}
          confirmText={procesando ? 'Procesando…' : 'Modificar (volver a ofertas)'}
          onConfirm={modificarLote}
          onCancel={() => !procesando && setConfirmModificar(false)}
        />
      )}

      {anularOpen && (
        <Modal
          title="Anular órdenes de compra en lote"
          size="md"
          onClose={() => { if (!procesando) { setAnularOpen(false); setMotivoAnular(''); } }}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => { setAnularOpen(false); setMotivoAnular(''); }} disabled={procesando}>Cancelar</button>
              <button className="btn btn-danger" onClick={() => { if (motivoAnular.trim()) setConfirmarAnular(true); }} disabled={procesando || !motivoAnular.trim()}>{procesando ? 'Anulando…' : `Anular ${porConfirmar(rows).length} OC`}</button>
            </>
          }
        >
          <p className="hint muted" style={{ marginTop: 0, fontSize: '.88rem' }}>
            Las {porConfirmar(rows).length} OC seleccionadas pasan a estado <strong>ANULADA</strong>. No mueven inventario ni caja.
          </p>
          <div className="form-row">
            <label>Motivo de la anulación</label>
            <textarea className="input" rows={3} value={motivoAnular} onChange={(e) => setMotivoAnular(e.target.value)} placeholder="Ya no se requiere, error de carga, se reemplaza por otra…" autoFocus />
          </div>
          {confirmarAnular && (
            <ConfirmDialog
              title="Anular órdenes de compra"
              message={`¿Seguro que querés anular ${porConfirmar(rows).length} OC? Esta acción no se puede deshacer.`}
              confirmText={`Anular ${porConfirmar(rows).length} OC`}
              danger
              onConfirm={() => void anularLote()}
              onCancel={() => setConfirmarAnular(false)}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

function CorreoModal({ rows, ensureCodigo, onClose }: {
  rows: OcLoteRow[]; ensureCodigo: () => Promise<string>; onClose: () => void;
}) {
  const [emails, setEmails] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    const lista = emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!lista.length) { toast('Indicá al menos un correo', 'error'); return; }
    if (!rows.length) { toast('No hay órdenes para enviar', 'error'); return; }
    setEnviando(true);
    try {
      const { enviados, fallidos } = await enviarChecklistAMultiples(rows, await ensureCodigo(), lista);
      toast(`Enviado a: ${enviados.join(', ')}`, 'success');
      if (fallidos.length) toast(`Falló: ${fallidos.map((f) => f.email).join(', ')}`, 'error');
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo enviar', 'error'); }
    finally { setEnviando(false); }
  }

  return (
    <Modal title="Enviar checklist por correo" size="md" onClose={() => !enviando && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={enviando}>Cancelar</button>
        <button className="btn btn-primary" onClick={enviar} disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar'}</button>
      </>
    }>
      <div className="form-row">
        <label>Correo(s) destinatario(s)</label>
        <input className="input" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="correo@ejemplo.com, otro@ejemplo.com" autoFocus />
        <small className="muted">Separá varios con coma o espacio. Se adjunta la relación en PDF.</small>
      </div>
    </Modal>
  );
}
