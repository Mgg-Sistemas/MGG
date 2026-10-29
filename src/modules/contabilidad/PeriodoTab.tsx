/* ============================================================
   MGG · Contabilidad · Menús «Período» y «Cerrar Período» (E-03)

   Como Galac (§4): los meses se cierran y se abren UNO POR UNO, en orden
   (se cierra el primero abierto; se abre el último cerrado, con motivo).
   Cerrar un mes muestra antes el diferencial cambiario que va a grabar.
   Un mes cerrado no admite ingresar ni modificar (usuario, 20/10 13:04).
   Cerrar Período: pre-cierre (reabrible, lo que recomienda Galac) o
   cierre definitivo del ejercicio, reabrir el pre-cierre y abrir el
   ejercicio siguiente.
   ============================================================ */

import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog, Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { useSession } from '@/modules/auth/authStore';
import { date, dateTime } from '@/shared/lib/format';
import {
  abrirEjercicioSiguiente, cerrarEjercicio, cerrarMes, listAuxiliares, listCentrosCosto, listCierres, listCuentas,
  listEjercicios, listPeriodos, reabrirEjercicio, reabrirMes, vistaPreviaCierreMes,
} from './contabilidad.repository';
import type { Revaluacion } from './logica/cierres';
import type { ContCierre, ContEjercicio, ContPeriodo } from './tipos';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const nombreMes = (p: ContPeriodo) => (p.numero === 13 ? '13 · Cierre del ejercicio' : `${p.numero} · ${MESES[p.numero - 1]}`);
const fmt = (v: number) => v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ESTADO_EJERCICIO: Record<ContEjercicio['estado'], string> = { abierto: 'Abierto', pre_cierre: 'Pre-cierre', cerrado: 'Cerrado (definitivo)' };

/** El único mes que se puede cerrar ahora (el primero abierto) y el único que se puede abrir (el último cerrado). */
export function mesesAccionables(periodos: ContPeriodo[], ejercicio: ContEjercicio): { cerrable: string | null; abrible: string | null } {
  const meses = periodos.filter((p) => p.ejercicio_id === ejercicio.id && p.numero <= 12).sort((a, b) => a.numero - b.numero);
  if (ejercicio.estado !== 'abierto') return { cerrable: null, abrible: null };
  return {
    cerrable: meses.find((p) => p.estado === 'abierto')?.id ?? null,
    abrible: [...meses].reverse().find((p) => p.estado === 'cerrado')?.id ?? null,
  };
}

function useDatosPeriodo(version: number) {
  const [datos, setDatos] = useState<{ ejercicios: ContEjercicio[]; periodos: ContPeriodo[]; cierres: ContCierre[] } | null>(null);
  const cargar = useCallback(async () => {
    try {
      const [ejercicios, periodos, cierres] = await Promise.all([listEjercicios(), listPeriodos(), listCierres()]);
      setDatos({ ejercicios, periodos, cierres });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron leer los períodos.', 'error');
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar, version]);
  return { datos, cargar };
}

/* ───────────── Período ───────────── */

export function PeriodoTab() {
  const { user } = useSession();
  const actor = user?.email ?? 'sistema';
  const { datos, cargar } = useDatosPeriodo(0);
  const [cerrar, setCerrar] = useState<ContPeriodo | null>(null);
  const [abrir, setAbrir] = useState<ContPeriodo | null>(null);

  if (!datos) return <p className="muted">Cargando…</p>;
  return (
    <>
      {datos.ejercicios.map((ej) => {
        const { cerrable, abrible } = mesesAccionables(datos.periodos, ej);
        return (
          <div key={ej.id} className="card" style={{ marginBottom: '1rem' }}>
            <div className="card-title">Período {ej.nombre} · {date(ej.fecha_inicio)} al {date(ej.fecha_fin)} · {ESTADO_EJERCICIO[ej.estado]}</div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Mes</th><th>Código</th><th>Desde</th><th>Hasta</th><th>Estado</th><th>Cerrado / reabierto</th><th /></tr></thead>
                <tbody>
                  {datos.periodos.filter((p) => p.ejercicio_id === ej.id).map((p) => (
                    <tr key={p.id}>
                      <td>{nombreMes(p)}</td>
                      <td className="mono">{p.codigo}</td>
                      <td>{date(p.fecha_inicio)}</td>
                      <td>{date(p.fecha_fin)}</td>
                      <td><span className={`cont-etq ${p.estado === 'abierto' ? 'mov' : 'descuadrado'}`}>{p.estado === 'abierto' ? 'Abierto' : 'Cerrado'}</span></td>
                      <td className="dim" style={{ fontSize: '.78rem' }}>
                        {p.estado === 'cerrado' && p.cerrado_en && <>Cerrado {dateTime(p.cerrado_en)} · {p.cerrado_por}</>}
                        {p.estado === 'abierto' && p.reabierto_en && <>Reabierto {dateTime(p.reabierto_en)} · {p.reabierto_por} · {p.reabierto_motivo}</>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {p.id === cerrable && <button type="button" className="btn btn-primary btn-sm" onClick={() => setCerrar(p)}>Cerrar Mes</button>}
                        {p.id === abrible && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAbrir(p)}>Abrir Mes</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint muted" style={{ marginTop: '.5rem' }}>
              Los meses se cierran en orden y se abren del último al primero. Con el mes cerrado no se puede ingresar ni modificar.
              El mes 13 solo recibe los asientos de cierre del ejercicio.
            </p>
          </div>
        );
      })}

      {cerrar && <CerrarMesDialogo periodo={cerrar} actor={actor} onCerrar={() => setCerrar(null)} onHecho={() => { setCerrar(null); void cargar(); }} />}
      {abrir && <AbrirMesDialogo periodo={abrir} actor={actor} onCerrar={() => setAbrir(null)} onHecho={() => { setAbrir(null); void cargar(); }} />}
    </>
  );
}

function CerrarMesDialogo({ periodo, actor, onCerrar, onHecho }: { periodo: ContPeriodo; actor: string; onCerrar: () => void; onHecho: () => void }) {
  const [vista, setVista] = useState<{ errores: string[]; revaluacion: Revaluacion | null } | null>(null);
  const [nombres, setNombres] = useState<{ cuentas: Map<string, string>; centros: Map<string, string>; aux: Map<string, string> } | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    Promise.all([vistaPreviaCierreMes(periodo.id), listCuentas(), listCentrosCosto(), listAuxiliares()])
      .then(([v, cuentas, centros, aux]) => {
        setVista(v);
        setNombres({
          cuentas: new Map(cuentas.map((c) => [c.id, `${c.codigo} · ${c.nombre}`])),
          centros: new Map(centros.map((c) => [c.id, c.codigo])),
          aux: new Map(aux.map((a) => [a.id, a.codigo])),
        });
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'No se pudo preparar el cierre.', 'error'));
  }, [periodo.id]);

  async function confirmar() {
    setEnviando(true);
    try {
      const r = await cerrarMes(periodo.id, actor);
      toast(r.revaluacion ? `Mes ${nombreMes(periodo)} cerrado; diferencial cambiario en el ${r.revaluacion.codigo}.` : `Mes ${nombreMes(periodo)} cerrado; sin diferencial cambiario.`, 'success');
      onHecho();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo cerrar el mes.', 'error');
      setEnviando(false);
    }
  }

  const rev = vista?.revaluacion;
  const total = rev ? rev.detalle.reduce((a, x) => a + Math.round(x.ajuste_ves * 100), 0) / 100 : 0;
  const tasaVieja = rev?.detalle.find((x) => x.fecha_tasa !== rev.fecha);
  return (
    <Modal title={`Cerrar el mes ${nombreMes(periodo)} de ${periodo.codigo.slice(0, 4)}`} size="lg" onClose={() => !enviando && onCerrar()}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={enviando}>Salir</button>
        <button type="button" className="btn btn-primary" onClick={() => void confirmar()} disabled={enviando || !vista || vista.errores.length > 0}>{enviando ? 'Cerrando…' : 'Cerrar Mes'}</button>
      </>}>
      {!vista || !nombres ? <p className="muted">Preparando el cierre…</p> : (
        <>
          {vista.errores.length > 0 && <ul className="cont-errores" style={{ marginTop: 0 }}>{vista.errores.map((x) => <li key={x}>{x}</li>)}</ul>}
          <div className="card-title" style={{ marginTop: '.5rem' }}>Ganancia o pérdida cambiaria del mes</div>
          {!rev || rev.detalle.length === 0 ? <EmptyState icon="💱" message="Sin diferencial cambiario: no hay saldos en moneda extranjera que revaluar." /> : (
            <>
              <p className="dim" style={{ fontSize: '.8rem', margin: '.25rem 0 .5rem' }}>
                Se graba un comprobante AJ el {date(rev.fecha)}: por cada cuenta en divisa × centro × auxiliar, ajuste = saldo en moneda × tasa de cierre − saldo en Bs.
                {tasaVieja && <> No hay tasa del {date(rev.fecha)}: se usa la última cargada, del {date(tasaVieja.fecha_tasa)}.</>}
              </p>
              <div className="table-wrap">
                <table className="table cont-tabla-informe">
                  <thead><tr><th>Cuenta</th><th>C.C.</th><th>Auxiliar</th><th className="num">Saldo en moneda</th><th className="num">Tasa de cierre</th><th className="num">Saldo Bs antes</th><th className="num">Ajuste Bs</th></tr></thead>
                  <tbody>
                    {rev.detalle.map((x, i) => (
                      <tr key={i}>
                        <td>{nombres.cuentas.get(x.cuenta_id)}</td>
                        <td>{x.centro_costo_id ? nombres.centros.get(x.centro_costo_id) : ''}</td>
                        <td>{x.auxiliar_id ? nombres.aux.get(x.auxiliar_id) : ''}</td>
                        <td className="num mono">{fmt(x.saldo_moneda)} {x.moneda}</td>
                        <td className="num mono">{x.tasa_cierre.toFixed(6)}</td>
                        <td className="num mono">{fmt(x.saldo_ves_antes)}</td>
                        <td className="num mono">{fmt(x.ajuste_ves)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={6}>Diferencial neto ({total >= 0 ? 'ganancia' : 'pérdida'})</td><td className="num mono">{fmt(total)}</td></tr></tfoot>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function AbrirMesDialogo({ periodo, actor, onCerrar, onHecho }: { periodo: ContPeriodo; actor: string; onCerrar: () => void; onHecho: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  async function confirmar() {
    setEnviando(true);
    try {
      await reabrirMes(periodo.id, motivo, actor);
      toast(`Mes ${nombreMes(periodo)} abierto. Su diferencial cambiario quedó reversado.`, 'success');
      onHecho();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo abrir el mes.', 'error');
      setEnviando(false);
    }
  }
  return (
    <Modal title={`Abrir el mes ${nombreMes(periodo)} de ${periodo.codigo.slice(0, 4)}`} size="sm" onClose={() => !enviando && onCerrar()}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onCerrar} disabled={enviando}>Salir</button>
        <button type="button" className="btn btn-primary" onClick={() => void confirmar()} disabled={enviando || !motivo.trim()}>{enviando ? 'Abriendo…' : 'Abrir Mes'}</button>
      </>}>
      <p style={{ marginTop: 0 }}>El diferencial cambiario del mes se reversa y se vuelve a calcular cuando se cierre de nuevo.</p>
      <label className="cont-form" style={{ display: 'block' }}>
        <span className="dim">Motivo (obligatorio)</span>
        <textarea className="textarea" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
      </label>
    </Modal>
  );
}

/* ───────────── Cerrar Período ───────────── */

type Accion = { kind: 'ninguna' } | { kind: 'cerrar'; tipo: 'pre_cierre' | 'definitivo' } | { kind: 'reabrir' } | { kind: 'siguiente' };

export function CerrarPeriodoTab() {
  const { user } = useSession();
  const actor = user?.email ?? 'sistema';
  const { datos, cargar } = useDatosPeriodo(0);
  const [accion, setAccion] = useState<Accion>({ kind: 'ninguna' });
  const [motivo, setMotivo] = useState('');

  if (!datos) return <p className="muted">Cargando…</p>;
  const ej = datos.ejercicios.find((x) => x.estado !== 'cerrado' || !datos.ejercicios.some((y) => y.fecha_inicio > x.fecha_fin)) ?? datos.ejercicios[0];
  if (!ej) return <EmptyState icon="📅" message="No hay ejercicios." />;
  const meses = datos.periodos.filter((p) => p.ejercicio_id === ej.id && p.numero <= 12);
  const abiertos = meses.filter((p) => p.estado !== 'cerrado');
  const tieneSiguiente = datos.ejercicios.some((x) => x.fecha_inicio > ej.fecha_fin);

  async function ejecutar() {
    try {
      if (accion.kind === 'cerrar') {
        await cerrarEjercicio(ej.id, accion.tipo, actor);
        toast(accion.tipo === 'pre_cierre' ? `Ejercicio ${ej.nombre} en pre-cierre.` : `Ejercicio ${ej.nombre} cerrado en definitivo.`, 'success');
      } else if (accion.kind === 'reabrir') {
        await reabrirEjercicio(ej.id, motivo, actor);
        toast(`Ejercicio ${ej.nombre} reabierto: sus asientos de cierre quedaron reversados.`, 'success');
      } else if (accion.kind === 'siguiente') {
        const n = await abrirEjercicioSiguiente(ej.id, actor);
        toast(`Ejercicio ${n.nombre} abierto, con su comprobante de apertura.`, 'success');
      }
      setAccion({ kind: 'ninguna' });
      setMotivo('');
      void cargar();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo completar la operación.', 'error');
    }
  }

  return (
    <>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-title">Período {ej.nombre} · {ESTADO_EJERCICIO[ej.estado]}</div>
        <p className="muted" style={{ marginTop: 0 }}>
          {abiertos.length
            ? `Para cerrar el período, los 12 meses tienen que estar cerrados: faltan ${abiertos.length} (desde ${abiertos[0].codigo.slice(4)}/${abiertos[0].codigo.slice(0, 4)}).`
            : 'Los 12 meses están cerrados.'}
          {ej.estado === 'pre_cierre' && ' Está en pre-cierre: se puede reabrir o pasar a definitivo.'}
          {ej.estado === 'cerrado' && ' Cierre definitivo: no se reabre.'}
        </p>
        <div className="cont-ficha-acciones">
          {ej.estado === 'abierto' && <button type="button" className="btn btn-primary btn-sm" disabled={abiertos.length > 0} onClick={() => setAccion({ kind: 'cerrar', tipo: 'pre_cierre' })}>Cierre de Período · Pre-Cierre</button>}
          {ej.estado !== 'cerrado' && <button type="button" className="btn btn-danger btn-sm" disabled={abiertos.length > 0} onClick={() => setAccion({ kind: 'cerrar', tipo: 'definitivo' })}>Cierre de Período · Definitivo</button>}
          {ej.estado === 'pre_cierre' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAccion({ kind: 'reabrir' })}>Re-abrir Período</button>}
          {ej.estado !== 'abierto' && !tieneSiguiente && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAccion({ kind: 'siguiente' })}>Abrir siguiente período</button>}
        </div>
        <p className="hint muted" style={{ marginTop: '.75rem' }}>
          El cierre graba en el mes 13 dos comprobantes CI: el que lleva ingresos, costos y gastos a Resultado del Ejercicio y el que
          traslada el resultado a Superávit. Galac recomienda el pre-cierre para poder registrar ajustes después.
        </p>
      </div>

      <div className="card">
        <div className="card-title">Cierres hechos</div>
        {datos.cierres.length === 0 ? <EmptyState icon="🗂" message="Todavía no hay cierres." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Qué</th><th>Tipo</th><th>Estado</th><th>Hecho</th><th>Reabierto</th></tr></thead>
              <tbody>
                {[...datos.cierres].reverse().map((c) => {
                  const p = datos.periodos.find((x) => x.id === c.periodo_id);
                  const e = datos.ejercicios.find((x) => x.id === c.ejercicio_id);
                  return (
                    <tr key={c.id}>
                      <td>{c.tipo === 'mes' ? `Mes ${p ? `${p.codigo.slice(4)}/${p.codigo.slice(0, 4)}` : '—'}` : `Ejercicio ${e?.nombre ?? '—'}`}</td>
                      <td className="muted">{c.tipo === 'mes' ? 'Cierre de mes' : c.tipo_cierre === 'pre_cierre' ? 'Pre-cierre' : 'Definitivo'}</td>
                      <td><span className={`cont-etq ${c.estado === 'vigente' ? 'mov' : ''}`}>{c.estado === 'vigente' ? 'Vigente' : 'Reabierto'}</span></td>
                      <td className="dim" style={{ fontSize: '.78rem' }}>{dateTime(c.hecho_en)} · {c.hecho_por}</td>
                      <td className="dim" style={{ fontSize: '.78rem' }}>{c.reabierto_en ? `${dateTime(c.reabierto_en)} · ${c.reabierto_por} · ${c.reabierto_motivo}` : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {accion.kind === 'cerrar' && (
        <ConfirmDialog
          title={accion.tipo === 'pre_cierre' ? `Pre-cierre del período ${ej.nombre}` : `Cierre definitivo del período ${ej.nombre}`}
          message={accion.tipo === 'pre_cierre'
            ? 'Se graban los dos comprobantes de cierre en el mes 13. El período queda en pre-cierre: se puede reabrir.'
            : ej.estado === 'pre_cierre'
              ? 'El pre-cierre pasa a definitivo, sin repetir los asientos. Un cierre definitivo NO se reabre.'
              : 'Se graban los dos comprobantes de cierre en el mes 13 y el período queda cerrado en definitivo. NO se reabre.'}
          confirmText={accion.tipo === 'pre_cierre' ? 'Pre-cierre' : 'Cierre definitivo'}
          danger={accion.tipo === 'definitivo'}
          requireText={accion.tipo === 'definitivo' ? ej.nombre : undefined}
          requireLabel={accion.tipo === 'definitivo' ? `Escribe ${ej.nombre} para confirmar` : undefined}
          onConfirm={() => void ejecutar()}
          onCancel={() => setAccion({ kind: 'ninguna' })}
        />
      )}
      {accion.kind === 'siguiente' && (
        <ConfirmDialog
          title={`Abrir el período ${Number(ej.nombre) + 1}`}
          message={`Se crean sus 13 meses y un comprobante de apertura el 01/01/${Number(ej.nombre) + 1} con los saldos de balance al ${date(ej.fecha_fin)}.`}
          confirmText="Abrir período"
          onConfirm={() => void ejecutar()}
          onCancel={() => setAccion({ kind: 'ninguna' })}
        />
      )}
      {accion.kind === 'reabrir' && (
        <Modal title={`Re-abrir el período ${ej.nombre}`} size="sm" onClose={() => setAccion({ kind: 'ninguna' })}
          footer={<>
            <button type="button" className="btn btn-ghost" onClick={() => setAccion({ kind: 'ninguna' })}>Salir</button>
            <button type="button" className="btn btn-primary" disabled={!motivo.trim()} onClick={() => void ejecutar()}>Re-abrir</button>
          </>}>
          <p style={{ marginTop: 0 }}>Los dos comprobantes de cierre del mes 13 se reversan y el período vuelve a abierto.</p>
          <label className="cont-form" style={{ display: 'block' }}>
            <span className="dim">Motivo (obligatorio)</span>
            <textarea className="textarea" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
          </label>
        </Modal>
      )}
    </>
  );
}
