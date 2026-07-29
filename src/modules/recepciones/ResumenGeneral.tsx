import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { dateTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import {
  resumenGeneralLocal, fetchRecepcionesExternas, getAliasExternos, setAliasExterno,
  guardarResumenSnapshot, listResumenSnapshots, eliminarResumenSnapshot,
  type RecepcionGrupo, type ResumenCentro, type RecepcionFila, type ResumenExterno,
  type ResumenSnapshot, type ResumenSnapshotDatos,
} from './recepciones.repository';

const SISTEMA_EXTERNO = 'golden-touch';

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

/** Tabla de resumen por centro (solo lectura). Si `onRename` viene (y `aliasMap`),
 *  cada centro muestra un ✎ para renombrarlo localmente (solo el sistema externo). */
function TablaResumen({ rows, etiquetaTotal, aliasMap, onRename }: {
  rows: ResumenCentro[]; etiquetaTotal: string;
  aliasMap?: Record<string, string>; onRename?: (original: string, actual: string) => void;
}) {
  if (!rows.length) return <EmptyState message="Sin recepciones registradas." icon="📥" />;
  const t = sumar(rows);
  const display = (nombre: string) => aliasMap?.[nombre] ?? nombre;
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
              <td>
                <strong>{display(c.nombre)}</strong>
                {onRename && (
                  <button className="btn btn-sm btn-ghost" style={{ marginLeft: '.35rem', padding: '0 .3rem' }}
                    title="Renombrar este centro (solo local)" onClick={() => onRename(c.nombre, display(c.nombre))}>✎</button>
                )}
              </td>
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
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('recepciones', 'escritura');
  const actor = user?.email ?? 'sistema';
  const miNombre = appUser?.nombre?.trim() || user?.email || '';

  const [local, setLocal] = useState<ResumenCentro[]>([]);
  const [localRecs, setLocalRecs] = useState<RecepcionFila[]>([]);
  const [loading, setLoading] = useState(true);
  const [externo, setExterno] = useState<ResumenExterno | null>(null);
  const [extLoading, setExtLoading] = useState(true);
  const [extError, setExtError] = useState<string | null>(null);
  // Alias LOCALES del sistema externo: { nombre_original → alias }.
  const [aliasExt, setAliasExt] = useState<Record<string, string>>({});
  // Rename en curso de un centro externo: { original, valor }.
  const [renExt, setRenExt] = useState<{ original: string; valor: string } | null>(null);
  // Histórico de "Guardar recepción" (snapshots del resumen por centro).
  const [snapshots, setSnapshots] = useState<ResumenSnapshot[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [verSnap, setVerSnap] = useState<ResumenSnapshot | null>(null);

  const cargarLocal = useCallback(async () => { const d = await resumenGeneralLocal(); setLocal(d.centros); setLocalRecs(d.recepciones); }, []);
  const cargarSnapshots = useCallback(async () => { try { setSnapshots(await listResumenSnapshots()); } catch { /* no bloquea el resumen */ } }, []);
  const cargarExterno = useCallback(async () => {
    setExtLoading(true); setExtError(null);
    try { setExterno(await fetchRecepcionesExternas(SISTEMA_EXTERNO)); }
    catch (e) { setExterno(null); setExtError(e instanceof Error ? e.message : 'No disponible'); }
    finally { setExtLoading(false); }
  }, []);
  const cargarAlias = useCallback(async () => {
    try { setAliasExt(await getAliasExternos(SISTEMA_EXTERNO)); } catch { /* si falla, se muestran los nombres originales */ }
  }, []);

  useEffect(() => {
    let c = false; setLoading(true);
    cargarLocal().catch((e) => { if (!c) toast(e instanceof Error ? e.message : 'Error al cargar', 'error'); })
      .finally(() => { if (!c) setLoading(false); });
    return () => { c = true; };
  }, [cargarLocal]);
  useEffect(() => { void cargarExterno(); }, [cargarExterno]);
  useEffect(() => { void cargarAlias(); }, [cargarAlias]);
  useEffect(() => { void cargarSnapshots(); }, [cargarSnapshots]);
  useRealtime(['recepciones', 'recepcion_pesajes', 'recepcion_grupos'], cargarLocal);
  useRealtime(['recepciones_centro_alias'], cargarAlias);
  useRealtime(['recepcion_resumen_snapshots'], cargarSnapshots);

  const alias = (nombre: string) => aliasExt[nombre] ?? nombre;

  async function guardarAliasExt() {
    if (!renExt) return;
    try {
      await setAliasExterno(SISTEMA_EXTERNO, renExt.original, renExt.valor, actor, miNombre);
      setRenExt(null); await cargarAlias();
      toast('Nombre del centro actualizado', 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo renombrar', 'error'); }
  }

  const tLocal = sumar(local);
  const tExterno = externo ? sumar(externo.grupos) : null;
  const totalGeneralKg = tLocal.totalKg + (tExterno?.totalKg ?? 0);
  const totalGeneralSeco = tLocal.netoSeco + (tExterno?.netoSeco ?? 0);

  // Histórico consolidado: recepciones locales (MGG) + externas (con alias aplicado), por fecha desc.
  const historial: Array<RecepcionFila & { origen?: string }> = [
    ...localRecs.map((r) => ({ ...r })),
    ...(externo?.recepciones ?? []).map((r) => ({ ...r, centro: alias(r.centro), origen: externo?.label ?? 'Externo' })),
  ].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

  // Datos combinados (MGG + externo con alias) para el reporte imprimible por centro.
  const externoGruposAlias = (externo?.grupos ?? []).map((g) => ({ ...g, nombre: alias(g.nombre) }));
  const externoRecsAlias = (externo?.recepciones ?? []).map((r) => ({ ...r, centro: alias(r.centro) }));
  const centrosTotales = [...local, ...externoGruposAlias];
  const recepcionesTotales = [...localRecs, ...externoRecsAlias];
  const centrosConRecep = centrosTotales.filter((c) => c.nRecepciones > 0).length;

  async function verReporte() {
    try {
      const { descargarReportePesoCentrosPdf } = await import('./reportePesoCentrosPdf');
      await descargarReportePesoCentrosPdf({ centros: centrosTotales, recepciones: recepcionesTotales });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el reporte', 'error'); }
  }

  /** Congela el resumen por centro de TODAS las recepciones (MGG + externo) en el histórico. */
  async function guardarRecepcion() {
    if (guardando) return;
    setGuardando(true);
    try {
      const datos: ResumenSnapshotDatos = {
        local, externoLabel: externo?.label ?? null, externoGrupos: externoGruposAlias,
        externoAt: externo?.at ?? null, recepciones: historial,
      };
      const snap = await guardarResumenSnapshot(datos, null, actor, miNombre);
      await cargarSnapshots();
      toast(`Recepción guardada · N° ${snap.numero}`, 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar la recepción', 'error'); }
    finally { setGuardando(false); }
  }

  /** Descarga el PDF (vista previa) de un snapshot ya guardado, con sus datos congelados. */
  async function descargarSnap(s: ResumenSnapshot) {
    try {
      const centros = [...(s.datos.local ?? []), ...(s.datos.externoGrupos ?? [])];
      const { descargarReportePesoCentrosPdf } = await import('./reportePesoCentrosPdf');
      await descargarReportePesoCentrosPdf({ centros, recepciones: s.datos.recepciones ?? [], referencia: `GUARDADA N° ${s.numero}`, fecha: s.fecha });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  async function borrarSnap(s: ResumenSnapshot) {
    if (!window.confirm(`¿Eliminar la recepción guardada N° ${s.numero}? Esta acción no se puede deshacer.`)) return;
    try { await eliminarResumenSnapshot(s.id); await cargarSnapshots(); toast('Recepción guardada eliminada', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  // #3 · El otro sistema ya cerró/limpió su recepción → el externo (en vivo) llega vacío.
  // Para NO perderla de vista, mostramos la ÚLTIMA recepción guardada que tenga datos del
  // externo (copia congelada), con aviso de que es un respaldo.
  const ultimoSnapConExterno = snapshots.find((s) => (s.datos?.externoGrupos ?? []).length > 0) ?? null;
  const externoEnVivoVacio = !extLoading && !extError && (externo?.grupos?.length ?? 0) === 0;
  const externoRespaldo = externoEnVivoVacio ? ultimoSnapConExterno : null;

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
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          {canWrite && (
            <button className="btn btn-primary" onClick={() => void guardarRecepcion()} disabled={guardando}
              title="Congela el resumen por centro de TODAS las recepciones (MGG + externo) en el histórico de abajo">
              {guardando ? 'Guardando…' : '💾 Guardar recepción'}
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => void verReporte()} title="Vista previa antes de imprimir (sin logo)">🖨 Reporte de peso · Vista previa</button>
        </div>
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
        ) : externoRespaldo ? (
          <>
            <div className="card" style={{ borderColor: 'var(--brand, #ff8a00)', margin: 0, marginBottom: '.6rem' }}>
              <strong>ℹ El sistema externo ya no reporta recepciones</strong> <span className="muted">(las cerró o limpió en su sistema).</span>
              <div className="muted" style={{ fontSize: '.82rem', marginTop: '.25rem' }}>
                Mostrando la <strong>última recepción guardada</strong> con datos del externo:
                N° {externoRespaldo.numero} · {externoRespaldo.fecha ? dateTime(externoRespaldo.fecha) : '—'} <span className="badge" style={{ marginLeft: '.35rem' }}>Copia guardada</span>
              </div>
            </div>
            <TablaResumen rows={externoRespaldo.datos.externoGrupos ?? []} etiquetaTotal={`Total ${externoRespaldo.datos.externoLabel ?? 'externo'} (guardado)`} />
          </>
        ) : (
          <>
            <TablaResumen rows={externo?.grupos ?? []} etiquetaTotal={`Total ${externo?.label ?? 'externo'}`}
              aliasMap={aliasExt} onRename={canWrite ? (original, actualVal) => setRenExt({ original, valor: actualVal }) : undefined} />
            {externo && (
              <div className="muted" style={{ fontSize: '.72rem', marginTop: '.4rem' }}>
                Datos traídos del sistema externo en vivo (solo lectura){canWrite ? '; solo podés renombrar el centro localmente con ✎ (no cambia el sistema de origen).' : '. No se pueden editar desde acá.'}
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

      {/* ───────── Recepciones GUARDADAS (snapshots del resumen por centro) ───────── */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
          <span>💾 Recepciones guardadas <span className="badge" style={{ marginLeft: '.35rem' }}>{snapshots.length}</span></span>
          <span className="muted" style={{ fontSize: '.72rem', fontWeight: 400 }}>Cada «Guardar recepción» congela el resumen de arriba; queda aunque el sistema externo lo cierre.</span>
        </div>
        {snapshots.length === 0 ? (
          <EmptyState message="Aún no guardaste ninguna recepción. Usá 💾 Guardar recepción arriba." icon="💾" />
        ) : (
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.86rem' }}>
              <thead>
                <tr>
                  <th style={{ width: 50 }}>N°</th>
                  <th>Guardado</th>
                  <th style={{ textAlign: 'right' }}>Total (Kg)</th>
                  <th style={{ textAlign: 'right' }}>Neto seco</th>
                  <th style={{ textAlign: 'right' }}>Centros</th>
                  <th style={{ textAlign: 'right' }}>Recep.</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s) => (
                  <tr key={s.id}>
                    <td className="mono" style={{ fontWeight: 700 }}>{s.numero}</td>
                    <td className="muted" style={{ fontSize: '.84rem' }}>
                      {s.fecha ? dateTime(s.fecha) : '—'}
                      {s.actor_name ? <div style={{ fontSize: '.74rem' }}>{s.actor_name}</div> : null}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{n2(s.total_kg)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{n2(s.total_seco)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{s.n_centros ?? '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{s.n_recepciones ?? '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => setVerSnap(s)} title="Ver el detalle guardado">👁 Ver</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => void descargarSnap(s)} title="Descargar PDF (vista previa)">🖨</button>
                      {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => void borrarSnap(s)} title="Eliminar recepción guardada">🗑</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {verSnap && (
        <Modal title={`Recepción guardada · N° ${verSnap.numero}`} size="lg" onClose={() => setVerSnap(null)} footer={
          <>
            <button className="btn btn-ghost" onClick={() => void descargarSnap(verSnap)}>🖨 Descargar PDF</button>
            <button className="btn btn-primary" onClick={() => setVerSnap(null)}>Cerrar</button>
          </>
        }>
          <p className="muted" style={{ marginTop: 0, fontSize: '.82rem' }}>
            Guardado el {verSnap.fecha ? dateTime(verSnap.fecha) : '—'}{verSnap.actor_name ? ` por ${verSnap.actor_name}` : ''}. Copia <strong>congelada</strong>; no se edita.
          </p>
          <div className="card-title" style={{ fontSize: '.9rem' }}>🏭 MGG · todos los centros</div>
          <TablaResumen rows={verSnap.datos.local ?? []} etiquetaTotal="Total MGG" />
          {(verSnap.datos.externoGrupos ?? []).length > 0 && (
            <>
              <div className="card-title" style={{ fontSize: '.9rem', marginTop: '1rem' }}>🌐 {verSnap.datos.externoLabel ?? 'Externo'}</div>
              <TablaResumen rows={verSnap.datos.externoGrupos ?? []} etiquetaTotal={`Total ${verSnap.datos.externoLabel ?? 'externo'}`} />
            </>
          )}
          <div className="card-title" style={{ fontSize: '.9rem', marginTop: '1rem' }}>📜 Historial congelado</div>
          <HistorialTable filas={verSnap.datos.recepciones ?? []} />
        </Modal>
      )}

      {renExt && (
        <Modal title="Renombrar centro externo" size="sm" onClose={() => setRenExt(null)} footer={
          <>
            <button className="btn btn-ghost" onClick={() => setRenExt(null)}>Cancelar</button>
            <button className="btn btn-primary" onClick={() => void guardarAliasExt()}>Guardar</button>
          </>
        }>
          <div className="form-row">
            <label>Nombre del centro <span className="muted" style={{ fontWeight: 400 }}>(original: {renExt.original})</span></label>
            <input className="input" autoFocus value={renExt.valor}
              onChange={(e) => setRenExt((s) => (s ? { ...s, valor: e.target.value } : s))}
              onKeyDown={(e) => { if (e.key === 'Enter') void guardarAliasExt(); }} />
          </div>
          <small className="muted">Solo cambia cómo se <strong>muestra</strong> acá y en el reporte; no toca el sistema de origen. Dejalo vacío para volver al nombre original.</small>
        </Modal>
      )}
    </div>
  );
}
