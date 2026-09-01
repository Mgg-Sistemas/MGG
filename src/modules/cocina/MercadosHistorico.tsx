/* ============================================================
   MGG · Cocina · Histórico de mercados cerrados
   Lista de mercados cerrados (como "Recepciones cerradas"): ver el detalle en
   solo-lectura, sacar el PDF / reenviar por correo, REABRIR para editar, o eliminar.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { money, num } from '@/shared/lib/format';
import {
  listMercados, resumenMercado, reabrirMercado, eliminarMercado,
  type MercadoCocina, type ResumenMercado,
} from './mercados.repository';
import { MercadoPanel } from './MercadoPanel';

function fmtDia(iso: string): string { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }

export function MercadosHistoricoModal({ cocinaId, cocinaNombre, almacen, canWrite, actor, userEmail, onClose, onChanged }: {
  cocinaId: string; cocinaNombre: string; almacen: string | null; canWrite: boolean;
  actor: string; userEmail: string | null; onClose: () => void; onChanged: () => void | Promise<void>;
}) {
  const [mercados, setMercados] = useState<MercadoCocina[]>([]);
  const [loading, setLoading] = useState(true);
  const [ver, setVer] = useState<{ mercado: MercadoCocina; resumen: ResumenMercado } | null>(null);
  const [reabrir, setReabrir] = useState<MercadoCocina | null>(null);
  const [borrar, setBorrar] = useState<MercadoCocina | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setMercados(await listMercados(cocinaId)); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar el histórico', 'error'); }
    finally { setLoading(false); }
  }, [cocinaId]);
  useEffect(() => { void reload(); }, [reload]);

  const cerrados = useMemo(() => mercados.filter((m) => m.estado === 'cerrado'), [mercados]);
  // Solo el más reciente cerrado se puede reabrir (los anteriores, en cascada).
  const idReabrible = cerrados[0]?.id ?? null;

  async function verMercado(m: MercadoCocina) {
    setBusy(true);
    try { setVer({ mercado: m, resumen: await resumenMercado(m, almacen) }); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir el mercado', 'error'); }
    finally { setBusy(false); }
  }

  async function pdf(m: MercadoCocina) {
    if (!m.cierre) return;
    try {
      const { descargarCierrePdf } = await import('./mercadoCierrePdf');
      await descargarCierrePdf(cocinaNombre, m, m.cierre);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  async function confirmarReabrir() {
    const m = reabrir; if (!m) return; setReabrir(null); setBusy(true);
    try {
      await reabrirMercado(m);
      toast(`Mercado #${m.numero} reabierto para editar`, 'success');
      await reload(); await onChanged();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo reabrir', 'error'); }
    finally { setBusy(false); }
  }

  async function confirmarBorrar() {
    const m = borrar; if (!m) return; setBorrar(null); setBusy(true);
    try {
      await eliminarMercado(m.id);
      toast(`Mercado #${m.numero} eliminado del histórico`, 'success');
      await reload(); await onChanged();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
    finally { setBusy(false); }
  }

  if (ver) {
    return (
      <Modal title={`🔒 Mercado #${ver.mercado.numero} · ${cocinaNombre} (cerrado)`} size="xl" onClose={() => setVer(null)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setVer(null)}>← Volver al histórico</button>
            <button className="btn btn-ghost" onClick={() => pdf(ver.mercado)}>↓ PDF</button>
            <button className="btn btn-primary" onClick={() => setVer(null)}>Cerrar</button>
          </>
        }>
        <p className="hint muted" style={{ marginTop: 0 }}>Vista de solo lectura del mercado cerrado ({fmtDia(ver.mercado.fecha_inicio)} → {fmtDia(ver.mercado.fecha_fin)}). Para editarlo, reabrilo desde el histórico.</p>
        <MercadoPanel resumen={ver.resumen} cocinaNombre={cocinaNombre} almacen={almacen} canWrite={false}
          actor={actor} userEmail={userEmail} onReload={() => {}} onEditComida={() => {}} onDelComida={() => {}} />
      </Modal>
    );
  }

  return (
    <Modal title="🔒 Mercados cerrados (histórico)" size="xl" onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      {loading ? (
        <EmptyState message="Cargando…" icon="◔" />
      ) : !cerrados.length ? (
        <EmptyState message="Todavía no hay mercados cerrados." icon="🛒" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <th>N° mercado</th><th>Período</th>
              <th style={{ textAlign: 'right' }}>Consumo</th>
              <th style={{ textAlign: 'right' }}>Platos</th>
              <th style={{ textAlign: 'right' }}>Remanente</th>
              <th style={{ textAlign: 'right' }}>Acciones</th>
            </tr></thead>
            <tbody>
              {cerrados.map((m) => (
                <tr key={m.id}>
                  <td className="mono">#{m.numero}</td>
                  <td>{fmtDia(m.fecha_inicio)} → {fmtDia(m.fecha_fin)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(m.cierre?.totales.valor ?? 0)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(m.cierre?.totales.platos ?? 0)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(m.cierre?.remanente.length ?? 0)} ítem(s)</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => verMercado(m)} disabled={busy} title="Ver detalle (solo lectura)">👁 Ver</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => pdf(m)} disabled={busy || !m.cierre} title="Reporte PDF">📄</button>
                    {canWrite && m.id === idReabrible && (
                      <button className="btn btn-sm btn-ghost" style={{ color: 'var(--warning)' }} onClick={() => setReabrir(m)} disabled={busy} title="Reabrir para editar">🔓 Reabrir</button>
                    )}
                    {canWrite && (
                      <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setBorrar(m)} disabled={busy} title="Eliminar del histórico">🗑</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reabrir && (
        <ConfirmDialog title={`Reabrir mercado #${reabrir.numero}`}
          message={`¿Reabrir el mercado #${reabrir.numero} para editarlo? Vuelve a estado ABIERTO y se elimina el mercado siguiente (se regenerará al volver a cerrarlo, con el saldo recalculado). No mueve el inventario.`}
          confirmText="Reabrir" onConfirm={confirmarReabrir} onCancel={() => setReabrir(null)} />
      )}
      {borrar && (
        <ConfirmDialog title={`Eliminar mercado #${borrar.numero}`} danger
          message={`¿Eliminar el mercado #${borrar.numero} del histórico? Esta acción no se puede deshacer. No borra comidas ni toca el inventario.`}
          confirmText="Eliminar" onConfirm={confirmarBorrar} onCancel={() => setBorrar(null)} />
      )}
    </Modal>
  );
}
