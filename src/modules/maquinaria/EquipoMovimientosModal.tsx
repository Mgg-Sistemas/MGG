import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { num as fmtNum, date as fmtDate } from '@/shared/lib/format';
import { listMantenimientos, etiquetaTipoMant, type MantenimientoCalc } from './maquinariaMant.repository';
import { listServiciosDeEquipo, type ServicioDeEquipo } from '@/modules/pedidos/servicios.repository';
import { listServiciosDirectosDeEquipo, type ServicioDirecto } from '@/modules/pedidos/serviciosDirectos.repository';
import { descargarMovimientosEquipoPdf, type MovimientoEquipoRow } from './servicioMantenimientoPdf';
import { listProductosPorIds } from '@/modules/inventario/inventario.repository';
import type { Producto } from '@/shared/lib/types';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';

/** Detalle de consumo de un registro de bitácora (aceite/gasoil/refrigerante/km/trabajo). */
function detalleBitacora(r: MantenimientoCalc): string {
  const partes: string[] = [];
  if (r.aceite_lts) partes.push(`Aceite ${fmtNum(r.aceite_lts)} L`);
  if (r.gasoil_lts) partes.push(`Gasoil ${fmtNum(r.gasoil_lts)} L`);
  if (r.refrigerante_lts) partes.push(`Refrig. ${fmtNum(r.refrigerante_lts)} L`);
  const km = (r as unknown as { kilometraje?: number | null }).kilometraje;
  if (km != null) partes.push(`Km ${fmtNum(km)}`);
  if (r.horometro != null) partes.push(`Horóm. ${fmtNum(r.horometro)}`);
  if (r.trabajo) partes.push(r.trabajo);
  if (r.consumibles) partes.push(r.consumibles);
  return partes.join(' · ') || '—';
}

const SIN_DECLARAR = 'sin declarar';

/** Qué repuesto llevó un servicio, leyendo sus renglones. Puede ser el producto del
 *  inventario, «sin repuesto» cuando se declaró que es solo mano de obra, o
 *  «sin declarar» cuando nadie contestó la pregunta (las líneas viejas). */
function etiquetaRepuesto(lineas: { insumoNombre: string | null; sinInsumo: boolean }[]): string {
  const conNombre = [...new Set(lineas.map((l) => l.insumoNombre).filter(Boolean) as string[])];
  if (conNombre.length) return conNombre.join(', ');
  if (lineas.length && lineas.every((l) => l.sinInsumo)) return 'sin repuesto';
  return SIN_DECLARAR;
}

/**
 * Historial de movimientos/consumos de UN equipo: une la bitácora (cambios de
 * aceite/filtro, trabajos…) con las solicitudes de servicio (cauchos, repuestos…)
 * en una línea de tiempo por fecha, filtrable por rango y con descarga a PDF.
 *
 * Desde el 10/09/2026 el historial también responde QUÉ CONSUME el equipo: cada
 * movimiento dice qué repuesto del inventario llevó, y arriba hay un resumen con
 * esos productos, cuántas veces se usaron y CUÁNTO HAY HOY EN EXISTENCIA. Esa era
 * la pregunta original —«cuántos productos tiene equis equipo disponible»— y no
 * hizo falta ninguna tabla nueva: el equipo ya venía anotado en cada renglón de
 * servicio; lo que faltaba era mirarlo desde el lado del equipo.
 */
export function EquipoMovimientosModal({ equipo, onClose }: { equipo: MaquinariaEquipo; onClose: () => void }) {
  const [bitacora, setBitacora] = useState<MantenimientoCalc[]>([]);
  const [servicios, setServicios] = useState<ServicioDeEquipo[]>([]);
  const [directos, setDirectos] = useState<ServicioDirecto[]>([]);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [b, s, d] = await Promise.all([
        listMantenimientos(equipo.id).catch(() => [] as MantenimientoCalc[]),
        listServiciosDeEquipo(equipo.id).catch(() => [] as ServicioDeEquipo[]),
        listServiciosDirectosDeEquipo(equipo.id).catch(() => [] as ServicioDirecto[]),
      ]);
      setBitacora(b); setServicios(s); setDirectos(d);
    } finally { setLoading(false); }
  }, [equipo.id]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_mantenimientos', 'ordenes', 'servicios_directos'], () => { void cargar(); });

  // Timeline unificado (bitácora + solicitudes de servicio), ordenado por fecha desc.
  const rows: MovimientoEquipoRow[] = useMemo(() => {
    const out: MovimientoEquipoRow[] = [];
    for (const r of bitacora) {
      out.push({ fecha: r.fecha, origen: 'Bitácora', tipo: etiquetaTipoMant(r.tipo), detalle: detalleBitacora(r) });
    }
    for (const s of servicios) {
      const detalle = (s.servicios ?? []).map((x) => `${x.nombre}${x.cantidad ? ` ×${x.cantidad}` : ''}`).join(', ') || '—';
      out.push({
        fecha: s.created_at, origen: 'Servicio',
        tipo: `${s.codigo}${s.estado ? ` (${s.estado})` : ''}`,
        detalle, repuesto: etiquetaRepuesto(s.servicios ?? []),
      });
    }
    for (const d of directos) {
      // Solo los renglones casados a ESTE equipo (o todos si el servicio es de cabecera del equipo).
      const propios = (d.items ?? []).filter((x) => x.equipo_id === equipo.id);
      const lineas = propios.length ? propios : (d.equipo_id === equipo.id ? (d.items ?? []) : []);
      if (!lineas.length) continue;
      const detalle = lineas.map((x) => {
        const extra = [x.bombonas ? `${fmtNum(x.bombonas)} bombona(s)` : '', x.kg_recarga ? `${fmtNum(x.kg_recarga)} kg` : ''].filter(Boolean).join(' · ');
        return `${x.descripcion}${x.cantidad ? ` ×${fmtNum(x.cantidad)}` : ''}${extra ? ` (${extra})` : ''}`;
      }).join(', ') || d.descripcion;
      out.push({
        fecha: d.finalizada_at ?? d.created_at, origen: 'Servicio',
        tipo: `${d.codigo ?? 'Servicio directo'} (${d.estado === 'finalizada' ? 'pagado' : 'en proceso'})`,
        detalle,
        repuesto: etiquetaRepuesto(lineas.map((x) => ({
          insumoNombre: x.producto_nombre ?? null, sinInsumo: false,
        }))),
      });
    }
    return out.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  }, [bitacora, servicios, directos]);

  // ── Qué consume este equipo ────────────────────────────────────────────────
  // Los repuestos declarados en sus servicios, agrupados por producto. `veces` es
  // en cuántos servicios apareció y `cantidad` cuánto se llevó en total.
  const dentroDelRango = useCallback((iso: string | null | undefined) => {
    const f = (iso ?? '').slice(0, 10);
    if (desde && f < desde) return false;
    if (hasta && f > hasta) return false;
    return true;
  }, [desde, hasta]);

  const consumo = useMemo(() => {
    const acc = new Map<string, { nombre: string; veces: number; cantidad: number }>();
    const sumar = (id: string | null, nombre: string | null, cant: number) => {
      if (!id) return;
      const prev = acc.get(id) ?? { nombre: nombre ?? '—', veces: 0, cantidad: 0 };
      acc.set(id, { nombre: prev.nombre, veces: prev.veces + 1, cantidad: prev.cantidad + (Number(cant) || 0) });
    };
    for (const s of servicios) {
      if (!dentroDelRango(s.created_at)) continue;
      for (const x of s.servicios ?? []) sumar(x.insumoProductoId, x.insumoNombre, x.cantidad);
    }
    for (const d of directos) {
      if (!dentroDelRango(d.finalizada_at ?? d.created_at)) continue;
      const propios = (d.items ?? []).filter((x) => x.equipo_id === equipo.id);
      const lineas = propios.length ? propios : (d.equipo_id === equipo.id ? (d.items ?? []) : []);
      for (const x of lineas) sumar(x.producto_id ?? null, x.producto_nombre ?? null, Number(x.producto_cantidad ?? x.cantidad) || 0);
    }
    return [...acc.entries()]
      .map(([productoId, v]) => ({ productoId, ...v }))
      .sort((a, b) => b.veces - a.veces || a.nombre.localeCompare(b.nombre, 'es-VE'));
  }, [servicios, directos, equipo.id, dentroDelRango]);

  // Existencia actual de esos repuestos. Se piden solo los que hacen falta.
  const [stock, setStock] = useState<Map<string, Producto>>(new Map());
  useEffect(() => {
    const ids = consumo.map((c) => c.productoId);
    if (!ids.length) { setStock(new Map()); return; }
    let vivo = true;
    listProductosPorIds(ids)
      .then((ps) => { if (vivo) setStock(new Map(ps.map((p) => [p.id, p]))); })
      .catch(() => { if (vivo) setStock(new Map()); });
    return () => { vivo = false; };
  }, [consumo]);

  // Cuántos servicios quedaron sin contestar si lleva repuesto o no. Es el hueco
  // que hay que cerrar para que el resumen de arriba sirva de algo.
  const sinDeclarar = useMemo(
    () => rows.filter((r) => r.repuesto === SIN_DECLARAR).length,
    [rows],
  );

  const rowsFiltradas = useMemo(() => rows.filter((r) => {
    const f = (r.fecha || '').slice(0, 10);
    if (desde && f < desde) return false;
    if (hasta && f > hasta) return false;
    return true;
  }), [rows, desde, hasta]);

  async function pdf() {
    try { await descargarMovimientosEquipoPdf(equipo.equipo, rowsFiltradas, { desde, hasta }); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  const footer = (
    <>
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      <button className="btn btn-primary" disabled={!rowsFiltradas.length} onClick={() => void pdf()}>↓ PDF del historial</button>
    </>
  );

  return (
    <Modal title={`🔧 Movimientos · ${equipo.equipo}`} size="xl" onClose={onClose} footer={footer}>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.7rem' }}>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
          Desde <input className="input" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} style={{ width: 'auto' }} />
        </label>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
          Hasta <input className="input" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} style={{ width: 'auto' }} />
        </label>
        {(desde || hasta) && <button className="btn btn-sm btn-ghost" onClick={() => { setDesde(''); setHasta(''); }}>✕ Fechas</button>}
        <span className="muted" style={{ fontSize: '.78rem', marginLeft: 'auto' }}>{rowsFiltradas.length} movimiento(s){loading ? ' · cargando…' : ''}</span>
      </div>

      {/* QUÉ CONSUME ESTE EQUIPO. Sale de los repuestos declarados en sus propios
          servicios, con la existencia de hoy al lado. No reserva stock ni promete
          disponibilidad: dice qué usa este equipo y cuánto hay en el almacén. */}
      <div className="card" style={{ padding: '.6rem .75rem', marginBottom: '.7rem' }}>
        <div className="muted" style={{ fontSize: '.74rem', marginBottom: '.4rem' }}>
          QUÉ CONSUME ESTE EQUIPO · repuestos declarados en sus servicios
        </div>
        {!consumo.length ? (
          <div className="muted" style={{ fontSize: '.8rem' }}>
            Todavía ningún servicio de este equipo declaró qué repuesto del inventario llevó.
            {sinDeclarar > 0 && <> Hay <strong>{sinDeclarar}</strong> servicio(s) sin contestar esa pregunta.</>}
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table" style={{ fontSize: '.8rem' }}>
                <thead><tr><th>Repuesto</th><th className="num">Veces</th><th className="num">Consumido</th><th className="num">Hoy en existencia</th></tr></thead>
                <tbody>
                  {consumo.map((c) => {
                    const p = stock.get(c.productoId);
                    const hay = p ? Number(p.stock) || 0 : null;
                    return (
                      <tr key={c.productoId}>
                        <td>
                          {p?.nombre ?? c.nombre}
                          {p?.sku && <span className="muted mono" style={{ fontSize: '.72rem' }}> · {p.sku}</span>}
                          {p && p.estado !== 'activo' && <span className="muted"> · dado de baja</span>}
                        </td>
                        <td className="num mono">{fmtNum(c.veces)}</td>
                        <td className="num mono">{fmtNum(c.cantidad)} {p?.unidad ?? ''}</td>
                        <td className="num mono" style={{ color: hay != null && hay <= 0 ? 'var(--danger, #ef4444)' : undefined }}>
                          {hay == null ? '—' : `${fmtNum(hay)} ${p?.unidad ?? ''}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {sinDeclarar > 0 && (
              <div className="muted" style={{ fontSize: '.74rem', marginTop: '.4rem' }}>
                ⚠ Esta lista está incompleta: <strong>{sinDeclarar}</strong> servicio(s) de este equipo no dicen si llevaron repuesto.
              </div>
            )}
          </>
        )}
      </div>

      <div className="table-wrap" style={{ maxHeight: 460, overflow: 'auto' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr><th>Fecha</th><th>Origen</th><th>Tipo</th><th>Detalle / consumo</th><th>Repuesto</th></tr></thead>
          <tbody>
            {!rowsFiltradas.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center' }}>Sin movimientos en el período.</td></tr>}
            {rowsFiltradas.map((r, i) => (
              <tr key={i}>
                <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.fecha)}</td>
                <td><span className="badge" style={{ background: r.origen === 'Servicio' ? '#0ea5e9' : 'var(--surface-2)', color: r.origen === 'Servicio' ? '#fff' : undefined }}>{r.origen}</span></td>
                <td>{r.tipo}</td>
                <td>{r.detalle}</td>
                <td className={r.repuesto && r.repuesto !== SIN_DECLARAR ? undefined : 'muted'}>
                  {r.repuesto ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: '.72rem', margin: '.4rem 0 0' }}>
        Une la <strong>bitácora</strong> del equipo (aceite, gasoil, filtros, trabajos) con las <strong>solicitudes de servicio</strong> (cauchos, repuestos…). Ej.: «25/06 · Cambio de cauchos ×6».
      </p>
    </Modal>
  );
}
