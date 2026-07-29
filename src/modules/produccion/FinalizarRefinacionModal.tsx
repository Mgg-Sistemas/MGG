/* ============================================================
   MGG · Finalizar Refinación — captura de RESULTADOS y BALANCE DE MASA
   (MGG-FR-002). El estaño refinado obtenido define la cantidad que entra a
   inventario. Rendimiento, peso promedio por lingote y merma se calculan solos.
   ============================================================ */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { notify } from '@/shared/lib/notify';
import { money, num } from '@/shared/lib/format';
import type { Produccion, ProduccionRefinacion } from '@/shared/lib/types';
import { getRefinacion, finalizarRefinacionConResultados } from './refinacion.repository';

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
  const [involucrados, setInvolucrados] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rendTocado, setRendTocado] = useState(false);

  useEffect(() => {
    let cancel = false;
    getRefinacion(prod.id).then((r) => {
      if (cancel) return;
      setRef(r);
      const d = r?.datos ?? {};
      setHoraIni(d.hora_inicio_refinacion ?? '');
      setHoraFin(d.hora_fin_refinacion ?? '');
      setHoraVaciado(d.hora_inicio_vaciado ?? '');
      setTempColada(d.temp_colada == null ? '' : String(d.temp_colada));
      setInvolucrados((d.involucrados ?? []).join('\n'));
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

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (refinadoNum <= 0) { setError('Indicá el estaño refinado obtenido (kg): es lo que entra a inventario.'); return; }
    setSaving(true);
    try {
      await finalizarRefinacionConResultados(prod.id, {
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
        involucrados: involucrados.split('\n').map((s) => s.trim()).filter(Boolean),
      }, actor, actorName ?? null);
      notify(`Refinación finalizada: ${num(refinadoNum)} kg de estaño refinado → ${prod.almacen_destino}`, 'success', { link: '#/app/inventario' });
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

        {/* Tiempos de colada y moldeo */}
        <div className="form-grid">
          <div className="form-row">
            <label>Hora inicio de refinación</label>
            <input className="input" value={horaIni} onChange={(e) => setHoraIni(e.target.value)} placeholder="Ej.: 4:29pm 28/03/26" />
          </div>
          <div className="form-row">
            <label>Hora fin de refinación</label>
            <input className="input" value={horaFin} onChange={(e) => setHoraFin(e.target.value)} placeholder="Ej.: 7:20pm 28/03/26" />
          </div>
        </div>
        <div className="form-grid">
          <div className="form-row">
            <label>Hora inicio de vaciado</label>
            <input className="input" value={horaVaciado} onChange={(e) => setHoraVaciado(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Temp. de colada (°C)</label>
            <input className="input mono" type="number" step="any" value={tempColada} onChange={(e) => setTempColada(e.target.value)} style={{ textAlign: 'right' }} />
          </div>
        </div>
        <div className="form-row" style={{ maxWidth: 260 }}>
          <label>Tiempo total de proceso (h)</label>
          <input className="input mono" type="number" step="any" value={tiempoTotal} onChange={(e) => setTiempoTotal(e.target.value)} placeholder="Ej.: 2,88" style={{ textAlign: 'right' }} />
        </div>

        <div style={{ height: 1, background: 'var(--border)', margin: '.85rem 0' }} />

        {/* Resultados de producción */}
        <div className="form-grid">
          <div className="form-row">
            <label>Estaño refinado obtenido (kg) *</label>
            <input className="input mono" type="number" min={0} step="any" value={refinado} onChange={(e) => setRefinado(e.target.value)} style={{ textAlign: 'right' }} autoFocus required />
          </div>
          <div className="form-row">
            <label>N° de lingotes producidos</label>
            <input className="input mono" type="number" min={0} step="1" value={lingotes} onChange={(e) => setLingotes(e.target.value)} style={{ textAlign: 'right' }} />
            {pesoProm > 0 && <small className="muted" style={{ fontSize: '.7rem' }}>Peso prom./lingote: <strong>{num(pesoProm)} kg</strong></small>}
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
            {rendSugerido > 0 && <small className="muted" style={{ fontSize: '.7rem' }}>Sugerido: {num(rendSugerido)} % (refinado ÷ crudo)</small>}
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
          <label>Personal involucrado <span className="muted" style={{ fontWeight: 400 }}>(uno por línea)</span></label>
          <textarea className="input" rows={3} value={involucrados} onChange={(e) => setInvolucrados(e.target.value)} placeholder={'Nombre 1\nNombre 2\n…'} />
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
