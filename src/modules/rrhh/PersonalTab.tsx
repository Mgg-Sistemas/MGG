import { useCallback, useEffect, useRef, useState, type FormEvent, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { money, date, dateTime } from '@/shared/lib/format';
import { useRealtime } from '@/shared/lib/useRealtime';
import type { Personal, NominaRenglon } from '@/shared/lib/types';
import {
  listPersonal, crearPersonal, actualizarPersonal, setPersonalActivo, eliminarPersonal,
  subirFotoCarnet, type PersonalInput,
} from './personal.repository';
import { listHistoricoPersona } from './nomina.repository';
import { listCargos, listDepartamentos, addCargo, addDepartamento } from './catalogos';
import { generarFrenteBlob, generarReversoBlob, descargarCarnet } from './carnetImagen';
import { descargarConstanciaTrabajoPdf } from './constanciaTrabajoPdf';

const VACIO: PersonalInput = { nombre: '', apellido: '', cedula: '', cargo: '', departamento: '', sueldo_base: 0, fecha_ingreso: '', telefono: '', contacto_emergencia: '', contacto_emergencia_tlf: '', foto_url: '', foto_pos_x: 0.5, foto_pos_y: 0.5, foto_zoom: 1 };

/** Limita la cédula a formato venezolano: prefijo opcional (V/E/J/G/P) + hasta 8 dígitos. */
function sanitizarCedula(v: string): string {
  const limpio = (v || '').toUpperCase().replace(/[^VEJGP0-9]/g, '');
  const letra = /^[VEJGP]/.test(limpio) ? limpio[0] : '';
  const digitos = limpio.replace(/[^0-9]/g, '').slice(0, 8);
  return letra && digitos ? `${letra}-${digitos}` : letra + digitos;
}

/**
 * Encuadre de la foto del carnet: muestra la imagen dentro de un marco con la MISMA
 * proporción que el carnet (260×300) y deja al usuario ARRASTRARLA para centrar la cara,
 * más un zoom. La posición (0..1) y el zoom se guardan y el carnet los respeta idénticos.
 */
function FotoEncuadre({ url, posX, posY, zoom, onChange }: {
  url: string; posX: number; posY: number; zoom: number;
  onChange: (v: { foto_pos_x: number; foto_pos_y: number; foto_zoom: number }) => void;
}) {
  const BOX_W = 191, BOX_H = 220;   // proporción del carnet: 260×300
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  useEffect(() => {
    let vivo = true; const im = new Image();
    im.onload = () => { if (vivo) setNat({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 }); };
    im.onerror = () => { if (vivo) setNat(null); };
    im.src = url;
    return () => { vivo = false; };
  }, [url]);

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  const z = Math.min(4, Math.max(1, zoom));
  const base = nat ? Math.max(BOX_W / nat.w, BOX_H / nat.h) : 1;
  const scale = base * z;
  const dispW = nat ? nat.w * scale : BOX_W;
  const dispH = nat ? nat.h * scale : BOX_H;
  const overX = Math.max(0, dispW - BOX_W);
  const overY = Math.max(0, dispH - BOX_H);
  const left = -overX * clamp01(posX);
  const top = -overY * clamp01(posY);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: posX, py: posY };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    const nx = overX > 0 ? clamp01(drag.current.px - dx / overX) : 0.5;
    const ny = overY > 0 ? clamp01(drag.current.py - dy / overY) : 0.5;
    onChange({ foto_pos_x: nx, foto_pos_y: ny, foto_zoom: z });
  };
  const onUp = () => { drag.current = null; };

  return (
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
        style={{ width: BOX_W, height: BOX_H, borderRadius: 12, border: '3px solid var(--primary)', overflow: 'hidden', position: 'relative', cursor: 'grab', touchAction: 'none', background: 'var(--bg-1)', flexShrink: 0 }}
        title="Arrastrá para mover la foto dentro del marco">
        {nat
          ? <img src={url} alt="Encuadre" draggable={false} style={{ position: 'absolute', left, top, width: dispW, height: dispH, maxWidth: 'none', userSelect: 'none', pointerEvents: 'none' }} />
          : <div className="muted" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.8rem' }}>Cargando…</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', minWidth: 180, flex: '1 1 180px' }}>
        <small className="muted">Arrastrá la foto para <strong>centrar la cara</strong> en el marco (proporción real del carnet). Así queda en el carnet.</small>
        <label style={{ fontSize: '.82rem' }}>Zoom <span className="mono muted">{z.toFixed(2)}×</span>
          <input type="range" min={1} max={4} step={0.01} value={z}
            onChange={(e) => onChange({ foto_pos_x: posX, foto_pos_y: posY, foto_zoom: Number(e.target.value) })}
            style={{ width: '100%' }} />
        </label>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange({ foto_pos_x: 0.5, foto_pos_y: 0.5, foto_zoom: 1 })}>↺ Centrar / restablecer</button>
      </div>
    </div>
  );
}

export function PersonalTab({ canWrite, actor }: { canWrite: boolean; actor: string }) {
  const [lista, setLista] = useState<Personal[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PersonalInput>(VACIO);
  const [guardando, setGuardando] = useState(false);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [histPersona, setHistPersona] = useState<Personal | null>(null);
  const [carnetPersona, setCarnetPersona] = useState<Personal | null>(null);
  const [constanciaPersona, setConstanciaPersona] = useState<Personal | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [cargos, setCargos] = useState<string[]>([]);
  const [departamentos, setDepartamentos] = useState<string[]>([]);

  const recargar = useCallback(async () => {
    setLoading(true);
    try { setLista(await listPersonal(false)); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cargar el personal', 'error'); }
    finally { setLoading(false); }
  }, []);
  const cargarCatalogos = useCallback(() => {
    listCargos().then(setCargos).catch(() => { /* catálogo opcional */ });
    listDepartamentos().then(setDepartamentos).catch(() => { /* catálogo opcional */ });
  }, []);
  useEffect(() => { void recargar(); }, [recargar]);
  useEffect(() => { cargarCatalogos(); }, [cargarCatalogos]);
  useRealtime(['personal'], () => { void recargar(); });

  function abrirNuevo() { setEditId(null); setForm(VACIO); setError(null); setFormOpen(true); }
  function editar(p: Personal) {
    setEditId(p.id);
    setForm({ nombre: p.nombre, apellido: p.apellido, cedula: p.cedula ?? '', cargo: p.cargo ?? '', departamento: p.departamento ?? '', sueldo_base: Number(p.sueldo_base) || 0, fecha_ingreso: p.fecha_ingreso ?? '', telefono: p.telefono ?? '', contacto_emergencia: p.contacto_emergencia ?? '', contacto_emergencia_tlf: p.contacto_emergencia_tlf ?? '', foto_url: p.foto_url ?? '', foto_pos_x: p.foto_pos_x == null ? 0.5 : Number(p.foto_pos_x), foto_pos_y: p.foto_pos_y == null ? 0.5 : Number(p.foto_pos_y), foto_zoom: p.foto_zoom == null ? 1 : Number(p.foto_zoom) });
    setError(null); setFormOpen(true);
  }
  function cerrarForm() { setEditId(null); setForm(VACIO); setError(null); setFormOpen(false); }

  async function onPickFoto(file: File | null) {
    if (!file) return;
    setSubiendoFoto(true); setError(null);
    try {
      const url = await subirFotoCarnet(file);
      // Nueva foto → arranca centrada y sin zoom (el usuario la reencuadra si quiere).
      setForm((f) => ({ ...f, foto_url: url, foto_pos_x: 0.5, foto_pos_y: 0.5, foto_zoom: 1 }));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo subir la foto'); }
    finally { setSubiendoFoto(false); }
  }
  function quitarFoto() { setForm((f) => ({ ...f, foto_url: '', foto_pos_x: 0.5, foto_pos_y: 0.5, foto_zoom: 1 })); }

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!form.nombre.trim()) { setError('Indicá el nombre.'); return; }
    setGuardando(true);
    try {
      if (editId) await actualizarPersonal(editId, form);
      else await crearPersonal(form, actor);
      // Si el cargo/departamento es nuevo, lo agregamos al catálogo compartido.
      const cargo = (form.cargo ?? '').trim();
      const depto = (form.departamento ?? '').trim();
      if (cargo && !cargos.includes(cargo)) await addCargo(cargo, actor).catch(() => {});
      if (depto && !departamentos.includes(depto)) await addDepartamento(depto, actor).catch(() => {});
      cargarCatalogos();
      toast(editId ? 'Personal actualizado' : 'Personal agregado', 'success');
      cerrarForm();
      await recargar();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); }
    finally { setGuardando(false); }
  }

  async function toggleActivo(p: Personal) {
    try { await setPersonalActivo(p.id, !p.activo); await recargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo cambiar', 'error'); }
  }
  async function borrar(p: Personal) {
    if (!window.confirm(`¿Eliminar a ${p.nombre} ${p.apellido} de la nómina? (no afecta los pagos ya hechos)`)) return;
    try { await eliminarPersonal(p.id); await recargar(); toast('Eliminado', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <div>
      {canWrite && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '.75rem' }}>
          <button className="btn btn-primary" onClick={abrirNuevo}>+ Ingresar Registro de Personal</button>
        </div>
      )}

      <div className="table-wrap">
        <table className="table" style={{ fontSize: '.85rem' }}>
          <thead><tr><th>Persona</th><th>Departamento</th><th>Cargo</th><th style={{ textAlign: 'right' }}>Sueldo base</th><th style={{ textAlign: 'center' }}>Estado</th><th style={{ textAlign: 'center' }}>Acciones</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !lista.length && <tr><td colSpan={6}><EmptyState message="Sin personal. Usá “+ Ingresar Registro de Personal”." icon="👥" /></td></tr>}
            {!loading && lista.map((p) => (
              <tr key={p.id} style={{ opacity: p.activo ? 1 : 0.55 }}>
                <td>{p.nombre} {p.apellido}{p.cedula ? <span className="muted"> · {p.cedula}</span> : null}</td>
                <td className="muted">{p.departamento || '—'}</td>
                <td className="muted">{p.cargo || '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{Number(p.sueldo_base) > 0 ? money(p.sueldo_base) : '—'}</td>
                <td style={{ textAlign: 'center' }}><span className="badge" style={{ color: p.activo ? 'var(--success)' : 'var(--muted)' }}>{p.activo ? 'Activo' : 'Inactivo'}</span></td>
                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setCarnetPersona(p)} title="Carnet (imagen con QR)">🪪</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setConstanciaPersona(p)} title="Constancia de trabajo (PDF)">📄</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => setHistPersona(p)} title="Histórico de pagos">🧾</button>
                  {canWrite && <>
                    <button className="btn btn-sm btn-ghost" onClick={() => editar(p)} title="Editar">✎</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => toggleActivo(p)} title={p.activo ? 'Desactivar' : 'Activar'}>{p.activo ? '⏸' : '▶'}</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => borrar(p)} title="Eliminar" style={{ color: 'var(--danger)' }}>🗑</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <Modal
          title={editId ? 'Editar registro de personal' : 'Ingresar registro de personal'}
          size="lg"
          onClose={() => { if (!guardando) cerrarForm(); }}
          footer={
            <>
              <button className="btn btn-ghost" onClick={cerrarForm} disabled={guardando}>Cancelar</button>
              <button type="submit" form="rrhh-personal-form" className="btn btn-primary" disabled={guardando}>
                {guardando ? 'Guardando…' : editId ? 'Guardar cambios' : '+ Agregar'}
              </button>
            </>
          }
        >
          <form id="rrhh-personal-form" onSubmit={guardar}>
            {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.6rem' }}><strong>Error:</strong> {error}</div>}

            {/* Foto del carnet (opcional): subir / cambiar / quitar. */}
            <div className="form-row">
              <label>Foto del carnet</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.8rem', flexWrap: 'wrap' }}>
                <div style={{ width: 84, height: 96, borderRadius: 10, border: '2px solid var(--primary)', overflow: 'hidden', background: 'var(--bg-1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {form.foto_url
                    ? <img src={form.foto_url} alt="Foto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span className="muted" style={{ fontSize: '1.6rem' }}>👤</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                  <label className="btn btn-sm btn-ghost" style={{ cursor: subiendoFoto ? 'wait' : 'pointer' }}>
                    {subiendoFoto ? 'Subiendo…' : (form.foto_url ? '🔄 Cambiar foto' : '📷 Subir foto')}
                    <input type="file" accept="image/*" style={{ display: 'none' }} disabled={subiendoFoto}
                      onChange={(e) => { void onPickFoto(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                  </label>
                  {form.foto_url && <button type="button" className="btn btn-sm btn-danger" onClick={quitarFoto} disabled={subiendoFoto}>🗑 Quitar</button>}
                </div>
                <small className="muted" style={{ flex: '1 1 160px', minWidth: 0 }}>Imagen (JPG/PNG) ≤ 5&nbsp;MB. Se recorta al marco del carnet.</small>
              </div>
            </div>

            {/* Encuadre de la foto: el usuario arrastra para centrar la cara + zoom. */}
            {form.foto_url && (
              <div className="form-row">
                <label>Encuadre de la foto <span className="muted" style={{ fontWeight: 400 }}>· arrastrá para centrar la cara</span></label>
                <FotoEncuadre
                  url={form.foto_url}
                  posX={form.foto_pos_x ?? 0.5}
                  posY={form.foto_pos_y ?? 0.5}
                  zoom={form.foto_zoom ?? 1}
                  onChange={(v) => setForm((f) => ({ ...f, ...v }))}
                />
              </div>
            )}

            <div className="form-grid">
              <div className="form-row"><label>Nombre *</label><input className="input" autoFocus value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} required /></div>
              <div className="form-row"><label>Apellido</label><input className="input" value={form.apellido ?? ''} onChange={(e) => setForm((f) => ({ ...f, apellido: e.target.value }))} /></div>
              <div className="form-row"><label>Cédula</label><input className="input" value={form.cedula ?? ''} onChange={(e) => setForm((f) => ({ ...f, cedula: sanitizarCedula(e.target.value) }))} placeholder="V-12345678" maxLength={11} inputMode="numeric" /></div>
              <ComboConAgregar
                label="Cargo" valor={form.cargo ?? ''} opciones={cargos}
                onChange={(v) => setForm((f) => ({ ...f, cargo: v }))}
                hint="Elegí de la lista o agregá uno nuevo (queda guardado)." />
              <ComboConAgregar
                label="Departamento" valor={form.departamento ?? ''} opciones={departamentos}
                onChange={(v) => setForm((f) => ({ ...f, departamento: v }))}
                hint="Toma los de Usuarios; podés agregar uno nuevo." />
              <div className="form-row"><label>Sueldo base mensual (USD)</label><input className="input mono" type="number" min={0} step="any" value={form.sueldo_base ?? 0} onChange={(e) => setForm((f) => ({ ...f, sueldo_base: Number(e.target.value) || 0 }))} placeholder="0,00" /></div>
              <div className="form-row"><label>Fecha de ingreso</label><input className="input" type="date" value={form.fecha_ingreso ?? ''} onChange={(e) => setForm((f) => ({ ...f, fecha_ingreso: e.target.value }))} /></div>
              <div className="form-row"><label>Teléfono</label><input className="input mono" value={form.telefono ?? ''} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} placeholder="0414-1234567" inputMode="tel" /></div>
              <div className="form-row"><label>Contacto de emergencia</label><input className="input" value={form.contacto_emergencia ?? ''} onChange={(e) => setForm((f) => ({ ...f, contacto_emergencia: e.target.value }))} placeholder="Nombre y parentesco" /></div>
              <div className="form-row"><label>Tel. de emergencia</label><input className="input mono" value={form.contacto_emergencia_tlf ?? ''} onChange={(e) => setForm((f) => ({ ...f, contacto_emergencia_tlf: e.target.value }))} placeholder="0414-1234567" inputMode="tel" /></div>
            </div>
            <small className="muted" style={{ display: 'block', marginTop: '.5rem' }}>El sueldo base es <strong>mensual</strong>; la quincena = 15 días (mitad). Queda guardado para precargar la nómina. El <strong>teléfono</strong> y el <strong>contacto de emergencia</strong> se incluyen en el <strong>QR del carnet</strong> (🪪).</small>
          </form>
        </Modal>
      )}

      {histPersona && <HistoricoPersonaModal persona={histPersona} onClose={() => setHistPersona(null)} />}
      {carnetPersona && <CarnetModal persona={carnetPersona} onClose={() => setCarnetPersona(null)} />}
      {constanciaPersona && <ConstanciaModal persona={constanciaPersona} onClose={() => setConstanciaPersona(null)} />}
    </div>
  );
}

/* ───────── Constancia de trabajo (PDF, vista previa) ───────── */
function ConstanciaModal({ persona, onClose }: { persona: Personal; onClose: () => void }) {
  const [dirigidoA, setDirigidoA] = useState('A quien pueda interesar');
  const [lugar, setLugar] = useState('Puerto Ordaz, Estado Bolívar');
  const [incluirSalario, setIncluirSalario] = useState(true);
  const [generando, setGenerando] = useState(false);

  const faltan: string[] = [];
  if (!persona.cedula) faltan.push('cédula');
  if (!persona.cargo) faltan.push('cargo');
  if (!persona.fecha_ingreso) faltan.push('fecha de ingreso');

  async function generar() {
    setGenerando(true);
    try {
      await descargarConstanciaTrabajoPdf(persona, { dirigidoA: dirigidoA.trim() || 'A quien pueda interesar', lugar: lugar.trim() || 'Puerto Ordaz, Estado Bolívar', incluirSalario });
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo generar la constancia', 'error'); }
    finally { setGenerando(false); }
  }

  return (
    <Modal title={`Constancia de trabajo · ${persona.nombre} ${persona.apellido}`} size="md" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={generando}>Cancelar</button>
        <button className="btn btn-primary" onClick={generar} disabled={generando}>{generando ? 'Generando…' : '📄 Ver constancia (vista previa)'}</button>
      </>
    }>
      {faltan.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '.7rem', fontSize: '.85rem' }}>
          ⚠️ Este registro no tiene <strong>{faltan.join(', ')}</strong>. Podés generarla igual (esos datos se omiten) o completarlos primero con ✎ Editar.
        </div>
      )}
      <div className="form-row">
        <label>Dirigida a</label>
        <input className="input" value={dirigidoA} onChange={(e) => setDirigidoA(e.target.value)} placeholder="A quien pueda interesar" />
      </div>
      <div className="form-row">
        <label>Lugar de emisión</label>
        <input className="input" value={lugar} onChange={(e) => setLugar(e.target.value)} placeholder="Puerto Ordaz, Estado Bolívar" />
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.9rem', marginTop: '.3rem' }}>
        <input type="checkbox" checked={incluirSalario} onChange={(e) => setIncluirSalario(e.target.checked)} />
        Incluir el <strong>sueldo mensual</strong> {Number(persona.sueldo_base) > 0 ? <span className="mono muted">({money(persona.sueldo_base)})</span> : <span className="muted">(sin sueldo cargado)</span>}
      </label>
      <small className="muted" style={{ display: 'block', marginTop: '.5rem' }}>
        La fecha de emisión es la de hoy. El documento se abre en <strong>vista previa</strong> para revisar/imprimir.
      </small>
    </Modal>
  );
}

/* ───────── Vista previa + descarga del carnet (frente + reverso, PNG con QR) ───────── */
function CarnetModal({ persona, onClose }: { persona: Personal; onClose: () => void }) {
  const [frente, setFrente] = useState<string | null>(null);
  const [reverso, setReverso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);

  useEffect(() => {
    let urls: string[] = [];
    let vivo = true;
    Promise.all([generarFrenteBlob(persona), generarReversoBlob()])
      .then(([bf, br]) => {
        if (!vivo) return;
        const uf = URL.createObjectURL(bf);
        const ur = URL.createObjectURL(br);
        urls = [uf, ur];
        setFrente(uf); setReverso(ur);
      })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo generar el carnet'); });
    return () => { vivo = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [persona]);

  async function descargar() {
    setBajando(true);
    try { await descargarCarnet(persona); toast('Carnet descargado (frente + reverso)', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo descargar', 'error'); }
    finally { setBajando(false); }
  }

  const imgStyle: CSSProperties = { width: 230, maxWidth: '100%', height: 'auto', borderRadius: 10, boxShadow: 'var(--shadow-md)' };
  return (
    <Modal title={`Carnet · ${persona.nombre} ${persona.apellido}`} size="lg" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        <button className="btn btn-primary" onClick={descargar} disabled={!frente || bajando}>{bajando ? 'Descargando…' : '⬇ Descargar PNG (frente + reverso)'}</button>
      </>
    }>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.7rem' }}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)' }}><strong>Error:</strong> {error}</div>}
        {!error && !frente && <div className="muted" style={{ padding: '2rem' }}>Generando carnet…</div>}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          {frente && <div style={{ textAlign: 'center' }}><img src={frente} alt="Frente del carnet" style={imgStyle} /><div className="muted" style={{ fontSize: '.75rem', marginTop: '.25rem' }}>Frente</div></div>}
          {reverso && <div style={{ textAlign: 'center' }}><img src={reverso} alt="Reverso del carnet" style={imgStyle} /><div className="muted" style={{ fontSize: '.75rem', marginTop: '.25rem' }}>Reverso</div></div>}
        </div>
        <small className="muted" style={{ textAlign: 'center' }}>2 imágenes PNG · 54×86&nbsp;mm a 300&nbsp;DPI (638×1016&nbsp;px). El QR del frente incluye cédula, teléfono y contacto de emergencia.</small>
      </div>
    </Modal>
  );
}

/* ───────── Combo estilizado (select del sistema) con opción de agregar nuevo ───────── */
function ComboConAgregar({ label, valor, opciones, onChange, hint }: {
  label: string; valor: string; opciones: string[]; onChange: (v: string) => void; hint?: string;
}) {
  const [agregando, setAgregando] = useState(false);
  const [nuevo, setNuevo] = useState('');
  // Si el valor actual no está en el catálogo (p. ej. al editar), lo incluimos.
  const opts = valor && !opciones.includes(valor) ? [valor, ...opciones] : opciones;
  function confirmar() {
    const v = nuevo.trim();
    if (v) onChange(v);
    setNuevo(''); setAgregando(false);
  }
  return (
    <div className="form-row">
      <label>{label}</label>
      {agregando ? (
        <div style={{ display: 'flex', gap: '.3rem' }}>
          <input className="input" autoFocus value={nuevo} placeholder={`Nuevo ${label.toLowerCase()}…`}
            onChange={(e) => setNuevo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } if (e.key === 'Escape') { setAgregando(false); setNuevo(''); } }} />
          <button type="button" className="btn btn-sm btn-primary" onClick={confirmar} title="Agregar">✓</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setAgregando(false); setNuevo(''); }} title="Cancelar">✕</button>
        </div>
      ) : (
        <select className="select" value={valor}
          onChange={(e) => { if (e.target.value === '__nuevo__') setAgregando(true); else onChange(e.target.value); }}>
          <option value="">— elegir —</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          <option value="__nuevo__">+ Agregar nuevo…</option>
        </select>
      )}
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}

/* ───────── Histórico de pagos individuales de una persona ───────── */
function HistoricoPersonaModal({ persona, onClose }: { persona: Personal; onClose: () => void }) {
  const [rows, setRows] = useState<NominaRenglon[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    listHistoricoPersona(persona.id).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [persona.id]);

  const pagados = rows.filter((r) => r.estado === 'pagada');
  const totalPagado = pagados.reduce((a, r) => a + (Number(r.neto_usd) || 0), 0);

  return (
    <Modal title={`Histórico de pagos · ${persona.nombre} ${persona.apellido}`} size="lg" onClose={onClose} footer={
      <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
    }>
      <div className="muted" style={{ marginBottom: '.5rem', fontSize: '.85rem' }}>
        {pagados.length} pago(s) · Total pagado <strong className="mono">{money(totalPagado)}</strong>
      </div>
      <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
        <table className="table" style={{ fontSize: '.82rem' }}>
          <thead><tr><th>Nómina</th><th>Período</th><th style={{ textAlign: 'right' }}>Días</th><th style={{ textAlign: 'right' }}>Neto</th><th style={{ textAlign: 'center' }}>Estado</th><th>Pagada</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !rows.length && <tr><td colSpan={6}><EmptyState message="Sin pagos registrados" /></td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.periodo?.codigo ?? '—'}</td>
                <td className="muted">{r.periodo?.periodo_desde ? `${date(r.periodo.periodo_desde)} → ${date(r.periodo.periodo_hasta)}` : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.dias_trabajados}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{money(r.neto_usd)}</td>
                <td style={{ textAlign: 'center' }}>
                  <span className="badge" style={{ color: r.estado === 'pagada' ? 'var(--success)' : 'var(--warning)' }}>{r.estado === 'pagada' ? 'Pagada' : 'Por pagar'}</span>
                </td>
                <td className="muted">{r.pagada_en ? dateTime(r.pagada_en) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
