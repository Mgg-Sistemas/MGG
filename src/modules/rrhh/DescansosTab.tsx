/* ============================================================
   MGG · RRHH · Descansos por rotación (21×7)

   Desde el 30-09-2026 es para TODO el personal activo (antes solo cocina).
   Quiénes salen en un plan se elige a mano en «🗓 Generar plan», y esa
   elección se puede guardar con un nombre para cargarla en el próximo
   descanso (tabla `rrhh_descansos_grupos`).

   Calendario del mes con una fila por trabajador y una barra por descanso.
   Se filtra por departamento o por «solo quienes tienen descansos».
   Abajo, cuántos están fuera cada día contra el TOPE (rojo si se pasa).
   · Tocar un día vacío → nuevo descanso desde ese día.
   · Tocar una barra → editar fechas, nota o borrarlo.
   · 🗓 Generar plan → reparte los descansos de los próximos meses para que
     nunca salgan más del tope, siguiendo el ritmo de cada uno.
   · ⚙ Ajustes → días de trabajo, días de descanso y tope (por nómina).
   ============================================================ */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { date as fmtDate } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Personal } from '@/shared/lib/types';
import type { Empresa } from './empresa';
import { listPersonal } from './personal.repository';
import {
  aplicarPlanDescansos, crearDescanso, editarDescanso, eliminarDescanso, eliminarGrupoDescanso, getConfigDescansos,
  guardarConfigDescansos, guardarGrupoDescanso, listDescansos, listGruposDescanso, type Descanso, type GrupoDescanso,
} from './descansos.repository';
import {
  CONFIG_POR_DEFECTO, capacidadRotacion, cargaPorDia, diasConChoque, diasDe, fechasEntre, fueraEl,
  generarPlan, minimoSimultaneo, seCruzan, sumarDias, type ConfigDescansos, type DescansoRango, type ResultadoPlan,
} from './descansosPlan';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIA_SEM = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

const hoyVE = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const nombre = (p?: Personal | null) => (p ? `${p.nombre} ${p.apellido}`.trim() : '—');
const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Último día del período que cubre un plan de `meses` meses a partir de `desde`. */
function finDePlan(desde: string, meses: number): string {
  const [y, m, d] = desde.split('-').map(Number);
  const f = new Date(Date.UTC(y, m - 1 + meses, d));
  return sumarDias(f.toISOString().slice(0, 10), -1);
}

export function DescansosTab({ empresa, canWrite, actor, actorName }: {
  empresa: Empresa; canWrite: boolean; actor: string; actorName: string | null;
}) {
  const hoy = useMemo(hoyVE, []);
  const [cursor, setCursor] = useState(() => ({ y: Number(hoy.slice(0, 4)), m: Number(hoy.slice(5, 7)) - 1 }));
  const [personal, setPersonal] = useState<Personal[]>([]);
  const [grupos, setGrupos] = useState<GrupoDescanso[]>([]);
  const [depto, setDepto] = useState('');
  const [soloConDescansos, setSoloConDescansos] = useState(false);
  const [descansos, setDescansos] = useState<Descanso[]>([]);
  const [cfg, setCfg] = useState<ConfigDescansos>(CONFIG_POR_DEFECTO);
  const [loading, setLoading] = useState(true);
  const [texto, setTexto] = useState('');
  const [editar, setEditar] = useState<{ descanso?: Descanso; personalId?: string; desde?: string } | null>(null);
  const [ajustes, setAjustes] = useState(false);
  const [plan, setPlan] = useState(false);
  const [lista, setLista] = useState<'fuera' | 'proximos' | null>(null);

  const recargar = useCallback(async () => {
    try {
      // TODO el personal activo (30-09-2026). Antes era solo cocina; ahora quién
      // sale se elige a mano en el plan y se puede guardar la selección.
      const ps = (await listPersonal(true, empresa)).sort((a, b) => nombre(a).localeCompare(nombre(b)));
      const [ds, c, gs] = await Promise.all([
        listDescansos(ps.map((p) => p.id)),
        getConfigDescansos(empresa).catch(() => CONFIG_POR_DEFECTO),
        listGruposDescanso(empresa).catch(() => [] as GrupoDescanso[]),
      ]);
      setPersonal(ps); setDescansos(ds); setCfg(c); setGrupos(gs);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudieron cargar los descansos', 'error'); }
    finally { setLoading(false); }
  }, [empresa]);
  useEffect(() => { void recargar(); }, [recargar]);
  useRealtime(['rrhh_descansos', 'rrhh_descansos_config', 'rrhh_descansos_grupos', 'personal'], () => { void recargar(); });

  /** Quienes están en la rotación: tienen algún descanso de hoy en adelante. */
  const enRotacion = useMemo(() => new Set(descansos.filter((d) => d.hasta >= hoy).map((d) => d.personal_id)), [descansos, hoy]);
  const conDescansos = useMemo(() => new Set(descansos.map((d) => d.personal_id)), [descansos]);
  const departamentos = useMemo(
    () => [...new Set(personal.map((p) => (p.departamento ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')),
    [personal],
  );

  const persById = useMemo(() => new Map(personal.map((p) => [p.id, p])), [personal]);

  // Mes visible.
  const D = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const mesIni = iso(cursor.y, cursor.m, 1);
  const mesFin = iso(cursor.y, cursor.m, D);
  const dias = useMemo(() => fechasEntre(mesIni, mesFin), [mesIni, mesFin]);
  const carga = useMemo(() => cargaPorDia(descansos, mesIni, mesFin), [descansos, mesIni, mesFin]);
  const choquesMes = useMemo(() => diasConChoque(carga, cfg.max_simultaneos), [carga, cfg.max_simultaneos]);

  const fueraHoy = useMemo(() => fueraEl(descansos, hoy), [descansos, hoy]);
  const proximos = useMemo(() => {
    const fin = sumarDias(hoy, 7);
    return descansos.filter((d) => d.desde > hoy && d.desde <= fin).sort((a, b) => a.desde.localeCompare(b.desde));
  }, [descansos, hoy]);

  const filas = useMemo(() => {
    const t = normal(texto.trim());
    return personal.filter((p) =>
      (!depto || (p.departamento ?? '').trim() === depto)
      && (!soloConDescansos || conDescansos.has(p.id))
      && (!t || normal(`${nombre(p)} ${p.cedula ?? ''} ${p.cargo ?? ''} ${p.departamento ?? ''} ${p.numero_ficha ?? ''}`).includes(t)));
  }, [personal, texto, depto, soloConDescansos, conDescansos]);

  function mover(delta: number) {
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  // El mínimo fuera a la vez se mide sobre quienes rotan, no sobre toda la nómina:
  // con todo el personal a la vista, contar a todos avisaría siempre.
  const minimo = minimoSimultaneo(enRotacion.size, cfg);

  return (
    <div className="descansos">
      <div className="kpi-grid" style={{ marginBottom: '1rem' }}>
        <button type="button" className={`kpi desc-kpi${fueraHoy.length > cfg.max_simultaneos ? ' alerta' : ''}`} onClick={() => setLista('fuera')}>
          <div className="label">Fuera hoy</div>
          <div className="value">{fueraHoy.length}<small> / {cfg.max_simultaneos}</small></div>
          <div className="muted" style={{ fontSize: '.78rem' }}>Tope de personas de descanso a la vez</div>
          <div className="icon" aria-hidden="true">🏠</div>
        </button>
        <div className="kpi">
          <div className="label">Trabajando hoy</div>
          <div className="value">{Math.max(0, personal.length - fueraHoy.length)}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>de {personal.length} activos en la nómina</div>
          <div className="icon" aria-hidden="true">⛏</div>
        </div>
        <button type="button" className="kpi desc-kpi" onClick={() => setLista('proximos')}>
          <div className="label">Salen en 7 días</div>
          <div className="value">{proximos.length}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>Descansos que empiezan esta semana</div>
          <div className="icon" aria-hidden="true">📅</div>
        </button>
        <div className={`kpi${choquesMes.length ? ' desc-kpi alerta' : ''}`}>
          <div className="label">Días sobre el tope</div>
          <div className="value">{choquesMes.length}</div>
          <div className="muted" style={{ fontSize: '.78rem' }}>en {MESES[cursor.m].toLowerCase()} de {cursor.y}</div>
          <div className="icon" aria-hidden="true">⚠</div>
        </div>
      </div>

      <div className="desc-barra">
        <div className="desc-mes">
          <button className="btn btn-sm btn-ghost" onClick={() => mover(-1)} aria-label="Mes anterior">←</button>
          <strong>{MESES[cursor.m]} {cursor.y}</strong>
          <button className="btn btn-sm btn-ghost" onClick={() => mover(1)} aria-label="Mes siguiente">→</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setCursor({ y: Number(hoy.slice(0, 4)), m: Number(hoy.slice(5, 7)) - 1 })}>Hoy</button>
        </div>
        <input id="desc-buscar" className="input desc-buscar" placeholder="🔍 Buscar por nombre, cédula, cargo, departamento…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        {departamentos.length > 1 && (
          <select className="select" style={{ width: 'auto' }} value={depto} onChange={(e) => setDepto(e.target.value)} aria-label="Departamento">
            <option value="">Todos los departamentos</option>
            {departamentos.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <label style={{ display: 'flex', gap: '.35rem', alignItems: 'center', fontSize: '.82rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={soloConDescansos} onChange={(e) => setSoloConDescansos(e.target.checked)} />
          Solo con descansos
        </label>
        <div className="desc-acciones">
          <span className="chip" title="Días de trabajo × días de descanso · tope a la vez">{cfg.dias_trabajo}×{cfg.dias_descanso} · tope {cfg.max_simultaneos}</span>
          <span className="chip" title="Todo el personal activo; en la rotación están quienes tienen descansos de hoy en adelante">
            👥 {personal.length} activos · {enRotacion.size} en rotación
          </span>
          {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setAjustes(true)}>⚙ Ajustes</button>}
          {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setPlan(true)} disabled={!personal.length}>🗓 Generar plan</button>}
          {canWrite && <button className="btn btn-sm btn-primary" onClick={() => setEditar({})} disabled={!personal.length}>+ Descanso</button>}
        </div>
      </div>

      {minimo > cfg.max_simultaneos && (
        <div className="aviso warning" style={{ marginBottom: '.6rem' }}>
          <span className="aviso-icono">⚠</span>
          <div>Con <strong>{enRotacion.size}</strong> trabajadores en {cfg.dias_trabajo}×{cfg.dias_descanso}, lo mínimo que puede haber fuera a la vez es <strong>{minimo}</strong>: el tope de {cfg.max_simultaneos} alcanza para {capacidadRotacion(cfg)} personas. Subí el tope en ⚙ Ajustes o aceptá esos días en rojo.</div>
        </div>
      )}

      {loading ? <div className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Cargando…</div>
        : !personal.length ? (
          <EmptyState icon="👥" message="Todavía no hay personal activo cargado." />
        )
        : !filas.length ? (
          <EmptyState icon="🔍" message="Nadie coincide con el filtro." />
        )
        : (
          <div className="card desc-scroll">
            <div className="desc-grid" style={{ gridTemplateColumns: `minmax(150px, 190px) repeat(${D}, minmax(28px, 1fr))`, minWidth: 170 + D * 28 }}>
              <div className="desc-nombre desc-cab">Trabajador</div>
              {dias.map((f) => {
                const dia = new Date(`${f}T12:00:00`).getDay();
                return (
                  <div key={f} className={`desc-cab desc-dia${f === hoy ? ' hoy' : ''}${dia === 0 ? ' domingo' : ''}${(carga.get(f) ?? 0) > cfg.max_simultaneos ? ' choque' : ''}`}>
                    <small>{DIA_SEM[dia]}</small>{Number(f.slice(8))}
                  </div>
                );
              })}

              {filas.map((p, i) => {
                const row = i + 2;
                const suyos = descansos.filter((d) => d.personal_id === p.id && seCruzan(d, { desde: mesIni, hasta: mesFin }));
                const fuera = fueraHoy.includes(p.id);
                return (
                  <FilaPersona key={p.id} row={row} persona={p} dias={dias} hoy={hoy} fuera={fuera} descansos={suyos}
                    mesIni={mesIni} mesFin={mesFin} canWrite={canWrite}
                    onDia={(f) => setEditar({ personalId: p.id, desde: f })}
                    onDescanso={(d) => setEditar({ descanso: d })} />
                );
              })}

              <div className="desc-nombre desc-pie" style={{ gridRow: filas.length + 2 }}>Fuera por día</div>
              {dias.map((f, i) => {
                const n = carga.get(f) ?? 0;
                return (
                  <div key={`t${f}`} style={{ gridColumn: i + 2, gridRow: filas.length + 2 }}
                    className={`desc-pie desc-total${n > cfg.max_simultaneos ? ' choque' : n === cfg.max_simultaneos ? ' lleno' : ''}`}
                    title={`${fmtDate(f)}: ${n} fuera (tope ${cfg.max_simultaneos})`}>{n}</div>
                );
              })}
            </div>
          </div>
        )}

      <div className="desc-leyenda muted">
        <span><i className="desc-muestra plan" /> Del plan</span>
        <span><i className="desc-muestra manual" /> Cargado a mano</span>
        <span><i className="desc-muestra choque" /> Día sobre el tope</span>
        {canWrite && <span>Tocá un día vacío para cargar un descanso, o una barra para cambiarla.</span>}
      </div>

      {editar && (
        <DescansoModal inicial={editar} personal={personal} descansos={descansos} cfg={cfg} canWrite={canWrite}
          actor={actor} actorName={actorName} onClose={() => setEditar(null)}
          onSaved={async () => { setEditar(null); await recargar(); }} />
      )}
      {ajustes && (
        <AjustesModal empresa={empresa} cfg={cfg} personas={enRotacion.size} actor={actor}
          onClose={() => setAjustes(false)} onSaved={async () => { setAjustes(false); await recargar(); }} />
      )}
      {plan && (
        <GenerarPlanModal empresa={empresa} personal={personal} descansos={descansos} cfg={cfg} hoy={hoy} actor={actor} actorName={actorName}
          grupos={grupos} departamentos={departamentos} enRotacion={enRotacion}
          onClose={() => setPlan(false)} onSaved={async () => { setPlan(false); await recargar(); }} />
      )}
      {lista && (
        <Modal title={lista === 'fuera' ? `🏠 Fuera hoy (${fueraHoy.length} / ${cfg.max_simultaneos})` : `📅 Salen en los próximos 7 días (${proximos.length})`}
          size="md" onClose={() => setLista(null)} footer={<button className="btn btn-primary" onClick={() => setLista(null)}>Cerrar</button>}>
          {(lista === 'fuera'
            ? descansos.filter((d) => d.desde <= hoy && hoy <= d.hasta)
            : proximos
          ).map((d) => (
            <button key={d.id} type="button" className="desc-item" onClick={() => { setLista(null); setEditar({ descanso: d }); }}>
              <strong>{nombre(persById.get(d.personal_id))}</strong>
              <span className="muted">{persById.get(d.personal_id)?.cargo || ''}</span>
              <span className="mono">{fmtDate(d.desde)} → {fmtDate(d.hasta)} · vuelve {fmtDate(sumarDias(d.hasta, 1))}</span>
            </button>
          ))}
          {!(lista === 'fuera' ? fueraHoy.length : proximos.length) && <EmptyState icon="✅" message={lista === 'fuera' ? 'Nadie está de descanso hoy.' : 'Nadie sale esta semana.'} />}
        </Modal>
      )}
    </div>
  );
}

function FilaPersona({ row, persona, dias, hoy, fuera, descansos, mesIni, mesFin, canWrite, onDia, onDescanso }: {
  row: number; persona: Personal; dias: string[]; hoy: string; fuera: boolean; descansos: Descanso[];
  mesIni: string; mesFin: string; canWrite: boolean; onDia: (f: string) => void; onDescanso: (d: Descanso) => void;
}) {
  return (
    <>
      <div className="desc-nombre" style={{ gridRow: row }} title={`${nombre(persona)}${persona.cargo ? ` · ${persona.cargo}` : ''}`}>
        <i className={`desc-estado${fuera ? ' fuera' : ''}`} aria-label={fuera ? 'De descanso hoy' : 'Trabajando hoy'} />
        <span className="desc-nombre-txt">{nombre(persona)}</span>
        {persona.cargo && <small className="muted">{persona.cargo}</small>}
      </div>
      {dias.map((f, i) => (
        canWrite
          ? <button key={f} type="button" className={`desc-celda${f === hoy ? ' hoy' : ''}`} style={{ gridColumn: i + 2, gridRow: row }}
              onClick={() => onDia(f)} aria-label={`Cargar descanso de ${nombre(persona)} desde el ${fmtDate(f)}`} />
          : <div key={f} className={`desc-celda${f === hoy ? ' hoy' : ''}`} style={{ gridColumn: i + 2, gridRow: row }} />
      ))}
      {descansos.map((d) => {
        const ini = d.desde < mesIni ? mesIni : d.desde;
        const fin = d.hasta > mesFin ? mesFin : d.hasta;
        const c0 = Number(ini.slice(8)) + 1;
        const c1 = Number(fin.slice(8)) + 2;
        return (
          <button key={d.id} type="button" className={`desc-bar ${d.origen}`} style={{ gridColumn: `${c0} / ${c1}`, gridRow: row }}
            onClick={() => onDescanso(d)} title={`${fmtDate(d.desde)} → ${fmtDate(d.hasta)} (${diasDe(d)} días)${d.nota ? ` · ${d.nota}` : ''}`}>
            {diasDe(d)}d{d.nota ? ` · ${d.nota}` : ''}
          </button>
        );
      })}
    </>
  );
}

/* ───────── Nuevo / editar descanso ───────── */
function DescansoModal({ inicial, personal, descansos, cfg, canWrite, actor, actorName, onClose, onSaved }: {
  inicial: { descanso?: Descanso; personalId?: string; desde?: string };
  personal: Personal[]; descansos: Descanso[]; cfg: ConfigDescansos; canWrite: boolean;
  actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const d0 = inicial.descanso;
  const [personaId, setPersonaId] = useState(d0?.personal_id ?? inicial.personalId ?? '');
  const [desde, setDesde] = useState(d0?.desde ?? inicial.desde ?? hoyVE());
  const [hasta, setHasta] = useState(d0?.hasta ?? sumarDias(inicial.desde ?? hoyVE(), cfg.dias_descanso - 1));
  const [nota, setNota] = useState(d0?.nota ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aceptoChoque, setAceptoChoque] = useState(false);
  const [borrar, setBorrar] = useState(false);
  const persona = personal.find((p) => p.id === personaId) ?? null;

  const otros = descansos.filter((d) => d.id !== d0?.id);
  const valido = !!personaId && !!desde && !!hasta && hasta >= desde;
  const propio = valido ? otros.find((d) => d.personal_id === personaId && seCruzan(d, { desde, hasta })) : undefined;
  const choques = useMemo(() => {
    if (!valido) return [];
    const c = cargaPorDia([...otros, { personal_id: personaId, desde, hasta }], desde, hasta);
    return diasConChoque(c, cfg.max_simultaneos);
  }, [valido, otros, personaId, desde, hasta, cfg.max_simultaneos]);
  const regreso = valido ? sumarDias(hasta, 1) : null;

  function cambiarDesde(v: string) {
    // Si la duración era la de siempre, se corre el fin junto con el inicio.
    if (desde && hasta && diasDe({ desde, hasta }) === cfg.dias_descanso && v) setHasta(sumarDias(v, cfg.dias_descanso - 1));
    setDesde(v);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!persona) { setError('Elegí el trabajador.'); return; }
    if (!valido) { setError('La fecha «hasta» tiene que ser igual o posterior a «desde».'); return; }
    if (propio) { setError(`Ya tiene un descanso del ${fmtDate(propio.desde)} al ${fmtDate(propio.hasta)} que se cruza.`); return; }
    if (choques.length && !aceptoChoque) { setError('Esos días se pasa el tope. Marcá «Guardar igual» si es a propósito, o cambiá las fechas.'); return; }
    setSaving(true);
    try {
      if (d0) await editarDescanso(d0.id, { desde, hasta, nota });
      else await crearDescanso({ personal_id: persona.id, desde, hasta, nota }, actor, actorName);
      toast(d0 ? 'Descanso actualizado' : 'Descanso cargado', 'success');
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  async function eliminar() {
    if (!d0) return;
    setBorrar(false); setSaving(true);
    try { await eliminarDescanso(d0.id); toast('Descanso eliminado', 'success'); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudo eliminar'); setSaving(false); }
  }

  return (
    <Modal title={d0 ? '🏠 Descanso' : '🏠 Nuevo descanso'} size="md" onClose={() => !saving && onClose()} footer={
      <>
        {canWrite && d0 && <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setBorrar(true)} disabled={saving}>🗑 Eliminar</button>}
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>{canWrite ? 'Cancelar' : 'Cerrar'}</button>
        {canWrite && <button type="submit" form="desc-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>}
      </>
    }>
      <form id="desc-form" onSubmit={guardar}>
        {error && <div className="aviso danger" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">⛔</span><div>{error}</div></div>}
        <div className="form-grid">
          <div className="form-row" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="desc-persona">Trabajador</label>
            {d0 ? <strong>{nombre(persona)}{persona?.cargo ? ` · ${persona.cargo}` : ''}</strong>
              : <SearchSelect id="desc-persona" value={personaId} onChange={setPersonaId} placeholder="🔍 Buscar trabajador…"
                  options={personal.map((p) => ({ value: p.id, label: `${nombre(p)}${p.cedula ? ` · ${p.cedula}` : ''}${p.cargo ? ` · ${p.cargo}` : ''}` }))} />}
          </div>
          <div className="form-row"><label htmlFor="desc-desde">Sale (desde)</label>
            <input id="desc-desde" className="input" type="date" value={desde} disabled={!canWrite} onChange={(e) => cambiarDesde(e.target.value)} required /></div>
          <div className="form-row"><label htmlFor="desc-hasta">Último día de descanso</label>
            <input id="desc-hasta" className="input" type="date" value={hasta} min={desde || undefined} disabled={!canWrite} onChange={(e) => setHasta(e.target.value)} required /></div>
          <div className="form-row" style={{ gridColumn: '1 / -1' }}><label htmlFor="desc-nota">Nota (opcional)</label>
            <input id="desc-nota" className="input" value={nota} disabled={!canWrite} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: cambio con otro trabajador, permiso médico…" /></div>
        </div>
        {valido && (
          <div className="muted" style={{ marginTop: '.4rem', fontSize: '.85rem' }}>
            {diasDe({ desde, hasta })} día(s) de descanso · vuelve a trabajar el <strong>{fmtDate(regreso)}</strong>
            {d0 && <> · {d0.origen === 'plan' ? 'generado por el plan' : 'cargado a mano'}{d0.actor_name ? ` por ${d0.actor_name}` : ''}</>}
          </div>
        )}
        {propio && (
          <div className="aviso danger sm" style={{ marginTop: '.5rem' }}><span className="aviso-icono">⛔</span>
            <div>Se cruza con otro descanso de la misma persona ({fmtDate(propio.desde)} → {fmtDate(propio.hasta)}).</div></div>
        )}
        {!!choques.length && (
          <div className="aviso warning sm" style={{ marginTop: '.5rem' }}><span className="aviso-icono">⚠</span>
            <div>
              Con este descanso quedan <strong>más de {cfg.max_simultaneos}</strong> personas fuera {choques.length === 1 ? 'el' : 'los días'} {choques.slice(0, 6).map((f) => fmtDate(f)).join(', ')}{choques.length > 6 ? '…' : ''}.
              {canWrite && (
                <label style={{ display: 'flex', gap: '.4rem', alignItems: 'center', marginTop: '.35rem' }}>
                  <input type="checkbox" checked={aceptoChoque} onChange={(e) => setAceptoChoque(e.target.checked)} /> Guardar igual
                </label>
              )}
            </div>
          </div>
        )}
        {d0?.origen === 'plan' && canWrite && (
          <p className="muted" style={{ fontSize: '.78rem', marginTop: '.5rem' }}>Si lo cambiás queda como «cargado a mano» y el generador de plan ya no lo mueve.</p>
        )}
      </form>
      {borrar && d0 && (
        <ConfirmDialog title="Eliminar descanso" danger confirmText="Sí, borrar"
          message={`Se borra el descanso de ${nombre(persona)} del ${fmtDate(d0.desde)} al ${fmtDate(d0.hasta)}.`}
          onConfirm={() => { void eliminar(); }} onCancel={() => setBorrar(false)} />
      )}
    </Modal>
  );
}

/* ───────── Ajustes de la rotación ───────── */
function AjustesModal({ empresa, cfg, personas, actor, onClose, onSaved }: {
  empresa: Empresa; cfg: ConfigDescansos; personas: number; actor: string; onClose: () => void; onSaved: () => void;
}) {
  const [v, setV] = useState({ ...cfg });
  const [saving, setSaving] = useState(false);
  const ok = v.dias_trabajo >= 1 && v.dias_descanso >= 1 && v.max_simultaneos >= 1;
  const minimo = minimoSimultaneo(personas, v);
  const campo = (k: keyof ConfigDescansos, label: string, max: number) => (
    <div className="form-row">
      <label htmlFor={`desc-cfg-${k}`}>{label}</label>
      <input id={`desc-cfg-${k}`} className="input" type="number" min={1} max={max} step={1} value={v[k] || ''}
        onChange={(e) => setV((x) => ({ ...x, [k]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} />
    </div>
  );
  async function guardar() {
    setSaving(true);
    try { await guardarConfigDescansos(empresa, v, actor); toast('Ajustes guardados', 'success'); onSaved(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar', 'error'); setSaving(false); }
  }
  return (
    <Modal title={`⚙ Ajustes de descansos · ${empresa}`} size="md" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={saving || !ok}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </>
    }>
      <div className="form-grid">
        {campo('dias_trabajo', 'Días de trabajo', 120)}
        {campo('dias_descanso', 'Días de descanso', 60)}
        {campo('max_simultaneos', 'Máximo fuera a la vez', 500)}
      </div>
      {ok && (
        <p className="muted" style={{ fontSize: '.84rem', marginTop: '.5rem' }}>
          Ciclo de {v.dias_trabajo + v.dias_descanso} días. Con tope {v.max_simultaneos} entran hasta <strong>{capacidadRotacion(v)}</strong> personas sin pasarse;
          hoy hay {personas} activas (mínimo {minimo} fuera a la vez).
        </p>
      )}
    </Modal>
  );
}

/* ───────── Generar plan ───────── */
function GenerarPlanModal({ empresa, personal, descansos, cfg, hoy, actor, actorName, grupos, departamentos, enRotacion, onClose, onSaved }: {
  empresa: Empresa; personal: Personal[]; descansos: Descanso[]; cfg: ConfigDescansos; hoy: string;
  actor: string; actorName: string | null;
  grupos: GrupoDescanso[]; departamentos: string[]; enRotacion: Set<string>;
  onClose: () => void; onSaved: () => void;
}) {
  const [desde, setDesde] = useState(hoy);
  const [meses, setMeses] = useState(3);
  // Arranca con quienes ya rotan: el próximo plan suele ser de la misma gente.
  // Con todo el personal a la vista, marcar a todos de entrada mandaba de
  // descanso a la nómina entera con un clic.
  const idsActivos = useMemo(() => new Set(personal.map((p) => p.id)), [personal]);
  const [sel, setSel] = useState<Set<string>>(() => new Set([...enRotacion].filter((id) => idsActivos.has(id))));
  const [texto, setTexto] = useState('');
  const [depto, setDepto] = useState('');
  const [saving, setSaving] = useState(false);
  const [grupoId, setGrupoId] = useState('');
  const [nombreGrupo, setNombreGrupo] = useState('');
  const [guardandoGrupo, setGuardandoGrupo] = useState(false);
  const [borrarGrupo, setBorrarGrupo] = useState<GrupoDescanso | null>(null);
  const hasta = desde ? finDePlan(desde, Math.max(1, meses)) : '';

  const visibles = personal.filter((p) =>
    (!depto || (p.departamento ?? '').trim() === depto)
    && (!texto.trim() || normal(`${nombre(p)} ${p.cargo ?? ''} ${p.cedula ?? ''} ${p.departamento ?? ''}`).includes(normal(texto.trim()))));

  function cargarGrupo(id: string) {
    setGrupoId(id);
    const g = grupos.find((x) => x.id === id);
    if (!g) return;
    // Solo quienes siguen activos: una ficha dada de baja no puede salir de descanso.
    const vigentes = g.personal_ids.filter((pid) => idsActivos.has(pid));
    setSel(new Set(vigentes));
    setNombreGrupo(g.nombre);
    const bajas = g.personal_ids.length - vigentes.length;
    toast(`Selección «${g.nombre}» cargada: ${vigentes.length} persona(s)${bajas ? ` · ${bajas} ya no están activas` : ''}`, 'success');
  }

  async function guardarGrupo() {
    setGuardandoGrupo(true);
    try {
      await guardarGrupoDescanso(empresa, nombreGrupo, [...sel], actor, actorName);
      toast(`Selección «${nombreGrupo.trim()}» guardada (${sel.size})`, 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo guardar la selección', 'error'); }
    finally { setGuardandoGrupo(false); }
  }

  async function confirmarBorrarGrupo() {
    const g = borrarGrupo; setBorrarGrupo(null);
    if (!g) return;
    try {
      await eliminarGrupoDescanso(g.id);
      if (grupoId === g.id) setGrupoId('');
      toast(`Selección «${g.nombre}» eliminada`, 'success');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  const propuesta: ResultadoPlan | null = useMemo(() => {
    if (!desde || !hasta || !sel.size) return null;
    const ids = [...sel];
    // Se reemplazan los descansos del PLAN de los elegidos desde la fecha; el resto queda fijo.
    const fijos: DescansoRango[] = descansos.filter((d) => !(sel.has(d.personal_id) && d.origen === 'plan' && d.desde >= desde));
    const personas = ids.map((id) => {
      const previos = descansos.filter((d) => d.personal_id === id && d.desde < desde);
      const ultimoHasta = previos.reduce<string | null>((m, d) => (!m || d.hasta > m ? d.hasta : m), null);
      return { personal_id: id, ultimoHasta };
    });
    return generarPlan({ personas, desde, hasta, cfg, fijos });
  }, [desde, hasta, sel, descansos, cfg]);

  const reemplaza = descansos.filter((d) => sel.has(d.personal_id) && d.origen === 'plan' && d.desde >= desde).length;
  const aMano = descansos.filter((d) => sel.has(d.personal_id) && d.origen === 'manual' && d.hasta >= desde).length;

  async function aplicar() {
    if (!propuesta) return;
    setSaving(true);
    try {
      const n = await aplicarPlanDescansos([...sel], desde, propuesta.descansos, actor, actorName);
      toast(`Plan aplicado: ${n} descansos`, 'success');
      onSaved();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo aplicar el plan', 'error'); setSaving(false); }
  }

  const alternar = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Modal title="🗓 Generar plan de descansos" size="lg" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => void aplicar()} disabled={saving || !propuesta?.descansos.length}>
          {saving ? 'Aplicando…' : `Aplicar plan (${propuesta?.descansos.length ?? 0} descansos)`}
        </button>
      </>
    }>
      <div className="form-grid">
        <div className="form-row"><label htmlFor="plan-desde">Desde</label>
          <input id="plan-desde" className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="form-row"><label htmlFor="plan-meses">Meses a planificar</label>
          <select id="plan-meses" className="select" value={meses} onChange={(e) => setMeses(Number(e.target.value))}>
            {[1, 2, 3, 4, 6, 9, 12].map((m) => <option key={m} value={m}>{m} {m === 1 ? 'mes' : 'meses'}</option>)}
          </select></div>
      </div>
      <p className="muted" style={{ fontSize: '.84rem', margin: '.5rem 0' }}>
        Del <strong>{fmtDate(desde)}</strong> al <strong>{fmtDate(hasta)}</strong>, {cfg.dias_trabajo}×{cfg.dias_descanso} con tope {cfg.max_simultaneos}.
        Cada uno sigue su ritmo (último descanso + {cfg.dias_trabajo} días) cuando entra en el tope; si no, se corre al hueco más libre.
        Se reemplazan los descansos <strong>del plan</strong> de los elegidos desde esa fecha ({reemplaza}); los <strong>cargados a mano</strong> ({aMano}) se respetan.
      </p>

      {propuesta && (
        <div className={`aviso ${propuesta.choques.length ? 'warning' : 'success'} sm`} style={{ marginBottom: '.6rem' }}>
          <span className="aviso-icono">{propuesta.choques.length ? '⚠' : '✅'}</span>
          <div>
            {propuesta.descansos.length} descansos para {sel.size} trabajadores · pico de <strong>{propuesta.pico}</strong> fuera a la vez.
            {propuesta.choques.length
              ? <> Igual se pasa el tope {propuesta.choques.length} día(s) (desde el {fmtDate(propuesta.choques[0])}): con {sel.size} personas el mínimo es {minimoSimultaneo(sel.size, cfg)}.</>
              : <> Nunca se pasa el tope.</>}
          </div>
        </div>
      )}

      <div className="desc-plan-personas">
        {/* Quiénes salen: se eligen a mano y la elección se guarda para el próximo descanso. */}
        <div className="card" style={{ margin: '0 0 .6rem', padding: '.55rem .7rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: '.84rem' }}>👥 Selección guardada</span>
          <select className="select" style={{ width: 'auto', minWidth: 180 }} value={grupoId} onChange={(e) => cargarGrupo(e.target.value)}
            aria-label="Cargar selección guardada">
            <option value="">{grupos.length ? '— cargar una selección —' : 'Todavía no hay selecciones guardadas'}</option>
            {grupos.map((g) => <option key={g.id} value={g.id}>{g.nombre} ({g.personal_ids.length})</option>)}
          </select>
          {grupoId && (
            <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }}
              onClick={() => setBorrarGrupo(grupos.find((g) => g.id === grupoId) ?? null)} title="Eliminar esta selección guardada">🗑</button>
          )}
          <span style={{ flex: '1 1 auto' }} />
          <input className="input" style={{ width: 200 }} placeholder="Nombre (ej.: Cocina, Turno A)" value={nombreGrupo}
            onChange={(e) => setNombreGrupo(e.target.value)} aria-label="Nombre de la selección" />
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void guardarGrupo()}
            disabled={guardandoGrupo || !sel.size || !nombreGrupo.trim()}
            title={grupos.some((g) => g.nombre === nombreGrupo.trim()) ? 'Ya existe con ese nombre: se reemplaza' : 'Guardar para el próximo descanso'}>
            {guardandoGrupo ? 'Guardando…' : `💾 Guardar selección (${sel.size})`}
          </button>
        </div>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.4rem' }}>
          <input id="plan-buscar" className="input" style={{ flex: '1 1 200px' }} placeholder="🔍 Buscar trabajador…" value={texto} onChange={(e) => setTexto(e.target.value)} />
          {departamentos.length > 1 && (
            <select className="select" style={{ width: 'auto' }} value={depto} onChange={(e) => setDepto(e.target.value)} aria-label="Departamento">
              <option value="">Todos los departamentos</option>
              {departamentos.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {/* «Marcar/Desmarcar» actúan sobre lo que se ve: con un departamento
              filtrado, se marca ese departamento entero de un toque. */}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSel((s) => new Set([...s, ...visibles.map((p) => p.id)]))}>
            Marcar {visibles.length === personal.length ? 'todos' : `los ${visibles.length} visibles`}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => {
            const fuera = new Set(visibles.map((p) => p.id));
            setSel((s) => new Set([...s].filter((id) => !fuera.has(id))));
          }}>Desmarcar {visibles.length === personal.length ? 'todos' : 'visibles'}</button>
          <span className="muted" style={{ fontSize: '.8rem' }}>{sel.size} de {personal.length} salen</span>
        </div>
        <div className="desc-plan-lista">
          {visibles.map((p) => {
            const primero = propuesta?.descansos.find((d) => d.personal_id === p.id);
            return (
              <label key={p.id} className="desc-plan-fila">
                <input type="checkbox" checked={sel.has(p.id)} onChange={() => alternar(p.id)} />
                <span className="desc-nombre-txt">{nombre(p)}</span>
                <small className="muted">{[p.cargo, p.departamento].filter(Boolean).join(' · ')}</small>
                <span className="mono" style={{ marginLeft: 'auto', fontSize: '.78rem' }}>
                  {sel.has(p.id) ? (primero ? `sale ${fmtDate(primero.desde)}` : '—') : ''}
                </span>
              </label>
            );
          })}
        </div>
      </div>
      {borrarGrupo && (
        <ConfirmDialog title="Eliminar selección guardada" danger confirmText="Sí, eliminar"
          message={`Se borra la selección «${borrarGrupo.nombre}» (${borrarGrupo.personal_ids.length} personas). Los descansos ya cargados no se tocan.`}
          onConfirm={() => { void confirmarBorrarGrupo(); }} onCancel={() => setBorrarGrupo(null)} />
      )}
    </Modal>
  );
}
