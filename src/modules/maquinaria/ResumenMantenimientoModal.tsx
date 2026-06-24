import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { num as fmtNum } from '@/shared/lib/format';
import { consumosPorEquipo, type ConsumoMant } from './maquinariaMant.repository';
import { descargarResumenMantenimientoPdf, type ResumenMantRow } from './servicioMantenimientoPdf';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';

const CERO: ConsumoMant = { aceite: 0, refrigerante: 0, gasoil: 0, filtros: 0, registros: 0 };

/**
 * Resumen del grupo de mantenimiento ACTIVO (el switch que se está viendo): por cada
 * equipo, su horómetro / HRS restantes y los consumos del período (aceite / gasoil /
 * refrigerante / filtros). Filtrable por fechas, con descarga a PDF (vista previa).
 */
export function ResumenMantenimientoModal({ grupo, equipos, infoEquipo, onClose }: {
  grupo: string;
  equipos: MaquinariaEquipo[];
  infoEquipo: Map<string, { restantes: number | null; horometro: number | null }>;
  onClose: () => void;
}) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [consumos, setConsumos] = useState<Map<string, ConsumoMant>>(new Map());
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    setLoading(true);
    try { setConsumos(await consumosPorEquipo(desde || undefined, hasta || undefined)); }
    catch { setConsumos(new Map()); }
    finally { setLoading(false); }
  }, [desde, hasta]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_mantenimientos'], () => { void cargar(); });

  const rows: ResumenMantRow[] = useMemo(() => equipos.map((e) => {
    const c = consumos.get(e.id) ?? CERO;
    const info = infoEquipo.get(e.id);
    return {
      equipo: e.equipo, status: e.status,
      horometro: info?.horometro ?? null, restantes: info?.restantes ?? null,
      aceite: c.aceite, gasoil: c.gasoil, refrigerante: c.refrigerante, filtros: c.filtros,
    };
  }), [equipos, consumos, infoEquipo]);

  const tot = useMemo(() => rows.reduce((a, r) => ({
    aceite: a.aceite + r.aceite, gasoil: a.gasoil + r.gasoil,
    refrigerante: a.refrigerante + r.refrigerante, filtros: a.filtros + r.filtros,
  }), { aceite: 0, gasoil: 0, refrigerante: 0, filtros: 0 }), [rows]);

  async function pdf() {
    try { await descargarResumenMantenimientoPdf(grupo, rows, { desde, hasta }); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      <button className="btn btn-primary" disabled={!rows.length} onClick={() => void pdf()}>↓ Resumen PDF</button>
    </>
  );

  return (
    <Modal title={`📊 Resumen · ${grupo}`} size="xl" onClose={onClose} footer={footer}>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.7rem' }}>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
          Desde <input className="input" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} style={{ width: 'auto' }} />
        </label>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
          Hasta <input className="input" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} style={{ width: 'auto' }} />
        </label>
        {(desde || hasta) && <button className="btn btn-sm btn-ghost" onClick={() => { setDesde(''); setHasta(''); }}>✕ Fechas</button>}
        <span className="muted" style={{ fontSize: '.78rem', marginLeft: 'auto' }}>{equipos.length} equipo(s){loading ? ' · cargando…' : ''}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '.5rem', marginBottom: '.7rem' }}>
        <div className="card" style={{ margin: 0, padding: '.5rem .75rem' }}>
          <div className="muted" style={{ fontSize: '.66rem' }}>ACEITE (Σ)</div>
          <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 700 }}>{fmtNum(tot.aceite)} L</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.5rem .75rem' }}>
          <div className="muted" style={{ fontSize: '.66rem' }}>GASOIL (Σ)</div>
          <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 700 }}>{fmtNum(tot.gasoil)} L</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.5rem .75rem' }}>
          <div className="muted" style={{ fontSize: '.66rem' }}>REFRIGERANTE (Σ)</div>
          <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 700 }}>{fmtNum(tot.refrigerante)} L</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.5rem .75rem' }}>
          <div className="muted" style={{ fontSize: '.66rem' }}>FILTROS (Σ)</div>
          <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 700 }}>{fmtNum(tot.filtros)}</div>
        </div>
      </div>

      <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr>
            <th>Equipo</th><th>Status</th>
            <th style={{ textAlign: 'right' }}>Horómetro</th><th style={{ textAlign: 'right' }}>HRS. rest.</th>
            <th style={{ textAlign: 'right' }}>Aceite</th><th style={{ textAlign: 'right' }}>Gasoil</th>
            <th style={{ textAlign: 'right' }}>Refrig.</th><th style={{ textAlign: 'right' }}>Filtros</th>
          </tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center' }}>Sin equipos en este grupo.</td></tr>}
            {rows.map((r, i) => (
              <tr key={i}>
                <td><strong>{r.equipo}</strong></td>
                <td>{r.status}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.horometro != null ? fmtNum(r.horometro) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.restantes != null ? `${fmtNum(r.restantes)} h` : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.aceite ? fmtNum(r.aceite) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.gasoil ? fmtNum(r.gasoil) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.refrigerante ? fmtNum(r.refrigerante) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.filtros ? fmtNum(r.filtros) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: '.72rem', margin: '.4rem 0 0' }}>
        Los consumos (aceite / gasoil / refrigerante / filtros) se suman de la bitácora de cada equipo en el período elegido.
      </p>
    </Modal>
  );
}
