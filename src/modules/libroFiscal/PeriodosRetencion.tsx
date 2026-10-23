/* ============================================================
   Golden Touch · Retenciones · Períodos (V3R)
   Los períodos de cada impuesto por año: generar el año, declarar (con el
   candado: un período declarado no admite registrar ni mover retenciones) y
   reabrir con motivo; el vencimiento y quién declara (GT u otro sistema).
   Reemplaza la pestaña estática de Períodos.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { hoyVE } from '@/modules/tesoreria/tasas.repository';
import { listRetenciones, tipoAGt } from './retencionesFiscal.repository';
import { opcionesImpuestoEnte } from './entes.repository';
import {
  cambiarDeclara, cambiarVence, conteoDelPeriodo, declararPeriodo, estadoPeriodo, generarPeriodos, listPeriodos,
  nombrePeriodo, reabrirPeriodo, type Declara, type EstadoPeriodo, type PeriodoFiscal,
} from './periodosRetencion.repository';
import { fechaCorta, labelClave } from './parametrosR1';
import { rotuloAutor, rotuloMotivo } from './rotulos';

const mensaje = (e: unknown, d: string) => (e instanceof Error ? e.message : d);
type Conteo = { tipoGt: string; periodo: string; quincena: 1 | 2 | null; declarada: boolean };

function diasEntre(desdeIso: string, hastaIso: string): number {
  const ms = 86400000;
  const d1 = new Date(desdeIso + 'T00:00:00').getTime();
  const d2 = new Date(hastaIso + 'T00:00:00').getTime();
  return Math.round((d2 - d1) / ms);
}

function textoVencimientoDias(venceIso: string, hoyIso: string): string {
  const d = diasEntre(hoyIso, venceIso);
  if (d === 0) return 'vence hoy';
  if (d === 1) return 'queda 1 día para declarar';
  if (d > 1) return `quedan ${d} días para declarar`;
  if (d === -1) return 'venció ayer';
  return `venció hace ${Math.abs(d)} días`;
}

const ESTADOS: { key: EstadoPeriodo | ''; label: string }[] = [
  { key: '', label: 'Todos' }, { key: 'abierto', label: 'Abiertos' }, { key: 'vencido', label: 'Vencidos' },
  { key: 'declarado', label: 'Declarados' }, { key: 'otro_sistema', label: 'Del otro sistema' },
];
const ROTULO: Record<EstadoPeriodo, { texto: string; color: string }> = {
  declarado: { texto: '🔒 Declarado', color: 'var(--success)' },
  vencido: { texto: 'Vencido sin declarar', color: 'var(--danger)' },
  abierto: { texto: 'Abierto', color: 'var(--text-muted)' },
  otro_sistema: { texto: 'Lo declara el otro sistema', color: 'var(--text-muted)' },
};

export function PeriodosRetencion({ puedeEditar }: { puedeEditar: boolean }) {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [tipo, setTipo] = useState('');
  const [estado, setEstado] = useState<EstadoPeriodo | ''>('');
  const [periodos, setPeriodos] = useState<PeriodoFiscal[] | null>(null);
  const [conteos, setConteos] = useState<Conteo[]>([]);
  const [impuestos, setImpuestos] = useState<{ clave: string; nombre: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [declarar, setDeclarar] = useState<PeriodoFiscal | null>(null);
  const [reabrir, setReabrir] = useState<PeriodoFiscal | null>(null);
  const [quien, setQuien] = useState<PeriodoFiscal | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [ps, rs, imps] = await Promise.all([
        listPeriodos(anio),
        listRetenciones({ direccion: 'practicada' }),
        opcionesImpuestoEnte().catch(() => []),
      ]);
      setPeriodos(ps);
      setConteos(rs.map((r) => ({ tipoGt: tipoAGt(r.tipo), periodo: r.periodo, quincena: r.quincena, declarada: r.estado === 'declarada' })));
      setImpuestos(imps); setError(null);
    } catch (e) { setError(mensaje(e, 'No se pudieron leer los períodos.')); }
  }, [anio]);
  useEffect(() => { setPeriodos(null); void cargar(); }, [cargar]);
  useRealtime(['retencion_periodos', 'retenciones'], () => { void cargar(); });

  const nombre = (c: string) => impuestos.find((i) => i.clave === c)?.nombre ?? labelClave(c);
  const visibles = useMemo(() => (periodos ?? [])
    .filter((p) => !tipo || p.tipo === tipo)
    .filter((p) => !estado || estadoPeriodo(p) === estado), [periodos, tipo, estado]);
  const tiposConPeriodos = useMemo(() => [...new Set((periodos ?? []).map((p) => p.tipo))], [periodos]);

  async function generar() {
    setTrabajando(true);
    try {
      const n = await generarPeriodos(anio);
      toast(n ? `Se generaron ${n} períodos de ${anio}.` : `Los períodos de ${anio} ya estaban todos.`, n ? 'success' : 'info');
      void cargar();
    } catch (e) { toast(mensaje(e, 'No se pudieron generar los períodos.'), 'error'); } finally { setTrabajando(false); }
  }

  async function guardarVence(p: PeriodoFiscal, vence: string) {
    try { await cambiarVence(p.id, vence || null); toast('Vencimiento guardado.', 'success'); void cargar(); } catch (e) { toast(mensaje(e, 'No se pudo guardar.'), 'error'); }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
        <div style={{ display: 'flex', gap: '.2rem', alignItems: 'center' }}>
          <button type="button" className="btn btn-sm btn-ghost" aria-label="Año anterior" onClick={() => setAnio((a) => a - 1)}>‹</button>
          <strong style={{ minWidth: 48, textAlign: 'center' }}>{anio}</strong>
          <button type="button" className="btn btn-sm btn-ghost" aria-label="Año siguiente" onClick={() => setAnio((a) => a + 1)}>›</button>
        </div>
        <select className="select" style={{ maxWidth: 200 }} value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Impuesto">
          <option value="">Todos los impuestos</option>
          {tiposConPeriodos.map((c) => <option key={c} value={c}>{nombre(c)}</option>)}
        </select>
        <div role="group" aria-label="Estado" style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
          {ESTADOS.map((x) => (
            <button key={x.key || 'todos'} type="button" className={`btn btn-sm ${estado === x.key ? 'btn-primary' : ''}`} aria-pressed={estado === x.key} onClick={() => setEstado(x.key)}>{x.label}</button>
          ))}
        </div>
        {puedeEditar && <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => void generar()} disabled={trabajando}>{trabajando ? 'Generando…' : `Generar períodos de ${anio}`}</button>}
      </div>
      <p className="muted" style={{ fontSize: '.8rem', marginTop: 0 }}>
        Declarar cierra el período: sus retenciones pasan a «declarada» y no se puede registrar ni mover una retención en él hasta reabrirlo (con motivo).
      </p>

      {error && <div className="card" style={{ borderColor: 'var(--danger)' }}>{error} <button type="button" className="btn btn-sm btn-ghost" onClick={() => void cargar()}>Reintentar</button></div>}
      {!periodos && !error && <p className="muted">Leyendo los períodos…</p>}
      {periodos && periodos.length === 0 && <p className="muted">No hay períodos de {anio}.{puedeEditar ? ' Usa «Generar períodos».' : ''}</p>}
      {periodos && periodos.length > 0 && visibles.length === 0 && <p className="muted">Ningún período con ese filtro.</p>}


      {/* Un bloque plegado por impuesto, con su resumen: así no son 60 filas de golpe. */}
      {visibles.length > 0 && tiposConPeriodos.filter((t) => !tipo || t === tipo).map((t) => {
        const lista = visibles.filter((p) => p.tipo === t);
        if (!lista.length) return null;
        const hoy = hoyVE();
        const enCurso = lista.find((p) => p.desde <= hoy && hoy <= p.hasta);
        const vencidos = lista.filter((p) => estadoPeriodo(p) === 'vencido').length;
        const abiertos = lista.filter((p) => !p.declaradoEn).length;
        const proximo = lista.filter((p) => !p.declaradoEn && p.vence && p.vence >= hoy).sort((a, b) => String(a.vence).localeCompare(String(b.vence)))[0];
        const masVencido = lista.filter((p) => !p.declaradoEn && p.vence && p.vence < hoy).sort((a, b) => String(b.vence).localeCompare(String(a.vence)))[0];

        return (
          <details key={t} open={!!tipo} className="card" style={{ marginBottom: '.5rem', padding: '.5rem .75rem' }}>
            <summary style={{ cursor: 'pointer', display: 'flex', gap: '.8rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <strong style={{ fontSize: '1rem' }}>{nombre(t)}</strong>
              <div style={{ fontSize: '.82rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {enCurso ? (
                  <span style={{ background: 'rgba(34, 197, 94, 0.15)', color: 'var(--success)', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
                    🟢 En curso: {nombrePeriodo(enCurso)}
                  </span>
                ) : (
                  <span style={{ background: 'rgba(239, 68, 68, 0.12)', color: 'var(--danger)', padding: '2px 8px', borderRadius: 4 }}>
                    ⚠️ Sin período en curso configurado
                  </span>
                )}
                <span className="muted">· {abiertos} sin declarar</span>
                {vencidos > 0 && <span style={{ color: ROTULO.vencido.color, fontWeight: 700 }}>· {vencidos} vencido{vencidos === 1 ? '' : 's'}</span>}
                {proximo?.vence && (
                  <span style={{ background: diasEntre(hoy, proximo.vence) <= 5 ? 'rgba(234, 179, 8, 0.15)' : 'rgba(255, 255, 255, 0.05)', color: diasEntre(hoy, proximo.vence) <= 5 ? 'var(--warning)' : 'var(--text-muted)', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>
                    ⏰ Próximo a vencer: {nombrePeriodo(proximo)} ({textoVencimientoDias(proximo.vence, hoy)} · vence {fechaCorta(proximo.vence)})
                  </span>
                )}
                {!proximo && masVencido?.vence && (
                  <span style={{ background: 'rgba(239, 68, 68, 0.12)', color: 'var(--danger)', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>
                    🚨 {nombrePeriodo(masVencido)} ({textoVencimientoDias(masVencido.vence, hoy)})
                  </span>
                )}
              </div>
            </summary>
        <div style={{ overflowX: 'auto', marginTop: '.6rem' }}>
          <table className="table" style={{ fontSize: '.82rem', width: '100%' }}>
            <thead><tr><th>Período</th><th>Del</th><th>Vencimiento</th><th>Retenciones</th><th>Quién declara</th><th>Estado</th><th aria-label="Acciones" /></tr></thead>
            <tbody>
              {lista.map((p) => {
                const est = estadoPeriodo(p);
                const c = conteoDelPeriodo(p, conteos);
                const esEsteEnCurso = enCurso?.id === p.id;
                const diasRestantes = p.vence ? diasEntre(hoy, p.vence) : null;

                return (
                  <tr key={p.id} style={esEsteEnCurso ? { background: 'rgba(34, 197, 94, 0.05)' } : undefined}>
                    <td>
                      <strong>{nombrePeriodo(p)}</strong>
                      {esEsteEnCurso && (
                        <span style={{ background: 'rgba(34, 197, 94, 0.2)', color: 'var(--success)', padding: '1px 5px', borderRadius: 3, fontSize: '.7rem', fontWeight: 700, marginLeft: 6 }}>
                          Actual en curso
                        </span>
                      )}
                    </td>
                    <td>{fechaCorta(p.desde)} – {fechaCorta(p.hasta)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        {puedeEditar && !p.declaradoEn
                          ? <input className="input" type="date" defaultValue={p.vence ?? ''} style={{ maxWidth: 140, padding: '2px 6px', fontSize: '.8rem' }}
                              onBlur={(e) => { if ((e.target.value || null) !== p.vence) void guardarVence(p, e.target.value); }} aria-label={`Vencimiento de ${nombrePeriodo(p)}`} />
                          : <span>{fechaCorta(p.vence)}</span>}
                        {p.vence && !p.declaradoEn && diasRestantes !== null && (
                          <span style={{
                            fontSize: '.72rem',
                            fontWeight: diasRestantes <= 5 ? 700 : 500,
                            color: diasRestantes < 0 ? 'var(--danger)' : diasRestantes <= 5 ? 'var(--warning)' : 'var(--text-muted)',
                            background: diasRestantes < 0 ? 'rgba(239, 68, 68, 0.12)' : diasRestantes <= 5 ? 'rgba(234, 179, 8, 0.12)' : 'transparent',
                            padding: diasRestantes <= 5 ? '1px 5px' : 0,
                            borderRadius: 3,
                            whiteSpace: 'nowrap',
                          }}>
                            {diasRestantes === 0 ? '¡Vence hoy!' : diasRestantes > 0 ? `Quedan ${diasRestantes} d.` : `Venció hace ${Math.abs(diasRestantes)} d.`}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>{c.total}{c.declaradas ? <span className="muted"> · {c.declaradas} declarada{c.declaradas === 1 ? '' : 's'}</span> : ''}</td>
                    <td>
                      {p.declara === 'gt' ? 'Este sistema' : 'Otro sistema'}
                      {puedeEditar && !p.declaradoEn && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setQuien(p)}>Cambiar</button>}
                    </td>
                    <td>
                      <span style={{ color: ROTULO[est].color, fontWeight: est === 'vencido' ? 700 : 400 }}>{ROTULO[est].texto}</span>
                      {p.declaradoEn && <div className="muted" style={{ fontSize: '.72rem' }}>{fechaCorta(p.declaradoEn)}{p.declaradoPor ? ` · ${rotuloAutor(p.declaradoPor)}` : ''}</div>}
                      {!p.declaradoEn && p.reabiertoEn && <div className="muted" style={{ fontSize: '.72rem' }}>Reabierto {fechaCorta(p.reabiertoEn)}: {rotuloMotivo(p.reabiertoMotivo)}</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {puedeEditar && !p.declaradoEn && p.declara === 'gt' && <button type="button" className="btn btn-sm btn-primary" onClick={() => setDeclarar(p)}>Declarar</button>}
                      {puedeEditar && p.declaradoEn && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setReabrir(p)}>Reabrir</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
          </details>
        );
      })}

      {declarar && (
        <DeclararModal periodo={declarar} nombre={`${nombre(declarar.tipo)} · ${nombrePeriodo(declarar)}`} pendientes={(() => { const c = conteoDelPeriodo(declarar, conteos); return c.total - c.declaradas; })()}
          onClose={() => setDeclarar(null)} onHecho={() => { setDeclarar(null); void cargar(); }} />
      )}
      {reabrir && <ReabrirModal periodo={reabrir} nombre={`${nombre(reabrir.tipo)} · ${nombrePeriodo(reabrir)}`} onClose={() => setReabrir(null)} onHecho={() => { setReabrir(null); void cargar(); }} />}
      {quien && <DeclaraModal periodo={quien} nombre={`${nombre(quien.tipo)} · ${nombrePeriodo(quien)}`} onClose={() => setQuien(null)} onHecho={() => { setQuien(null); void cargar(); }} />}
    </div>
  );
}

function DeclararModal({ periodo, nombre, pendientes, onClose, onHecho }: { periodo: PeriodoFiscal; nombre: string; pendientes: number; onClose: () => void; onHecho: () => void }) {
  const [trabajando, setTrabajando] = useState(false);
  async function confirmar() {
    setTrabajando(true);
    try {
      const r = await declararPeriodo(periodo.id);
      toast(r.mensaje, r.enCero ? 'info' : 'success');
      onHecho();
    } catch (e) { toast(mensaje(e, 'No se pudo declarar.'), 'error'); setTrabajando(false); }
  }
  return (
    <Modal title={`Declarar ${nombre}`} compact onClose={() => !trabajando && onClose()}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={trabajando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void confirmar()} disabled={trabajando}>{trabajando ? 'Declarando…' : 'Declarar'}</button>
        </>
      )}>
      <p style={{ fontSize: '.86rem' }}>
        {pendientes
          ? `${pendientes} retención${pendientes === 1 ? '' : 'es'} pasa${pendientes === 1 ? '' : 'n'} a «declarada».`
          : 'No hay retenciones por declarar: queda como declaración en cero.'}
        {' '}Después no se puede registrar ni mover una retención en este período hasta reabrirlo.
      </p>
    </Modal>
  );
}

function ReabrirModal({ periodo, nombre, onClose, onHecho }: { periodo: PeriodoFiscal; nombre: string; onClose: () => void; onHecho: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  async function confirmar() {
    setTrabajando(true);
    try {
      const r = await reabrirPeriodo(periodo.id, motivo);
      toast(r.mensaje, r.enCero ? 'info' : 'success');
      onHecho();
    } catch (e) { toast(mensaje(e, 'No se pudo reabrir.'), 'error'); setTrabajando(false); }
  }
  return (
    <Modal title={`Reabrir ${nombre}`} compact onClose={() => !trabajando && onClose()}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={trabajando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void confirmar()} disabled={trabajando || !motivo.trim()}>{trabajando ? 'Reabriendo…' : 'Reabrir'}</button>
        </>
      )}>
      <p style={{ fontSize: '.86rem' }}>Sus retenciones declaradas vuelven a «registrada» y el período admite cambios otra vez. Queda en el historial.</p>
      <div className="form-row"><label>Motivo</label><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus /></div>
    </Modal>
  );
}

function DeclaraModal({ periodo, nombre, onClose, onHecho }: { periodo: PeriodoFiscal; nombre: string; onClose: () => void; onHecho: () => void }) {
  const [declara, setDeclara] = useState<Declara>(periodo.declara === 'gt' ? 'otro_sistema' : 'gt');
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  async function confirmar() {
    setTrabajando(true);
    try { await cambiarDeclara(periodo.id, declara, motivo); toast('Guardado.', 'success'); onHecho(); } catch (e) { toast(mensaje(e, 'No se pudo cambiar.'), 'error'); setTrabajando(false); }
  }
  return (
    <Modal title={`Quién declara ${nombre}`} compact onClose={() => !trabajando && onClose()}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={trabajando}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={() => void confirmar()} disabled={trabajando || !motivo.trim()}>{trabajando ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}>
      <div className="form-row">
        <label>Lo declara</label>
        <select className="select" value={declara} onChange={(e) => setDeclara(e.target.value as Declara)}>
          <option value="gt">Este sistema</option><option value="otro_sistema">El otro sistema</option>
        </select>
      </div>
      <div className="form-row"><label>Motivo</label><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
    </Modal>
  );
}
