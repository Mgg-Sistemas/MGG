/* ============================================================
   MGG · Documentación · Formulario de la nota de envío
   Crear o corregir (mientras está «Enviada»). El N° lo asigna la base
   al guardar. El total sigue la suma de cantidades salvo que se escriba
   a mano (en el papel a veces se cuenta distinto, p. ej. solo facturas).
   Los destinatarios ya usados se ofrecen para autocompletar.
   ============================================================ */
import { useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { hoyISO } from '@/shared/lib/format';
import { crearNotaEnvio, actualizarNotaEnvio, type Actor, type NotaEnvio } from './documentacion.repository';
import { EMISOR_NOTA, numeroEnvio, totalRenglones, type ItemNotaEnvio } from './notaEnvio';

export interface SugerenciasNota {
  razon: string[];
  porRazon: Record<string, { rif: string | null; direccion: string | null; atencion_a: string | null }>;
  atencion: string[];
  condicion: string[];
}

export function NotaEnvioForm({ nota, sugerencias, actor, onClose, onSaved }: {
  nota: NotaEnvio | null;
  sugerencias: SugerenciasNota;
  actor: Actor;
  onClose: () => void;
  onSaved: (n: NotaEnvio) => void;
}) {
  const [fecha, setFecha] = useState(nota?.fecha ?? hoyISO());
  const [razon, setRazon] = useState(nota?.razon_social ?? '');
  const [rif, setRif] = useState(nota?.rif ?? '');
  const [direccion, setDireccion] = useState(nota?.direccion ?? '');
  const [atencion, setAtencion] = useState(nota?.atencion_a ?? '');
  const [condicion, setCondicion] = useState(nota?.condicion ?? '');
  const [items, setItems] = useState<Array<{ descripcion: string; cantidad: string }>>(
    nota?.items.length
      ? nota.items.map((r) => ({ descripcion: r.descripcion, cantidad: r.cantidad == null ? '' : String(r.cantidad) }))
      : [{ descripcion: '', cantidad: '' }],
  );
  const [etiqueta, setEtiqueta] = useState(nota?.total_etiqueta ?? 'Documentos');
  const [totalManual, setTotalManual] = useState<string | null>(
    nota && nota.total_cantidad !== totalRenglones(nota.items) ? String(nota.total_cantidad) : null,
  );
  const [entregadoPor, setEntregadoPor] = useState(nota?.entregado_por && nota.entregado_por !== '—' ? nota.entregado_por : (actor.nombre ?? ''));
  const [notas, setNotas] = useState(nota?.nota ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const renglones: ItemNotaEnvio[] = useMemo(
    () => items.map((r) => ({ descripcion: r.descripcion, cantidad: r.cantidad.trim() === '' ? null : Number(r.cantidad.replace(',', '.')) })),
    [items],
  );
  const suma = totalRenglones(renglones);
  const total = totalManual == null || totalManual.trim() === '' ? suma : Number(totalManual.replace(',', '.'));

  const setItem = (i: number, campo: 'descripcion' | 'cantidad', v: string) =>
    setItems((xs) => xs.map((r, j) => (j === i ? { ...r, [campo]: v } : r)));

  /** Al elegir una razón social ya usada, se traen su RIF, dirección y persona de atención. */
  function elegirRazon(v: string) {
    setRazon(v);
    const d = sugerencias.porRazon[v];
    if (!d) return;
    if (!rif && d.rif) setRif(d.rif);
    if (!direccion && d.direccion) setDireccion(d.direccion);
    if (!atencion && d.atencion_a) setAtencion(d.atencion_a);
  }

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    const input = {
      fecha, razon_social: razon, rif, direccion, atencion_a: atencion, condicion,
      items: renglones, total_etiqueta: etiqueta, total, entregado_por: entregadoPor, nota: notas,
    };
    try {
      const n = nota ? await actualizarNotaEnvio(nota.id, input) : await crearNotaEnvio(input, actor);
      toast(nota ? `Nota N° ${numeroEnvio(n.numero)} actualizada` : `Nota de envío N° ${numeroEnvio(n.numero)} creada`, 'success');
      onSaved(n);
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  return (
    <Modal
      title={nota ? `Editar nota de envío N° ${numeroEnvio(nota.numero)}` : 'Nueva nota de envío'} size="lg" onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" form="nota-envio-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : nota ? 'Guardar cambios' : 'Crear nota'}</button>
      </>}
    >
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}
      <form id="nota-envio-form" onSubmit={submit}>
        <div className="muted" style={{ fontSize: '.8rem', marginBottom: '.6rem' }}>
          {nota ? 'El N° no cambia al editar.' : 'El N° (correlativo) lo asigna el sistema al guardar.'} Emite <strong>{EMISOR_NOTA.razonSocial}</strong> · RIF {EMISOR_NOTA.rif}. Las firmas van a mano sobre la nota impresa.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 1rem' }}>
          <div className="form-row">
            <label htmlFor="ne-fecha">Fecha *</label>
            <input id="ne-fecha" className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div className="form-row">
            <label htmlFor="ne-entregado">Entregado por</label>
            <input id="ne-entregado" className="input" value={entregadoPor} onChange={(e) => setEntregadoPor(e.target.value)} />
          </div>
        </div>

        <div className="card-title" style={{ margin: '.4rem 0' }}>Datos del cliente / departamento</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 1rem' }}>
          <div className="form-row">
            <label htmlFor="ne-razon">Razón social / departamento *</label>
            <input id="ne-razon" className="input" list="ne-razones" value={razon} onChange={(e) => elegirRazon(e.target.value)} />
            <datalist id="ne-razones">{sugerencias.razon.map((v) => <option key={v} value={v} />)}</datalist>
          </div>
          <div className="form-row">
            <label htmlFor="ne-rif">RIF / C.I.</label>
            <input id="ne-rif" className="input" value={rif} onChange={(e) => setRif(e.target.value.toUpperCase())} />
          </div>
        </div>
        <div className="form-row">
          <label htmlFor="ne-direccion">Dirección (opcional)</label>
          <input id="ne-direccion" className="input" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
        </div>

        <div className="card-title" style={{ margin: '.4rem 0' }}>Detalles de entrega</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 1rem' }}>
          <div className="form-row">
            <label htmlFor="ne-atencion">Atención a</label>
            <input id="ne-atencion" className="input" list="ne-atenciones" value={atencion} onChange={(e) => setAtencion(e.target.value)} />
            <datalist id="ne-atenciones">{sugerencias.atencion.map((v) => <option key={v} value={v} />)}</datalist>
          </div>
          <div className="form-row">
            <label htmlFor="ne-condicion">Condición</label>
            <input id="ne-condicion" className="input" list="ne-condiciones" value={condicion} onChange={(e) => setCondicion(e.target.value)} placeholder="Ej: Facturas originales, copias…" />
            <datalist id="ne-condiciones">{['Facturas originales', 'Copias', 'Originales y copias', ...sugerencias.condicion].filter((v, i, a) => a.indexOf(v) === i).map((v) => <option key={v} value={v} />)}</datalist>
          </div>
        </div>

        <div className="card-title" style={{ margin: '.4rem 0' }}>Renglones</div>
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.86rem' }}>
            <thead><tr><th style={{ width: 50 }}>Ítem</th><th>Descripción / concepto</th><th style={{ width: 110 }}>Cant.</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {items.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{String(i + 1).padStart(2, '0')}</td>
                  <td><input id={`ne-desc-${i}`} className="input" value={r.descripcion} onChange={(e) => setItem(i, 'descripcion', e.target.value)} placeholder="Ej: Facturas originales de …" /></td>
                  <td><input id={`ne-cant-${i}`} className="input mono" inputMode="decimal" value={r.cantidad} onChange={(e) => setItem(i, 'cantidad', e.target.value.replace(/[^\d.,]/g, ''))} /></td>
                  <td>
                    {items.length > 1 && (
                      <button type="button" className="btn btn-sm btn-ghost" title="Quitar renglón" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.4rem' }} onClick={() => setItems((xs) => [...xs, { descripcion: '', cantidad: '' }])}>＋ Agregar renglón</button>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 1rem', marginTop: '.75rem' }}>
          <div className="form-row">
            <label htmlFor="ne-etiqueta">Total de… (texto)</label>
            <input id="ne-etiqueta" className="input" value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="Facturas, Documentos…" />
          </div>
          <div className="form-row">
            <label htmlFor="ne-total">Total {etiqueta || ''}</label>
            <input id="ne-total" className="input mono" inputMode="decimal" value={totalManual ?? String(suma)}
              onChange={(e) => setTotalManual(e.target.value.replace(/[^\d.,]/g, ''))} />
            <small className="muted">
              Suma de cantidades: {suma}.{totalManual != null && (
                <> <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTotalManual(null)}>Usar la suma</button></>
              )}
            </small>
          </div>
        </div>
        <div className="form-row">
          <label htmlFor="ne-notas">Observaciones (opcional)</label>
          <textarea id="ne-notas" className="input" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}
