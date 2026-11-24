/* ============================================================
   Golden Touch · Retenciones · Pestaña de Auditoría (lector del log)

   Lee el log append-only `retencion_historial` (la ÚNICA fuente) y muestra
   CADA acción registrada: quién, qué, cuándo, antes/después, motivo. No
   reconstruye el estado actual; es un lector de la traza.

   Filtrable por tipo de objeto (retenciones, impuestos, parámetros, régimen,
   buzón, empresas…), por acción (alta/cambio/baja), por fecha y por texto.
   Detrás del detector: sin el log en la base, solo lo informa. Degradación:
   muestra lo que haya aunque el log aún sea parcial.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { norm } from '@/shared/lib/texto';
import { rotuloAutor } from './rotulos';
import {
  historialDisponible, listHistorial, resumenHistorial, diffHistorial, celdaCsvSegura, LABEL_CATEGORIA,
  type FilaHistorial, type AccionHistorial, type CategoriaHistorial, type ResumenHistorial,
} from './historialRetenciones.repository';

function formatFechaHoraVE(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso ?? '—';
  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: true, timeZone: 'America/Caracas',
  }).format(d);
}

function tiempoRelativo(iso: string): string {
  if (!iso) return '';
  const diffHoras = Math.round((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60));
  if (Number.isNaN(diffHoras)) return '';
  if (diffHoras < 1) return 'Hace momentos';
  if (diffHoras < 24) return `Hace ${diffHoras} h`;
  const diffDias = Math.round(diffHoras / 24);
  if (diffDias === 1) return 'Ayer';
  if (diffDias <= 7) return `Hace ${diffDias} días`;
  return '';
}

const ACCIONES: { key: AccionHistorial | ''; label: string }[] = [
  { key: '', label: 'Toda acción' },
  { key: 'alta', label: 'Altas' },
  { key: 'cambio', label: 'Cambios' },
  { key: 'baja', label: 'Bajas' },
];

const ESTILO_ACCION: Record<AccionHistorial, { bg: string; color: string; icono: string; label: string }> = {
  alta: { bg: 'rgba(34, 197, 94, 0.15)', color: 'var(--success, #22c55e)', icono: '➕', label: 'ALTA' },
  cambio: { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', icono: '✏️', label: 'CAMBIO' },
  baja: { bg: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger, #ef4444)', icono: '🗑', label: 'BAJA' },
};

/** Un valor del jsonb, legible en una celda/línea. */
function valorLegible(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function AuditoriaRetenciones() {
  const [disponible, setDisponible] = useState<boolean | null>(null);
  const [filas, setFilas] = useState<FilaHistorial[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaHistorial | ''>('');
  const [filtroAccion, setFiltroAccion] = useState<AccionHistorial | ''>('');
  const [filtroDesde, setFiltroDesde] = useState('');
  const [filtroHasta, setFiltroHasta] = useState('');
  const [filtroTexto, setFiltroTexto] = useState('');

  const [pag, setPag] = useState(1);
  const TAM_PAG = 25;
  const [sel, setSel] = useState<FilaHistorial | null>(null);

  const cargar = useCallback(async () => {
    try {
      setCargando(true);
      const hay = await historialDisponible().catch(() => false);
      setDisponible(hay);
      if (!hay) { setFilas([]); setError(null); return; }
      const data = await listHistorial({ desde: filtroDesde || undefined, hasta: filtroHasta || undefined });
      setFilas(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el log de auditoría.');
    } finally {
      setCargando(false);
    }
  }, [filtroDesde, filtroHasta]);

  useEffect(() => { void cargar(); }, [cargar]);

  // El log se alimenta por disparadores de la base: realtime refleja lo nuevo al instante.
  useRealtime(['retencion_historial'], () => { void cargar(); }, { enabled: disponible === true });

  // Las categorías presentes en lo leído (para ofrecer solo filtros con datos).
  const categoriasPresentes = useMemo(() => {
    const vistas = new Map<CategoriaHistorial, number>();
    for (const f of filas ?? []) vistas.set(f.categoria, (vistas.get(f.categoria) ?? 0) + 1);
    return Array.from(vistas.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [filas]);

  const filtrados = useMemo(() => {
    if (!filas) return [];
    const txt = norm(filtroTexto);
    return filas.filter((f) => {
      if (filtroCategoria && f.categoria !== filtroCategoria) return false;
      if (filtroAccion && f.accion !== filtroAccion) return false;
      if (txt) {
        const bolsa = norm(`${f.tabla} ${f.clave ?? ''} ${f.actor ?? ''} ${f.motivo ?? ''} ${f.categoriaLabel} `
          + `${JSON.stringify(f.antes ?? {})} ${JSON.stringify(f.despues ?? {})}`);
        if (!bolsa.includes(txt)) return false;
      }
      return true;
    });
  }, [filas, filtroCategoria, filtroAccion, filtroTexto]);

  const resumen: ResumenHistorial = useMemo(() => resumenHistorial(filtrados), [filtrados]);

  useEffect(() => { setPag(1); }, [filtroCategoria, filtroAccion, filtroDesde, filtroHasta, filtroTexto]);

  const totalPags = Math.ceil(filtrados.length / TAM_PAG) || 1;
  const paginaActual = useMemo(() => filtrados.slice((pag - 1) * TAM_PAG, (pag - 1) * TAM_PAG + TAM_PAG), [filtrados, pag]);

  const hayFiltros = Boolean(filtroCategoria || filtroAccion || filtroDesde || filtroHasta || filtroTexto);

  function exportarCsv() {
    if (!filtrados.length) return;
    const cabecera = ['Fecha y Hora', 'Tipo de objeto', 'Tabla', 'Clave', 'Acción', 'Responsable', 'Motivo'];
    // Todo texto libre pasa por celdaCsvSegura (comillas + guarda anti fórmula de Excel).
    const lineas = filtrados.map((f) => [
      celdaCsvSegura(formatFechaHoraVE(f.at)), celdaCsvSegura(f.categoriaLabel), celdaCsvSegura(f.tabla), celdaCsvSegura(f.clave ?? ''),
      celdaCsvSegura(ESTILO_ACCION[f.accion].label), celdaCsvSegura(rotuloAutor(f.actor)), celdaCsvSegura(f.motivo ?? ''),
    ]);
    const csv = '﻿' + [cabecera.join(','), ...lineas.map((l) => l.join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `auditoria-retenciones-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast('Traza de auditoría exportada en CSV', 'success');
  }

  return (
    <div style={{ paddingBottom: '2rem' }}>
      {/* ── Encabezado ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '.8rem', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <span>🛡️</span> Auditoría de Retenciones
          </h3>
          <p className="muted" style={{ margin: '.25rem 0 0', fontSize: '.84rem' }}>
            Traza de cada acción registrada en el módulo: quién, qué, cuándo, antes/después y motivo. Fuente única: el registro histórico.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()} disabled={cargando}>
            {cargando ? 'Actualizando…' : '🔄 Actualizar'}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={exportarCsv} disabled={!filtrados.length}>
            ↓ Exportar CSV
          </button>
        </div>
      </div>

      {/* El log todavía no está en la base: solo se informa, no se consulta. */}
      {disponible === false && (
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>🛡️</div>
          <strong>El registro histórico todavía no está en la base.</strong>
          <p className="muted" style={{ fontSize: '.84rem', margin: '.3rem 0 0' }}>
            Cuando esté disponible, aquí se verá la traza de cada acción del módulo.
          </p>
        </div>
      )}

      {disponible && (
        <>
          {/* ── Tarjetas resumen ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.6rem', marginBottom: '1rem' }}>
            <Kpi titulo="Total acciones" valor={resumen.total} color="var(--primary, #3b82f6)" nota="Traza registrada" />
            <Kpi titulo="Altas" valor={resumen.altas} color="var(--success, #22c55e)" nota="Registros creados" />
            <Kpi titulo="Cambios" valor={resumen.cambios} color="#3b82f6" nota="Registros modificados" />
            <Kpi titulo="Bajas" valor={resumen.bajas} color="var(--danger, #ef4444)" nota="Registros eliminados" />
          </div>

          {/* ── Filtros ── */}
          <div className="card" style={{ padding: '.75rem', marginBottom: '1rem', background: 'var(--bg-2, rgba(255,255,255,0.03))' }}>
            <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.5rem' }}>
              <button type="button" className={`btn btn-sm ${filtroCategoria === '' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: '.78rem', padding: '3px 8px' }} onClick={() => setFiltroCategoria('')}>
                Todos los objetos
              </button>
              {categoriasPresentes.map((c) => (
                <button key={c} type="button" className={`btn btn-sm ${filtroCategoria === c ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontSize: '.78rem', padding: '3px 8px' }} onClick={() => setFiltroCategoria(c)}>
                  {LABEL_CATEGORIA[c]}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div role="group" aria-label="Filtro por acción" style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
                {ACCIONES.map((a) => (
                  <button key={a.key || 'todas'} type="button" className={`btn btn-sm ${filtroAccion === a.key ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontSize: '.78rem', padding: '3px 8px' }} onClick={() => setFiltroAccion(a.key)}>
                    {a.label}
                  </button>
                ))}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                  <input type="date" className="input" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)}
                    style={{ fontSize: '.78rem', padding: '2px 6px', maxWidth: 130 }} aria-label="Fecha desde" title="Fecha desde" />
                  <span className="muted" style={{ fontSize: '.75rem' }}>–</span>
                  <input type="date" className="input" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)}
                    style={{ fontSize: '.78rem', padding: '2px 6px', maxWidth: 130 }} aria-label="Fecha hasta" title="Fecha hasta" />
                </div>
                <input type="search" className="input" placeholder="Buscar en tabla, clave, usuario, motivo, datos…"
                  value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)}
                  style={{ fontSize: '.8rem', padding: '3px 8px', minWidth: 220 }} />
                {hayFiltros && (
                  <button type="button" className="btn btn-sm btn-ghost" style={{ fontSize: '.76rem', color: 'var(--text-muted)' }}
                    onClick={() => { setFiltroCategoria(''); setFiltroAccion(''); setFiltroDesde(''); setFiltroHasta(''); setFiltroTexto(''); }}>
                    Limpiar
                  </button>
                )}
              </div>
            </div>
          </div>

          {error && (
            <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
              <strong>Error de carga:</strong> {error}
            </div>
          )}
          {cargando && !filas && (
            <p className="muted" style={{ textAlign: 'center', padding: '2rem' }}>Consultando el registro histórico…</p>
          )}
          {!cargando && filtrados.length === 0 && !error && (
            <div className="card" style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>🛡️</div>
              <strong>{hayFiltros ? 'No hay acciones que coincidan con los filtros' : 'Todavía no hay acciones registradas'}</strong>
              <p className="muted" style={{ fontSize: '.84rem', margin: '.3rem 0 0' }}>
                {hayFiltros ? 'Prueba ajustando el rango de fechas o los términos de búsqueda.' : 'A medida que se registren acciones del módulo, aparecerán aquí.'}
              </p>
            </div>
          )}

          {filtrados.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', fontSize: '.82rem', margin: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 140 }}>Fecha / Hora</th>
                      <th style={{ minWidth: 150 }}>Objeto</th>
                      <th style={{ minWidth: 100 }}>Acción</th>
                      <th style={{ minWidth: 160 }}>Responsable</th>
                      <th style={{ minWidth: 220 }}>Motivo / Cambio</th>
                      <th style={{ width: 60, textAlign: 'center' }} aria-label="Detalle" />
                    </tr>
                  </thead>
                  <tbody>
                    {paginaActual.map((f) => {
                      const rel = tiempoRelativo(f.at);
                      const cambios = f.accion === 'cambio' ? diffHistorial(f.antes, f.despues) : [];
                      return (
                        <tr key={f.id} style={{ background: f.accion === 'baja' ? 'rgba(239, 68, 68, 0.04)' : undefined }}>
                          <td>
                            <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatFechaHoraVE(f.at)}</div>
                            {rel && <span className="muted" style={{ fontSize: '.7rem' }}>{rel}</span>}
                          </td>
                          <td>
                            <span style={{ fontWeight: 600, display: 'block' }}>{f.categoriaLabel}</span>
                            <span className="muted mono" style={{ fontSize: '.72rem' }}>{f.tabla}{f.clave ? ` · ${f.clave}` : ''}</span>
                          </td>
                          <td><BadgeAccion accion={f.accion} /></td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                              <span>👤</span><span style={{ fontWeight: 500 }}>{rotuloAutor(f.actor)}</span>
                            </div>
                          </td>
                          <td>
                            {f.motivo ? (
                              <span style={{ fontSize: '.78rem' }}>{f.motivo}</span>
                            ) : cambios.length ? (
                              <span className="muted" style={{ fontSize: '.76rem' }}>
                                {cambios.slice(0, 3).map((c) => c.campo).join(', ')}{cambios.length > 3 ? `, +${cambios.length - 3}` : ''}
                              </span>
                            ) : (
                              <span className="muted" style={{ fontSize: '.74rem' }}>—</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button type="button" className="btn btn-sm btn-ghost" title="Ver el detalle de la acción"
                              onClick={() => setSel(f)} style={{ padding: '2px 6px', fontSize: '.75rem' }}>
                              👁️
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.6rem .9rem', borderTop: '1px solid var(--border)', fontSize: '.8rem', background: 'var(--bg-2, rgba(255,255,255,0.02))' }}>
                <span className="muted">Mostrando {paginaActual.length} de {filtrados.length} acción{filtrados.length === 1 ? '' : 'es'}</span>
                <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPag((p) => Math.max(1, p - 1))} disabled={pag <= 1}>‹ Anterior</button>
                  <strong style={{ minWidth: 60, textAlign: 'center' }}>Página {pag} / {totalPags}</strong>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPag((p) => Math.min(totalPags, p + 1))} disabled={pag >= totalPags}>Siguiente ›</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Detalle de la acción ── */}
      {sel && (
        <Modal
          title={`Acción · ${sel.categoriaLabel}`}
          size="md"
          onClose={() => setSel(null)}
          footer={<button type="button" className="btn btn-primary" onClick={() => setSel(null)}>Cerrar</button>}
        >
          <div style={{ fontSize: '.86rem', display: 'flex', flexDirection: 'column', gap: '.8rem' }}>
            <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center' }}>
              <BadgeAccion accion={sel.accion} grande />
              <div className="muted" style={{ fontSize: '.8rem' }}>{formatFechaHoraVE(sel.at)}</div>
            </div>
            <div className="card" style={{ margin: 0, background: 'var(--bg-2)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.4rem .8rem', fontSize: '.82rem' }}>
                <div><span className="muted">Tipo de objeto:</span> <strong>{sel.categoriaLabel}</strong></div>
                <div><span className="muted">Responsable:</span> <strong>{rotuloAutor(sel.actor)}</strong></div>
                <div><span className="muted">Tabla:</span> <strong className="mono">{sel.tabla}</strong></div>
                <div><span className="muted">Clave:</span> <strong className="mono">{sel.clave ?? '—'}</strong></div>
              </div>
              {sel.motivo && (
                <p style={{ margin: '.5rem 0 0', fontSize: '.82rem' }}>
                  <span className="muted">Motivo:</span> {sel.motivo}
                </p>
              )}
            </div>

            {/* Antes → Después: solo los campos que cambiaron (en un cambio) o el estado (alta/baja). */}
            <DetalleCambios fila={sel} />

            <div className="muted" style={{ fontSize: '.72rem', textAlign: 'right' }}>
              Identificador de traza: <code className="mono">{sel.id}</code>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Kpi({ titulo, valor, color, nota }: { titulo: string; valor: number; color: string; nota: string }) {
  return (
    <div className="card" style={{ padding: '.65rem .85rem', margin: 0, borderLeft: `4px solid ${color}` }}>
      <div className="muted" style={{ fontSize: '.75rem', fontWeight: 600, textTransform: 'uppercase' }}>{titulo}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: 2, color }}>{valor}</div>
      <div className="muted" style={{ fontSize: '.72rem' }}>{nota}</div>
    </div>
  );
}

function BadgeAccion({ accion, grande }: { accion: AccionHistorial; grande?: boolean }) {
  const e = ESTILO_ACCION[accion];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', padding: grande ? '3px 8px' : '1px 6px', borderRadius: 4, fontSize: grande ? '.78rem' : '.72rem', fontWeight: 700, background: e.bg, color: e.color, whiteSpace: 'nowrap' }}>
      <span>{e.icono}</span><span>{e.label}</span>
    </span>
  );
}

function DetalleCambios({ fila }: { fila: FilaHistorial }) {
  // En un cambio: los campos que se movieron. En alta/baja: el estado completo (después/antes).
  if (fila.accion === 'cambio') {
    const cambios = diffHistorial(fila.antes, fila.despues);
    if (!cambios.length) return <p className="muted" style={{ fontSize: '.8rem', margin: 0 }}>Sin cambios de campos en el registro.</p>;
    return (
      <div className="card" style={{ margin: 0, padding: 0, overflow: 'hidden' }}>
        <table className="table" style={{ width: '100%', fontSize: '.8rem', margin: 0 }}>
          <thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead>
          <tbody>
            {cambios.map((c) => (
              <tr key={c.campo}>
                <td className="mono" style={{ fontSize: '.74rem' }}>{c.campo}</td>
                <td style={{ color: 'var(--danger)' }}>{valorLegible(c.antes)}</td>
                <td style={{ color: 'var(--success)' }}>{valorLegible(c.despues)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const estado = fila.accion === 'baja' ? fila.antes : fila.despues;
  const etiqueta = fila.accion === 'baja' ? 'Registro eliminado (estado previo)' : 'Registro creado (estado)';
  const campos = estado ? Object.entries(estado) : [];
  return (
    <div className="card" style={{ margin: 0 }}>
      <strong style={{ display: 'block', fontSize: '.82rem', marginBottom: '.3rem' }}>{etiqueta}</strong>
      {campos.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.3rem .8rem', fontSize: '.8rem' }}>
          {campos.map(([k, v]) => (
            <div key={k}><span className="muted mono" style={{ fontSize: '.72rem' }}>{k}:</span> {valorLegible(v)}</div>
          ))}
        </div>
      ) : <p className="muted" style={{ margin: 0, fontSize: '.8rem' }}>Sin datos en el registro.</p>}
    </div>
  );
}
