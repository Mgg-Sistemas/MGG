/* ============================================================
   MGG · Retenciones v8 · La pestaña Períodos

   Traslado de `#sec-periodos` de la maqueta v8 (l. 1351-1366) con
   `pintarPeriodos` y `v7FilaPeriodo` (v7, l. 5220-5290) y lo de la v8:
   «Requiere atención» plegable con su conteo (v8-6-plegar.js), el impuesto
   sin paso inicial (l. 7778) y quién declaró (l. 7785).
   Contra retencion_periodos_v (paquete 07). Sin la base de Retenciones
   (periodos = null), la pestaña no se muestra en producción y en local sale
   vacía y marcada.
   Sin trasladar todavía: «Descargar TXT» (espera la muestra del TXT del
   IVA) y «Ver retenciones» (lleva a Reportes).
   ============================================================ */

import { useMemo, useState } from 'react';
import { money } from '@/shared/lib/format';
import { nf } from '../listas/paginador';
import type { Declaracion, PasoInicial, PeriodoRetencion } from '../datos/periodos';
import { nombreImpuesto } from '../pantalla/pendientesPorDocumento';
import { fechaVe } from '../pantalla/realizadasYLibro';
import {
  EST_PER, aniosDe, atencionDe, avisosPeriodos, corto, diasEntre, estadoFila, etiquetaPeriodo, nombrePeriodo,
  periodicidadDe, periodosPorAnio, type EstadoFila,
} from './modeloPeriodos';
import { MarcaPaquete21 } from '../comun/MarcaPaquete21';
import { DeclararDialogo, PasoInicialDialogo, ReabrirDialogo } from './PeriodoDialogos';
import './rv8-periodos.css';

const MARCA = 'Requiere la base de Retenciones (paquete 2.1)';
const TAM = 12;
const hoyIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Caracas' });
const ESTADOS: ['' | EstadoFila, string][] = [['', 'Todos'], ['abierto', 'Abiertos'], ['por_declarar', 'Por declarar'], ['vencido', 'Vencidos'], ['declarado', 'Declarados'], ['anterior', 'Otro sistema']];

interface Props {
  /** null = la base de Retenciones todavía no tiene períodos. */
  periodos: PeriodoRetencion[] | null;
  /** La fecha de corte del paso inicial de cada impuesto (null = falta). */
  paso: Record<string, string | null>;
  impuestos: string[];
  /** Marcar declarado y reabrir. Sin ellas, los botones no se muestran. */
  onDeclarar?: (p: PeriodoRetencion, d: Declaracion) => Promise<void>;
  onReabrir?: (p: PeriodoRetencion, motivo: string) => Promise<void>;
  /** Guarda el paso inicial de un impuesto. Sin ella, «Indicar el período en curso» no se puede usar. */
  onPasoInicial?: (k: string, p: PasoInicial) => Promise<void>;
  /** Días del aviso «por vencer» (retenciones.avisos.umbrales). */
  umbral: number;
}

export function Periodos({ periodos, paso, impuestos, onDeclarar, onReabrir, onPasoInicial, umbral }: Props) {
  const hoy = hoyIso();
  const ps = useMemo(() => periodos ?? [], [periodos]);
  const [k, setK] = useState(impuestos[0] ?? 'iva');
  const [est, setEst] = useState<'' | EstadoFila>('');
  const [anio, setAnio] = useState(0);
  const avisos = avisosPeriodos(ps, impuestos, hoy, umbral);
  const [pasoDe, setPasoDe] = useState<string | null>(null);
  const sinPaso = impuestos.filter((x) => !paso[x]).length;
  const [atencionAbierta, setAtencionAbierta] = useState<boolean | null>(null);
  const abierta = atencionAbierta ?? avisos.vencidos > 0;
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set());
  const [pags, setPags] = useState<Record<number, number>>({});
  const [declarar, setDeclarar] = useState<PeriodoRetencion | null>(null);
  const [reabrir, setReabrir] = useState<PeriodoRetencion | null>(null);
  const anios = aniosDe(ps);
  const tabla = useMemo(() => periodosPorAnio(ps, k, hoy, est, anio), [ps, k, hoy, est, anio]);

  const verDe = (x: string, e: '' | EstadoFila) => { setK(x); setEst(e); setAnio(0); };

  return (
    <div className="rv8-periodos">
      <section className="rv8-v7-atencion" aria-labelledby="rv8-per-at-t">
        <h2 id="rv8-per-at-t">
          <button type="button" className="rv8-v8-plegable" aria-expanded={abierta} aria-controls="rv8-per-avisos" onClick={() => setAtencionAbierta(!abierta)}>
            <span>Requiere atención</span> <span className="rv8-v8-plegable-n">· {avisos.vencidos ? `${avisos.vencidos} vencido(s)` : 'nada vencido'}{avisos.pronto ? ` · ${avisos.pronto} por vencer` : ''}{sinPaso ? ` · ${sinPaso} sin paso inicial` : ''}</span>
          </button>
        </h2>
        <div id="rv8-per-avisos" aria-live="polite" hidden={!abierta}>
          {impuestos.length === 0 && <p className="rv8-huella">Sin impuestos activos.</p>}
          {impuestos.map((x) => {
            if (!paso[x]) return (
              <div key={x} className="rv8-v7-at-fila rv8-pendiente"><b>{nombreImpuesto(x)}</b><span>Falta el paso inicial: sin él, {nombreImpuesto(x)} no se usa.</span>
                {onPasoInicial ? <button type="button" className="rv8-mini" onClick={() => setPasoDe(x)}>Indicar período en curso</button>
                  : import.meta.env.DEV ? <button type="button" className="rv8-mini rv8-requiere-base" disabled title={MARCA}>Indicar período en curso</button> : <span />}</div>
            );
            const a = atencionDe(ps, x, hoy);
            const pronto = a.porDeclarar.some((p) => p.vence && diasEntre(hoy, p.vence) <= umbral);
            const cierra = a.abierto ? diasEntre(hoy, a.abierto.hasta) : 0;
            return (
              <div key={x} className={`rv8-v7-at-fila${a.vencidos.length ? ' rv8-vencido' : pronto ? ' rv8-pronto' : ''}`}>
                <b>{nombreImpuesto(x)}</b>
                <span>{a.abierto ? `En curso: ${nombrePeriodo(a.abierto)} · cierra ${cierra === 0 ? 'hoy' : `en ${cierra} días`}` : 'Sin período en curso'}</span>
                <span>{a.porDeclarar.length ? `Por declarar: ${a.porDeclarar.map((p) => `${nombrePeriodo(p)}, vence el ${corto(p.vence)}${p.vence ? ` (en ${diasEntre(hoy, p.vence)} días)` : ''}`).join('; ')}` : 'Nada por declarar'}</span>
                <span>{a.vencidos.length ? <><b className="rv8-venc">Vencidos sin declarar: {a.vencidos.length}</b> · el más antiguo, {nombrePeriodo(a.vencidos[0])}</> : 'Sin vencidos'}</span>
                <button type="button" className="rv8-mini" onClick={() => verDe(x, a.vencidos.length ? 'vencido' : a.porDeclarar.length ? 'por_declarar' : '')}>
                  Ver {a.vencidos.length ? 'vencidos' : a.porDeclarar.length ? 'por declarar' : 'períodos'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <div className="rv8-v7-per-barra">
        <div className="rv8-campo rv8-v7-per-imp-campo"><span id="rv8-l-per-imp">Impuesto</span>
          <div><div className="rv8-chips" role="group" aria-labelledby="rv8-l-per-imp">
            {impuestos.map((x) => <button key={x} type="button" className="rv8-chip" aria-pressed={k === x} onClick={() => setK(x)}>{nombreImpuesto(x)}</button>)}
          </div></div>
        </div>
        <label className="rv8-campo"><span>Estado</span>
          <select className="rv8-select" value={est} onChange={(e) => setEst(e.target.value as '' | EstadoFila)}>
            {ESTADOS.map(([v, t]) => <option key={v || 'todos'} value={v}>{t}</option>)}
          </select>
        </label>
        <label className="rv8-campo"><span>Año fiscal</span>
          <select className="rv8-select" value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            <option value={0}>Todos (por año)</option>
            {anios.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>
      <p className="rv8-nota-igtf">
        {nombreImpuesto(k)}: {periodicidadDe(ps, k).toLowerCase()}. Los vencimientos salen del calendario oficial cargado en la base. Marcar declarado y reabrir (con motivo): administración o escritura.
        {periodos == null && <> <MarcaPaquete21 /></>}
      </p>

      <section className="rv8-per-imp">
        <header><h3>{nombreImpuesto(k)}</h3><span className="rv8-contador">{periodicidadDe(ps, k)}</span></header>
        {!paso[k] && periodos != null ? (
          <div className="rv8-vacio"><p><b>Indique el período en curso de {nombreImpuesto(k)}.</b> Sin él, el impuesto no tiene períodos ni vencimientos.</p>
            {onPasoInicial ? <button type="button" className="btn btn-primary" onClick={() => setPasoDe(k)}>Indicar el período en curso</button>
              : import.meta.env.DEV && <><button type="button" className="btn btn-primary rv8-requiere-base" disabled title={MARCA}>Indicar el período en curso</button> <MarcaPaquete21 /></>}</div>
        ) : !tabla.length ? (
          <div className="rv8-vacio"><p>{periodos == null ? 'Sin períodos: la base de Retenciones todavía no los tiene.' : 'Sin períodos para los filtros aplicados.'}</p></div>
        ) : tabla.map((a) => {
          const pag = pags[a.anio] ?? 1, vis = a.filas.slice((pag - 1) * TAM, pag * TAM), npag = Math.ceil(a.filas.length / TAM);
          const total = a.filas.length + a.anteriores.length;
          return (
            <details key={a.anio} className="rv8-v7-anio" open={!!anio || abiertos.has(a.anio)}
              onToggle={(e) => { const o = (e.target as HTMLDetailsElement).open; setAbiertos((s) => { const n = new Set(s); if (o) n.add(a.anio); else n.delete(a.anio); return n; }); }}>
              <summary><b>{a.anio}</b> · {nf(total)} período(s)
                {a.cuenta.vencido ? <> · <span className="rv8-venc">{a.cuenta.vencido} vencido(s)</span></> : null}
                {a.cuenta.por_declarar ? ` · ${a.cuenta.por_declarar} por declarar` : ''}{a.cuenta.declarado ? ` · ${a.cuenta.declarado} declarado(s)` : ''}</summary>
              <div className="rv8-per-fila rv8-cab"><span>Período</span><span>Fechas</span><span>Vence</span><span>Estado</span><span className="rv8-n">Retenciones</span><span className="rv8-n">Retenido</span><span>Declaración</span><span /></div>
              {vis.map((p) => <FilaPeriodo key={p.id} p={p} hoy={hoy} onDeclarar={onDeclarar && (() => setDeclarar(p))} onReabrir={onReabrir && (() => setReabrir(p))} />)}
              {a.anteriores.length > 0 && (
                <div className="rv8-per-fila rv8-v7-anterior">
                  <span data-l="Período"><b>{a.anteriores.length} período(s)</b></span>
                  <span data-l="Del">{corto(a.anteriores[a.anteriores.length - 1].desde)} al {corto(a.anteriores[0].hasta)}</span><span />
                  <span data-l="Estado"><span className="rv8-estado-per rv8-anterior">Otro sistema</span></span><span /><span />
                  <span data-l="Declaración" style={{ fontSize: '.76rem' }}>Gestionados en el otro sistema</span><span />
                </div>
              )}
              {npag > 1 && (
                <div className="rv8-acciones-per" style={{ padding: '.4rem 1rem' }}>
                  <button type="button" className="rv8-mini" disabled={pag <= 1} onClick={() => setPags((x) => ({ ...x, [a.anio]: pag - 1 }))}>‹ Anterior</button>
                  <span className="rv8-huella">Página {pag} de {npag}</span>
                  <button type="button" className="rv8-mini" disabled={pag >= npag} onClick={() => setPags((x) => ({ ...x, [a.anio]: pag + 1 }))}>Siguiente ›</button>
                </div>
              )}
            </details>
          );
        })}
      </section>

      {declarar && onDeclarar && <DeclararDialogo p={declarar} onCerrar={() => setDeclarar(null)} onGuardar={async (d) => { await onDeclarar(declarar, d); setDeclarar(null); }} />}
      {pasoDe && onPasoInicial && <PasoInicialDialogo k={pasoDe} onCerrar={() => setPasoDe(null)} onGuardar={async (p) => { await onPasoInicial(pasoDe, p); setPasoDe(null); }} />}
      {reabrir && onReabrir && <ReabrirDialogo p={reabrir} onCerrar={() => setReabrir(null)} onGuardar={async (m) => { await onReabrir(reabrir, m); setReabrir(null); }} />}
    </div>
  );
}

/* ───────── Una fila (`v7FilaPeriodo`) ───────── */
function FilaPeriodo({ p, hoy, onDeclarar, onReabrir }: { p: PeriodoRetencion; hoy: string; onDeclarar?: () => void; onReabrir?: () => void }) {
  const e = estadoFila(p);
  const sinops = p.retencionesVigentes === 0;
  const dias = p.vence ? diasEntre(hoy, p.vence) : null;
  const vence = !p.vence ? '—' : e === 'declarado' ? fechaVe(p.vence) : `${fechaVe(p.vence)}${dias! >= 0 ? ` · en ${dias} d` : ` · hace ${-dias!} d`}`;
  const retenido = [p.retenidoBs ? money(p.retenidoBs, 'Bs') : '', p.retenidoUsd ? money(p.retenidoUsd, 'USD') : ''].filter(Boolean).join(' · ');
  return (
    <div className={`rv8-per-fila${sinops ? ' rv8-sinops' : ''}`}>
      <span data-l="Período"><b>{etiquetaPeriodo(p)}</b></span>
      <span data-l="Del">{corto(p.desde)} al {corto(p.hasta)}</span>
      <span data-l="Vence">{vence}</span>
      <span data-l="Estado"><span className={`rv8-estado-per rv8-${e}`}>{EST_PER[e]}</span>{sinops && <span className="rv8-marca-sinops">sin operaciones</span>}</span>
      <span className="rv8-n" data-l="Retenciones">{sinops ? '—' : nf(p.retencionesVigentes)}</span>
      <span className="rv8-n" data-l="Retenido">{retenido || '—'}</span>
      <span data-l="Declaración" style={{ fontSize: '.76rem' }}>
        {p.declaradoEn ? `${fechaVe(p.declaradoEn)}${p.planilla ? ` · Planilla ${p.planilla}` : ''}${p.numeroDeclaracion ? ` · N° ${p.numeroDeclaracion}` : ''}` : '—'}
        {p.declaradoPor && <small className="rv8-v8-quien">por {p.declaradoPor}{p.declaradoRegistradoEn ? ` · ${fechaVe(p.declaradoRegistradoEn)}` : ''}</small>}
        {p.reabiertoMotivo && <small className="rv8-v8-quien">reabierto{p.reabiertoPor ? ` por ${p.reabiertoPor}` : ''}: {p.reabiertoMotivo}</small>}
      </span>
      <span className="rv8-acciones-per">
        {e === 'declarado' && onReabrir && <button type="button" className="rv8-mini" onClick={onReabrir}>Reabrir</button>}
        {(e === 'por_declarar' || e === 'vencido') && onDeclarar && <button type="button" className="rv8-mini rv8-registrar" onClick={onDeclarar}>Marcar declarado</button>}
        {e === 'abierto' && <span className="rv8-huella">Se declara al cerrar</span>}
      </span>
    </div>
  );
}
