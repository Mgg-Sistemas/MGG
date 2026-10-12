/* ============================================================
   MGG · Asignaciones · La ventana del acta de entrega

   Lo que antes era una carpeta del Drive: el número del acta, quién entregó
   y quién recibió, los ítems, las fotos del anexo fotográfico y el escaneo
   del acta ya firmada. Desde acá se imprime la carta en PDF.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { date as fmtDate } from '@/shared/lib/format';
import { previewFileUrl } from '@/shared/lib/reportPreview';
import type { Asignacion, Personal } from '@/shared/lib/types';
import { numeroFicha } from '@/modules/rrhh/fichaPersonal';
import { iconoTipo, labelTipo, textoEstado } from './asignaciones';
import { MAX_FOTOS_ACTA, cedulaConPuntos, errorFotosActa } from './actas';
import {
  actualizarActa, dataUrlArchivoActa, quitarActaFirmada, quitarFotoActa, subirActaFirmada, subirFotosActa, urlArchivoActa,
  type ActaAsignacion,
} from './actas.repository';

export function ActaModal({ acta: inicial, items, personal, canWrite, actor, onClose, onChanged }: {
  acta: ActaAsignacion;
  items: Asignacion[];
  personal: Personal[];
  canWrite: boolean;
  actor: string;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [acta, setActa] = useState(inicial);
  useEffect(() => { setActa(inicial); }, [inicial]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [miniaturas, setMiniaturas] = useState<Record<string, string>>({});
  const [porQuitar, setPorQuitar] = useState<{ tipo: 'foto'; path: string } | { tipo: 'firmada' } | null>(null);
  const [editarEntrega, setEditarEntrega] = useState(false);

  const personaPorId = useMemo(() => new Map(personal.map((p) => [p.id, p])), [personal]);
  const recibe = personaPorId.get(acta.personal_id) ?? null;
  const nombre = (p: Personal | null | undefined) => (p ? `${p.nombre} ${p.apellido ?? ''}`.trim() : '—');

  // Miniaturas del anexo: URL firmada por foto (10 min), solo de las que faltan.
  useEffect(() => {
    let vivo = true;
    (async () => {
      for (const f of acta.fotos) {
        if (miniaturas[f.path]) continue;
        try { const u = await urlArchivoActa(f.path); if (vivo) setMiniaturas((m) => ({ ...m, [f.path]: u })); }
        catch { /* sin miniatura, el nombre alcanza */ }
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acta.fotos]);

  async function hecho(nuevo: ActaAsignacion, msg: string) {
    setActa(nuevo); toast(msg, 'success'); await onChanged();
  }

  async function agregarFotos(files: FileList | null) {
    const lista = Array.from(files ?? []);
    if (!lista.length) return;
    const mal = errorFotosActa(lista, acta.fotos.length);
    if (mal) { toast(mal, 'warning'); return; }
    setOcupado('fotos');
    try { await hecho(await subirFotosActa(acta, lista), lista.length === 1 ? 'Foto agregada al anexo' : `${lista.length} fotos agregadas al anexo`); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudieron subir las fotos', 'error'); }
    finally { setOcupado(null); }
  }

  async function subirFirmada(file: File | null | undefined) {
    if (!file) return;
    setOcupado('firmada');
    try { await hecho(await subirActaFirmada(acta, file, actor), 'Acta firmada guardada'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo subir el acta firmada', 'error'); }
    finally { setOcupado(null); }
  }

  async function confirmarQuitar() {
    const q = porQuitar; setPorQuitar(null);
    if (!q) return;
    try {
      if (q.tipo === 'foto') await hecho(await quitarFotoActa(acta, q.path), 'Foto quitada del anexo');
      else await hecho(await quitarActaFirmada(acta), 'Acta firmada quitada');
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo quitar', 'error'); }
  }

  async function ver(path: string, nombreArchivo: string, titulo: string) {
    try { await previewFileUrl(await urlArchivoActa(path), nombreArchivo, titulo); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir', 'error'); }
  }

  async function verPdf() {
    setOcupado('pdf');
    try {
      const fotos: { dataUrl: string; filename: string }[] = [];
      for (const f of acta.fotos) {
        try { fotos.push({ dataUrl: await dataUrlArchivoActa(f.path), filename: f.filename }); }
        catch { /* una foto que no baja no frena el acta */ }
      }
      const { verActaEntregaPdf } = await import('./actaEntregaPdf');
      await verActaEntregaPdf(acta, items, recibe, fotos);
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar el acta', 'error'); }
    finally { setOcupado(null); }
  }

  async function cambiarEntrega(id: string) {
    const p = personaPorId.get(id) ?? null;
    try { await hecho(await actualizarActa(acta.id, { entrega: p }), 'Quien entrega actualizado'); setEditarEntrega(false); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cambiar', 'error'); }
  }

  const opcionesPersonal = useMemo(() => personal.filter((p) => p.activo).map((p) => ({
    value: p.id, label: nombre(p), hint: p.cargo ?? numeroFicha(p.numero_ficha), keywords: [p.cedula ?? '', p.cargo ?? ''],
  })), [personal]);

  return (
    <Modal title={`📝 Acta de entrega · ASIGNACIÓN ${acta.numero}`} size="lg" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        <button className="btn btn-primary" onClick={() => void verPdf()} disabled={ocupado === 'pdf'}>{ocupado === 'pdf' ? 'Generando…' : '📝 Ver acta en PDF'}</button>
      </>
    }>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.6rem', marginBottom: '.7rem' }}>
        <div className="card" style={{ padding: '.55rem .7rem' }}>
          <div className="muted" style={{ fontSize: '.7rem', letterSpacing: '.04em' }}>RECIBE</div>
          <strong>{nombre(recibe)}</strong>
          <div className="muted" style={{ fontSize: '.76rem' }}>{[recibe?.cedula ? `C.I. ${cedulaConPuntos(recibe.cedula)}` : '', recibe?.cargo ?? ''].filter(Boolean).join(' · ') || '—'}</div>
        </div>
        <div className="card" style={{ padding: '.55rem .7rem' }}>
          <div className="muted" style={{ fontSize: '.7rem', letterSpacing: '.04em', display: 'flex', gap: '.4rem', alignItems: 'center' }}>
            ENTREGA (POR LA EMPRESA)
            {canWrite && !editarEntrega && <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setEditarEntrega(true)} title="Cambiar quién entrega">✎</button>}
          </div>
          {editarEntrega
            ? <SearchSelect options={opcionesPersonal} value={acta.entrega_personal_id ?? ''} onChange={(id) => void cambiarEntrega(id)} placeholder="🔍 Buscar quién entrega…" sinPreseleccion />
            : (
              <>
                <strong>{acta.entrega_nombre || '— sin indicar —'}</strong>
                <div className="muted" style={{ fontSize: '.76rem' }}>{[acta.entrega_cedula ? `C.I. ${cedulaConPuntos(acta.entrega_cedula)}` : '', acta.entrega_cargo ?? ''].filter(Boolean).join(' · ') || '—'}</div>
              </>
            )}
        </div>
        <div className="card" style={{ padding: '.55rem .7rem' }}>
          <div className="muted" style={{ fontSize: '.7rem', letterSpacing: '.04em' }}>FECHA · REGISTRO</div>
          <strong>{fmtDate(acta.fecha)}</strong>
          <div className="muted" style={{ fontSize: '.76rem' }}>{acta.actor_name || acta.creado_por || '—'}{acta.historico ? ' · histórico' : ''}</div>
        </div>
      </div>

      {acta.observaciones && <p className="muted" style={{ fontSize: '.84rem', marginTop: 0 }}>Observación: {acta.observaciones}</p>}

      <table className="table" style={{ marginBottom: '.8rem' }}>
        <thead><tr><th>#</th><th>Tipo</th><th>Lo entregado</th><th>Estado</th></tr></thead>
        <tbody>
          {items.map((a, i) => (
            <tr key={a.id}>
              <td className="muted">{i + 1}</td>
              <td>{iconoTipo(a.tipo)} {labelTipo(a.tipo)}</td>
              <td>{a.descripcion}{a.serial ? <span className="muted"> · S/N {a.serial}</span> : null}{a.numero_linea ? <span className="muted"> · línea {a.numero_linea}</span> : null}{Number(a.cantidad) > 1 ? <span className="muted"> · {a.cantidad} {a.unidad ?? 'und'}</span> : null}</td>
              <td>{textoEstado(a.estado, a.retornable)}</td>
            </tr>
          ))}
          {!items.length && <tr><td colSpan={4} className="muted">Esta acta ya no tiene ítems.</td></tr>}
        </tbody>
      </table>

      {/* ── Anexo fotográfico ── */}
      <div className="card" style={{ padding: '.6rem .75rem', marginBottom: '.6rem' }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          📷 Anexo fotográfico <span className="muted" style={{ fontWeight: 400 }}>· {acta.fotos.length} de {MAX_FOTOS_ACTA}</span>
          {canWrite && acta.fotos.length < MAX_FOTOS_ACTA && (
            <label className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto', cursor: 'pointer' }}>
              {ocupado === 'fotos' ? 'Subiendo…' : '+ Agregar fotos'}
              <input type="file" accept="image/*" multiple hidden disabled={ocupado === 'fotos'} onChange={(e) => { void agregarFotos(e.target.files); e.target.value = ''; }} />
            </label>
          )}
        </div>
        {!acta.fotos.length && <div className="muted" style={{ fontSize: '.82rem' }}>Sin fotos. La foto de lo entregado va en la segunda hoja del acta.</div>}
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          {acta.fotos.map((f) => (
            <div key={f.path} style={{ width: 150, border: '1px solid var(--border)', borderRadius: 6, padding: '.3rem', fontSize: '.72rem' }}>
              <button type="button" onClick={() => void ver(f.path, f.filename, 'Anexo fotográfico')} title="Ver en grande"
                style={{ display: 'block', width: '100%', height: 100, padding: 0, border: 0, background: 'var(--bg-2, #1a1f27)', borderRadius: 4, overflow: 'hidden', cursor: 'pointer' }}>
                {miniaturas[f.path] ? <img src={miniaturas[f.path]} alt={f.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="muted">cargando…</span>}
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem', marginTop: '.25rem' }}>
                <span className="muted" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.filename}>{f.filename}</span>
                {canWrite && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)', padding: '0 .3rem' }} title="Quitar foto" onClick={() => setPorQuitar({ tipo: 'foto', path: f.path })}>🗑</button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── El acta firmada ── */}
      <div className="card" style={{ padding: '.6rem .75rem' }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          🖊 Acta firmada
          {canWrite && (
            <label className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto', cursor: 'pointer' }}>
              {ocupado === 'firmada' ? 'Subiendo…' : acta.firmada_path ? '⬆ Reemplazar' : '⬆ Subir escaneo'}
              <input type="file" accept="application/pdf,image/*" hidden disabled={ocupado === 'firmada'} onChange={(e) => { void subirFirmada(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          )}
        </div>
        {acta.firmada_path
          ? (
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '.84rem' }}>
              <span>✔ <strong>{acta.firmada_nombre}</strong></span>
              <span className="muted" style={{ fontSize: '.76rem' }}>subida {fmtDate(acta.firmada_at)}{acta.firmada_por ? ` por ${acta.firmada_por}` : ''}</span>
              <button className="btn btn-sm btn-ghost" onClick={() => void ver(acta.firmada_path as string, acta.firmada_nombre ?? 'acta-firmada', `Acta ${acta.numero} firmada`)}>👁 Ver</button>
              {canWrite && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setPorQuitar({ tipo: 'firmada' })}>🗑</button>}
            </div>
          )
          : <div className="muted" style={{ fontSize: '.82rem' }}>Todavía no se subió. Imprime el acta, fírmala con huella y sube acá el escaneo o la foto: así no depende del Drive.</div>}
      </div>

      {porQuitar && (
        <ConfirmDialog title={porQuitar.tipo === 'foto' ? 'Quitar foto' : 'Quitar acta firmada'} danger confirmText="Sí, quitar"
          message={porQuitar.tipo === 'foto' ? 'La foto sale del anexo fotográfico y se borra del sistema.' : 'Se borra el escaneo del acta firmada. El acta y sus ítems no se tocan.'}
          onConfirm={() => { void confirmarQuitar(); }} onCancel={() => setPorQuitar(null)} />
      )}
    </Modal>
  );
}
