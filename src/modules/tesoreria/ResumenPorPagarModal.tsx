/* ============================================================
   MGG · Tesorería · 💬 Resumen por WhatsApp de las órdenes por pagar (04-11-2026)

   Se eligen todas o una a una, cada una con su motivo de pago (como en la
   ventana individual: «Sí, se pagará» o por qué no), y sale el mensaje con el
   código, el proveedor, el monto a pagar en $, el total y la fecha en que se
   generó. Nada se manda solo: el mensaje se ve antes y se copia o se envía.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { MensajeWhatsappModal } from '@/modules/pedidos/MensajeWhatsappModal';
import type { OrdenPorPagar } from '@/modules/pedidos/pedidos.repository';
import type { DirectoFila } from '@/modules/pedidos/DirectosPorPagarModal';
import { getTasaHoy, round2 } from './tasas.repository';
import {
  ETIQUETA_MOTIVO_LOTE, errorResumenPorPagar, textoResumenPorPagar, textoTesoreriaAlDia,
  type ItemResumenPorPagar, type MotivoPagoLote,
} from './resumenPorPagarWhatsapp';

interface Fila { id: string; codigo: string; proveedor: string; monto: number; moneda: string }

const esBs = (m: string | null | undefined) => (m ?? '').toUpperCase() === 'BS';

export function ResumenPorPagarModal({ rows, directos, onClose }: {
  rows: OrdenPorPagar[]; directos: DirectoFila[]; onClose: () => void;
}) {
  const filas = useMemo<Fila[]>(() => [
    ...rows.map((r) => ({
      id: r.orden.id, codigo: r.orden.oc_codigo ?? r.orden.codigo, proveedor: r.proveedorNombre,
      monto: Number(r.montoAPagar) || 0, moneda: r.orden.moneda ?? 'USD',
    })),
    ...directos.map((f) => ({ id: `dir-${f.kind}-${f.id}`, codigo: f.codigo, proveedor: f.titulo, monto: Number(f.total) || 0, moneda: f.moneda })),
  ], [rows, directos]);

  const [tasa, setTasa] = useState(0);
  useEffect(() => { getTasaHoy().then((t) => setTasa(Number(t.usd) || 0)).catch(() => setTasa(0)); }, []);
  const enUsd = (f: Fila) => (esBs(f.moneda) ? (tasa > 0 ? round2(f.monto / tasa) : 0) : round2(f.monto));

  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set(filas.map((f) => f.id)));
  const [motivos, setMotivos] = useState<Record<string, MotivoPagoLote>>({});
  const [otros, setOtros] = useState<Record<string, string>>({});
  const [texto, setTexto] = useState<string | null>(null);

  const todas = filas.length > 0 && filas.every((f) => marcadas.has(f.id));
  const seleccionadas = filas.filter((f) => marcadas.has(f.id));
  const hayBsSinTasa = tasa <= 0 && seleccionadas.some((f) => esBs(f.moneda));
  const totalSel = round2(seleccionadas.reduce((a, f) => a + enUsd(f), 0));

  function toggle(id: string) {
    setMarcadas((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function aplicarATodas(m: MotivoPagoLote) {
    setMotivos(Object.fromEntries(seleccionadas.map((f) => [f.id, m])));
  }
  function generar() {
    // 07-11-2026: sin ninguna orden por pagar, el mensaje dice «Tesorería al día».
    if (!filas.length) { setTexto(textoTesoreriaAlDia(new Date())); return; }
    if (hayBsSinTasa) { toast('No hay tasa BCV del día: no se pueden pasar a $ las órdenes en Bs.', 'error'); return; }
    const items: ItemResumenPorPagar[] = seleccionadas.map((f) => ({
      codigo: f.codigo, proveedor: f.proveedor, montoUsd: enUsd(f),
      motivo: motivos[f.id] ?? 'si', motivoOtro: otros[f.id] ?? null,
    }));
    const err = errorResumenPorPagar(items);
    if (err) { toast(err, 'error'); return; }
    setTexto(textoResumenPorPagar(items, new Date()));
  }

  return (
    <Modal title="💬 Resumen por WhatsApp · Órdenes por pagar" size="lg" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      <button className="btn btn-primary" disabled={filas.length > 0 && !seleccionadas.length} onClick={generar}>
        {filas.length ? `💬 Generar resumen (${seleccionadas.length})` : '💬 Generar «Tesorería al día»'}
      </button>
    </>}>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Marca todas o una a una e indica el <strong>motivo de pago</strong> de cada una. El mensaje lleva el código, el proveedor,
        el monto a pagar en $, el total y la fecha en que se genera.
      </p>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '.6rem' }}>
        <label style={{ display: 'inline-flex', gap: '.35rem', alignItems: 'center', cursor: 'pointer', fontWeight: 600 }}>
          <input type="checkbox" checked={todas} onChange={() => setMarcadas(todas ? new Set() : new Set(filas.map((f) => f.id)))} />
          Seleccionar todas
        </label>
        <span className="muted" style={{ fontSize: '.8rem', marginLeft: 'auto' }}>Motivo para las marcadas:</span>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => aplicarATodas('si')}>✓ Todas se pagan</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => aplicarATodas('sin_fondos')}>✕ Sin fondos</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => aplicarATodas('esperando_jefe')}>⏳ Esperando al jefe</button>
      </div>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr>
            <th style={{ width: 28 }}></th><th>Código</th><th>Proveedor</th>
            <th style={{ textAlign: 'right' }}>A pagar $</th><th>Motivo de pago</th>
          </tr></thead>
          <tbody>
            {!filas.length && <tr><td colSpan={5} style={{ textAlign: 'center', fontWeight: 700 }}>ÓRDENES PENDIENTES POR PAGAR: 0 · <span style={{ color: 'var(--success)' }}>✅ TESORERÍA AL DÍA EN PAGOS PENDIENTES</span></td></tr>}
            {filas.map((f) => {
              const m = motivos[f.id] ?? 'si';
              const marcada = marcadas.has(f.id);
              return (
                <tr key={f.id} style={{ opacity: marcada ? 1 : 0.5 }}>
                  <td style={{ textAlign: 'center' }}><input type="checkbox" checked={marcada} onChange={() => toggle(f.id)} /></td>
                  <td className="mono">{f.codigo}</td>
                  <td>{f.proveedor}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {esBs(f.moneda) && tasa <= 0 ? '—' : `$${enUsd(f).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </td>
                  <td>
                    <select className="input" style={{ minWidth: 200 }} value={m} disabled={!marcada}
                      onChange={(e) => setMotivos((p) => ({ ...p, [f.id]: e.target.value as MotivoPagoLote }))}>
                      {(Object.keys(ETIQUETA_MOTIVO_LOTE) as MotivoPagoLote[]).map((k) => (
                        <option key={k} value={k}>{k === 'si' ? '✓ ' : '✕ '}{ETIQUETA_MOTIVO_LOTE[k]}</option>
                      ))}
                    </select>
                    {m === 'otro' && marcada && (
                      <input className="input" style={{ marginTop: '.3rem' }} placeholder="Escribe el motivo"
                        value={otros[f.id] ?? ''} onChange={(e) => setOtros((p) => ({ ...p, [f.id]: e.target.value }))} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {seleccionadas.length > 0 && (
            <tfoot><tr>
              <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Total ({seleccionadas.length})</td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>${totalSel.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              <td></td>
            </tr></tfoot>
          )}
        </table>
      </div>
      {hayBsSinTasa && <p className="hint" style={{ color: 'var(--danger)' }}>Falta la tasa BCV del día para pasar a $ las órdenes en Bs.</p>}
      {texto && <MensajeWhatsappModal titulo="Resumen · Órdenes por pagar" texto={texto} onClose={() => setTexto(null)} />}
    </Modal>
  );
}
