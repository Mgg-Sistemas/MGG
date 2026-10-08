/* ============================================================
   MGG · Documentación · Formulario de la nota de envío
   Crear o corregir (mientras está «Enviada»). El N° lo asigna la base
   al guardar. El total sigue la suma de cantidades salvo que se escriba
   a mano (en el papel a veces se cuenta distinto, p. ej. solo facturas).

   Los datos que se repiten salen de CATÁLOGOS (08-10-2026): destinatarios
   (razón social, RIF, dirección, atención), condiciones, conceptos de
   renglón y personas de atención. Cada campo autocompleta con su catálogo
   y tiene un botón que lo abre para elegir, agregar, editar o borrar. Lo
   que se escriba a mano y no esté, se agrega solo al guardar la nota.
   ============================================================ */
import { useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { toast } from '@/shared/ui/Toast';
import { hoyISO } from '@/shared/lib/format';
import { crearNotaEnvio, actualizarNotaEnvio, type Actor, type Destinatario, type ItemCatalogoDoc, type NotaEnvio } from './documentacion.repository';
import { EMISOR_NOTA, numeroEnvio, totalRenglones, type ItemNotaEnvio } from './notaEnvio';
import { filtrarCatalogo, type ScopeCatalogoDoc } from './catalogoDocumentacion';
import { CatalogoTextoModal } from './CatalogoTextoModal';
import { DestinatariosModal } from './DestinatariosModal';

export interface SugerenciasNota {
  razon: string[];
  porRazon: Record<string, { rif: string | null; direccion: string | null; atencion_a: string | null }>;
  atencion: string[];
  condicion: string[];
}

export function NotaEnvioForm({ nota, sugerencias, destinatarios, catalogo, canWrite, actor, onClose, onSaved, onCatalogoChanged }: {
  nota: NotaEnvio | null;
  sugerencias: SugerenciasNota;
  destinatarios: Destinatario[];
  catalogo: ItemCatalogoDoc[];
  canWrite: boolean;
  actor: Actor;
  onClose: () => void;
  onSaved: (n: NotaEnvio) => void;
  onCatalogoChanged: () => void | Promise<void>;
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

  // Qué catálogo está abierto: destinatarios, o uno de texto (y para qué renglón, si es un concepto).
  const [catDest, setCatDest] = useState(false);
  const [catTexto, setCatTexto] = useState<{ scope: ScopeCatalogoDoc; fila?: number } | null>(null);

  const renglones: ItemNotaEnvio[] = useMemo(
    () => items.map((r) => ({ descripcion: r.descripcion, cantidad: r.cantidad.trim() === '' ? null : Number(r.cantidad.replace(',', '.')) })),
    [items],
  );
  const suma = totalRenglones(renglones);
  const total = totalManual == null || totalManual.trim() === '' ? suma : Number(totalManual.replace(',', '.'));

  // Listas para autocompletar: catálogo primero (lo más usado arriba) y lo que traigan las notas viejas después.
  const unicos = (xs: string[]) => xs.filter((v, i, a) => !!v && a.indexOf(v) === i);
  const opcRazon = useMemo(() => unicos([...destinatarios.map((d) => d.razon_social), ...sugerencias.razon]), [destinatarios, sugerencias.razon]);
  const opcAtencion = useMemo(() => unicos([...filtrarCatalogo(catalogo, 'atencion', '').map((i) => i.nombre), ...destinatarios.map((d) => d.atencion_a ?? ''), ...sugerencias.atencion]), [catalogo, destinatarios, sugerencias.atencion]);
  const opcCondicion = useMemo(() => unicos([...filtrarCatalogo(catalogo, 'condicion', '').map((i) => i.nombre), ...sugerencias.condicion]), [catalogo, sugerencias.condicion]);
  const opcConcepto = useMemo(() => filtrarCatalogo(catalogo, 'concepto', '').map((i) => i.nombre), [catalogo]);

  const setItem = (i: number, campo: 'descripcion' | 'cantidad', v: string) =>
    setItems((xs) => xs.map((r, j) => (j === i ? { ...r, [campo]: v } : r)));

  /** Al elegir una razón social ya usada, se traen su RIF, dirección y persona de atención. */
  function elegirRazon(v: string) {
    setRazon(v);
    const d = destinatarios.find((x) => x.razon_social === v) ?? sugerencias.porRazon[v];
    if (!d) return;
    if (!rif && d.rif) setRif(d.rif);
    if (!direccion && d.direccion) setDireccion(d.direccion);
    if (!atencion && d.atencion_a) setAtencion(d.atencion_a);
  }

  /** «Usar» desde el catálogo de destinatarios: llena los cuatro campos (pisa lo que haya). */
  function usarDestinatario(d: Destinatario) {
    setRazon(d.razon_social); setRif(d.rif ?? ''); setDireccion(d.direccion ?? ''); if (d.atencion_a) setAtencion(d.atencion_a);
    setCatDest(false);
  }

  /** «Usar» desde un catálogo de texto: va al campo que lo abrió. */
  function usarTexto(nombre: string) {
    if (!catTexto) return;
    if (catTexto.scope === 'condicion') setCondicion(nombre);
    else if (catTexto.scope === 'atencion') setAtencion(nombre);
    else if (catTexto.fila != null) setItem(catTexto.fila, 'descripcion', nombre);
    setCatTexto(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null); setSaving(true);
    const input = {
      fecha, razon_social: razon, rif, direccion, atencion_a: atencion, condicion,
      items: renglones, total_etiqueta: etiqueta, total, entregado_por: entregadoPor, nota: notas,
    };
    try {
      const n = nota ? await actualizarNotaEnvio(nota.id, input, actor) : await crearNotaEnvio(input, actor);
      toast(nota ? `Nota N° ${numeroEnvio(n.numero)} actualizada` : `Nota de envío N° ${numeroEnvio(n.numero)} creada`, 'success');
      onSaved(n);
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  const botonCatalogo = (titulo: string, icono: string, onClick: () => void) => (
    <button type="button" className="btn btn-sm btn-ghost" title={titulo} onClick={onClick} style={{ flex: '0 0 auto' }}>{icono}</button>
  );

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

        <div className="card-title" style={{ margin: '.4rem 0', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          Datos del cliente / departamento
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCatDest(true)} title="Catálogo de destinatarios: elegir, agregar, editar o borrar">📇 Destinatarios ({destinatarios.length})</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 1rem' }}>
          <div className="form-row">
            <label htmlFor="ne-razon">Razón social / departamento *</label>
            <div style={{ display: 'flex', gap: '.3rem' }}>
              <input id="ne-razon" className="input" list="ne-razones" value={razon} onChange={(e) => elegirRazon(e.target.value)} placeholder="Escribí o elegí del catálogo" style={{ flex: 1 }} />
              {botonCatalogo('Elegir del catálogo de destinatarios', '📇', () => setCatDest(true))}
            </div>
            <datalist id="ne-razones">{opcRazon.map((v) => <option key={v} value={v} />)}</datalist>
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
            <div style={{ display: 'flex', gap: '.3rem' }}>
              <input id="ne-atencion" className="input" list="ne-atenciones" value={atencion} onChange={(e) => setAtencion(e.target.value)} style={{ flex: 1 }} />
              {botonCatalogo('Catálogo de personas de atención', '👤', () => setCatTexto({ scope: 'atencion' }))}
            </div>
            <datalist id="ne-atenciones">{opcAtencion.map((v) => <option key={v} value={v} />)}</datalist>
          </div>
          <div className="form-row">
            <label htmlFor="ne-condicion">Condición</label>
            <div style={{ display: 'flex', gap: '.3rem' }}>
              <input id="ne-condicion" className="input" list="ne-condiciones" value={condicion} onChange={(e) => setCondicion(e.target.value)} placeholder="Ej: Copias, facturas originales…" style={{ flex: 1 }} />
              {botonCatalogo('Catálogo de condiciones', '🏷', () => setCatTexto({ scope: 'condicion' }))}
            </div>
            <datalist id="ne-condiciones">{opcCondicion.map((v) => <option key={v} value={v} />)}</datalist>
          </div>
        </div>

        <div className="card-title" style={{ margin: '.4rem 0', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          Renglones
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCatTexto({ scope: 'concepto' })} title="Catálogo de conceptos: agregar, editar o borrar">📋 Conceptos ({opcConcepto.length})</button>
        </div>
        <div className="table-wrap">
          <table className="table" style={{ fontSize: '.86rem' }}>
            <thead><tr><th style={{ width: 50 }}>Ítem</th><th>Descripción / concepto</th><th style={{ width: 110 }}>Cant.</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {items.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{String(i + 1).padStart(2, '0')}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '.3rem' }}>
                      <input id={`ne-desc-${i}`} className="input" list="ne-conceptos" value={r.descripcion} onChange={(e) => setItem(i, 'descripcion', e.target.value)} placeholder="Ej: Facturas de …" style={{ flex: 1 }} />
                      {botonCatalogo('Elegir del catálogo de conceptos', '📋', () => setCatTexto({ scope: 'concepto', fila: i }))}
                    </div>
                  </td>
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
          <datalist id="ne-conceptos">{opcConcepto.map((v) => <option key={v} value={v} />)}</datalist>
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

      {catDest && (
        <DestinatariosModal destinatarios={destinatarios} canWrite={canWrite} actor={actor.email}
          onClose={() => setCatDest(false)} onChanged={onCatalogoChanged} onElegir={usarDestinatario} />
      )}
      {catTexto && (
        <CatalogoTextoModal items={catalogo} scope={catTexto.scope} fijo canWrite={canWrite} actor={actor.email}
          onClose={() => setCatTexto(null)} onChanged={onCatalogoChanged} onElegir={usarTexto} />
      )}
    </Modal>
  );
}
