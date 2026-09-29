/* ============================================================
   MGG · RRHH · Descansos (rotación 21×7 de COCINA)

   Solo aparece acá la gente de cocina: cocinero, chef, ayudante de cocina
   y lo que dependa del comedor. Ellos trabajan 21 días y salen 7. El resto
   del personal no rota y no tiene fila en este calendario —se decide por el
   cargo y el departamento, así una ficha nueva de cocina entra sola (ver
   `esCargoDeCocina` en `descansosPlan.ts`)—.

   Calendario del mes con una fila por trabajador y una barra por descanso.
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
  aplicarPlanDescansos, crearDescanso, editarDescanso, eliminarDescanso, getConfigDescansos,
  guardarConfigDescansos, listDescansos, type Descanso,
} from './descansos.repository';
import {
  CONFIG_POR_DEFECTO, capacidadRotacion, cargaPorDia, diasConChoque, diasDe, fechasEntre, fueraEl,
  generarPlan, minimoSimultaneo, seCruzan, sumarDias, type ConfigDescansos, type DescansoRango, type ResultadoPlan, soloCocina,
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
  /** Cuánta gente activa NO rota, para decirlo y que nadie la busque acá. */
  const [fueraDeRotacion, setFueraDeRotacion] = useState(0);
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
      // SOLO la gente de cocina: el 21×7 es de ellos. El almacenista, el chofer
      // y la analista no rotan, y meterlos acá llenaría el calendario de filas
      // vacías que nadie va a usar. Se decide por cargo/departamento, así una
      // ficha nueva de cocina entra sola (ver `esCargoDeCocina`).
      const todos = await listPersonal(true, empresa);
      const ps = soloCocina(todos).sort((a, b) => nombre(a).localeCompare(nombre(b)));
      setFueraDeRotacion(todos.length - ps.length);
      const [ds, c] = await Promise.all([
        listDescansos(ps.map((p) => p.id)),
        getConfigDescansos(empresa).catch(() => CONFIG_POR_DEFECTO),
      ]);
      setPersonal(ps); setDescansos(ds); setCfg(c);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudieron cargar los descansos', 'error'); }
    finally { setLoading(false); }
  }, [empresa]);
  useEffect(() => { void recargar(); }, [recargar]);
  useRealtime(['rrhh_descansos', 'rrhh_descansos_config', 'personal'], () => { void recargar(); });

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
    return personal.filter((p) => !t || normal(`${nombre(p)} ${p.cedula ?? ''} ${p.cargo ?? ''} ${p.departamento ?? ''} ${p.numero_ficha ?? ''}`).includes(t));
  }, [personal, texto]);

  function mover(delta: number) {
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  }

  const minimo = minimoSimultaneo(personal.length, cfg);

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
        <div className="desc-acciones">
          <span className="chip" title="Días de trabajo × días de descanso · tope a la vez">{cfg.dias_trabajo}×{cfg.dias_descanso} · tope {cfg.max_simultaneos}</span>
          {/* Que se vea por qué la lista es corta: acá solo está la cocina. */}
          <span className="chip" title="La rotación toma a quien diga cocina, chef o comedor en su cargo o departamento">
            🍽 Solo cocina · {personal.length}
            {fueraDeRotacion > 0 && <span className="muted"> · {fueraDeRotacion} no rotan</span>}
          </span>
          {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setAjustes(true)}>⚙ Ajustes</button>}
          {canWrite && <button className="btn btn-sm btn-ghost" onClick={() => setPlan(true)} disabled={!personal.length}>🗓 Generar plan</button>}
          {canWrite && <button className="btn btn-sm btn-primary" onClick={() => setEditar({})} disabled={!personal.length}>+ Descanso</button>}
        </div>
      </div>

      {minimo > cfg.max_simultaneos && (
        <div className="aviso warning" style={{ marginBottom: '.6rem' }}>
          <span className="aviso-icono">⚠</span>
          <div>Con <strong>{personal.length}</strong> trabajadores en {cfg.dias_trabajo}×{cfg.dias_descanso}, lo mínimo que puede haber fuera a la vez es <strong>{minimo}</strong>: el tope de {cfg.max_simultaneos} alcanza para {capacidadRotacion(cfg)} personas. Subí el tope en ⚙ Ajustes o aceptá esos días en rojo.</div>
        </div>
      )}

      {loading ? <div className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Cargando…</div>
        : !personal.length ? (
          <EmptyState icon="🍽" message={fueraDeRotacion > 0
            ? `Ninguna de las ${fueraDeRotacion} personas activas tiene un cargo de cocina, así que nadie rota 21×7. La rotación toma a quien diga cocina, chef o comedor en su cargo o departamento.`
            : 'Todavía no hay personal cargado. La rotación 21×7 toma sola a quien tenga un cargo de cocina.'} />
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
        <AjustesModal empresa={empresa} cfg={cfg} personas={personal.length} actor={actor}
          onClose={() => setAjustes(false)} onSaved={async () => { setAjustes(false); await recargar(); }} />
      )}
      {plan && (
        <GenerarPlanModal personal={personal} descansos={descansos} cfg={cfg} hoy={hoy} actor={actor} actorName={actorName}
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
function GenerarPlanModal({ personal, descansos, cfg, hoy, actor, actorName, onClose, onSaved }: {
  personal: Personal[]; descansos: Descanso[]; cfg: ConfigDescansos; hoy: string;
  actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [desde, setDesde] = useState(hoy);
  const [meses, setMeses] = useState(3);
  const [sel, setSel] = useState<Set<string>>(() => new Set(personal.map((p) => p.id)));
  const [texto, setTexto] = useState('');
  const [saving, setSaving] = useState(false);
  const hasta = desde ? finDePlan(desde, Math.max(1, meses)) : '';

  const visibles = personal.filter((p) => !texto.trim() || normal(`${nombre(p)} ${p.cargo ?? ''} ${p.cedula ?? ''}`).includes(normal(texto.trim())));

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
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.4rem' }}>
          <input id="plan-buscar" className="input" style={{ flex: '1 1 200px' }} placeholder="🔍 Buscar trabajador…" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSel(new Set(personal.map((p) => p.id)))}>Todos</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())}>Ninguno</button>
          <span className="muted" style={{ fontSize: '.8rem' }}>{sel.size} de {personal.length}</span>
        </div>
        <div className="desc-plan-lista">
          {visibles.map((p) => {
            const primero = propuesta?.descansos.find((d) => d.personal_id === p.id);
            return (
              <label key={p.id} className="desc-plan-fila">
                <input type="checkbox" checked={sel.has(p.id)} onChange={() => alternar(p.id)} />
                <span className="desc-nombre-txt">{nombre(p)}</span>
                <small className="muted">{p.cargo || ''}</small>
                <span className="mono" style={{ marginLeft: 'auto', fontSize: '.78rem' }}>
                  {sel.has(p.id) ? (primero ? `sale ${fmtDate(primero.desde)}` : '—') : ''}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
