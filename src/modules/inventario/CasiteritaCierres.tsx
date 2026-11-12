/* ============================================================
   MGG · Los Pinos · Casiterita — Fase 4
   · 🗓 Cierres y reportes: cerrar meses (foto fija), Excel «Cierre Promedio» y PDF.
   · ⚖ Conteo físico: galpón contra libro, con ajuste en el mismo paso.
   · 🧮 Simulador: qué deja un lote vendido con la ley y el precio del día.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import {
  CONTENEDOR_KG, cerradoHasta, errorMesCerrado, fechaTxt, finDeMes, hoyVE, kgTxt, leerNumero, mesDe, mesesPorCerrar, nombreMes, numTxt,
  pctTxt, pmpTxt, resumenPorMes, saldoAl, saldoFinal, simularVenta, usdTxt,
  type CierreMesPmp, type ConteoPmp, type FilaLibro,
} from './casiteritaPmp';
import { cerrarMesPmp, faltaTabla, listConteosPmp, registrarConteoPmp, reabrirMesPmp } from './casiteritaPmp.repository';
import { vistaPreviaExcelLibro, vistaPreviaPdfCierre } from './casiteritaPmpReportes';

/* ───────── Cierres y reportes ───────── */
export function CierresCasiterita({ filas, cierres, canWrite, esAdmin, sinTablas, onCambio }: {
  filas: FilaLibro[]; cierres: CierreMesPmp[]; canWrite: boolean; esAdmin: boolean; sinTablas: boolean; onCambio: () => void;
}) {
  const [cerrar, setCerrar] = useState<string | null>(null);
  const [reabrir, setReabrir] = useState<string | null>(null);
  const [generando, setGenerando] = useState<string | null>(null);
  const meses = useMemo(() => resumenPorMes(filas).map((m) => m.mes), [filas]);
  const porCerrar = mesesPorCerrar(filas, cierres, hoyVE());
  const siguiente = porCerrar[0] ?? null;
  const ultimo = cerradoHasta(cierres);
  const [excelMeses, setExcelMeses] = useState<Set<string>>(() => new Set(meses.slice(-1)));

  async function hacerCerrar() {
    if (!cerrar) return;
    try { await cerrarMesPmp(cerrar); toast(`${nombreMes(cerrar)} cerrado.`, 'success'); setCerrar(null); onCambio(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cerrar', 'error'); }
  }
  async function hacerReabrir() {
    if (!reabrir) return;
    try { await reabrirMesPmp(reabrir); toast(`${nombreMes(reabrir)} reabierto.`, 'success'); setReabrir(null); onCambio(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo reabrir', 'error'); }
  }
  async function reporte(clave: string, fn: () => Promise<void>) {
    setGenerando(clave);
    try { await fn(); } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar', 'error'); } finally { setGenerando(null); }
  }

  if (sinTablas) {
    return <div className="card" style={{ borderLeft: '3px solid var(--warning)' }}><strong>Falta preparar la base.</strong> Corre en Supabase <span className="mono">supabase/sql/casiterita-pmp-fase4-cierres.sql</span> y después su semilla con los cierres de agosto a octubre.</div>;
  }

  const todos = [...new Set([...meses, ...cierres.map((c) => c.mes)])].sort().reverse();
  return (
    <>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
          <span>🗓 Cierres mensuales</span>
          <span className="muted" style={{ fontWeight: 400, fontSize: '.8rem' }}>{ultimo ? `Cerrado hasta ${nombreMes(ultimo)}: no se cargan ni se borran movimientos de esas fechas.` : 'Ningún mes cerrado todavía.'}</span>
        </div>
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead><tr>
              <th>Mes</th><th>Estado</th><th style={{ textAlign: 'right' }}>Saldo global</th><th style={{ textAlign: 'right' }}>Inv. MGG</th><th style={{ textAlign: 'right' }}>Resguardo</th>
              <th style={{ textAlign: 'right' }}>Costo MGG</th><th style={{ textAlign: 'right' }}>PMP</th><th>Reportes</th><th />
            </tr></thead>
            <tbody>
              {todos.map((mes) => {
                const c = cierres.find((x) => x.mes === mes) ?? null;
                const s = c ? { global: c.kg_global, mgg: c.kg_mgg, resguardo: c.resguardo, costo: c.costo, pmp: c.pmp } : saldoAl(filas, finDeMes(mes));
                return (
                  <tr key={mes}>
                    <td style={{ fontWeight: 700 }}>{nombreMes(mes)}</td>
                    <td>{c ? <span className="badge success" title={`${c.cerrado_por_name ?? ''} · ${fechaTxt(c.cerrado_en.slice(0, 10))}`}>🔒 Cerrado</span>
                      : mes === mesDe(hoyVE()) ? <span className="badge info">En curso</span> : <span className="badge warning">Abierto</span>}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{numTxt(s.global)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{numTxt(s.mgg)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{numTxt(s.resguardo)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{usdTxt(s.costo)}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{pmpTxt(s.pmp)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm btn-ghost" disabled={!!generando} onClick={() => void reporte(`pdf-${mes}`, () => vistaPreviaPdfCierre(filas, mes, c))}>{generando === `pdf-${mes}` ? '…' : '📄 PDF'}</button>
                      <button className="btn btn-sm btn-ghost" disabled={!!generando} onClick={() => void reporte(`xls-${mes}`, () => vistaPreviaExcelLibro(filas, [mes], cierres))}>{generando === `xls-${mes}` ? '…' : '📗 Excel'}</button>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {canWrite && mes === siguiente && <button className="btn btn-sm btn-primary" onClick={() => setCerrar(mes)}>🔒 Cerrar</button>}
                      {esAdmin && c && mes === ultimo && <button className="btn btn-sm btn-ghost" onClick={() => setReabrir(mes)}>🔓 Reabrir</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="hint muted" style={{ margin: '.5rem 0 0', fontSize: '.78rem' }}>Se cierra en orden y solo meses terminados. El saldo del cierre lo calcula la base con el mismo método del libro y queda fijo: es el que abre el mes siguiente. Reabrir el último mes cerrado lo hace un administrador.</p>
      </div>

      <div className="card">
        <div className="card-title">📗 Excel con el formato de las hojas «Cierre Promedio»</div>
        <p className="hint muted" style={{ marginTop: 0 }}>Una hoja por mes elegido (con los renglones «PROMEDIO» después de cada día), más «Resumen por mes» y el «Libro» completo.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem .9rem', marginBottom: '.6rem' }}>
          {meses.slice().reverse().map((m) => (
            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.85rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={excelMeses.has(m)} onChange={(e) => setExcelMeses((x) => { const y = new Set(x); if (e.target.checked) y.add(m); else y.delete(m); return y; })} /> {nombreMes(m)}
            </label>
          ))}
        </div>
        <button className="btn btn-primary" disabled={!excelMeses.size || !!generando} onClick={() => void reporte('xls', () => vistaPreviaExcelLibro(filas, [...excelMeses], cierres))}>{generando === 'xls' ? 'Generando…' : '📗 Vista previa Excel'}</button>
      </div>

      {cerrar && (
        <ConfirmDialog title={`Cerrar ${nombreMes(cerrar)}`} confirmText="🔒 Cerrar el mes"
          message={`El saldo al ${fechaTxt(finDeMes(cerrar))} queda fijo y abre el mes siguiente. Después no se podrán cargar ni borrar movimientos con fecha de ${nombreMes(cerrar)} o anterior.`}
          onConfirm={() => void hacerCerrar()} onCancel={() => setCerrar(null)} />
      )}
      {reabrir && (
        <ConfirmDialog title={`Reabrir ${nombreMes(reabrir)}`} danger confirmText="🔓 Reabrir"
          message={`Se borra la foto del cierre de ${nombreMes(reabrir)} y se vuelven a permitir movimientos con esa fecha. Úsalo solo para corregir.`}
          onConfirm={() => void hacerReabrir()} onCancel={() => setReabrir(null)} />
      )}
    </>
  );
}

/* ───────── Conteo físico ───────── */
interface Renglon { descripcion: string; kg: string }

export function ConteoCasiterita({ filas, cierres, canWrite, onCambio }: { filas: FilaLibro[]; cierres: CierreMesPmp[]; canWrite: boolean; onCambio: () => void }) {
  const [conteos, setConteos] = useState<ConteoPmp[]>([]);
  const [sinTabla, setSinTabla] = useState(false);
  const [fecha, setFecha] = useState(hoyVE());
  const [renglones, setRenglones] = useState<Renglon[]>([{ descripcion: '', kg: '' }]);
  const [nota, setNota] = useState('');
  const [ajustar, setAjustar] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try { setConteos(await listConteosPmp()); setSinTabla(false); }
    catch (e) { if (faltaTabla(e)) setSinTabla(true); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['casiterita_conteos'], () => { void cargar(); }, { enabled: !sinTabla });

  const fisico = renglones.reduce((a, r) => a + (leerNumero(r.kg) ?? 0), 0);
  const libro = saldoAl(filas, fecha);
  const dif = Math.round((fisico - libro.global) * 1000) / 1000;
  const validos = renglones.filter((r) => r.descripcion.trim() && leerNumero(r.kg) != null && (leerNumero(r.kg) ?? -1) >= 0);
  const err = errorMesCerrado(fecha, cerradoHasta(cierres))
    ?? (!validos.length || validos.length !== renglones.length ? 'Cada renglón lleva descripción y kg.' : null)
    ?? (fecha > hoyVE() ? 'El conteo no puede ser de una fecha futura.' : null)
    ?? (ajustar && -dif > libro.mgg + 0.001 ? 'El faltante es mayor que el inventario MGG: revisa el conteo.' : null);

  async function guardar() {
    if (err) return;
    setGuardando(true);
    try {
      await registrarConteoPmp(fecha, validos.map((r) => ({ descripcion: r.descripcion.trim(), kg: leerNumero(r.kg) ?? 0 })), nota || null, ajustar && Math.abs(dif) > 0.001);
      toast(ajustar && Math.abs(dif) > 0.001 ? 'Conteo registrado y ajuste cargado en el libro.' : 'Conteo registrado.', 'success');
      setRenglones([{ descripcion: '', kg: '' }]); setNota('');
      void cargar(); onCambio();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo registrar', 'error'); }
    finally { setGuardando(false); }
  }

  if (sinTabla) {
    return <div className="card" style={{ borderLeft: '3px solid var(--warning)' }}><strong>Falta preparar la base.</strong> Corre en Supabase <span className="mono">supabase/sql/casiterita-pmp-fase4-cierres.sql</span>.</div>;
  }

  return (
    <>
      {canWrite && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-title">⚖ Nuevo conteo físico del galpón</div>
          <div className="form-grid" style={{ marginBottom: '.6rem' }}>
            <div className="form-row"><label>Fecha del conteo</label><input className="input" type="date" value={fecha} max={hoyVE()} onChange={(e) => setFecha(e.target.value)} /></div>
            <div className="form-row"><label>Nota (opcional)</label><input className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="ej. repesaje con báscula del galpón" /></div>
          </div>
          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.82rem' }}>
              <thead><tr><th>Qué se contó (pila, big bags, lote…)</th><th style={{ textAlign: 'right', width: 160 }}>Kg</th><th /></tr></thead>
              <tbody>
                {renglones.map((r, i) => (
                  <tr key={i}>
                    <td><input className="input" value={r.descripcion} onChange={(e) => setRenglones((x) => x.map((y, j) => (j === i ? { ...y, descripcion: e.target.value } : y)))} placeholder="ej. Big bags galpón 1" /></td>
                    <td><input className="input mono" style={{ textAlign: 'right' }} inputMode="decimal" value={r.kg} onChange={(e) => setRenglones((x) => x.map((y, j) => (j === i ? { ...y, kg: e.target.value } : y)))} /></td>
                    <td>{renglones.length > 1 && <button className="btn btn-sm btn-ghost" onClick={() => setRenglones((x) => x.filter((_, j) => j !== i))}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={() => setRenglones((x) => [...x, { descripcion: '', kg: '' }])}>＋ Renglón</button>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '.5rem', margin: '.8rem 0', fontSize: '.85rem' }}>
            <div><div className="muted">Físico contado</div><strong className="mono">{kgTxt(fisico)}</strong></div>
            <div><div className="muted">Libro al {fechaTxt(fecha)}</div><strong className="mono">{kgTxt(libro.global)}</strong></div>
            <div><div className="muted">Diferencia</div><strong className="mono" style={{ color: Math.abs(dif) < 0.001 ? 'var(--success)' : dif < 0 ? 'var(--danger)' : 'var(--warning)' }}>{Math.abs(dif) < 0.001 ? 'cuadra' : `${dif > 0 ? '+' : '−'}${kgTxt(Math.abs(dif))} (${dif > 0 ? 'sobra' : 'falta'})`}</strong></div>
            {Math.abs(dif) >= 0.001 && <div><div className="muted">Efecto en MGG (al PMP)</div><strong className="mono">{usdTxt(Math.abs(dif) * libro.pmp)}</strong></div>}
          </div>
          {Math.abs(dif) >= 0.001 && (
            <label style={{ display: 'flex', gap: '.4rem', alignItems: 'center', fontSize: '.85rem', marginBottom: '.6rem' }}>
              <input type="checkbox" checked={ajustar} onChange={(e) => setAjustar(e.target.checked)} /> Cargar el ajuste en el libro (el {dif < 0 ? 'faltante sale' : 'sobrante entra'} del inventario MGG al PMP)
            </label>
          )}
          {err && <div style={{ color: 'var(--warning)', fontSize: '.85rem', marginBottom: '.5rem' }}>⚠ {err}</div>}
          <button className="btn btn-primary" disabled={!!err || guardando} onClick={() => void guardar()}>{guardando ? 'Guardando…' : '💾 Registrar conteo'}</button>
        </div>
      )}
      <div className="card">
        <div className="card-title">🗂 Conteos registrados</div>
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.82rem' }}>
            <thead><tr><th>Fecha</th><th>Renglones</th><th style={{ textAlign: 'right' }}>Físico</th><th style={{ textAlign: 'right' }}>Libro</th><th style={{ textAlign: 'right' }}>Diferencia</th><th>Ajuste</th><th>Por</th></tr></thead>
            <tbody>
              {conteos.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{fechaTxt(c.fecha)}</td>
                  <td style={{ whiteSpace: 'normal', fontSize: '.76rem' }}>{c.renglones.map((r) => `${r.descripcion}: ${numTxt(r.kg)}`).join(' · ')}{c.nota && <div className="muted">{c.nota}</div>}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{numTxt(c.kg_fisico)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{numTxt(c.kg_libro)}</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{Math.abs(c.diferencia) < 0.001 ? 'cuadra' : `${c.diferencia > 0 ? '+' : '−'}${numTxt(Math.abs(c.diferencia))}`}</td>
                  <td>{c.ajuste_id ? <span className="badge warning">ajustado</span> : <span className="muted">—</span>}</td>
                  <td className="muted">{c.actor_name ?? ''}</td>
                </tr>
              ))}
              {!conteos.length && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Sin conteos registrados.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ───────── Simulador ───────── */
export function SimuladorCasiterita({ filas }: { filas: FilaLibro[] }) {
  const saldo = saldoFinal(filas);
  const [kg, setKg] = useState(String(Math.min(CONTENEDOR_KG, Math.floor(saldo.global)) || CONTENEDOR_KG));
  const [ley, setLey] = useState('');
  const [precio, setPrecio] = useState('');
  const [ded, setDed] = useState('0');
  const kgN = leerNumero(kg) ?? 0;
  const leyN = leerNumero(ley) ?? 0;
  const precioN = leerNumero(precio) ?? 0;
  const dedN = leerNumero(ded) ?? 0;
  const r = simularVenta({ kg: kgN, ley: leyN, precioTonSn: precioN, deduccionPct: dedN }, saldo);
  const listo = kgN > 0 && leyN > 0 && precioN > 0;
  const fila = (label: string, valor: string, fuerte = false, color?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', padding: '.3rem 0', borderBottom: '1px solid var(--border, rgba(255,255,255,.08))', fontSize: '.86rem' }}>
      <span className="muted">{label}</span><span className="mono" style={{ fontWeight: fuerte ? 800 : 600, color }}>{valor}</span>
    </div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
      <div className="card" style={{ margin: 0 }}>
        <div className="card-title">🧮 Datos del lote</div>
        <div className="form-row"><label>Kg del lote</label><input className="input mono" inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value)} /></div>
        <div className="form-row"><label>Ley SGS (% Sn)</label><input className="input mono" inputMode="decimal" value={ley} onChange={(e) => setLey(e.target.value)} placeholder="ej. 66,50" /></div>
        <div className="form-row"><label>Precio del estaño ($ por tonelada de Sn)</label><input className="input mono" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="el del día" /></div>
        <div className="form-row"><label>Deducciones del comprador (TC/RC, fletes) %</label><input className="input mono" inputMode="decimal" value={ded} onChange={(e) => setDed(e.target.value)} /></div>
        <p className="hint muted" style={{ margin: '.5rem 0 0', fontSize: '.78rem' }}>Usa el saldo y el PMP de hoy del libro. Solo la parte MGG del lote tiene costo; la parte de resguardo es de los aliados.</p>
      </div>
      <div className="card" style={{ margin: 0 }}>
        <div className="card-title">⚖ Qué sale y a qué costo</div>
        {!r.alcanza && <div style={{ color: 'var(--warning)', fontSize: '.84rem', marginBottom: '.4rem' }}>⚠ Hoy hay {kgTxt(saldo.global)} en el galpón: el lote no alcanza.</div>}
        {fila('Proporción del galpón', pctTxt(r.pct))}
        {fila('Kg MGG', kgTxt(r.kgMgg))}
        {fila('Kg de resguardo (aliados)', kgTxt(r.kgResguardo))}
        {fila('PMP vigente', pmpTxt(saldo.pmp))}
        {fila('Costo MGG del lote', usdTxt(r.costoMgg), true)}
        {fila('Estaño contenido', listo ? kgTxt(r.snKg) : '—')}
      </div>
      <div className="card" style={{ margin: 0 }}>
        <div className="card-title">💰 Resultado para MGG</div>
        {!listo ? <p className="muted" style={{ fontSize: '.86rem' }}>Carga la ley y el precio del estaño para ver el resultado.</p> : (<>
          {fila('Valor bruto del lote', usdTxt(r.bruto))}
          {fila('Valor neto (con deducciones)', usdTxt(r.neto))}
          {fila('Parte de MGG', usdTxt(r.ingresoMgg))}
          {fila('Parte del resguardo (a liquidar con aliados)', usdTxt(r.valorResguardo))}
          {fila('Margen de MGG', usdTxt(r.margenMgg), true, r.margenMgg >= 0 ? 'var(--success)' : 'var(--danger)')}
          {r.margenPct != null && fila('Margen sobre la parte MGG', pctTxt(r.margenPct))}
          {r.precioEquilibrio != null && fila('Precio de equilibrio ($/t Sn)', usdTxt(r.precioEquilibrio))}
        </>)}
      </div>
    </div>
  );
}
