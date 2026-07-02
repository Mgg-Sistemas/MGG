import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { date, money, num } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { CorreoReporteModal } from '@/shared/ui/CorreoReporteModal';
import type { ContratoAcopio, CajaMovimiento, GrupoClasificacion } from '@/shared/lib/types';
// Desacoplado: el módulo de producción/contratos aún no existe en este sistema.
// Stub local que devuelve []. Reemplazar al construir contratos. (Centro de Acopio standalone)
import { listContratos } from './contratos.stub';
import { listCajaMovimientos, actualizarMovimientoCaja, eliminarMovimientoCaja, GRUPOS } from './caja.repository';
// descargarMovAcopioPdf / descargarMovAcopioExcel / enviarMovAcopioPorCorreo se importan dinámicamente (al generar) para no cargar jsPDF/xlsx al abrir.

/**
 * Lista de movimientos del Centro de Acopio (réplica del Excel «caja» de acopio).
 * Por ahora se alimenta de los CONTRATOS DE PRODUCCIÓN CERRADOS: al cerrar un
 * contrato, sus Kg de casiterita entran al inventario y se reflejan aquí como un
 * movimiento. El número de Kg que aporta el contrato se resalta con color.
 * Incluye filtros (estilo Tesorería) y reportes PDF / Excel / correo.
 */

interface FilaMov {
  id: string;
  contratoId?: string;      // ← si la fila proviene de un contrato cerrado, su id (para ir al detalle)
  fecha: string;
  descripcion: string;
  usdEntregado: number | null;
  kgCerrados: number;       // ← lo que aporta el contrato (se refleja en la caja)
  precioUsdKg: number | null;
  usdFacturados: number;
  compraMaterial: number | null;  // $ Compra de material (egreso · baja el Saldo $)
  gastosGt: number | null;
  nominasGt: number | null;
  trasladoCaja: number | null;
  saldoUsd: number;
  kgRecibidosMgg: number | null;
  saldoKgCasiterita: number; // saldo corrido
}

/** Resumen que las tarjetas de la página consumen (misma fuente que la tabla). */
export interface ResumenAcopio {
  saldoKg: number;
  tasa: number;
  usdEntregado: number;
  saldoUsd: number;
  gastos: number;
  nominas: number;
  facturado: number;
}

export function MovimientosAcopioView({ onResumen, visible = true, centro, cajaId }: { onResumen?: (r: ResumenAcopio) => void; visible?: boolean; centro?: string; cajaId?: string | null } = {}) {
  const { user } = useSession();
  const { can } = usePermissions();
  const canWrite = can('acopio', 'escritura');
  const navigate = useNavigate();
  const [contratos, setContratos] = useState<ContratoAcopio[]>([]);
  const [cajaMovs, setCajaMovs] = useState<CajaMovimiento[]>([]);
  const [movEdit, setMovEdit] = useState<CajaMovimiento | null>(null);
  const [loading, setLoading] = useState(true);
  // Filtros (estilo Tesorería).
  const [fTexto, setFTexto] = useState('');
  const [fDesde, setFDesde] = useState('');
  const [fHasta, setFHasta] = useState('');
  const [ordenDesc, setOrdenDesc] = useState(false); // false = más viejo→nuevo; true = más nuevo→viejo
  const [correoOpen, setCorreoOpen] = useState(false);

  // La vista viva del centro se acota a la CAJA ABIERTA actual (`cajaId`): los
  // cierres anteriores quedan en el historial. Si no hay caja, cae al centro.
  const recargar = useCallback(async () => {
    const [cs, cms] = await Promise.all([listContratos(), listCajaMovimientos(cajaId ?? undefined, centro)]);
    setContratos(cs);
    setCajaMovs(cms);
  }, [centro, cajaId]);
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    recargar().catch((e) => { if (!cancel) toast(e instanceof Error ? e.message : 'Error al cargar movimientos', 'error'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [recargar]);
  useRealtime(['acopio_contratos', 'acopio_caja_movimientos'], () => { void recargar(); });

  async function borrarMov(m: CajaMovimiento) {
    if (!window.confirm(`¿Borrar el movimiento del ${date(m.fecha)}${m.descripcion ? ` · ${m.descripcion}` : ''}? Esta acción no se puede deshacer.`)) return;
    try { await eliminarMovimientoCaja(m.id); toast('Movimiento borrado', 'success'); await recargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error'); }
  }

  // El movimiento del Centro de Acopio es la mezcla de DOS fuentes, ordenada por fecha:
  //   1) Contratos de producción CERRADOS → aportan Kg de casiterita.
  //   2) Movimientos de caja (acopio_caja_movimientos) → flujo en USD; aquí entra el
  //      dinero ACEPTADO desde el otro sistema (columna $Usd entregado).
  // Saldos corridos: Kg = anterior + Kg Cerrados − Kg MGG; USD = anterior + Entregado
  // − Facturados − Gastos − Nóminas − Traslado.
  const filas = useMemo<FilaMov[]>(() => {
    type Evt = { t: 'c'; c: ContratoAcopio } | { t: 'm'; m: CajaMovimiento };
    const evts: Evt[] = [
      ...contratos.filter((c) => c.estado === 'cerrado').map((c) => ({ t: 'c' as const, c })),
      ...cajaMovs.map((m) => ({ t: 'm' as const, m })),
    ];
    const fechaDe = (e: Evt) => (e.t === 'c' ? e.c.fecha : e.m.fecha) ?? '';
    const seqDe = (e: Evt) => (e.t === 'c' ? e.c.seq : 0);
    evts.sort((a, b) => fechaDe(a).localeCompare(fechaDe(b)) || (seqDe(a) - seqDe(b)));

    let saldoKg = 0;
    let saldoUsd = 0;
    return evts.map((e): FilaMov => {
      if (e.t === 'c') {
        const kg = Number(e.c.kg_seco_limpio) || 0;
        const mgg = 0; // Kg Recibidos por MGG (aún no conectado) → cuando exista se resta acá.
        saldoKg = saldoKg + kg - mgg;
        return {
          id: `c-${e.c.id}`,
          contratoId: e.c.id,
          fecha: e.c.fecha,
          descripcion: `CONTRATO PRODUCCIÓN GT - #${e.c.seq}`,
          usdEntregado: null,
          kgCerrados: kg,
          precioUsdKg: null,
          usdFacturados: 0,
          compraMaterial: null,
          gastosGt: null,
          nominasGt: null,
          trasladoCaja: null,
          saldoUsd,
          kgRecibidosMgg: mgg || null,
          saldoKgCasiterita: saldoKg,
        };
      }
      const m = e.m;
      const entregado = Number(m.usd_entregado) || 0;
      const facturados = Number(m.facturados) || 0;
      const gastos = Number(m.gastos) || 0;
      const nominas = Number(m.nominas) || 0;
      const traslado = Number(m.traslado) || 0;
      const compraMaterial = Number(m.compra_material) || 0;
      const kgc = Number(m.kg_cerrados) || 0;
      const mgg = Number(m.kg_recibidos) || 0;
      saldoUsd = saldoUsd + entregado - facturados - gastos - nominas - traslado - compraMaterial;
      saldoKg = saldoKg + kgc - mgg;
      return {
        id: `m-${m.id}`,
        fecha: m.fecha,
        descripcion: m.descripcion || 'Movimiento de caja',
        usdEntregado: entregado || null,
        kgCerrados: kgc,
        precioUsdKg: null,
        usdFacturados: facturados,
        compraMaterial: compraMaterial || null,
        gastosGt: gastos || null,
        nominasGt: nominas || null,
        trasladoCaja: traslado || null,
        saldoUsd,
        kgRecibidosMgg: mgg || null,
        saldoKgCasiterita: saldoKg,
      };
    });
  }, [contratos, cajaMovs]);

  // Vista filtrada + ordenada por fecha (mantiene el saldo corrido calculado sobre TODOS los movimientos).
  const mostradas = useMemo(() => {
    const q = fTexto.trim().toLowerCase();
    const arr = filas.filter((f) => {
      if (fDesde && (f.fecha ?? '') < fDesde) return false;
      if (fHasta && (f.fecha ?? '') > fHasta) return false;
      if (q && !`${f.fecha} ${f.descripcion}`.toLowerCase().includes(q)) return false;
      return true;
    });
    // `filas` ya viene en orden ascendente por fecha; si se pide descendente, se invierte.
    return ordenDesc ? arr.slice().reverse() : arr;
  }, [filas, fTexto, fDesde, fHasta, ordenDesc]);

  const hayFiltro = !!(fTexto || fDesde || fHasta);
  const filtroTxt = () => (hayFiltro ? 'filtrado' : undefined);

  // Totales y saldo/tasa generales (sobre TODOS los movimientos, no el filtro) para las tarjetas.
  const totalKg = filas.reduce((a, f) => a + f.kgCerrados, 0);
  const totalFacturado = filas.reduce((a, f) => a + (f.usdFacturados ?? 0), 0);
  const totalGastos = filas.reduce((a, f) => a + (f.gastosGt ?? 0), 0);
  const totalNominas = filas.reduce((a, f) => a + (f.nominasGt ?? 0), 0);
  const totalUsdEntregado = filas.reduce((a, f) => a + (f.usdEntregado ?? 0), 0);
  const saldoFinal = filas.length ? filas[filas.length - 1].saldoKgCasiterita : 0;
  // Saldo en moneda $ Usd = el saldo corrido del movimiento cronológicamente más nuevo.
  const saldoUsdFinal = filas.length ? filas[filas.length - 1].saldoUsd : 0;
  // TASA ACTUAL DEL MATERIAL = (Facturado + Gastos + Nóminas) ÷ Kg cerrados.
  const tasa = totalKg !== 0 ? (totalFacturado + totalGastos + totalNominas) / totalKg : 0;

  // Reflejamos en las tarjetas de la página el MISMO resumen que alimenta la tabla.
  useEffect(() => {
    onResumen?.({
      saldoKg: saldoFinal, tasa,
      usdEntregado: totalUsdEntregado, saldoUsd: saldoUsdFinal,
      gastos: totalGastos, nominas: totalNominas, facturado: totalFacturado,
    });
  }, [saldoFinal, tasa, totalUsdEntregado, saldoUsdFinal, totalGastos, totalNominas, totalFacturado, onResumen]);

  // Totales de la vista (para la fila de totales de la tabla, respeta el filtro).
  const totUsdEntregadoVista = mostradas.reduce((a, f) => a + (f.usdEntregado ?? 0), 0);
  const totKgVista = mostradas.reduce((a, f) => a + f.kgCerrados, 0);
  const totCompraMaterialVista = mostradas.reduce((a, f) => a + (f.compraMaterial ?? 0), 0);
  const totTrasladoVista = mostradas.reduce((a, f) => a + (f.trasladoCaja ?? 0), 0);
  // Saldo final del rango filtrado = el del movimiento cronológicamente más nuevo (no depende del orden mostrado).
  const ascFiltradas = ordenDesc ? mostradas.slice().reverse() : mostradas;
  const saldoVista = ascFiltradas.length ? ascFiltradas[ascFiltradas.length - 1].saldoKgCasiterita : 0;

  // Oculto (switch «Listar movimientos» apagado): los hooks de arriba siguen
  // corriendo y alimentando las tarjetas vía onResumen; solo no se pinta la tabla.
  if (!visible) return null;

  return (
    <div className="card" style={{ marginBottom: '1.25rem' }}>
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem' }}>
        <span>📋 Movimientos del Centro de Costo</span>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <input className="input" type="search" value={fTexto} onChange={(e) => setFTexto(e.target.value)}
              placeholder="🔍 Buscar (fecha, descripción…)" style={{ width: 240, paddingRight: fTexto ? '1.6rem' : undefined }} />
            {fTexto && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFTexto('')} title="Limpiar búsqueda"
                style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', padding: '0 .3rem', lineHeight: 1 }}>✕</button>
            )}
          </div>
          <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
            Desde <input className="input" type="date" value={fDesde} onChange={(e) => setFDesde(e.target.value)} style={{ width: 'auto' }} />
          </label>
          <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
            Hasta <input className="input" type="date" value={fHasta} onChange={(e) => setFHasta(e.target.value)} style={{ width: 'auto' }} />
          </label>
          <button className="btn btn-sm btn-ghost" onClick={() => setOrdenDesc((v) => !v)} title="Ordenar por fecha">
            Fecha {ordenDesc ? '↓ (nuevo→viejo)' : '↑ (viejo→nuevo)'}
          </button>
          {hayFiltro && <button className="btn btn-sm btn-ghost" onClick={() => { setFTexto(''); setFDesde(''); setFHasta(''); }}>✕ Limpiar</button>}
          <span className="muted" style={{ fontSize: '.8rem' }}>{mostradas.length}/{filas.length}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
        <button className="btn btn-ghost btn-sm" disabled={!mostradas.length} onClick={() => void import('./movimientosAcopioReportes').then(({ descargarMovAcopioPdf }) => descargarMovAcopioPdf(mostradas, { filtro: filtroTxt() })).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))}>↓ PDF</button>
        <button className="btn btn-ghost btn-sm" disabled={!mostradas.length} onClick={() => void import('./movimientosAcopioReportes').then(({ descargarMovAcopioExcel }) => descargarMovAcopioExcel(mostradas)).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el Excel', 'error'))}>📊 Excel</button>
        <button className="btn btn-ghost btn-sm" disabled={!mostradas.length} onClick={() => setCorreoOpen(true)}>✉ Correo</button>
      </div>

      {loading ? <EmptyState message="Cargando…" icon="◔" /> : !filas.length ? (
        <EmptyState message="Sin movimientos. Al cerrar un contrato de producción, se reflejará aquí." icon="📋" />
      ) : (
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.8rem' }}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Descripción</th>
                <th>$Usd entregado</th>
                <th>Kg Cerrados</th>
                <th>$Usd Facturados</th>
                <th title="Compra de material (egreso que baja el Saldo $)">Compra Material</th>
                <th>Gastos</th>
                <th>Traspaso de Caja</th>
                <th>Saldo en moneda $ Usd</th>
                <th title="Saldo corrido = saldo anterior + Kg Cerrados − Kg Recibidos por MGG">Saldo en Kg de casiterita ⓘ</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {!mostradas.length && (
                <tr><td colSpan={11} className="muted" style={{ textAlign: 'center' }}>Ningún movimiento coincide con el filtro.</td></tr>
              )}
              {mostradas.map((f) => (
                <tr
                  key={f.id}
                  onClick={f.contratoId ? () => navigate(`/app/produccion?contrato=${f.contratoId}`) : undefined}
                  style={f.contratoId ? { cursor: 'pointer' } : undefined}
                  title={f.contratoId ? 'Ver el contrato en Producción' : undefined}
                >
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{date(f.fecha)}</td>
                  <td style={{ fontWeight: 600 }}>
                    {f.descripcion}
                    {f.contratoId && <span className="muted" style={{ marginLeft: '.4rem', fontWeight: 400 }} title="Ver el contrato en Producción">↗</span>}
                  </td>
                  <td className="mono">{f.usdEntregado == null ? '—' : money(f.usdEntregado)}</td>
                  {/* Kg que aporta el contrato al cerrarse → resaltado */}
                  <td className="mono" style={{ fontWeight: 800, color: 'var(--primary-3)' }}>{num(f.kgCerrados)}</td>
                  <td className="mono">{money(f.usdFacturados)}</td>
                  {/* Compra de material (egreso ingresado por el usuario que baja el Saldo $). */}
                  <td className="mono" style={{ color: f.compraMaterial ? 'var(--primary-3)' : undefined }}>{f.compraMaterial == null ? '—' : money(f.compraMaterial)}</td>
                  {/* Gastos = gastos + nómina (columnas unificadas). */}
                  <td className="mono">{(f.gastosGt == null && f.nominasGt == null) ? '—' : money((f.gastosGt ?? 0) + (f.nominasGt ?? 0))}</td>
                  <td className="mono">{f.trasladoCaja == null ? '—' : money(f.trasladoCaja)}</td>
                  <td className="mono"><strong>{money(f.saldoUsd)}</strong></td>
                  {/* Saldo corrido de casiterita → resaltado (permite negativo) */}
                  <td className="mono" style={{ fontWeight: 800, color: f.saldoKgCasiterita < 0 ? 'var(--danger)' : 'var(--success, #45c08a)' }}>{num(f.saldoKgCasiterita)}</td>
                  <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                    {!f.contratoId && canWrite && (() => {
                      // f.id viene como `m-<id>`; recuperamos el movimiento original de la caja.
                      const orig = f.id.startsWith('m-') ? cajaMovs.find((m) => m.id === f.id.slice(2)) : undefined;
                      return orig ? (
                        <span style={{ display: 'inline-flex', gap: '.25rem' }}>
                          <button className="btn btn-sm btn-ghost" title="Editar movimiento" onClick={(e) => { e.stopPropagation(); setMovEdit(orig); }}>✎</button>
                          <button className="btn btn-sm btn-ghost" title="Borrar movimiento" onClick={(e) => { e.stopPropagation(); void borrarMov(orig); }}>🗑</button>
                        </span>
                      ) : null;
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border, rgba(255,255,255,.15))' }}>
                <td colSpan={2} style={{ textAlign: 'right', fontWeight: 700 }}>Totales</td>
                <td className="mono" style={{ fontWeight: 800, color: 'var(--success, #45c08a)' }}>{totUsdEntregadoVista ? money(totUsdEntregadoVista) : '—'}</td>
                <td className="mono" style={{ fontWeight: 800, color: 'var(--primary-3)' }}>{num(totKgVista)}</td>
                <td></td>
                <td className="mono" style={{ fontWeight: 800, color: 'var(--primary-3)' }}>{totCompraMaterialVista ? money(totCompraMaterialVista) : '—'}</td>
                <td></td>
                <td className="mono" style={{ fontWeight: 800 }}>{totTrasladoVista ? money(totTrasladoVista) : '—'}</td>
                <td></td>
                <td className="mono" style={{ fontWeight: 800, color: saldoVista < 0 ? 'var(--danger)' : 'var(--success, #45c08a)' }}>{num(saldoVista)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <p className="hint muted" style={{ fontSize: '.74rem', marginTop: '.5rem' }}>
            <strong>Saldo en Kg de casiterita</strong> = saldo anterior + Kg Cerrados − Kg Recibidos por MGG (acumulado corrido; admite negativo).
          </p>
        </div>
      )}

      {correoOpen && (
        <CorreoReporteModal
          titulo="Enviar movimientos del Centro de Costo"
          descripcion={`Se enviará el PDF con ${mostradas.length} movimiento(s)${hayFiltro ? ', con el filtro aplicado' : ''}.`}
          defaultEmail={user?.email ?? ''}
          onEnviar={async (emails) => {
            const { enviarMovAcopioPorCorreo } = await import('./movimientosAcopioReportes');
            const { destinatarios } = await enviarMovAcopioPorCorreo(mostradas, emails, { filtro: filtroTxt() });
            return destinatarios;
          }}
          onClose={() => setCorreoOpen(false)}
        />
      )}

      {movEdit && (
        <EditarMovimientoCajaModal mov={movEdit} onClose={() => setMovEdit(null)} onSaved={() => { setMovEdit(null); void recargar(); }} />
      )}
    </div>
  );
}

/* ───────────── Editar un movimiento de la caja del acopio ───────────── */
function EditarMovimientoCajaModal({ mov, onClose, onSaved }: { mov: CajaMovimiento; onClose: () => void; onSaved: () => void }) {
  const [fecha, setFecha] = useState((mov.fecha ?? '').slice(0, 10));
  const [descripcion, setDescripcion] = useState(mov.descripcion ?? '');
  const [usdEntregado, setUsdEntregado] = useState(String(mov.usd_entregado ?? 0));
  const [kgCerrados, setKgCerrados] = useState(String(mov.kg_cerrados ?? 0));
  const [facturados, setFacturados] = useState(String(mov.facturados ?? 0));
  const [gastos, setGastos] = useState(String(mov.gastos ?? 0));
  const [nominas, setNominas] = useState(String(mov.nominas ?? 0));
  const [traslado, setTraslado] = useState(String(mov.traslado ?? 0));
  const [compraMaterial, setCompraMaterial] = useState(String(mov.compra_material ?? 0));
  const [kgRecibidos, setKgRecibidos] = useState(String(mov.kg_recibidos ?? 0));
  const [grupo, setGrupo] = useState<GrupoClasificacion | ''>((mov.clasif_grupo as GrupoClasificacion) ?? '');
  const [clasifValor, setClasifValor] = useState(mov.clasif_valor ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nzr = (s: string) => Math.round((Number(s) || 0) * 100) / 100;

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!fecha) { setError('Indicá la fecha.'); return; }
    setSaving(true);
    try {
      await actualizarMovimientoCaja(mov.id, {
        fecha,
        descripcion: descripcion.trim() || null,
        usd_entregado: nzr(usdEntregado), kg_cerrados: nzr(kgCerrados), facturados: nzr(facturados),
        gastos: nzr(gastos), nominas: nzr(nominas), traslado: nzr(traslado), compra_material: nzr(compraMaterial), kg_recibidos: nzr(kgRecibidos),
        clasif_grupo: grupo || null, clasif_valor: clasifValor.trim() || null,
      });
      toast('Movimiento actualizado', 'success');
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar.'); setSaving(false); }
  }

  const campo = (label: string, val: string, set: (v: string) => void) => (
    <div className="form-row"><label>{label}</label>
      <input className="input mono" type="number" step="0.01" value={val} onChange={(e) => set(e.target.value)} /></div>
  );

  return (
    <Modal title="Editar movimiento" size="md" onClose={onClose} footer={
      <><button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="acopio-mov-edit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button></>
    }>
      <form id="acopio-mov-edit" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
        <div className="form-grid">
          <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
          <div className="form-row"><label>Clasificación (grupo)</label>
            <select className="select" value={grupo} onChange={(e) => setGrupo(e.target.value as GrupoClasificacion | '')}>
              <option value="">— sin grupo —</option>
              {GRUPOS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row"><label>Descripción</label><input className="input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></div>
        <div className="form-row"><label>Categoría (valor)</label><input className="input" value={clasifValor} onChange={(e) => setClasifValor(e.target.value)} placeholder="Categoría / clasificación" /></div>
        <div className="form-grid">
          {campo('$Usd entregado', usdEntregado, setUsdEntregado)}
          {campo('Kg Cerrados', kgCerrados, setKgCerrados)}
        </div>
        <div className="form-grid">
          {campo('$Usd Facturados', facturados, setFacturados)}
          {campo('Kg Recibidos por MGG', kgRecibidos, setKgRecibidos)}
        </div>
        <div className="form-grid">
          {campo('Gastos', gastos, setGastos)}
          {campo('Nóminas', nominas, setNominas)}
        </div>
        <div className="form-grid">
          {campo('Compra Material', compraMaterial, setCompraMaterial)}
          {campo('Traslado de caja', traslado, setTraslado)}
        </div>
      </form>
    </Modal>
  );
}
