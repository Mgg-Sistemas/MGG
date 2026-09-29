/* ============================================================
   MGG · Finalizar Refinación — captura de RESULTADOS y BALANCE DE MASA
   (MGG-FR-002). El estaño refinado obtenido define la cantidad que entra a
   inventario. Rendimiento, peso promedio por lingote y merma se calculan solos.
   ============================================================ */
import { SelectorInvolucrados } from './SelectorInvolucrados';
import { sinRepetidos } from './involucrados';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { notify } from '@/shared/lib/notify';
import { money, num } from '@/shared/lib/format';
import type { Produccion, ProduccionRefinacion } from '@/shared/lib/types';
import { getRefinacion, finalizarRefinacionConResultados } from './refinacion.repository';
import { calcJornadaHoras, fmtJornada } from './colada.repository';
import { tiemposRefinacion, type TiemposRefinacion } from './tiemposRefinacion';
import { HoraInput } from '@/shared/ui/HoraInput';

const round2 = (n: number) => Math.round(n * 100) / 100;

export function FinalizarRefinacionModal({ prod, actor, actorName, onClose, onDone }: {
  prod: Produccion; actor: string; actorName?: string | null; onClose: () => void; onDone: () => void;
}) {
  const [ref, setRef] = useState<ProduccionRefinacion | null>(null);
  const [refinado, setRefinado] = useState('');
  const [lingotes, setLingotes] = useState('');
  const [precinto, setPrecinto] = useState('');
  const [dross, setDross] = useState('');
  const [rendimiento, setRendimiento] = useState('');
  const [purezaFinal, setPurezaFinal] = useState('');
  const [tiempoTotal, setTiempoTotal] = useState('');
  const [horaIni, setHoraIni] = useState('');
  const [horaFin, setHoraFin] = useState('');
  const [horaVaciado, setHoraVaciado] = useState('');
  const [tempColada, setTempColada] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [involucrados, setInvolucrados] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rendTocado, setRendTocado] = useState(false);
  // El INICIO viene de la jornada cargada al crear (solo se muestra); el FIN se
  // carga acá, que es cuando se sabe.
  const [tiempos, setTiempos] = useState<TiemposRefinacion>({ inicio: '', fin: '', totalHoras: null, delReporte: false });
  const [fechaIniJornada, setFechaIniJornada] = useState('');
  const [horaIniJornada, setHoraIniJornada] = useState('');
  const [fechaFinJornada, setFechaFinJornada] = useState('');
  const [horaFinJornada, setHoraFinJornada] = useState('');

  useEffect(() => {
    let cancel = false;
    getRefinacion(prod.id).then((r) => {
      if (cancel) return;
      setRef(r);
      const d = r?.datos ?? {};
      const t = tiemposRefinacion(d);
      setTiempos(t);
      setHoraIni(t.inicio);
      setHoraFin(t.fin);
      setTiempoTotal(t.totalHoras == null ? '' : String(t.totalHoras));
      setFechaIniJornada(d.fecha_inicio_jornada ?? '');
      setHoraIniJornada(d.hora_inicio_jornada ?? '');
      // El fin arranca el MISMO día del inicio: la refinación casi siempre cierra
      // en la jornada en que empezó. Si cruzó la medianoche, se corrige acá.
      setFechaFinJornada(d.fecha_fin_jornada || d.fecha_inicio_jornada || '');
      setHoraFinJornada(d.hora_fin_jornada ?? '');
      setHoraVaciado(d.hora_inicio_vaciado ?? '');
      setTempColada(d.temp_colada == null ? '' : String(d.temp_colada));
      setInvolucrados(sinRepetidos(d.involucrados ?? []));

      /* Lo que ya se hubiera escrito en el reporte se trae acá, igual que en la
         colada: si alguien anotó los kilos o el precinto mientras el lote estaba
         en curso, volver a pedirlos es pedir el dato dos veces —y la segunda vez
         se teclea distinto—. Se pueden corregir; acá es donde quedan firmes. */
      const txt = (v: number | null | undefined) => (v == null ? '' : String(v));
      if (d.estano_refinado_kg != null) setRefinado(txt(d.estano_refinado_kg));
      if (d.n_lingotes != null) setLingotes(txt(d.n_lingotes));
      if (d.dross_kg != null) setDross(txt(d.dross_kg));
      if (d.pureza_final != null) setPurezaFinal(txt(d.pureza_final));
      if (d.n_precinto) setPrecinto(d.n_precinto);
      if (d.observaciones) setObservaciones(d.observaciones);
      // Si ya venía un rendimiento cargado, manda ese y no el sugerido.
      if (d.rendimiento != null) { setRendTocado(true); setRendimiento(txt(d.rendimiento)); }
    }).catch(() => { /* opcional */ });
    return () => { cancel = true; };
  }, [prod.id]);

  const crudoKg = Number(ref?.datos?.estano_crudo_kg) || Number(prod.cantidad) || 0;
  const refinadoNum = Number(refinado) || 0;

  // Rendimiento sugerido = refinado ÷ crudo × 100 (mientras no lo editen).
  const rendSugerido = crudoKg > 0 && refinadoNum > 0 ? round2((refinadoNum / crudoKg) * 100) : 0;
  useEffect(() => {
    if (!rendTocado) setRendimiento(rendSugerido > 0 ? String(rendSugerido) : '');
  }, [rendSugerido, rendTocado]);

  // Peso promedio por lingote = refinado ÷ nº lingotes.
  const pesoProm = useMemo(() => {
    const n = Number(lingotes) || 0;
    return n > 0 && refinadoNum > 0 ? round2(refinadoNum / n) : 0;
  }, [lingotes, refinadoNum]);

  // Merma = crudo − refinado − dross.
  const merma = useMemo(() => round2(crudoKg - refinadoNum - (Number(dross) || 0)), [crudoKg, refinadoNum, dross]);

  // Total de la jornada = (fecha+hora fin) − (fecha+hora inicio). El inicio lo
  // dejó cargado quien abrió la refinación; el fin se escribe acá arriba.
  const jornadaH = useMemo(
    () => calcJornadaHoras(fechaIniJornada, horaIniJornada, fechaFinJornada, horaFinJornada),
    [fechaIniJornada, horaIniJornada, fechaFinJornada, horaFinJornada],
  );
  // El total de proceso sigue al de la jornada mientras nadie lo escriba a mano.
  useEffect(() => {
    if (jornadaH != null) setTiempoTotal(String(jornadaH));
  }, [jornadaH]);

  // Cómo se muestra el inicio de la jornada en la ayuda del total.
  const inicioTxt = (() => {
    if (!fechaIniJornada && !horaIniJornada) return 'sin cargar';
    return [fechaIniJornada ? fechaIniJornada.split('-').reverse().join('/') : '', horaIniJornada].filter(Boolean).join(' ');
  })();

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (refinadoNum <= 0) { setError('Indicá el estaño refinado obtenido (kg): es lo que entra a inventario.'); return; }
    setSaving(true);
    try {
      const avisoDross = await finalizarRefinacionConResultados(prod.id, {
        // El cierre de la jornada se escribe recién acá: al crear solo se sabía
        // el arranque. Con esto `sellarFechasDeLaOrden` puede sellar la orden con
        // el día que de verdad se trabajó.
        fecha_fin_jornada: fechaFinJornada || undefined,
        hora_fin_jornada: horaFinJornada || undefined,
        jornada_horas: jornadaH,
        estano_refinado_kg: refinadoNum,
        n_lingotes: lingotes.trim() === '' ? null : Number(lingotes),
        peso_prom_lingote: pesoProm || null,
        n_precinto: precinto.trim(),
        dross_kg: dross.trim() === '' ? null : Number(dross),
        rendimiento: rendimiento.trim() === '' ? null : Number(rendimiento),
        pureza_final: purezaFinal.trim() === '' ? null : Number(purezaFinal),
        merma_kg: merma,
        tiempo_total_horas: tiempoTotal.trim() === '' ? null : Number(tiempoTotal),
        hora_inicio_refinacion: horaIni.trim(),
        hora_fin_refinacion: horaFin.trim(),
        hora_inicio_vaciado: horaVaciado.trim(),
        temp_colada: tempColada.trim() === '' ? null : Number(tempColada),
        destino_almacen: prod.almacen_destino,
        observaciones: observaciones.trim(),
        involucrados: sinRepetidos(involucrados),
      }, actor, actorName ?? null);
      notify(`Refinación finalizada: ${num(refinadoNum)} kg de estaño refinado → ${prod.almacen_destino}`, 'success', { link: '#/app/inventario' });
      // Mismo criterio que la colada: si el dross no entró, se avisa con los kg.
      if (avisoDross) notify(avisoDross, 'warning', { link: '#/app/inventario' });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo finalizar la refinación.');
      setSaving(false);
    }
  }

  const cpTotal = prod.costo_material + prod.mano_obra + prod.costos_indirectos;
  const balanceOk = Math.abs(merma) < 0.01 || merma >= 0;

  return (
    <Modal title="✓ Finalizar refinación — Resultados y balance de masa" size="lg" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" form="fin-ref" className="btn btn-primary" disabled={saving}>{saving ? 'Finalizando…' : 'Finalizar y entrar a inventario'}</button>
      </>
    }>
      <form id="fin-ref" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <p className="hint muted" style={{ marginTop: 0 }}>
          El <strong>estaño refinado</strong> entra a inventario como <strong>{prod.producto_nombre}</strong> en <strong>{prod.almacen_destino}</strong> · estaño crudo cargado: <strong>{num(crudoKg)} kg</strong>.
        </p>

        {/* CIERRE DE LA JORNADA. El inicio se cargó al crear y acá solo se lee; el
            fin se escribe acá, que es cuando se sabe. Antes este bloque mostraba
            un «Fin —» en solo lectura y remitía al reporte: el dato quedaba sin
            cargar y el total de la jornada, vacío. */}
        <div style={{ padding: '.65rem .8rem', margin: '0 0 .8rem', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-1)' }}>
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, marginBottom: '.45rem' }}>Cierre de la jornada</div>
          <div className="form-grid">
            <div className="form-row">
              <label>Fecha fin de jornada</label>
              <input className="input" type="date" value={fechaFinJornada} onChange={(e) => setFechaFinJornada(e.target.value)} />
            </div>
            <div className="form-row">
              <label>Hora fin de jornada</label>
              <input className="input" type="time" value={horaFinJornada} onChange={(e) => setHoraFinJornada(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <label>Total de jornada (automático)</label>
            <input className="input mono" readOnly value={fmtJornada(jornadaH)} style={{ background: 'var(--bg-2)', fontWeight: 700 }} />
            <small className="hint muted" style={{ fontSize: '.7rem' }}>
              Fin − inicio de jornada. El inicio ({inicioTxt}) se cargó al abrir la refinación. Es lo que sale en el reporte como «Jornada».
            </small>
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>Hora inicio de vaciado</label>
              <HoraInput value={horaVaciado} onChange={setHoraVaciado} />
            </div>
            <div className="form-row">
              <label>Temp. de colada (°C)</label>
              <input className="input mono" type="number" step="any" value={tempColada} onChange={(e) => setTempColada(e.target.value)} style={{ textAlign: 'right' }} />
            </div>
          </div>
          {/* Sin jornada cargada al crear (registros viejos) no hay resta posible:
              se pide el total a mano en vez de dejarlo vacío para siempre. */}
          {!tiempos.delReporte && (
            <div className="form-row" style={{ maxWidth: 260, marginBottom: 0 }}>
              <label>Tiempo total de proceso (h)</label>
              <input className="input mono" type="number" step="any" value={tiempoTotal} onChange={(e) => setTiempoTotal(e.target.value)} placeholder="Ej.: 2,88" style={{ textAlign: 'right' }} />
              <small className="hint muted" style={{ fontSize: '.7rem' }}>No se cargó el inicio de jornada al crear: escribilo acá.</small>
            </div>
          )}
        </div>

        {/* Resultados de producción */}
        <div className="form-grid">
          <div className="form-row">
            <label>Estaño refinado obtenido (kg) *</label>
            <input className="input mono" type="number" min={0} step="any" value={refinado} onChange={(e) => setRefinado(e.target.value)} style={{ textAlign: 'right' }} autoFocus required />
          </div>
          <div className="form-row">
            <label>N° de lingotes producidos</label>
            <input className="input mono" type="number" min={0} step="any" value={lingotes} onChange={(e) => setLingotes(e.target.value)} style={{ textAlign: 'right' }} title="Admite medios lingotes: la última colada rara vez llena el molde" />
            {pesoProm > 0 && <small className="hint muted" style={{ fontSize: '.7rem' }}>Peso prom./lingote: <strong>{num(pesoProm)} kg</strong></small>}
          </div>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Dross / escoria de refinación (kg)</label>
            <input className="input mono" type="number" min={0} step="any" value={dross} onChange={(e) => setDross(e.target.value)} style={{ textAlign: 'right' }} />
          </div>
          <div className="form-row">
            <label>Rendimiento del proceso (%)</label>
            <input className="input mono" type="number" min={0} step="any" value={rendimiento} onChange={(e) => { setRendTocado(true); setRendimiento(e.target.value); }} style={{ textAlign: 'right' }} />
            {rendSugerido > 0 && <small className="hint muted" style={{ fontSize: '.7rem' }}>Sugerido: {num(rendSugerido)} % (refinado ÷ crudo)</small>}
          </div>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Pureza final estimada (% Sn)</label>
            <input className="input mono" type="number" min={0} step="any" value={purezaFinal} onChange={(e) => setPurezaFinal(e.target.value)} style={{ textAlign: 'right' }} />
          </div>
          <div className="form-row">
            <label>N° de precinto / lote final</label>
            <input className="input" value={precinto} onChange={(e) => setPrecinto(e.target.value)} />
          </div>
        </div>

        {/* Balance de masa */}
        <div className="card" style={{ padding: '.6rem .8rem', borderLeft: `3px solid ${balanceOk ? 'var(--primary)' : 'var(--danger)'}`, margin: '.4rem 0' }}>
          <div className="muted" style={{ fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>Balance de masa</div>
          <div className="mono" style={{ fontSize: '.85rem', lineHeight: 1.7 }}>
            Crudo <strong>{num(crudoKg)}</strong> = Refinado <strong>{num(refinadoNum)}</strong> + Dross <strong>{num(Number(dross) || 0)}</strong> + Merma <strong style={{ color: merma < 0 ? 'var(--danger)' : 'var(--success)' }}>{num(merma)}</strong> kg
            {merma < 0 && <><br /><span style={{ color: 'var(--danger)' }}>⚠ El refinado + dross supera al crudo cargado: revisá los kg.</span></>}
          </div>
        </div>

        <div className="form-row">
          <label>Observaciones / incidencias</label>
          <textarea className="input" rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
        </div>

        <div className="form-row">
          <label>Personal involucrado <span className="muted" style={{ fontWeight: 400 }}>(elegilo del catálogo)</span></label>
          <SelectorInvolucrados valor={involucrados} onChange={setInvolucrados} actor={actor} />
        </div>

        <div className="card" style={{ padding: '.6rem .8rem', borderLeft: '3px solid var(--primary)', margin: 0 }}>
          <div className="mono" style={{ fontSize: '.82rem' }}>
            Entra a inventario: <strong>{num(refinadoNum)} kg</strong> de {prod.producto_nombre} · costo total {money(cpTotal)}
            {refinadoNum > 0 && <> → costo unit. <strong style={{ color: 'var(--primary-3)' }}>{money(round2(cpTotal / refinadoNum))}/kg</strong></>}
          </div>
        </div>
      </form>
    </Modal>
  );
}
