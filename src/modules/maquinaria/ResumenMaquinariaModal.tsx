import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { RankedBarChart, type ChartPoint } from '@/shared/ui/Chart';
import { useRealtime } from '@/shared/lib/useRealtime';
import { num as fmtNum } from '@/shared/lib/format';
import { claveEquipo } from '@/modules/combustible/equipoVinculo';
import { consumoCombustiblePorEquipo as consumoPorEquipo } from '@/modules/combustible/combustible.repository';
import { horasUltimoPorEquipo } from './maquinariaMant.repository';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';

export function ResumenMaquinariaModal({ equipos, onClose }: { equipos: MaquinariaEquipo[]; onClose: () => void }) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [gasoil, setGasoil] = useState<{ nombre: string; cantidad: number; valor: number }[]>([]);
  const [horasMap, setHorasMap] = useState<Map<string, { horasUltimo: number | null; ultimoHorometro: number | null }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [detalle, setDetalle] = useState<string | null>(null); // nombre (equipo de combustible) seleccionado
  const [statusSel, setStatusSel] = useState<string | null>(null); // status elegido (click en su barra)

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const d = desde ? new Date(`${desde}T00:00:00`) : new Date(2000, 0, 1);
      const h = hasta ? new Date(`${hasta}T23:59:59`) : new Date();
      const [g, hm] = await Promise.all([
        consumoPorEquipo(d, h).catch(() => []),
        horasUltimoPorEquipo().catch(() => new Map()),
      ]);
      setGasoil(g); setHorasMap(hm);
    } finally { setLoading(false); }
  }, [desde, hasta]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_mantenimientos', 'combustible_tanque_movimientos'], () => { void cargar(); });

  // Distribución por status.
  const porStatus = useMemo(() => {
    const m = new Map<string, number>();
    equipos.forEach((e) => m.set(e.status || '—', (m.get(e.status || '—') ?? 0) + 1));
    return Array.from(m.entries()).map(([label, value]) => ({ label, value })) as ChartPoint[];
  }, [equipos]);

  // Gasoil consumido por equipo (de Combustible), top.
  const gasoilData: ChartPoint[] = useMemo(
    () => gasoil.filter((g) => g.cantidad > 0).map((g) => ({ label: g.nombre, value: Math.round(g.cantidad * 100) / 100, tooltip: `${g.nombre}: ${fmtNum(g.cantidad)} L` })),
    [gasoil],
  );

  // Mantenimiento preventivo: equipos con frecuencia cuyas horas del último período la superan.
  const preventivo = useMemo(() => equipos
    .filter((e) => e.mantenimiento_cada_hrs != null && e.mantenimiento_cada_hrs > 0)
    .map((e) => {
      const hm = horasMap.get(e.id);
      const horas = hm?.horasUltimo ?? null;
      const freq = e.mantenimiento_cada_hrs!;
      return { equipo: e, horas, freq, toca: horas != null && horas >= freq };
    })
    .sort((a, b) => (b.toca ? 1 : 0) - (a.toca ? 1 : 0)), [equipos, horasMap]);

  const tocan = preventivo.filter((p) => p.toca).length;

  // Detalle del equipo seleccionado (al hacer click en su barra de gasoil).
  const detalleData = useMemo(() => {
    if (!detalle) return null;
    // Misma clave normalizada que usa el resto del cruce: `trim().toLowerCase()` no
    // quita acentos, así que «Camión NHR» no encontraba su fila ni su equipo.
    const g = gasoil.find((x) => claveEquipo(x.nombre) === claveEquipo(detalle));
    const eq = equipos.find((e) => claveEquipo(e.combustible_equipo) === claveEquipo(detalle));
    const hm = eq ? horasMap.get(eq.id) : null;
    return { nombre: detalle, cantidad: g?.cantidad ?? 0, valor: g?.valor ?? 0, eq: eq ?? null, hm: hm ?? null };
  }, [detalle, gasoil, equipos, horasMap]);

  const footer = <button className="btn btn-primary" onClick={onClose}>Cerrar</button>;

  return (
    <Modal title="📊 Resumen de Maquinaria" size="xl" onClose={onClose} footer={footer}>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.6rem', marginBottom: '.75rem' }}>
        <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
          <div className="muted" style={{ fontSize: '.68rem' }}>EQUIPOS</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{equipos.length}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
          <div className="muted" style={{ fontSize: '.68rem' }}>ACTIVOS</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--success)' }}>{equipos.filter((e) => e.status === 'ACTIVO').length}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
          <div className="muted" style={{ fontSize: '.68rem' }}>REQUIEREN MANTT.</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: tocan ? 'var(--warning)' : undefined }}>{tocan}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1 1 340px', padding: '.8rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}><span>Gasoil consumido por equipo (⛽)</span><span className="muted" style={{ fontSize: '.7rem', fontWeight: 400 }}>click para ver detalle</span></div>
          <RankedBarChart data={gasoilData} valueFormatter={(v) => `${fmtNum(v)} L`} onBarClick={(p) => setDetalle(p.label)} emptyMessage={loading ? 'Cargando…' : 'Sin consumo de gasoil en el período (equipos vinculados a Combustible).'} />
        </div>
        <div className="card" style={{ flex: '1 1 260px', padding: '.8rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}><span>Equipos por status</span><span className="muted" style={{ fontSize: '.7rem', fontWeight: 400 }}>click para ver detalle</span></div>
          <RankedBarChart data={porStatus} valueFormatter={(v) => fmtNum(v)} onBarClick={(p) => setStatusSel(p.label)} emptyMessage="Sin equipos." />
        </div>
      </div>

      {/* Mantenimiento preventivo */}
      <div className="card-title" style={{ margin: '1rem 0 .4rem' }}><span>Mantenimiento preventivo</span></div>
      {!preventivo.length ? (
        <p className="hint muted" style={{ margin: 0, fontSize: '.85rem' }}>Ningún equipo tiene definida una frecuencia de mantenimiento (campo «Mantenimiento cada hrs»).</p>
      ) : (
        <div className="table-wrap" style={{ maxHeight: 240, overflow: 'auto' }}>
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead><tr><th>Equipo</th><th style={{ textAlign: 'right' }}>HRS. último período</th><th style={{ textAlign: 'right' }}>Frecuencia</th><th style={{ textAlign: 'center' }}>Estado</th></tr></thead>
            <tbody>
              {preventivo.map((p) => (
                <tr key={p.equipo.id}>
                  <td>{p.equipo.equipo}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{p.horas != null ? fmtNum(p.horas) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{fmtNum(p.freq)} h</td>
                  <td style={{ textAlign: 'center' }}>{p.toca ? <span className="badge" style={{ color: 'var(--warning)' }}>⚠️ Toca servicio</span> : <span className="badge" style={{ color: 'var(--success)' }}>OK</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detalleData && (
        <Modal title={`⛽ ${detalleData.nombre}`} size="md" onClose={() => setDetalle(null)} footer={<button className="btn btn-primary" onClick={() => setDetalle(null)}>Cerrar</button>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '.6rem', marginBottom: '.8rem' }}>
            <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
              <div className="muted" style={{ fontSize: '.68rem' }}>GASOIL CONSUMIDO{desde || hasta ? ' (período)' : ''}</div>
              <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--warning)' }}>{fmtNum(detalleData.cantidad)} L</div>
            </div>
            <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
              <div className="muted" style={{ fontSize: '.68rem' }}>VALOR CONSUMO</div>
              <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{fmtNum(detalleData.valor)}</div>
            </div>
            <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
              <div className="muted" style={{ fontSize: '.68rem' }}>ÚLTIMO HORÓMETRO</div>
              <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{detalleData.hm?.ultimoHorometro != null ? `${fmtNum(detalleData.hm.ultimoHorometro)} h` : '—'}</div>
            </div>
            <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
              <div className="muted" style={{ fontSize: '.68rem' }}>HRS. ÚLTIMO PERÍODO</div>
              <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{detalleData.hm?.horasUltimo != null ? `${fmtNum(detalleData.hm.horasUltimo)} h` : '—'}</div>
            </div>
          </div>

          {detalleData.eq ? (
            <table className="table" style={{ fontSize: '.82rem' }}>
              <tbody>
                {([
                  ['Equipo', detalleData.eq.equipo],
                  ['Tipo', detalleData.eq.tipo],
                  ['Propietario', detalleData.eq.propietario],
                  ['Status', detalleData.eq.status],
                  ['Ubicación', detalleData.eq.ubicacion],
                  ['Marca / Modelo', [detalleData.eq.marca, detalleData.eq.modelo].filter(Boolean).join(' ') || null],
                  ['Año', detalleData.eq.anio != null ? String(detalleData.eq.anio) : null],
                  ['Color', detalleData.eq.color],
                  ['Serial', detalleData.eq.serial],
                  ['Placa', detalleData.eq.placa],
                  ['Motor (modelo / serial)', [detalleData.eq.motor_modelo, detalleData.eq.motor_serial].filter(Boolean).join(' / ') || null],
                  ['Combustible', detalleData.eq.combustible],
                  ['Mantenimiento cada', detalleData.eq.mantenimiento_cada_hrs != null ? `${fmtNum(detalleData.eq.mantenimiento_cada_hrs)} h` : null],
                  ['Notas', detalleData.eq.notas],
                ] as [string, string | null][])
                  .filter(([, v]) => v != null && v !== '')
                  .map(([k, v]) => (
                    <tr key={k}><td className="muted" style={{ whiteSpace: 'nowrap', width: '40%' }}>{k}</td><td><strong>{v}</strong></td></tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <p className="hint muted" style={{ margin: 0, fontSize: '.85rem' }}>
              Este equipo de Combustible no está vinculado a una ficha de maquinaria. Vinculalo desde el botón ✎ Editar del equipo (campo «⛽ Equipo de Combustible vinculado»).
            </p>
          )}
        </Modal>
      )}

      {statusSel && (() => {
        const lista = equipos.filter((e) => (e.status || '—') === statusSel);
        return (
          <Modal title={`🚜 Status: ${statusSel} · ${lista.length} equipo(s)`} size="lg" onClose={() => setStatusSel(null)}
            footer={<button className="btn btn-primary" onClick={() => setStatusSel(null)}>Cerrar</button>}>
            {!lista.length ? (
              <p className="hint muted" style={{ margin: 0, fontSize: '.85rem' }}>Sin equipos en este status.</p>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
                <table className="table" style={{ fontSize: '.82rem' }}>
                  <thead><tr>
                    <th>Equipo</th><th>Tipo</th><th>Propietario</th><th>Ubicación</th><th>Serial / Placa</th><th style={{ textAlign: 'center' }}>Habilitado</th>
                  </tr></thead>
                  <tbody>
                    {lista.map((e) => (
                      <tr key={e.id} style={{ opacity: e.activo ? 1 : 0.55 }}>
                        <td><strong>{e.equipo}</strong>{[e.marca, e.modelo].filter(Boolean).length ? <div className="muted" style={{ fontSize: '.72rem' }}>{[e.marca, e.modelo].filter(Boolean).join(' ')}</div> : null}</td>
                        <td>{e.tipo ?? '—'}</td>
                        <td>{e.propietario ?? '—'}</td>
                        <td>{e.ubicacion ?? '—'}</td>
                        <td className="mono" style={{ fontSize: '.74rem' }}>{[e.serial, e.placa].filter(Boolean).join(' · ') || '—'}</td>
                        <td style={{ textAlign: 'center' }}>
                          {e.activo
                            ? <span className="badge" style={{ color: 'var(--success)' }}>Sí</span>
                            : <span className="badge" style={{ color: 'var(--danger)' }}>🚫 Inactivo</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Modal>
        );
      })()}
    </Modal>
  );
}
