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
import { compararConsumos } from './mercadoComparar';

function fmtDia(iso: string): string { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }

/**
 * Dos cortes lado a lado, víver por víver, ordenado por la variación más grande.
 *
 * La pregunta del analista no es «cuánto consumimos» sino «qué se disparó respecto
 * del corte anterior», así que manda el salto y no el volumen. Sin gráfico: con
 * 20-50 filas y dos series la tabla se lee mejor, se ordena y no depende del color.
 */
function Comparacion({ mercados, onCerrar }: { mercados: MercadoCocina[]; onCerrar: () => void }) {
  // El más viejo a la izquierda, para que el «antes → después» se lea natural.
  const [viejo, nuevo] = [...mercados].sort((a, b) => a.numero - b.numero);
  const filas = useMemo(
    () => compararConsumos(viejo.cierre?.consumos ?? [], nuevo.cierre?.consumos ?? []),
    [viejo, nuevo],
  );
  return (
    <div className="card" style={{ marginTop: '.8rem', borderColor: 'var(--primary)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
        <div className="card-title" style={{ margin: 0 }}>
          Comparación · #{viejo.numero} → #{nuevo.numero}
          <span className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}> · consumo por víver, mayor variación primero</span>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={onCerrar}>Quitar selección</button>
      </div>
      {!filas.length ? (
        <p className="hint muted" style={{ margin: 0 }}>Ninguno de los dos cortes tiene consumos cargados.</p>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
          <table className="table" style={{ fontSize: '.83rem' }}>
            <thead><tr>
              <th>Víver</th>
              <th style={{ textAlign: 'right' }}>#{viejo.numero}</th>
              <th style={{ textAlign: 'right' }}>#{nuevo.numero}</th>
              <th style={{ textAlign: 'right' }}>Δ</th>
            </tr></thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.producto_id}>
                  <td>{f.nombre} <span className="muted mono" style={{ fontSize: '.72rem' }}>{f.unidad}</span></td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(f.a)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(f.b)}</td>
                  {/* El signo escrito además del color: se lee igual sin distinguir colores. */}
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: f.delta > 0 ? 'var(--warning)' : f.delta < 0 ? 'var(--primary-3, #2ecc71)' : undefined }}>
                    {f.delta > 0 ? '+' : ''}{num(f.delta)}
                    {f.pct != null && <span className="muted" style={{ fontWeight: 400 }}> ({f.pct > 0 ? '+' : ''}{f.pct} %)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

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
  // Comparar dos cortes es la pregunta real del analista: qué se disparó respecto
  // del anterior. Se eligen marcando dos filas de la tabla.
  const [sel, setSel] = useState<string[]>([]);

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
        {/* Acá ya se eligió UN mercado desde la lista del histórico: un selector
            dentro del modal sería una segunda forma de hacer lo mismo. */}
        <MercadoPanel resumen={ver.resumen} mercados={[]} onElegirMercado={() => {}}
          cocinaNombre={cocinaNombre} almacen={almacen} canWrite={false}
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
              <th style={{ width: 34 }} title="Marcá dos para compararlos">⇄</th>
              <th>N° mercado</th><th>Período</th>
              <th style={{ textAlign: 'right' }}>Consumo</th>
              <th style={{ textAlign: 'right' }}>Platos</th>
              <th style={{ textAlign: 'right' }}>Remanente</th>
              <th style={{ textAlign: 'right' }}>Dif.</th>
              <th style={{ textAlign: 'right' }}>Acciones</th>
            </tr></thead>
            <tbody>
              {cerrados.map((m) => {
                const dif = m.cierre?.diferencia;
                const marcado = sel.includes(m.id);
                return (
                <tr key={m.id} style={marcado ? { borderLeft: '3px solid var(--primary)' } : undefined}>
                  <td>
                    <input type="checkbox" checked={marcado} disabled={!marcado && sel.length >= 2}
                      onChange={() => setSel((prev) => prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id])}
                      title={!marcado && sel.length >= 2 ? 'Ya hay dos marcados' : 'Comparar este corte'} />
                  </td>
                  <td className="mono">#{m.numero}</td>
                  <td>{fmtDia(m.fecha_inicio)} → {fmtDia(m.fecha_fin)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(m.cierre?.totales.valor ?? 0)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(m.cierre?.totales.platos ?? 0)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(m.cierre?.remanente.length ?? 0)} ítem(s)</td>
                  {/* La columna que se busca primero cuando se abre el histórico. Los
                      cierres viejos no la tienen: se muestra «—», no un 0 que mienta. */}
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: dif == null ? undefined : dif === 0 ? undefined : dif < 0 ? 'var(--danger)' : 'var(--warning)' }}>
                    {dif == null ? <span className="dim">—</span> : dif === 0 ? '·' : `${dif > 0 ? '+' : ''}${num(dif)}`}
                    {m.cierre?.ajustado && <span title={m.cierre.motivo_ajuste ?? 'Ajustado al inventario'} style={{ marginLeft: '.25rem' }}>✎</span>}
                  </td>
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Comparación de dos cortes, víver por víver ──────────────────────── */}
      {sel.length === 2 && <Comparacion mercados={cerrados.filter((m) => sel.includes(m.id))} onCerrar={() => setSel([])} />}
      {sel.length === 1 && (
        <p className="hint muted" style={{ marginTop: '.6rem' }}>Marcá un segundo mercado para comparar los dos.</p>
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
