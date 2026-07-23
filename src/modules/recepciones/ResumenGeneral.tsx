import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { dateTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  resumenGeneralLocal, fetchRecepcionesExternas,
  type RecepcionGrupo, type ResumenCentro, type RecepcionFila, type ResumenExterno,
} from './recepciones.repository';

/** 2 decimales es-VE con redondeo half-up (igual criterio que el resto de Recepciones). */
function n2(n: number | null | undefined): string {
  if (n == null || isNaN(n as number)) return '—';
  const r = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  return r.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sumar(rows: ResumenCentro[]) {
  return rows.reduce((a, c) => ({
    nRecepciones: a.nRecepciones + c.nRecepciones,
    totalKg: a.totalKg + c.totalKg,
    netoHumedo: a.netoHumedo + c.netoHumedo,
    netoSeco: a.netoSeco + c.netoSeco,
  }), { nRecepciones: 0, totalKg: 0, netoHumedo: 0, netoSeco: 0 });
}

/** Tabla de resumen por centro (solo lectura). */
function TablaResumen({ rows, etiquetaTotal }: { rows: ResumenCentro[]; etiquetaTotal: string }) {
  if (!rows.length) return <EmptyState message="Sin recepciones registradas." icon="📥" />;
  const t = sumar(rows);
  return (
    <div className="table-wrap">
      <table className="table" style={{ fontSize: '.9rem' }}>
        <thead>
          <tr>
            <th>Centro</th>
            <th style={{ textAlign: 'right' }}>Recepciones</th>
            <th style={{ textAlign: 'right' }}>Total recibido (Kg)</th>
            <th style={{ textAlign: 'right' }}>Neto húmedo</th>
            <th style={{ textAlign: 'right' }}>Neto seco</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td><strong>{c.nombre}</strong></td>
              <td className="mono" style={{ textAlign: 'right' }}>{c.nRecepciones}</td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{n2(c.totalKg)}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{n2(c.netoHumedo)}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{n2(c.netoSeco)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ fontWeight: 800 }}>{etiquetaTotal}</td>
            <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{t.nRecepciones}</td>
            <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{n2(t.totalKg)} Kg</td>
            <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{n2(t.netoHumedo)}</td>
            <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{n2(t.netoSeco)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Histórico consolidado (solo lectura): TODAS las recepciones individuales, con su centro
 *  y —si aplica— la marca del sistema de origen. Guarda el historial completo. */
function HistorialTable({ filas }: { filas: Array<RecepcionFila & { origen?: string }> }) {
  if (!filas.length) return <EmptyState message="Sin recepciones en el historial." icon="📥" />;
  const total = filas.reduce((a, r) => a + r.peso_kg, 0);
  return (
    <div className="table-wrap">
      <table className="table" style={{ fontSize: '.86rem' }}>
        <thead>
          <tr>
            <th style={{ width: 60 }}>Item</th>
            <th>Fecha y hora</th>
            <th style={{ textAlign: 'right' }}>Peso (Kg)</th>
            <th>Procedencia</th>
            <th>Centro</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((r) => (
            <tr key={`${r.origen ?? 'mgg'}-${r.id}`}>
              <td className="mono">{r.item}</td>
              <td className="muted" style={{ fontSize: '.84rem' }}>{r.fecha ? dateTime(r.fecha) : '—'}</td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{n2(r.peso_kg)}</td>
              <td><strong>{r.procedencia || '—'}</strong></td>
              <td>{r.centro}{r.origen ? <span className="badge" style={{ marginLeft: '.4rem' }}>{r.origen}</span> : null}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} style={{ fontWeight: 800 }}>Total histórico · {filas.length} recepcion{filas.length === 1 ? '' : 'es'}</td>
            <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{n2(total)} Kg</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * RECEPCIÓN GENERAL (solo lectura): resumen por centro de TODAS las recepciones
 * locales (MGG) + las del otro sistema puente (Golden Touch), traídas vía Edge Function,
 * más el HISTÓRICO consolidado de cada recepción. No se edita nada acá; los datos se
 * cargan en cada centro (o en el sistema externo).
 */
export function ResumenGeneral({ grupo, onBack }: { grupo: RecepcionGrupo; onBack: () => void }) {
  const [local, setLocal] = useState<ResumenCentro[]>([]);
  const [localRecs, setLocalRecs] = useState<RecepcionFila[]>([]);
  const [loading, setLoading] = useState(true);
  const [externo, setExterno] = useState<ResumenExterno | null>(null);
  const [extLoading, setExtLoading] = useState(true);
  const [extError, setExtError] = useState<string | null>(null);

  const cargarLocal = useCallback(async () => { const d = await resumenGeneralLocal(); setLocal(d.centros); setLocalRecs(d.recepciones); }, []);
  const cargarExterno = useCallback(async () => {
    setExtLoading(true); setExtError(null);
    try { setExterno(await fetchRecepcionesExternas('golden-touch')); }
    catch (e) { setExterno(null); setExtError(e instanceof Error ? e.message : 'No disponible'); }
    finally { setExtLoading(false); }
  }, []);

  useEffect(() => {
    let c = false; setLoading(true);
    cargarLocal().catch((e) => { if (!c) toast(e instanceof Error ? e.message : 'Error al cargar', 'error'); })
      .finally(() => { if (!c) setLoading(false); });
    return () => { c = true; };
  }, [cargarLocal]);
  useEffect(() => { void cargarExterno(); }, [cargarExterno]);
  useRealtime(['recepciones', 'recepcion_pesajes', 'recepcion_grupos'], cargarLocal);

  const tLocal = sumar(local);
  const tExterno = externo ? sumar(externo.grupos) : null;
  const totalGeneralKg = tLocal.totalKg + (tExterno?.totalKg ?? 0);
  const totalGeneralSeco = tLocal.netoSeco + (tExterno?.netoSeco ?? 0);

  // Histórico consolidado: recepciones locales (MGG) + externas, ordenadas por fecha desc.
  const historial: Array<RecepcionFila & { origen?: string }> = [
    ...localRecs.map((r) => ({ ...r })),
    ...(externo?.recepciones ?? []).map((r) => ({ ...r, origen: externo?.label ?? 'Externo' })),
  ].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

  // Datos combinados (MGG + externo) para el reporte imprimible por centro.
  const centrosTotales = [...local, ...(externo?.grupos ?? [])];
  const recepcionesTotales = [...localRecs, ...(externo?.recepciones ?? [])];
  const centrosConRecep = centrosTotales.filter((c) => c.nRecepciones > 0).length;

  async function verReporte() {
    try {
      const { descargarReportePesoCentrosPdf } = await import('./reportePesoCentrosPdf');
      await descargarReportePesoCentrosPdf({ centros: centrosTotales, recepciones: recepcionesTotales });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el reporte', 'error'); }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="btn btn-sm btn-ghost" onClick={onBack} style={{ marginBottom: '.4rem' }}>← Volver a recepciones</button>
          <h1 style={{ margin: 0 }}>📥 {grupo.nombre}</h1>
          <p className="hint muted" style={{ margin: 0 }}>
            Resumen de <strong>solo lectura</strong> de <strong>todas las recepciones</strong>: todos los centros de MGG
            y —vía puente— los del otro sistema. Los datos se cargan en cada centro; acá <strong>no se edita nada</strong>.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => void verReporte()} title="Vista previa antes de imprimir (sin logo)">🖨 Reporte de peso · Vista previa</button>
      </div>

      {/* ───────── Total general combinado (MGG + externo) ───────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        <div className="card" style={{ margin: 0 }}>
          <div className="muted" style={{ fontSize: '.78rem' }}>Total recibido (MGG + externo)</div>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800 }}>{n2(totalGeneralKg)} <span style={{ fontSize: '.9rem', fontWeight: 600 }}>Kg</span></div>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <div className="muted" style={{ fontSize: '.78rem' }}>Neto seco total (MGG + externo)</div>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800 }}>{n2(totalGeneralSeco)} <span style={{ fontSize: '.9rem', fontWeight: 600 }}>Kg</span></div>
        </div>
        <div className="card" style={{ margin: 0 }}>
          <div className="muted" style={{ fontSize: '.78rem' }}>Centros con recepciones</div>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800 }}>{centrosConRecep}</div>
        </div>
      </div>

      {/* ───────── MGG (todos los centros) ───────── */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="card-title">🏭 Recepciones MGG · todos los centros</div>
        {loading ? <p className="hint muted">Cargando…</p> : <TablaResumen rows={local} etiquetaTotal="Total MGG" />}
      </div>

      {/* ───────── Sistema externo (puente · solo lectura) ───────── */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <span>🌐 {externo?.label ?? 'Golden Touch'} · sistema externo <span className="badge" style={{ marginLeft: '.35rem' }}>Solo lectura</span></span>
          <button className="btn btn-sm btn-ghost" onClick={() => void cargarExterno()} disabled={extLoading}>{extLoading ? 'Trayendo…' : '↻ Actualizar'}</button>
        </div>
        {extLoading ? (
          <p className="hint muted">Trayendo datos del sistema externo…</p>
        ) : extError ? (
          <div className="card" style={{ borderColor: 'var(--warning, #d19a00)', margin: 0 }}>
            <strong>⚠ Sistema externo no disponible.</strong>
            <div className="muted" style={{ fontSize: '.82rem', marginTop: '.25rem' }}>{extError}</div>
            <div className="muted" style={{ fontSize: '.78rem', marginTop: '.35rem' }}>
              Verificá que la Edge Function <code>recepciones-externas</code> esté desplegada y que estén los secretos <code>GT_URL</code> / <code>GT_SERVICE_KEY</code>.
            </div>
          </div>
        ) : (
          <>
            <TablaResumen rows={externo?.grupos ?? []} etiquetaTotal={`Total ${externo?.label ?? 'externo'}`} />
            {externo && (
              <div className="muted" style={{ fontSize: '.72rem', marginTop: '.4rem' }}>
                Datos traídos del sistema externo en vivo (solo lectura). No se pueden editar desde acá.
              </div>
            )}
          </>
        )}
      </div>

      {/* ───────── Histórico consolidado de TODAS las recepciones (MGG + externo) ───────── */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="card-title">📜 Historial de recepciones · todo <span className="badge" style={{ marginLeft: '.35rem' }}>Solo lectura</span></div>
        {loading ? <p className="hint muted">Cargando…</p> : <HistorialTable filas={historial} />}
      </div>
    </div>
  );
}
