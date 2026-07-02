import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { notify } from '@/shared/lib/notify';
import { money, date, dateTime, redondearArriba5 } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Personal, AnticipoPrestamo, NominaRenglon, DeduccionRef } from '@/shared/lib/types';
import { getTasaHoy, round2 } from '../tesoreria/tasas.repository';
import { listPersonal, setPersonalActivo } from './personal.repository';
import { listAnticiposActivos } from './anticipos.repository';
// descargarNominaReciboPdf se importa dinámicamente (al generar) para no cargar jsPDF al abrir.
import {
  cargarNomina, listNominas, listRenglones, eliminarNomina, calcularRenglon,
  type NominaPeriodoResumen, type RenglonInput,
} from './nomina.repository';

const bs = (n: number) => 'Bs ' + Number(n || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function NominaTab({ canWrite, actor, actorName }: { canWrite: boolean; actor: string; actorName: string | null }) {
  const [nominas, setNominas] = useState<NominaPeriodoResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [cargarOpen, setCargarOpen] = useState(false);
  const [liqOpen, setLiqOpen] = useState(false);
  const [verPeriodo, setVerPeriodo] = useState<NominaPeriodoResumen | null>(null);

  const recargar = useCallback(async () => {
    setLoading(true);
    try { setNominas(await listNominas()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar', 'error'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void recargar(); }, [recargar]);
  useRealtime(['nomina_periodos', 'nomina_renglones'], () => { void recargar(); });

  async function borrar(p: NominaPeriodoResumen) {
    if (!window.confirm(`¿Eliminar la nómina ${p.codigo}? Solo se puede si no tiene pagos.`)) return;
    try { await eliminarNomina(p.id); await recargar(); toast('Nómina eliminada', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  // Comprobante de pago (PDF, uno por trabajador, con firmas).
  async function pdfNomina(p: NominaPeriodoResumen) {
    try {
      const [rens, pers] = await Promise.all([listRenglones(p.id), listPersonal(false)]);
      if (!rens.length) { toast('La nómina no tiene renglones', 'error'); return; }
      const cedulas = Object.fromEntries(pers.map((x) => [x.id, x.cedula]));
      const { descargarNominaReciboPdf } = await import('./nominaReciboPdf');
      await descargarNominaReciboPdf(rens, { periodo: p, cedulas });
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  function estadoBadge(p: NominaPeriodoResumen) {
    if (p.pendientes === 0 && p.total_renglones > 0) return <span className="badge" style={{ color: 'var(--success)' }}>✓ Nómina Pagada</span>;
    if (p.pagados > 0) return <span className="badge" style={{ color: 'var(--warning)' }}>Faltan {p.pendientes} por pagar</span>;
    return <span className="badge" style={{ color: 'var(--primary)' }}>Cargada · {p.pendientes} por pagar</span>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div className="muted" style={{ fontSize: '.88rem' }}>Nómina quincenal · se paga desde Tesorería.</div>
        {canWrite && (
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={() => setLiqOpen(true)}>🧾 Liquidación / pago extraordinario</button>
            <button className="btn btn-primary" onClick={() => setCargarOpen(true)}>+ Cargar nómina</button>
          </div>
        )}
      </div>

      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Nómina</th><th>Fecha</th><th style={{ textAlign: 'center' }}>Personas</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'center' }}>Estado</th><th>Cargada</th><th style={{ textAlign: 'center' }}>Acciones</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !nominas.length && <tr><td colSpan={7}><EmptyState message="Sin nóminas cargadas" icon="📋" /></td></tr>}
            {!loading && nominas.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.codigo}</td>
                <td className="muted">{p.periodo_desde ? (p.periodo_hasta && p.periodo_hasta !== p.periodo_desde ? `${date(p.periodo_desde)} → ${date(p.periodo_hasta)}` : date(p.periodo_desde)) : '—'}</td>
                <td style={{ textAlign: 'center' }}>{p.pagados}/{p.total_renglones}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(p.total_usd)}</td>
                <td style={{ textAlign: 'center' }}>{estadoBadge(p)}</td>
                <td className="muted">{dateTime(p.created_at)}</td>
                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setVerPeriodo(p)} title="Ver detalle">👁</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => pdfNomina(p)} title="Comprobante de pago (PDF con firmas)">📄 PDF</button>
                  {canWrite && p.pagados === 0 && <button className="btn btn-sm btn-ghost" onClick={() => borrar(p)} title="Eliminar" style={{ color: 'var(--danger)' }}>🗑</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cargarOpen && <CargarNominaModal actor={actor} actorName={actorName} onClose={() => setCargarOpen(false)} onSaved={async () => { setCargarOpen(false); await recargar(); }} />}
      {liqOpen && <LiquidacionModal actor={actor} actorName={actorName} onClose={() => setLiqOpen(false)} onSaved={async () => { setLiqOpen(false); await recargar(); }} />}
      {verPeriodo && <NominaDetalleModal periodo={verPeriodo} onClose={() => setVerPeriodo(null)} />}
    </div>
  );
}

/* ───────── Cargar nómina (vista previa con días y deducciones) ───────── */
interface FilaUI {
  persona: Personal;
  incluido: boolean;
  dias: string;
  deduc: Record<string, string>;   // anticipoId -> monto a descontar
}

function CargarNominaModal({ actor, actorName, onClose, onSaved }: {
  actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  // Fecha del día (local) y mes presente — la nómina se marca "hoy".
  const ahora = new Date();
  const hoyIso = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
  const mesLabel = ahora.toLocaleDateString('es-VE', { month: 'long', year: 'numeric', timeZone: 'America/Caracas' });
  const [diasBase, setDiasBase] = useState(15);
  const [tasa, setTasa] = useState(0);
  const [tasaFecha, setTasaFecha] = useState<string | null>(null);
  const [notas, setNotas] = useState('');
  const [anticipos, setAnticipos] = useState<AnticipoPrestamo[]>([]);
  const [filas, setFilas] = useState<FilaUI[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTasaHoy().then((t) => { if (t.usd != null) setTasa(t.usd); setTasaFecha(t.fecha); }).catch(() => {});
    Promise.all([listPersonal(true), listAnticiposActivos()]).then(([ps, as]) => {
      setAnticipos(as);
      setFilas(ps.map((p) => ({
        persona: p,
        incluido: true,
        dias: String(15),
        deduc: as.filter((a) => a.personal_id === p.id).reduce<Record<string, string>>((acc, a) => {
          const sug = a.cuota_sugerida != null ? Math.min(Number(a.cuota_sugerida), Number(a.saldo)) : 0;
          acc[a.id] = sug > 0 ? String(round2(sug)) : '';
          return acc;
        }, {}),
      })));
    }).catch(() => {});
  }, []);

  // Al cambiar los días base, sincroniza las filas que aún no se tocaron individualmente.
  function aplicarDiasBase(n: number) {
    setDiasBase(n);
    setFilas((fs) => fs.map((f) => ({ ...f, dias: String(n) })));
  }

  const anticiposDe = (pid: string) => anticipos.filter((a) => a.personal_id === pid);

  function calcFila(f: FilaUI) {
    const deducciones: DeduccionRef[] = anticiposDe(f.persona.id)
      .map((a) => ({ id: a.id, tipo: a.tipo, monto: round2(Math.min(Number(f.deduc[a.id]) || 0, Number(a.saldo))) }))
      .filter((d) => d.monto > 0);
    const c = calcularRenglon({ sueldo_base_mensual: Number(f.persona.sueldo_base) || 0, dias_trabajados: Number(f.dias) || 0, deducciones });
    return { deducciones, ...c };
  }

  const incluidas = filas.filter((f) => f.incluido);
  const totalNeto = useMemo(() => round2(incluidas.reduce((a, f) => a + calcFila(f).neto_usd, 0)), [filas, anticipos]);

  async function guardar() {
    setError(null);
    if (!incluidas.length) { setError('Incluí al menos un trabajador.'); return; }
    setSaving(true);
    try {
      const renglones: RenglonInput[] = incluidas.map((f) => {
        const { deducciones } = calcFila(f);
        return {
          personal_id: f.persona.id,
          nombre: `${f.persona.nombre} ${f.persona.apellido}`.trim(),
          cargo: f.persona.cargo ?? null,
          departamento: f.persona.departamento ?? null,
          sueldo_base_mensual: Number(f.persona.sueldo_base) || 0,
          dias_trabajados: Number(f.dias) || 0,
          deducciones,
        };
      });
      const per = await cargarNomina({
        periodo_desde: hoyIso, periodo_hasta: hoyIso, dias_base: diasBase,
        tasa_bcv: tasa || null, notas: notas || null, renglones, actorEmail: actor, actorName,
      });
      notify(`Nómina ${per.codigo} cargada · ${renglones.length} persona(s) · ${money(per.total_usd)}`, 'success', { link: '#/app/tesoreria' });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar la nómina'); setSaving(false); }
  }

  return (
    <Modal title="Marcar nómina" size="xl" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={guardar} disabled={saving}>{saving ? 'Cargando…' : `Cargar nómina · ${money(totalNeto)}`}</button>
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}

      <div className="card" style={{ padding: '.75rem', marginBottom: '.75rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.2rem', alignItems: 'flex-end' }}>
          <div>
            <div className="muted" style={{ fontSize: '.72rem' }}>Mes</div>
            <strong style={{ textTransform: 'capitalize' }}>{mesLabel}</strong>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '.72rem' }}>Fecha</div>
            <strong className="mono">{date(hoyIso)}</strong>
          </div>
          <div className="form-row" style={{ minWidth: 130 }}>
            <label style={{ fontSize: '.72rem' }}>Días base (quincena)</label>
            <input className="input mono" type="number" min={1} max={31} value={diasBase} onChange={(e) => aplicarDiasBase(Number(e.target.value) || 0)} />
          </div>
          <div className="form-row" style={{ minWidth: 170 }}>
            <label style={{ fontSize: '.72rem' }}>Tasa BCV (Bs/$){tasaFecha ? ` · ${date(tasaFecha)}` : ''}</label>
            <input className="input mono" type="number" min={0} step="any" value={tasa || ''} onChange={(e) => setTasa(Number(e.target.value) || 0)} placeholder="tasa del día" />
          </div>
          <div className="form-row" style={{ flex: 1, minWidth: 180 }}>
            <label style={{ fontSize: '.72rem' }}>Notas (opcional)</label>
            <input className="input" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Comentario de la nómina" />
          </div>
        </div>
        <small className="muted" style={{ display: 'block', marginTop: '.5rem' }}>
          Marcá los trabajadores a pagar. Sueldo diario = sueldo mensual ÷ 30. Bruto = diario × días. Neto = bruto − (anticipos + préstamos). IVSS/FAOV/bonos: próximamente.
        </small>
      </div>

      <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr>
            <th style={{ width: 28 }}></th><th>Trabajador</th>
            <th style={{ textAlign: 'right' }}>Sueldo mes</th>
            <th style={{ textAlign: 'center', width: 70 }}>Días</th>
            <th style={{ textAlign: 'right' }}>Bruto</th>
            <th>Deducciones (anticipos/préstamos)</th>
            <th style={{ textAlign: 'right' }}>Neto USD</th>
            <th style={{ textAlign: 'right' }}>≈ Bs</th>
          </tr></thead>
          <tbody>
            {!filas.length && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center' }}>Sin personal activo. Agregá trabajadores en la pestaña Personal.</td></tr>}
            {filas.map((f, i) => {
              const { deducciones, salario_bruto, neto_usd } = calcFila(f);
              const ants = anticiposDe(f.persona.id);
              return (
                <tr key={f.persona.id} style={{ opacity: f.incluido ? 1 : 0.45 }}>
                  <td><input type="checkbox" checked={f.incluido} onChange={(e) => setFilas((fs) => fs.map((x, j) => j === i ? { ...x, incluido: e.target.checked } : x))} /></td>
                  <td>{f.persona.nombre} {f.persona.apellido}<div className="muted" style={{ fontSize: '.72rem' }}>{f.persona.departamento || ''}{f.persona.cargo ? ` · ${f.persona.cargo}` : ''}</div></td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(f.persona.sueldo_base)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <input className="input mono" type="number" min={0} max={31} value={f.dias} disabled={!f.incluido}
                      onChange={(e) => setFilas((fs) => fs.map((x, j) => j === i ? { ...x, dias: e.target.value } : x))}
                      style={{ width: 56, textAlign: 'center' }} />
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{money(salario_bruto)}</td>
                  <td>
                    {!ants.length ? <span className="muted">—</span> : ants.map((a) => (
                      <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', marginBottom: '.2rem' }}>
                        <span className="badge" style={{ fontSize: '.68rem' }}>{a.tipo === 'anticipo' ? 'Ant.' : 'Prést.'}</span>
                        <input className="input mono" type="number" min={0} max={Number(a.saldo)} step="any" value={f.deduc[a.id] ?? ''} disabled={!f.incluido}
                          onChange={(e) => setFilas((fs) => fs.map((x, j) => j === i ? { ...x, deduc: { ...x.deduc, [a.id]: e.target.value } } : x))}
                          style={{ width: 90, textAlign: 'right' }} placeholder="0,00" />
                        <span className="muted" style={{ fontSize: '.7rem' }}>de {money(a.saldo)}</span>
                      </div>
                    ))}
                    {deducciones.length > 0 && <div className="muted" style={{ fontSize: '.7rem' }}>− {money(deducciones.reduce((s, d) => s + d.monto, 0))}</div>}
                  </td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>
                    {money(neto_usd)}
                    {redondearArriba5(neto_usd) > neto_usd && (
                      <div className="muted" style={{ fontSize: '.66rem', fontWeight: 400 }} title="Sugerido para pago en efectivo (redondeado al múltiplo de $5)">
                        💵 efectivo ≈ {money(redondearArriba5(neto_usd))}
                      </div>
                    )}
                  </td>
                  <td className="mono muted" style={{ textAlign: 'right' }}>{tasa > 0 ? bs(round2(neto_usd * tasa)) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr>
            <td colSpan={6} style={{ textAlign: 'right', fontWeight: 700 }}>TOTAL NETO ({incluidas.length} persona/s)</td>
            <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>{money(totalNeto)}</td>
            <td className="mono muted" style={{ textAlign: 'right' }}>{tasa > 0 ? bs(round2(totalNeto * tasa)) : '—'}</td>
          </tr></tfoot>
        </table>
      </div>
    </Modal>
  );
}

/* ───────── Liquidación / pago extraordinario (incluye renuncia) ───────── */
function LiquidacionModal({ actor, actorName, onClose, onSaved }: {
  actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [personal, setPersonal] = useState<Personal[]>([]);
  const [anticipos, setAnticipos] = useState<AnticipoPrestamo[]>([]);
  const [personaId, setPersonaId] = useState('');
  const [montoStr, setMontoStr] = useState('');
  const [concepto, setConcepto] = useState('');
  const [tasa, setTasa] = useState(0);
  const [deduc, setDeduc] = useState<Record<string, string>>({});
  const [darBaja, setDarBaja] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTasaHoy().then((t) => { if (t.usd != null) setTasa(t.usd); }).catch(() => {});
    Promise.all([listPersonal(true), listAnticiposActivos()]).then(([ps, as]) => { setPersonal(ps); setAnticipos(as); }).catch(() => {});
  }, []);

  const persona = personal.find((p) => p.id === personaId) ?? null;
  const ants = anticipos.filter((a) => a.personal_id === personaId);
  const monto = round2(Number(montoStr) || 0);
  const deducciones: DeduccionRef[] = ants
    .map((a) => ({ id: a.id, tipo: a.tipo, monto: round2(Math.min(Number(deduc[a.id]) || 0, Number(a.saldo))) }))
    .filter((d) => d.monto > 0);
  const deducTotal = round2(deducciones.reduce((s, d) => s + d.monto, 0));
  const neto = round2(monto - deducTotal);

  async function guardar() {
    setError(null);
    if (!persona) { setError('Elegí el trabajador.'); return; }
    if (monto <= 0) { setError('Indicá el monto del pago.'); return; }
    if (neto < 0) { setError('Las deducciones no pueden superar el monto.'); return; }
    setSaving(true);
    try {
      const per = await cargarNomina({
        tipo: 'liquidacion', dias_base: 0, tasa_bcv: tasa || null,
        notas: concepto.trim() ? `Liquidación: ${concepto.trim()}` : 'Liquidación / pago extraordinario',
        renglones: [{
          personal_id: persona.id,
          nombre: `${persona.nombre} ${persona.apellido}`.trim(),
          cargo: persona.cargo ?? null, departamento: persona.departamento ?? null,
          sueldo_base_mensual: 0, dias_trabajados: 0, asignaciones: monto, deducciones,
        }],
        actorEmail: actor, actorName,
      });
      if (darBaja) await setPersonalActivo(persona.id, false).catch(() => {});
      notify(`Liquidación ${per.codigo} cargada · ${persona.nombre} · ${money(per.total_usd)}${darBaja ? ' · trabajador dado de baja' : ''}`, 'success', { link: '#/app/tesoreria' });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar la liquidación'); setSaving(false); }
  }

  return (
    <Modal title="Liquidación / pago extraordinario" size="lg" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={guardar} disabled={saving}>{saving ? 'Cargando…' : `Cargar · ${money(neto)}`}</button>
      </>
    }>
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}
      <p className="hint muted" style={{ marginTop: 0, fontSize: '.86rem' }}>
        Pago único (renuncia, despido, bono especial). Se carga como nómina de una persona y <strong>Tesorería lo paga</strong> igual que el resto.
      </p>
      <div className="form-grid">
        <div className="form-row">
          <label>Trabajador</label>
          <select className="select" value={personaId} onChange={(e) => setPersonaId(e.target.value)} required>
            <option value="">— elegir —</option>
            {personal.map((p) => <option key={p.id} value={p.id}>{p.nombre} {p.apellido}</option>)}
          </select>
        </div>
        <div className="form-row"><label>Monto del pago (USD)</label><input className="input mono" type="number" min={0} step="any" value={montoStr} onChange={(e) => setMontoStr(e.target.value)} placeholder="0,00" /></div>
        <div className="form-row" style={{ gridColumn: '1 / -1' }}><label>Concepto</label><input className="input" value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="Liquidación por renuncia, vacaciones pendientes, etc." /></div>
      </div>

      {persona && ants.length > 0 && (
        <div className="card" style={{ marginTop: '.6rem', padding: '.6rem' }}>
          <div className="muted" style={{ fontSize: '.78rem', marginBottom: '.3rem' }}>Saldar anticipos / préstamos pendientes (opcional)</div>
          {ants.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.25rem' }}>
              <span className="badge" style={{ fontSize: '.7rem' }}>{a.tipo === 'anticipo' ? 'Anticipo' : 'Préstamo'}</span>
              <input className="input mono" type="number" min={0} max={Number(a.saldo)} step="any" value={deduc[a.id] ?? ''} onChange={(e) => setDeduc((m) => ({ ...m, [a.id]: e.target.value }))} placeholder="0,00" style={{ width: 110, textAlign: 'right' }} />
              <span className="muted" style={{ fontSize: '.78rem' }}>de {money(a.saldo)} pendiente{a.motivo ? ` · ${a.motivo}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: '.6rem', padding: '.6rem', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
        <div style={{ fontSize: '.86rem' }}>
          Monto <strong className="mono">{money(monto)}</strong> − deducciones <strong className="mono">{money(deducTotal)}</strong> = <strong className="mono" style={{ color: 'var(--success)' }}>Neto {money(neto)}</strong>
          {tasa > 0 && <span className="muted"> · ≈ {bs(round2(neto * tasa))}</span>}
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.6rem', fontSize: '.88rem' }}>
        <input type="checkbox" checked={darBaja} onChange={(e) => setDarBaja(e.target.checked)} />
        Dar de baja al trabajador (renuncia / desincorporación) — deja de aparecer en la nómina.
      </label>
    </Modal>
  );
}

/* ───────── Detalle de una nómina (renglones) ───────── */
function NominaDetalleModal({ periodo, onClose }: { periodo: NominaPeriodoResumen; onClose: () => void }) {
  const [rows, setRows] = useState<NominaRenglon[]>([]);
  const [loading, setLoading] = useState(true);
  const [cedulas, setCedulas] = useState<Record<string, string | null | undefined>>({});
  useEffect(() => { listRenglones(periodo.id).then(setRows).catch(() => setRows([])).finally(() => setLoading(false)); }, [periodo.id]);
  useEffect(() => { listPersonal(false).then((ps) => setCedulas(Object.fromEntries(ps.map((x) => [x.id, x.cedula])))).catch(() => {}); }, []);

  async function reciboDe(r: NominaRenglon) {
    try { const { descargarNominaReciboPdf } = await import('./nominaReciboPdf'); await descargarNominaReciboPdf([r], { periodo, cedulas }); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'); }
  }

  return (
    <Modal title={`Nómina ${periodo.codigo}`} size="xl" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={() => void import('./nominaReciboPdf').then(({ descargarNominaReciboPdf }) => descargarNominaReciboPdf(rows, { periodo, cedulas })).catch((e) => toast(e instanceof Error ? e.message : 'No se pudo generar el PDF', 'error'))} disabled={!rows.length}>📄 Comprobantes (todos)</button>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </>
    }>
      <div className="muted" style={{ marginBottom: '.5rem', fontSize: '.85rem' }}>
        {periodo.periodo_desde ? `${periodo.periodo_hasta && periodo.periodo_hasta !== periodo.periodo_desde ? `${date(periodo.periodo_desde)} → ${date(periodo.periodo_hasta)}` : date(periodo.periodo_desde)} · ` : ''}
        {periodo.pagados}/{periodo.total_renglones} pagados · Total <strong className="mono">{money(periodo.total_usd)}</strong>
        {periodo.tasa_bcv ? ` · BCV ${bs(periodo.tasa_bcv)}` : ''}
      </div>
      <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="table" style={{ fontSize: '.8rem' }}>
          <thead><tr><th>Trabajador</th><th style={{ textAlign: 'right' }}>Días</th><th style={{ textAlign: 'right' }}>Bruto</th><th style={{ textAlign: 'right' }}>Deduc.</th><th style={{ textAlign: 'right' }}>Neto</th><th style={{ textAlign: 'center' }}>Estado</th><th>Pago</th><th style={{ textAlign: 'center' }}>Recibo</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id}>
                <td>{r.nombre}<div className="muted" style={{ fontSize: '.7rem' }}>{r.departamento || ''}</div></td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.dias_trabajados}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(r.salario_bruto)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(round2((Number(r.deduc_anticipos) || 0) + (Number(r.deduc_prestamos) || 0)))}</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.neto_usd)}</td>
                <td style={{ textAlign: 'center' }}><span className="badge" style={{ color: r.estado === 'pagada' ? 'var(--success)' : 'var(--warning)' }}>{r.estado === 'pagada' ? 'Pagada' : 'Por pagar'}</span></td>
                <td className="muted">{r.pagada_en ? `${dateTime(r.pagada_en)}${r.moneda_pago ? ` · ${r.moneda_pago}` : ''}` : '—'}</td>
                <td style={{ textAlign: 'center' }}><button className="btn btn-sm btn-ghost" onClick={() => reciboDe(r)} title="Comprobante con firmas">📄</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
