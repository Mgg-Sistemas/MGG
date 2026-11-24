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
  datosJefeDe,
  datosTrabajadorDe,
  diasInclusivePermiso,
  hayCambioFirmaEnEdicion,
  inicialSolicitudPermiso,
  solicitudSinPersonal,
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
  const [form, setForm] = useState<SolicitudPermisoForm>(() => inicialSolicitudPermiso(personal, personalId, empresa, evento));
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

  const opcionesJefe: SearchOption[] = personal
    .filter((p) => p.activo || p.id === form.jefe_departamento?.personal_id)
    .map((p) => ({
      value: p.id,
      label: `${p.nombre} ${p.apellido}`.trim(),
      hint: p.cargo ? `${p.cargo}${p.departamento ? ` · ${p.departamento}` : ''}` : p.cedula ?? undefined,
      keywords: [p.cedula, p.cargo, p.departamento, p.telefono].filter((x): x is string => !!x),
    }));

  function elegirTrabajador(id: string) {
    const p = personal.find((x) => x.id === id);
    setForm((f) => ({ ...f, personal_id: id, trabajador: p ? datosTrabajadorDe(p) : { ...VACIO_TRABAJADOR } }));
    setError(null);
  }

  function elegirJefe(id: string) {
    const p = personal.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      jefe_departamento: p ? datosJefeDe(p) : null,
    }));
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
    try { await verSolicitudPermisoPdf(form, form.empresa); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo generar el PDF'); }
  }

  async function guardar() {
    setError(null);
    const cambioFirma = edicion && hayCambioFirmaEnEdicion(evento, form);
    if (edicion && !nuevos.length && !cambioFirma) {
      setError('Elegí un soporte o marcá la firma del jefe para guardar.'); return;
    }
    if (form.requiere_firma_jefe && !form.jefe_departamento) {
      setError('Elegí el jefe de departamento para la firma.'); return;
    }
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
        const todos = await agregarAdjuntosPermiso(evento, nuevos, solicitudSinPersonal(form));
        setAdjuntos(todos); setNuevos([]);
        toast(nuevos.length ? 'Soportes y firma guardados' : 'Firma guardada', 'success');
        if (cambioFirma) void verSolicitudPermisoPdf(form, form.empresa);
      } else {
        const creado = await guardarSolicitudPermiso(form, nuevos, actor, actorName);
        setAdjuntos(creado.adjuntos ?? []); setNuevos([]);
        toast('Solicitud guardada con su PDF', 'success');
        void verSolicitudPermisoPdf(form, form.empresa);
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
        <button className="btn" onClick={() => void verPdf()} disabled={guardando}>📄 Vista previa del PDF</button>
        <button className="btn btn-primary" onClick={() => void guardar()} disabled={guardando}>
          {guardando ? 'Guardando…' : edicion ? '💾 Guardar cambios' : '💾 Guardar solicitud'}
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

      <div className="card" style={{ padding: '.75rem', marginTop: '.75rem', background: 'var(--surface-2, transparent)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontWeight: 600, fontSize: '.85rem' }}>
          <input
            type="checkbox"
            checked={!!form.requiere_firma_jefe}
            onChange={(e) => {
              const checked = e.target.checked;
              setForm((f) => ({
                ...f,
                requiere_firma_jefe: checked,
                jefe_departamento: checked ? f.jefe_departamento : null,
              }));
            }}
          />
          <span>✍️ Incluir firma de jefe del departamento (opcional)</span>
        </label>
        {form.requiere_firma_jefe && (
          <div style={{ marginTop: '.6rem' }}>
            <label style={{ fontSize: '.8rem', display: 'block', marginBottom: '.3rem' }}>Jefe de departamento *</label>
            <SearchSelect
              options={opcionesJefe}
              value={form.jefe_departamento?.personal_id ?? ''}
              onChange={elegirJefe}
              placeholder="Buscar por nombre, cédula, cargo o departamento…"
              emptyText="Sin trabajadores disponibles"
            />
            {form.jefe_departamento && (
              <div className="muted" style={{ fontSize: '.75rem', marginTop: '.35rem' }}>
                Firma: <strong>{form.jefe_departamento.nombre} {form.jefe_departamento.apellido}</strong>
                {form.jefe_departamento.cargo ? ` · ${form.jefe_departamento.cargo}` : ''}
                {form.jefe_departamento.departamento ? ` (${form.jefe_departamento.departamento})` : ''}
              </div>
            )}
          </div>
        )}
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

      <div className="card" style={{ padding: '.75rem', marginTop: '1rem', background: 'var(--surface-2, transparent)', borderLeft: '3px solid var(--primary, #ff8a00)' }}>
        <strong style={{ fontSize: '.85rem', color: 'var(--primary, #ff8a00)' }}>COMPROMISO DEL TRABAJADOR:</strong>
        <p style={{ fontSize: '.85rem', marginBottom: 0, textAlign: 'justify', lineHeight: 1.45 }}>{COMPROMISO_TRABAJADOR}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: form.requiere_firma_jefe ? '1fr 1fr 1fr' : '1fr 1fr', gap: form.requiere_firma_jefe ? '1rem' : '2rem', marginTop: '1.5rem' }}>
        <div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.4rem', textAlign: 'center', fontSize: '.8rem' }}>
            <div style={{ fontWeight: 700 }}>Firma del trabajador</div>
            {(`${form.trabajador.nombre ?? ''} ${form.trabajador.apellido ?? ''}`.trim()) && (
              <div style={{ fontSize: '.76rem', marginTop: '.2rem', fontWeight: 600 }}>
                {`${form.trabajador.nombre} ${form.trabajador.apellido}`.trim().toUpperCase()}
              </div>
            )}
            {form.trabajador.cedula && (
              <div className="muted" style={{ fontSize: '.72rem' }}>C.I. {form.trabajador.cedula}</div>
            )}
          </div>
        </div>
        {form.requiere_firma_jefe && (
          <div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.4rem', textAlign: 'center', fontSize: '.8rem' }}>
              <div style={{ fontWeight: 700 }}>Firma Jefe de Depto.</div>
              {form.jefe_departamento ? (
                <>
                  <div style={{ fontSize: '.76rem', marginTop: '.2rem', fontWeight: 600 }}>
                    {`${form.jefe_departamento.nombre} ${form.jefe_departamento.apellido}`.trim().toUpperCase()}
                  </div>
                  {form.jefe_departamento.cargo && (
                    <div className="muted" style={{ fontSize: '.72rem' }}>{form.jefe_departamento.cargo}</div>
                  )}
                </>
              ) : (
                <div className="muted" style={{ fontSize: '.72rem', fontStyle: 'italic', marginTop: '.2rem' }}>Pendiente por seleccionar</div>
              )}
            </div>
          </div>
        )}
        <div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.4rem', textAlign: 'center', fontSize: '.8rem' }}>
            <div style={{ fontWeight: 700 }}>Firma de RRHH</div>
            <div style={{ fontSize: '.76rem', marginTop: '.2rem' }}>Departamento de Recursos Humanos</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
