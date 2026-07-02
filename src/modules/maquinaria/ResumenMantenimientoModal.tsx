import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { num as fmtNum, date as fmtDate } from '@/shared/lib/format';
import { consumosPorEquipo, listMantenimientos, type ConsumoMant, type MantenimientoCalc } from './maquinariaMant.repository';
import { type ResumenMantRow, type MovEquipoRow } from './servicioMantenimientoPdf';
// descargarResumenMantenimientoPdf de ./servicioMantenimientoPdf: import dinámico (al generar) para no cargar jsPDF/xlsx al abrir.
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
  // Equipo seleccionado para ver TODOS sus movimientos en el rango (modal anidado).
  const [verEquipo, setVerEquipo] = useState<MaquinariaEquipo | null>(null);

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
    try { const { descargarResumenMantenimientoPdf } = await import('./servicioMantenimientoPdf'); await descargarResumenMantenimientoPdf(grupo, rows, { desde, hasta }); }
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
              <tr key={i} className="row-selectable" style={{ cursor: 'pointer' }}
                title="Ver todos los movimientos de este equipo" onClick={() => setVerEquipo(equipos[i])}>
                <td><strong>{r.equipo}</strong> <span className="muted" style={{ fontSize: '.7rem' }}>🔍</span></td>
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
      <p className="hint muted" style={{ fontSize: '.72rem', margin: '.4rem 0 0' }}>
        Los consumos (aceite / gasoil / refrigerante / filtros) se suman de la bitácora de cada equipo en el período elegido.
        Tocá una fila para ver <strong>todos los movimientos</strong> del equipo y descargar su PDF.
      </p>

      {verEquipo && (
        <MovimientosEquipoModal equipo={verEquipo} desde={desde} hasta={hasta} onClose={() => setVerEquipo(null)} />
      )}
    </Modal>
  );
}

/**
 * Detalle de TODOS los movimientos de un equipo (bitácora) en el rango de fechas
 * heredado del resumen: qué se consumió y cuándo (ej.: "25/06 · 6 cauchos"), con PDF.
 */
function MovimientosEquipoModal({ equipo, desde, hasta, onClose }: {
  equipo: MaquinariaEquipo;
  desde: string;
  hasta: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<MantenimientoCalc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    listMantenimientos(equipo.id)
      .then((m) => { if (!cancel) setRows(m); })
      .catch(() => { if (!cancel) setRows([]); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [equipo.id]);

  // Movimientos acotados al rango heredado del resumen.
  const enRango = useMemo(
    () => rows.filter((r) => (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta)),
    [rows, desde, hasta],
  );

  const fmtInsumos = (r: MantenimientoCalc) =>
    (r.insumos ?? []).map((i) => `${i.concepto}${i.cantidad != null ? ` ×${fmtNum(i.cantidad)}${i.unidad ? ` ${i.unidad}` : ''}` : ''}`).join(', ');

  async function pdf() {
    try {
      const { descargarMovimientosEquipoPdf } = await import('./servicioMantenimientoPdf');
      const data: MovEquipoRow[] = enRango.map((r) => ({
        fecha: r.fecha, tipo: r.tipo, horometro: r.horometro, kilometraje: r.kilometraje,
        aceite: r.aceite_lts, gasoil: r.gasoil_lts, refrigerante: r.refrigerante_lts,
        filtros: r.filtros_cant, filtrosTipo: r.filtros_tipo, insumos: fmtInsumos(r),
        trabajo: r.trabajo, mecanico: r.mecanico,
      }));
      await descargarMovimientosEquipoPdf(equipo.equipo, data, { desde, hasta });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  return (
    <Modal title={`🔧 Movimientos · ${equipo.equipo}`} size="xl" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        <button className="btn btn-primary" disabled={!enRango.length} onClick={() => void pdf()}>↓ PDF de movimientos</button>
      </>
    }>
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.82rem' }}>
        Todo lo que se le hizo a <strong>{equipo.equipo}</strong>{desde || hasta ? <> en el período <strong>{desde ? fmtDate(desde) : '…'} — {hasta ? fmtDate(hasta) : 'hoy'}</strong></> : ' (histórico completo)'}.
      </p>
      <div className="table-wrap" style={{ maxHeight: 460, overflow: 'auto' }}>
        <table className="table" style={{ fontSize: '.8rem' }}>
          <thead><tr>
            <th>Fecha</th><th>Tipo</th>
            <th style={{ textAlign: 'right' }}>Horóm.</th><th style={{ textAlign: 'right' }}>Km</th>
            <th style={{ textAlign: 'right' }}>Aceite</th><th style={{ textAlign: 'right' }}>Gasoil</th><th style={{ textAlign: 'right' }}>Filtros</th>
            <th>Repuestos / insumos</th><th>Trabajo</th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !enRango.length && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center' }}>Sin movimientos en el período.</td></tr>}
            {enRango.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.fecha)}</td>
                <td style={{ fontSize: '.76rem' }}>{r.tipo ? <span className="badge">{r.tipo}</span> : '—'}{r.pieza ? <div className="muted mono" style={{ fontSize: '.68rem' }}>🔩 {r.pieza}</div> : null}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.horometro != null ? fmtNum(r.horometro) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.kilometraje != null ? fmtNum(r.kilometraje) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.aceite_lts != null ? fmtNum(r.aceite_lts) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.gasoil_lts != null ? fmtNum(r.gasoil_lts) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.filtros_cant != null ? fmtNum(r.filtros_cant) : '—'}{r.filtros_tipo ? <div className="muted" style={{ fontSize: '.66rem' }}>{r.filtros_tipo}</div> : null}</td>
                <td style={{ fontSize: '.74rem' }}>
                  {(r.insumos && r.insumos.length)
                    ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem' }}>
                        {r.insumos.map((i, k) => <span key={k} className="badge" style={{ fontSize: '.68rem' }}>{i.concepto}{i.cantidad != null ? ` ×${fmtNum(i.cantidad)}${i.unidad ? ` ${i.unidad}` : ''}` : ''}</span>)}
                      </div>
                    : '—'}
                </td>
                <td style={{ fontSize: '.76rem' }}>{r.trabajo || r.mecanico || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
