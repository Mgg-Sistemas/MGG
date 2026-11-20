/* ============================================================
   MGG · RRHH · SOLICITUD DE PERMISO LABORAL (20-11-2026)

   Modal que se abre en Administrativo cuando Tipo = Permiso. El mismo
   contenido se pinta en el PDF (con el estilo del sistema) y se guarda
   junto con hasta 4 soportes PDF/imagen. Sirve para todas las empresas
   de la nómina, incluida GT.
   ============================================================ */
import { useRef, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { FechaVe } from '@/shared/ui/FechaVe';
import { SearchSelect, type SearchOption } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import type { Personal, RrhhEvento } from '@/shared/lib/types';
import {
  iconoAdjunto,
  pesoAdjunto,
  validarTandaAdjuntos,
  type AdjuntoSalida,
} from '@/modules/salidas/adjuntosSalida';
import type { Empresa } from './empresa';
import {
  COMPROMISO_TRABAJADOR,
  datosTrabajadorDe,
  diasInclusivePermiso,
  hoyIsoPermiso,
  validarSolicitudPermiso,
  type SolicitudPermisoForm,
} from './permisoLaboral';
import {
  agregarAdjuntosPermiso,
  guardarSolicitudPermiso,
  urlArchivoPermiso,
} from './permisoLaboral.repository';
import { verSolicitudPermisoPdf } from './solicitudPermisoPdf';

const VACIO_TRABAJADOR = { nombre: '', apellido: '', cedula: '', cargo: '', departamento: '', telefono: '' };

function inicial(personal: Personal[], personalId: string, empresa: Empresa, evento?: RrhhEvento | null): SolicitudPermisoForm {
  if (evento?.solicitud) return { ...evento.solicitud, personal_id: evento.personal_id };
  const p = personal.find((x) => x.id === personalId);
  return {
    personal_id: personalId,
    fecha_solicitud: hoyIsoPermiso(),
    fecha_inicio: '',
    fecha_fin: '',
    tiempo_solicitado: '',
    horario: '',
    motivo: '',
    compromiso: COMPROMISO_TRABAJADOR,
    trabajador: p ? datosTrabajadorDe(p) : { ...VACIO_TRABAJADOR },
    empresa,
  };
}

export function SolicitudPermisoModal({ personal, personalId, empresa, actor, actorName, evento, onClose, onGuardado }: {
  personal: Personal[];
  personalId: string;
  empresa: Empresa;
  actor: string;
  actorName: string | null;
  evento?: RrhhEvento | null;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [form, setForm] = useState<SolicitudPermisoForm>(() => inicial(personal, personalId, empresa, evento));
  const [adjuntos, setAdjuntos] = useState(evento?.adjuntos ?? []);
  const [nuevos, setNuevos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const camara = useRef<HTMLInputElement>(null);
  const archivos = useRef<HTMLInputElement>(null);
  const edicion = !!evento;

  const opciones: SearchOption[] = personal.filter((p) => p.activo || p.id === form.personal_id).map((p) => ({
    value: p.id,
    label: `${p.nombre} ${p.apellido}`.trim(),
    hint: p.numero_ficha ? `Ficha ${p.numero_ficha}` : p.cedula ?? undefined,
    keywords: [p.cedula, p.cargo, p.departamento, p.telefono].filter((x): x is string => !!x),
  }));

  function elegirTrabajador(id: string) {
    const p = personal.find((x) => x.id === id);
    setForm((f) => ({ ...f, personal_id: id, trabajador: p ? datosTrabajadorDe(p) : { ...VACIO_TRABAJADOR } }));
    setError(null);
  }

  function cambiarFecha(campo: 'fecha_inicio' | 'fecha_fin', valor: string) {
    setForm((f) => {
      const next = { ...f, [campo]: valor };
      const dias = diasInclusivePermiso(next.fecha_inicio, next.fecha_fin);
      if (dias > 0) next.tiempo_solicitado = `${dias} día(s)`;
      return next;
    });
  }

  function agregarArchivos(lista: FileList | null) {
    if (!lista?.length) return;
    const existentes: AdjuntoSalida[] = adjuntos.map((a) => ({ path: a.path, filename: a.filename }));
    const mal = validarTandaAdjuntos([...nuevos, ...Array.from(lista)], existentes);
    if (mal) { setError(mal); return; }
    setNuevos((n) => [...n, ...Array.from(lista)]);
    setError(null);
    if (camara.current) camara.current.value = '';
    if (archivos.current) archivos.current.value = '';
  }

  async function verAdjunto(path: string) {
    try { window.open(await urlArchivoPermiso(path), '_blank', 'noopener,noreferrer'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo abrir el archivo', 'error'); }
  }

  async function verPdf() {
    setError(null);
    const mal = validarSolicitudPermiso(form);
    if (mal) { setError(mal); return; }
    try { await verSolicitudPermisoPdf(form, empresa); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar el PDF'); }
  }

  async function guardar() {
    setError(null);
    if (edicion && !nuevos.length) { setError('Elegí al menos un archivo para agregar.'); return; }
    if (!edicion) {
      const mal = validarSolicitudPermiso(form);
      if (mal) { setError(mal); return; }
    }
    const existentes: AdjuntoSalida[] = adjuntos.map((a) => ({ path: a.path, filename: a.filename }));
    const malArchivos = validarTandaAdjuntos(nuevos, existentes);
    if (malArchivos) { setError(malArchivos); return; }

    setGuardando(true);
    try {
      if (evento) {
        const todos = await agregarAdjuntosPermiso(evento, nuevos);
        setAdjuntos(todos); setNuevos([]);
        toast('Soportes guardados', 'success');
      } else {
        const creado = await guardarSolicitudPermiso(form, nuevos, actor, actorName);
        setAdjuntos(creado.adjuntos ?? []); setNuevos([]);
        toast('Solicitud guardada con su PDF', 'success');
      }
      onGuardado();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la solicitud.');
    } finally { setGuardando(false); }
  }

  const cupo = 4 - adjuntos.length - nuevos.length;

  return (
    <Modal
      title="SOLICITUD DE PERMISO LABORAL"
      size="lg"
      onClose={() => { if (!guardando) onClose(); }}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
        <button className="btn" onClick={() => void verPdf()} disabled={guardando || edicion}>📄 Vista previa del PDF</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={guardando}>
          {guardando ? 'Guardando…' : edicion ? '📎 Guardar soportes' : '💾 Guardar solicitud'}
        </button>
      </>}
    >
      {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.7rem' }}><strong>Revisá:</strong> {error}</div>}

      <div className="form-grid">
        <div className="form-row">
          <label>Trabajador</label>
          <SearchSelect
            options={opciones}
            value={form.personal_id}
            onChange={elegirTrabajador}
            placeholder="Buscar por nombre, cédula, cargo…"
            emptyText="Sin trabajadores para esta empresa"
            disabled={edicion}
          />
        </div>
        <div className="form-row">
          <label>Fecha de Solicitud</label>
          <FechaVe value={form.fecha_solicitud} onChange={(v) => setForm((f) => ({ ...f, fecha_solicitud: v }))} disabled={edicion} />
          <span className="muted" style={{ fontSize: '.72rem' }}>Formato d/mm/aaaa</span>
        </div>
      </div>

      <h3 style={{ fontSize: '.85rem', margin: '1rem 0 .5rem', color: 'var(--primary, #ff8a00)' }}>DATOS DEL TRABAJADOR</h3>
      <div className="form-grid">
        {([
          ['Nombre y apellido', `${form.trabajador.nombre} ${form.trabajador.apellido}`.trim()],
          ['Cédula', form.trabajador.cedula],
          ['Cargo', form.trabajador.cargo],
          ['Departamento', form.trabajador.departamento],
          ['Teléfono', form.trabajador.telefono],
        ] as const).map(([etiqueta, valor]) => (
          <div className="form-row" key={etiqueta}>
            <label>{etiqueta}</label>
            <input className="input" value={valor || '—'} readOnly style={{ background: 'var(--surface-2, transparent)' }} />
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: '.85rem', margin: '1rem 0 .5rem', color: 'var(--primary, #ff8a00)' }}>DETALLES DEL PERMISO</h3>
      <div className="form-grid">
        <div className="form-row"><label>Fecha Inicio</label><FechaVe value={form.fecha_inicio} onChange={(v) => cambiarFecha('fecha_inicio', v)} disabled={edicion} /></div>
        <div className="form-row"><label>Fecha fin</label><FechaVe value={form.fecha_fin} onChange={(v) => cambiarFecha('fecha_fin', v)} disabled={edicion} /></div>
        <div className="form-row"><label>Tiempo solicitado</label><input className="input" value={form.tiempo_solicitado} onChange={(e) => setForm((f) => ({ ...f, tiempo_solicitado: e.target.value }))} readOnly={edicion} placeholder="Ej. 3 día(s), 4 horas" /></div>
        <div className="form-row"><label>Horario (si aplica)</label><input className="input" value={form.horario} onChange={(e) => setForm((f) => ({ ...f, horario: e.target.value }))} readOnly={edicion} placeholder="Ej. 08:00 a 12:00" /></div>
        <div className="form-row" style={{ gridColumn: '1 / -1' }}>
          <label>Motivo de la Ausencia</label>
          <textarea className="input" rows={3} value={form.motivo} onChange={(e) => setForm((f) => ({ ...f, motivo: e.target.value }))} readOnly={edicion} />
        </div>
      </div>

      <h3 style={{ fontSize: '.85rem', margin: '1rem 0 .5rem', color: 'var(--primary, #ff8a00)' }}>SOPORTES (PDF o imágenes, máx. 4)</h3>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        <input ref={camara} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => agregarArchivos(e.target.files)} />
        <input ref={archivos} type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => agregarArchivos(e.target.files)} />
        <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => camara.current?.click()}>📷 Tomar foto</button>
        <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => archivos.current?.click()}>🖼 Elegir PDF o imagen</button>
        <span className="muted" style={{ alignSelf: 'center' }}>{cupo} cupo(s) disponible(s)</span>
      </div>
      {(adjuntos.length > 0 || nuevos.length > 0) && (
        <div style={{ marginTop: '.6rem', display: 'grid', gap: '.35rem' }}>
          {adjuntos.map((a) => (
            <div key={a.path} className="card" style={{ padding: '.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
              <span>{iconoAdjunto(a)} {a.filename} <span className="muted">({pesoAdjunto(a.size ?? 0)})</span></span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void verAdjunto(a.path)}>Ver</button>
            </div>
          ))}
          {nuevos.map((f, i) => (
            <div key={`${f.name}-${i}`} className="card" style={{ padding: '.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
              <span>{iconoAdjunto({ filename: f.name })} {f.name} <span className="muted">({pesoAdjunto(f.size)})</span></span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNuevos((n) => n.filter((_, j) => j !== i))}>✕ Quitar</button>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: '.75rem', marginTop: '1rem', background: 'var(--surface-2, transparent)' }}>
        <strong style={{ fontSize: '.85rem' }}>COMPROMISO DEL TRABAJADOR:</strong>
        <p style={{ fontSize: '.85rem', marginBottom: 0 }}>{COMPROMISO_TRABAJADOR}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginTop: '1.5rem' }}>
        <div><div style={{ borderTop: '1px solid var(--border)', paddingTop: '.4rem', textAlign: 'center', fontSize: '.8rem' }}>Firma del trabajador</div></div>
        <div><div style={{ borderTop: '1px solid var(--border)', paddingTop: '.4rem', textAlign: 'center', fontSize: '.8rem' }}>Firma de RRHH</div></div>
      </div>
    </Modal>
  );
}
