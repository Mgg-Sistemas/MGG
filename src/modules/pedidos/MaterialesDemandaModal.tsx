import { useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { money, num } from '@/shared/lib/format';
import { toast } from '@/shared/ui/Toast';
import type { Orden } from '@/shared/lib/types';
import { type DemandaRow } from './demandaPdf'; // función descargarDemandaPdf: import dinámico (al exportar) para no cargar jsPDF al abrir.

interface Props {
  ordenes: Orden[];
  onClose: () => void;
}

type Metrica = 'cantidad' | 'monto';
type Modo = 'todo' | 'dia' | 'mes' | 'rango';

const TOP_N = 12;

export function MaterialesDemandaModal({ ordenes, onClose }: Props) {
  const [metrica, setMetrica] = useState<Metrica>('cantidad');
  const [modo, setModo] = useState<Modo>('todo');
  const [dia, setDia] = useState('');          // yyyy-mm-dd
  const [mes, setMes] = useState('');          // yyyy-mm
  const [desde, setDesde] = useState('');      // yyyy-mm-dd
  const [hasta, setHasta] = useState('');      // yyyy-mm-dd
  const [exporting, setExporting] = useState(false);

  // Órdenes dentro del período elegido (se usa la fecha de solicitud / created_at).
  const ordenesPeriodo = useMemo(() => {
    return ordenes.filter((o) => {
      if (!o.created_at) return false;
      const ts = new Date(o.created_at).getTime();
      if (modo === 'dia') {
        if (!dia) return true;
        const ini = new Date(dia + 'T00:00:00').getTime();
        const fin = new Date(dia + 'T23:59:59.999').getTime();
        return ts >= ini && ts <= fin;
      }
      if (modo === 'mes') {
        if (!mes) return true;
        const ini = new Date(mes + '-01T00:00:00').getTime();
        const [yy, mm] = mes.split('-').map(Number);
        const finDate = new Date(yy, mm, 0, 23, 59, 59, 999); // último día del mes
        return ts >= ini && ts <= finDate.getTime();
      }
      if (modo === 'rango') {
        const ini = desde ? new Date(desde + 'T00:00:00').getTime() : null;
        const fin = hasta ? new Date(hasta + 'T23:59:59.999').getTime() : null;
        if (ini && ts < ini) return false;
        if (fin && ts > fin) return false;
        return true;
      }
      return true; // 'todo'
    });
  }, [ordenes, modo, dia, mes, desde, hasta]);

  // Agregación de demanda por producto (clave: SKU, con respaldo en el nombre).
  const rows = useMemo<DemandaRow[]>(() => {
    const map = new Map<string, DemandaRow & { _ordenes: Set<string> }>();
    for (const o of ordenesPeriodo) {
      for (const it of o.items ?? []) {
        const key = (it.sku || it.nombre || '—').trim().toLowerCase();
        let r = map.get(key);
        if (!r) {
          r = { sku: it.sku || '—', nombre: it.nombre || it.sku || '—', cantidad: 0, monto: 0, ordenes: 0, _ordenes: new Set() };
          map.set(key, r);
        }
        const cant = Number(it.cantidad) || 0;
        r.cantidad += cant;
        r.monto += cant * (Number(it.precio) || 0);
        r._ordenes.add(o.id);
      }
    }
    return Array.from(map.values()).map((r) => ({
      sku: r.sku, nombre: r.nombre,
      cantidad: Math.round(r.cantidad * 100) / 100,
      monto: Math.round(r.monto * 100) / 100,
      ordenes: r._ordenes.size,
    }));
  }, [ordenesPeriodo]);

  const valOf = (r: DemandaRow) => (metrica === 'cantidad' ? r.cantidad : r.monto);
  const sorted = useMemo(() => [...rows].sort((a, b) => valOf(b) - valOf(a)), [rows, metrica]);
  const top = sorted.slice(0, TOP_N);
  const max = Math.max(1, ...top.map(valOf));

  function periodoLabel(): string {
    if (modo === 'dia') return dia ? `Día ${dia}` : 'Todos los días';
    if (modo === 'mes') return mes ? `Mes ${mes}` : 'Todos los meses';
    if (modo === 'rango') return `Rango ${desde || '…'} → ${hasta || '…'}`;
    return 'Todo el histórico';
  }

  async function exportar() {
    setExporting(true);
    try {
      const { descargarDemandaPdf } = await import('./demandaPdf');
      await descargarDemandaPdf(sorted, { metrica, periodo: periodoLabel(), totalOrdenes: ordenesPeriodo.length });
    } catch {
      toast('No se pudo generar el PDF', 'error');
    } finally {
      setExporting(false);
    }
  }

  const fmt = (v: number) => (metrica === 'cantidad' ? num(v) : money(v));

  return (
    <Modal
      title="📊 Materiales con más demanda"
      size="xl"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
          <button className="btn btn-primary" onClick={exportar} disabled={exporting || !sorted.length}>
            {exporting ? 'Generando…' : '↓ Exportar PDF'}
          </button>
        </>
      }
    >
      {/* Controles: métrica + período */}
      <div className="card" style={{ marginBottom: '1rem', padding: '.85rem 1rem', display: 'flex', flexWrap: 'wrap', gap: '.6rem', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: '.82rem' }}>Medir por:</span>
        <button type="button" className={`chip${metrica === 'cantidad' ? ' chip-active' : ''}`} onClick={() => setMetrica('cantidad')}>Cantidad</button>
        <button type="button" className={`chip${metrica === 'monto' ? ' chip-active' : ''}`} onClick={() => setMetrica('monto')}>Monto ($)</button>

        <span className="muted" style={{ fontSize: '.82rem', marginLeft: '.8rem' }}>Período:</span>
        {(['todo', 'dia', 'mes', 'rango'] as Modo[]).map((m) => (
          <button key={m} type="button" className={`chip${modo === m ? ' chip-active' : ''}`} onClick={() => setModo(m)}>
            {m === 'todo' ? 'Todo' : m === 'dia' ? 'Día' : m === 'mes' ? 'Mes' : 'Rango'}
          </button>
        ))}

        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
          {modo === 'dia' && (
            <input type="date" className="input" style={{ width: 170 }} value={dia} onChange={(e) => setDia(e.target.value)} />
          )}
          {modo === 'mes' && (
            <input type="month" className="input" style={{ width: 170 }} value={mes} onChange={(e) => setMes(e.target.value)} />
          )}
          {modo === 'rango' && (
            <>
              <label className="muted" style={{ fontSize: '.82rem' }}>Desde</label>
              <input type="date" className="input" style={{ width: 160 }} value={desde} onChange={(e) => setDesde(e.target.value)} />
              <label className="muted" style={{ fontSize: '.82rem' }}>Hasta</label>
              <input type="date" className="input" style={{ width: 160 }} value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </>
          )}
        </div>
      </div>

      <div className="muted" style={{ fontSize: '.82rem', marginBottom: '.6rem' }}>
        {periodoLabel()} · {ordenesPeriodo.length} orden(es) · {sorted.length} material(es)
      </div>

      {!sorted.length ? (
        <EmptyState message="No hay demanda registrada para el período seleccionado." icon="◇" />
      ) : (
        <>
          {/* Gráfico de barras horizontales (top N) */}
          <div className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
            <div className="card-title" style={{ marginBottom: '.75rem' }}>Top {top.length} por {metrica === 'cantidad' ? 'cantidad' : 'monto'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {top.map((r, i) => {
                const v = valOf(r);
                const pct = Math.max(2, (v / max) * 100);
                return (
                  <div key={`${r.sku}-${i}`} className="m-stack" style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '.6rem', alignItems: 'center' }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '.82rem' }} title={`${r.sku} · ${r.nombre}`}>
                      <strong className="mono">{r.sku !== '—' ? r.sku : ''}</strong> {r.nombre}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                      <div style={{ flex: 1, background: 'var(--bg-2)', borderRadius: '4px', overflow: 'hidden', height: 18 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: i === 0 ? 'var(--brand, #ff8a00)' : 'var(--primary)', borderRadius: '4px' }} />
                      </div>
                      <span className="mono" style={{ fontSize: '.8rem', minWidth: 80, textAlign: 'right' }}>{fmt(v)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tabla completa del ranking */}
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.85rem' }}>
              <thead>
                <tr>
                  <th style={{ width: 36, textAlign: 'right' }}>#</th>
                  <th>SKU</th>
                  <th>Producto</th>
                  <th style={{ textAlign: 'right' }}>Cantidad</th>
                  <th style={{ textAlign: 'right' }}>Órdenes</th>
                  <th style={{ textAlign: 'right' }}>Monto total</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => (
                  <tr key={`${r.sku}-row-${i}`}>
                    <td className="mono" style={{ textAlign: 'right' }}>{i + 1}</td>
                    <td className="mono">{r.sku}</td>
                    <td>{r.nombre}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(r.cantidad)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{num(r.ordenes)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{money(r.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
