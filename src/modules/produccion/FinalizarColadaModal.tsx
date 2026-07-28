/* ============================================================
   MGG · Finalizar Colada — captura de RESULTADOS (MGG-FR-001).
   El estaño obtenido define la cantidad que entra a inventario. Rendimiento
   se sugiere a partir del Sn cargado (estaño ÷ Sn contenido × 100).
   ============================================================ */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { notify } from '@/shared/lib/notify';
import { money, num } from '@/shared/lib/format';
import type { Produccion, ProduccionColada } from '@/shared/lib/types';
import { getColada, finalizarColadaConResultados } from './colada.repository';

const round2 = (n: number) => Math.round(n * 100) / 100;

export function FinalizarColadaModal({ prod, actor, actorName, onClose, onDone }: {
  prod: Produccion; actor: string; actorName?: string | null; onClose: () => void; onDone: () => void;
}) {
  const [colada, setColada] = useState<ProduccionColada | null>(null);
  const [estano, setEstano] = useState('');
  const [lingotes, setLingotes] = useState('');
  const [escoria, setEscoria] = useState('');
  const [rendimiento, setRendimiento] = useState('');
  const [merma, setMerma] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [involucrados, setInvolucrados] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rendTocado, setRendTocado] = useState(false);

  useEffect(() => {
    let cancel = false;
    getColada(prod.id).then((c) => { if (!cancel) setColada(c); }).catch(() => { /* opcional */ });
    return () => { cancel = true; };
  }, [prod.id]);

  const snKg = Number(colada?.datos?.sn_kg) || 0;
  const totalCasiterita = Number(colada?.datos?.total_casiterita) || 0;
  const estanoNum = Number(estano) || 0;

  // Rendimiento sugerido = estaño ÷ Sn contenido × 100 (mientras el usuario no lo edite).
  const rendSugerido = snKg > 0 && estanoNum > 0 ? round2((estanoNum / snKg) * 100) : 0;
  useEffect(() => {
    if (!rendTocado) setRendimiento(rendSugerido > 0 ? String(rendSugerido) : '');
  }, [rendSugerido, rendTocado]);

  // Merma sugerida = total casiterita − estaño − escoria (referencial).
  const mermaSugerida = useMemo(() => {
    const v = totalCasiterita - estanoNum - (Number(escoria) || 0);
    return v > 0 ? round2(v) : 0;
  }, [totalCasiterita, estanoNum, escoria]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (estanoNum <= 0) { setError('Indicá el estaño obtenido (kg): es lo que entra a inventario.'); return; }
    setSaving(true);
    try {
      await finalizarColadaConResultados(prod.id, {
        estano_kg: estanoNum,
        escoria_kg: escoria.trim() === '' ? null : Number(escoria),
        n_lingotes: lingotes.trim() === '' ? null : Number(lingotes),
        rendimiento: rendimiento.trim() === '' ? null : Number(rendimiento),
        merma_kg: merma.trim() === '' ? (mermaSugerida || null) : Number(merma),
        destino_almacen: prod.almacen_destino,
        observaciones: observaciones.trim(),
        involucrados: involucrados.split('\n').map((s) => s.trim()).filter(Boolean),
      }, actor, actorName ?? null);
      notify(`Colada finalizada: ${num(estanoNum)} kg de estaño → ${prod.almacen_destino}`, 'success', { link: '#/app/inventario' });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo finalizar la colada.');
      setSaving(false);
    }
  }

  return (
    <Modal title="✓ Finalizar colada — Resultados" size="lg" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" form="fin-colada" className="btn btn-primary" disabled={saving}>{saving ? 'Finalizando…' : 'Finalizar y entrar a inventario'}</button>
      </>
    }>
      <form id="fin-colada" onSubmit={submit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <p className="hint muted" style={{ marginTop: 0 }}>
          El <strong>estaño obtenido</strong> entra a inventario como <strong>{prod.producto_nombre}</strong> en <strong>{prod.almacen_destino}</strong>
          {snKg > 0 && <> · Sn contenido en la carga ≈ <strong>{num(snKg)} kg</strong></>}.
        </p>

        <div className="form-grid">
          <div className="form-row">
            <label>Estaño obtenido (kg) *</label>
            <input className="input mono" type="number" min={0} step="any" value={estano} onChange={(e) => setEstano(e.target.value)} style={{ textAlign: 'right' }} autoFocus required />
          </div>
          <div className="form-row">
            <label>N° de lingotes</label>
            <input className="input mono" type="number" min={0} step="1" value={lingotes} onChange={(e) => setLingotes(e.target.value)} style={{ textAlign: 'right' }} />
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Escoria generada (kg)</label>
            <input className="input mono" type="number" min={0} step="any" value={escoria} onChange={(e) => setEscoria(e.target.value)} style={{ textAlign: 'right' }} />
          </div>
          <div className="form-row">
            <label>Rendimiento (%)</label>
            <input className="input mono" type="number" min={0} step="any" value={rendimiento} onChange={(e) => { setRendTocado(true); setRendimiento(e.target.value); }} style={{ textAlign: 'right' }} />
            {rendSugerido > 0 && <small className="muted" style={{ fontSize: '.7rem' }}>Sugerido: {num(rendSugerido)} % (estaño ÷ Sn)</small>}
          </div>
        </div>

        <div className="form-row" style={{ maxWidth: 260 }}>
          <label>Merma (kg)</label>
          <input className="input mono" type="number" step="any" value={merma} onChange={(e) => setMerma(e.target.value)} placeholder={mermaSugerida ? String(mermaSugerida) : ''} style={{ textAlign: 'right' }} />
          {mermaSugerida > 0 && <small className="muted" style={{ fontSize: '.7rem' }}>Referencial: {num(mermaSugerida)} kg (casiterita − estaño − escoria)</small>}
        </div>

        <div className="form-row">
          <label>Observaciones</label>
          <textarea className="input" rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Ej.: % de producción respecto a la casiterita utilizada…" />
        </div>

        <div className="form-row">
          <label>Involucrados <span className="muted" style={{ fontWeight: 400 }}>(uno por línea)</span></label>
          <textarea className="input" rows={3} value={involucrados} onChange={(e) => setInvolucrados(e.target.value)} placeholder={'Nombre 1\nNombre 2\n…'} />
        </div>

        <div className="card" style={{ padding: '.6rem .8rem', borderLeft: '3px solid var(--primary)', margin: 0 }}>
          <div className="mono" style={{ fontSize: '.82rem' }}>
            Entra a inventario: <strong>{num(estanoNum)} kg</strong> de {prod.producto_nombre} · costo de fundición total {money(prod.costo_material + prod.mano_obra + prod.costos_indirectos)}
            {estanoNum > 0 && <> → costo unit. <strong style={{ color: 'var(--primary-3)' }}>{money(round2((prod.costo_material + prod.mano_obra + prod.costos_indirectos) / estanoNum))}/kg</strong></>}
          </div>
        </div>
      </form>
    </Modal>
  );
}
