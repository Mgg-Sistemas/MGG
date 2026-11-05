/* ============================================================
   MGG · Cocina · 🧾 Histórico de distribución (05-11-2026)
   Los repartos del mercado entre las cocinas y el resguardo, con su PDF (vista
   previa) y su WhatsApp, uno a uno o de todo lo filtrado. Nada se manda solo.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { FechaVe } from '@/shared/ui/FechaVe';
import { useRealtime } from '@/shared/lib/useRealtime';
import { MensajeWhatsappModal } from '@/modules/pedidos/MensajeWhatsappModal';
import { listHistoricoRepartos } from './repartoHistorico.repository';
import {
  etiquetaEstadoReparto, fechaHoraReparto, mensajeHistoricoRepartos, mensajeReparto, tocaCocina, valorReparto,
  type RepartoHist,
} from './repartoHistorico';

const hoyVe = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
const usd = (n: number) => `$${(Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number) => (Number(n) || 0).toLocaleString('es-VE', { maximumFractionDigits: 3 });

export function HistoricoRepartosModal({ cocinaNombre, onClose }: { cocinaNombre: string; onClose: () => void }) {
  const hoy = useMemo(hoyVe, []);
  const [desde, setDesde] = useState(() => `${hoy.slice(0, 8)}01`);
  const [hasta, setHasta] = useState(hoy);
  const [todas, setTodas] = useState(false);
  const [sentido, setSentido] = useState<'todos' | 'sale' | 'entra'>('todos');
  const [buscar, setBuscar] = useState('');
  const [filas, setFilas] = useState<RepartoHist[]>([]);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<{ titulo: string; texto: string } | null>(null);

  const cargar = useCallback(async () => {
    if (!desde || !hasta || desde > hasta) return;
    setCargando(true);
    try { setFilas(await listHistoricoRepartos(desde, hasta)); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo leer el histórico', 'error'); }
    finally { setCargando(false); }
  }, [desde, hasta]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['solicitudes_salida'], () => { void cargar(); });

  const n = (s: string) => s.trim().toLowerCase();
  const visibles = useMemo(() => filas.filter((r) => {
    if (!todas && !tocaCocina(r, cocinaNombre)) return false;
    if (!todas && sentido === 'sale' && n(r.origen) !== n(cocinaNombre)) return false;
    if (!todas && sentido === 'entra' && n(r.destino) !== n(cocinaNombre)) return false;
    const q = n(buscar);
    if (q && ![r.codigo, r.origen, r.destino, r.nota ?? '', r.quien ?? '', ...r.lineas.map((l) => l.nombre)].some((x) => n(x).includes(q))) return false;
    return true;
  }), [filas, todas, sentido, buscar, cocinaNombre]);
  const total = visibles.reduce((a, r) => a + valorReparto(r), 0);
  const cab = { desde, hasta, cocina: todas ? null : cocinaNombre };

  async function pdf(rs: RepartoHist[]) {
    try { const { verHistoricoRepartosPdf } = await import('./repartoHistoricoPdf'); await verHistoricoRepartosPdf(rs, cab); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo armar el PDF', 'error'); }
  }

  return (
    <Modal title="🧾 Histórico de distribución" size="xl" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      <button className="btn btn-ghost" disabled={!visibles.length} onClick={() => setWhatsapp({ titulo: 'Histórico de distribución · WhatsApp', texto: mensajeHistoricoRepartos(visibles, cab) })}>💬 WhatsApp</button>
      <button className="btn btn-primary" disabled={!visibles.length} onClick={() => void pdf(visibles)}>📄 PDF</button>
    </>}>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.85rem' }}>
        Cada reparto del mercado a otra cocina o al resguardo, con sus víveres. Toca una fila para ver el detalle.
      </p>
      <div className="form-grid" style={{ marginBottom: '.6rem' }}>
        <div className="form-row"><label>Desde</label><FechaVe value={desde} onChange={setDesde} /></div>
        <div className="form-row"><label>Hasta</label><FechaVe value={hasta} onChange={setHasta} /></div>
        <div className="form-row">
          <label>Cuáles</label>
          <select className="select" value={todas ? 'todas' : sentido} onChange={(e) => {
            const v = e.target.value;
            if (v === 'todas') { setTodas(true); setSentido('todos'); } else { setTodas(false); setSentido(v as 'todos' | 'sale' | 'entra'); }
          }}>
            <option value="todos">De {cocinaNombre} (enviados y recibidos)</option>
            <option value="sale">Enviados desde {cocinaNombre}</option>
            <option value="entra">Recibidos en {cocinaNombre}</option>
            <option value="todas">Todas las cocinas y el resguardo</option>
          </select>
        </div>
        <div className="form-row"><label>Buscar</label><input className="input" placeholder="Traslado, víver, cocina, nota…" value={buscar} onChange={(e) => setBuscar(e.target.value)} /></div>
      </div>
      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr>
            <th>Traslado</th><th>Fecha</th><th>De</th><th>A</th><th>Mercado</th>
            <th style={{ textAlign: 'right' }}>Víveres</th><th style={{ textAlign: 'right' }}>Valor</th><th>Estado</th><th />
          </tr></thead>
          <tbody>
            {cargando && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!cargando && !visibles.length && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center' }}>Sin repartos en ese período.</td></tr>}
            {!cargando && visibles.map((r) => (
              <FilaReparto key={r.id} r={r} abierto={abierto === r.id} onToggle={() => setAbierto(abierto === r.id ? null : r.id)}
                onPdf={() => void pdf([r])} onWhatsapp={() => setWhatsapp({ titulo: `Distribución ${r.codigo} · WhatsApp`, texto: mensajeReparto(r) })} />
            ))}
          </tbody>
          {visibles.length > 0 && (
            <tfoot><tr>
              <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700 }}>Total ({visibles.length})</td>
              <td className="mono" style={{ textAlign: 'right' }}>{visibles.reduce((a, r) => a + r.lineas.length, 0)}</td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{usd(total)}</td><td colSpan={2} />
            </tr></tfoot>
          )}
        </table>
      </div>
      {whatsapp && <MensajeWhatsappModal titulo={whatsapp.titulo} texto={whatsapp.texto} onClose={() => setWhatsapp(null)} />}
    </Modal>
  );
}

function FilaReparto({ r, abierto, onToggle, onPdf, onWhatsapp }: {
  r: RepartoHist; abierto: boolean; onToggle: () => void; onPdf: () => void; onWhatsapp: () => void;
}) {
  const v = valorReparto(r);
  return (
    <>
      <tr className="row-selectable" style={{ cursor: 'pointer' }} onClick={onToggle}>
        <td className="mono">{abierto ? '▾' : '▸'} {r.codigo}</td>
        <td>{fechaHoraReparto(r.fecha)}</td>
        <td>{r.origen}</td>
        <td>{r.destino}</td>
        <td>{r.mercado != null ? `#${r.mercado}` : '—'}</td>
        <td className="mono" style={{ textAlign: 'right' }}>{r.lineas.length}</td>
        <td className="mono" style={{ textAlign: 'right' }}>{v > 0 ? usd(v) : '—'}</td>
        <td><span className={`badge ${r.estado === 'ejecutada' ? 'success' : r.estado === 'aprobada' || r.estado === 'por_aprobar' ? 'warning' : ''}`}>{etiquetaEstadoReparto(r.estado)}</span></td>
        <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn btn-ghost btn-xs" title="PDF de este reparto (vista previa)" onClick={onPdf}>📄 PDF</button>
          <button type="button" className="btn btn-ghost btn-xs" title="WhatsApp de este reparto" onClick={onWhatsapp}>💬</button>
        </td>
      </tr>
      {abierto && (
        <tr><td colSpan={9} style={{ paddingTop: 0 }}>
          <div className="muted" style={{ fontSize: '.78rem', margin: '.2rem 0 .35rem' }}>
            {r.quien ? `Registró: ${r.quien}` : ''}{r.nota ? ` · Nota: ${r.nota}` : ''}
          </div>
          <table className="table" style={{ fontSize: '.78rem' }}>
            <thead><tr><th>Víver</th><th style={{ textAlign: 'right' }}>Cantidad</th><th>Unidad</th><th style={{ textAlign: 'right' }}>Costo unit.</th><th style={{ textAlign: 'right' }}>Valor</th></tr></thead>
            <tbody>
              {r.lineas.map((l, i) => (
                <tr key={i}>
                  <td>{l.nombre}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{num(l.cantidad)}</td>
                  <td>{l.unidad ?? '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{l.precio != null ? usd(l.precio) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{l.precio != null ? usd(l.cantidad * l.precio) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </td></tr>
      )}
    </>
  );
}
