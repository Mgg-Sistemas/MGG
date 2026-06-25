import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { listActivosMaquinaria } from './maquinaria.repository';
import { listVehiculos, listCatalogo } from '@/modules/combustible/combustible.repository';
import { addEquipo, updateEquipo, GRUPOS_MANTENIMIENTO, type MaquinariaEquipo, type MaquinariaEquipoInput } from './maquinariaEquipos.repository';

const COMBUSTIBLES = ['GASOIL', 'GASOLINA', 'GAS', 'ELÉCTRICO', 'N/A'];

export function EquipoFormModal({ equipo, actor, onClose, onSaved }: {
  equipo: MaquinariaEquipo | null;
  actor: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const esNuevo = !equipo;
  const [f, setF] = useState<MaquinariaEquipoInput>(() => ({
    equipo: equipo?.equipo ?? '',
    tipo: equipo?.tipo ?? null,
    propietario: equipo?.propietario ?? null,
    status: equipo?.status ?? 'ACTIVO',
    ubicacion: equipo?.ubicacion ?? null,
    anio: equipo?.anio ?? null,
    marca: equipo?.marca ?? null,
    modelo: equipo?.modelo ?? null,
    color: equipo?.color ?? null,
    serial: equipo?.serial ?? null,
    placa: equipo?.placa ?? null,
    motor_modelo: equipo?.motor_modelo ?? null,
    motor_serial: equipo?.motor_serial ?? null,
    combustible: equipo?.combustible ?? 'GASOIL',
    litros_consume: equipo?.litros_consume ?? null,
    mantenimiento_cada_hrs: equipo?.mantenimiento_cada_hrs ?? null,
    alerta_km: equipo?.alerta_km ?? null,
    alerta_horometro: equipo?.alerta_horometro ?? null,
    aceite_cada_hrs: equipo?.aceite_cada_hrs ?? null,
    filtro_cada_hrs: equipo?.filtro_cada_hrs ?? null,
    combustible_cada_hrs: equipo?.combustible_cada_hrs ?? null,
    combustible_equipo: equipo?.combustible_equipo ?? null,
    grupo_mantenimiento: equipo?.grupo_mantenimiento ?? null,
    documentacion: equipo?.documentacion ?? null,
    ficha_tecnica: equipo?.ficha_tecnica ?? null,
    ficha_mantenimiento: equipo?.ficha_mantenimiento ?? null,
    doc_fisico: equipo?.doc_fisico ?? false,
    ficha_mantt: equipo?.ficha_mantt ?? false,
    doc_drive: equipo?.doc_drive ?? false,
    esp_tecnicas: equipo?.esp_tecnicas ?? false,
    revision_mina: equipo?.revision_mina ?? false,
    notas: equipo?.notas ?? null,
  }));
  const [tipos, setTipos] = useState<string[]>([]);
  const [props, setProps] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [combEquipos, setCombEquipos] = useState<string[]>([]);
  const [ubicaciones, setUbicaciones] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listActivosMaquinaria('tipo_maquinaria').then(setTipos).catch(() => {});
    listActivosMaquinaria('propietario').then(setProps).catch(() => {});
    listActivosMaquinaria('status').then((s) => setStatuses(s.length ? s : ['ACTIVO'])).catch(() => setStatuses(['ACTIVO']));
    // Equipos (vehículos/máquinas) y UBICACIONES se traen del módulo de Combustible (fuente única).
    listVehiculos().then((vs) => setCombEquipos(vs.filter((v) => v.estado === 'activo').map((v) => v.nombre))).catch(() => {});
    listCatalogo('combustible_ubicaciones').then((u) => setUbicaciones(u.filter((x) => x.estado === 'activo').map((x) => x.nombre))).catch(() => {});
  }, []);

  const set = <K extends keyof MaquinariaEquipoInput>(k: K, v: MaquinariaEquipoInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const upper = (s: string) => s.toUpperCase();
  const numField = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

  const combOpts = useMemo(() => combEquipos.map((e) => ({ value: e, label: e })), [combEquipos]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.equipo?.trim()) { setError('Indicá el nombre del equipo.'); return; }
    setSaving(true);
    try {
      if (esNuevo) await addEquipo(f, actor);
      else await updateEquipo(equipo!.id, f);
      toast(esNuevo ? 'Equipo creado' : 'Equipo actualizado', 'success');
      onSaved(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally { setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="equipo-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : (esNuevo ? 'Crear equipo' : 'Guardar')}</button>
    </>
  );

  const Check = ({ k, label }: { k: keyof MaquinariaEquipoInput; label: string }) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontSize: '.84rem', cursor: 'pointer' }}>
      <input type="checkbox" checked={!!f[k]} onChange={(e) => set(k, e.target.checked as never)} /> {label}
    </label>
  );

  return (
    <Modal title={esNuevo ? 'Nuevo equipo / maquinaria' : `Editar · ${equipo?.equipo}`} size="lg" onClose={onClose} footer={footer}>
      <form id="equipo-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        <div className="form-grid">
          <div className="form-row">
            <label>Equipo / designación *</label>
            <input name="f-equipo" className="input" defaultValue={f.equipo ?? ''} onChange={(e) => { e.target.value = upper(e.target.value); set('equipo', e.target.value); }} placeholder="Ej. VOLVO A35F 484" required />
          </div>
          <div className="form-row">
            <label>Tipo de maquinaria</label>
            <SearchSelect value={f.tipo ?? ''} onChange={(v) => set('tipo', v || null)} options={tipos.map((t) => ({ value: t, label: t }))} placeholder="— elegí el tipo —" />
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Propietario</label>
            <SearchSelect value={f.propietario ?? ''} onChange={(v) => set('propietario', v || null)} options={props.map((t) => ({ value: t, label: t }))} placeholder="— elegí el propietario —" />
          </div>
          <div className="form-row">
            <label>Status</label>
            <select className="select" value={f.status ?? 'ACTIVO'} onChange={(e) => set('status', e.target.value)}>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Última ubicación</label>
            <input className="input" list="maq-ubicaciones" value={f.ubicacion ?? ''}
              onChange={(e) => set('ubicacion', upper(e.target.value) || null)}
              placeholder="Buscá una ubicación de Combustible o escribí una nueva…" />
            <datalist id="maq-ubicaciones">{ubicaciones.map((u) => <option key={u} value={u} />)}</datalist>
            <small className="muted">Se traen del catálogo de Combustible → Ubicaciones.</small>
          </div>
          <div className="form-row">
            <label>Año</label>
            <input name="f-anio" className="input mono" type="number" defaultValue={f.anio ?? ''} onChange={(e) => set('anio', numField(e.target.value))} />
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row"><label>Marca</label><input name="f-marca" className="input" defaultValue={f.marca ?? ''} onChange={(e) => { e.target.value = upper(e.target.value); set('marca', e.target.value); }} /></div>
          <div className="form-row"><label>Modelo</label><input name="f-modelo" className="input" defaultValue={f.modelo ?? ''} onChange={(e) => { e.target.value = upper(e.target.value); set('modelo', e.target.value); }} /></div>
        </div>

        <div className="form-grid">
          <div className="form-row"><label>Color</label><input name="f-color" className="input" defaultValue={f.color ?? ''} onChange={(e) => { e.target.value = upper(e.target.value); set('color', e.target.value); }} /></div>
          <div className="form-row"><label>Serial</label><input name="f-serial" className="input mono" defaultValue={f.serial ?? ''} onChange={(e) => { e.target.value = upper(e.target.value); set('serial', e.target.value); }} /></div>
        </div>

        <div className="form-grid">
          <div className="form-row"><label>Placa</label><input name="f-placa" className="input mono" defaultValue={f.placa ?? ''} onChange={(e) => { e.target.value = upper(e.target.value); set('placa', e.target.value); }} /></div>
          <div className="form-row"><label>Motor (modelo)</label><input name="f-motor_modelo" className="input" defaultValue={f.motor_modelo ?? ''} onChange={(e) => { e.target.value = upper(e.target.value); set('motor_modelo', e.target.value); }} /></div>
        </div>

        <div className="form-grid">
          <div className="form-row"><label>Motor (serial)</label><input name="f-motor_serial" className="input mono" defaultValue={f.motor_serial ?? ''} onChange={(e) => { e.target.value = upper(e.target.value); set('motor_serial', e.target.value); }} /></div>
          <div className="form-row">
            <label>Combustible</label>
            <select className="select" value={f.combustible ?? 'GASOIL'} onChange={(e) => set('combustible', e.target.value)}>
              {COMBUSTIBLES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row"><label>Litros que consume / capacidad</label><input name="f-litros_consume" className="input mono" type="number" step="any" defaultValue={f.litros_consume ?? ''} onChange={(e) => set('litros_consume', numField(e.target.value))} /></div>
          <div className="form-row">
            <label>Mantenimiento cada (hrs)</label>
            <input name="f-mantenimiento_cada_hrs" className="input mono" type="number" step="any" defaultValue={f.mantenimiento_cada_hrs ?? ''} onChange={(e) => set('mantenimiento_cada_hrs', numField(e.target.value))} placeholder="Ej. 250" />
            <small className="muted">Frecuencia para la alerta de mantenimiento preventivo.</small>
          </div>
        </div>

        {/* Alerta por KILOMETRAJE: el usuario fija el objetivo; la lectura vigente sale de Combustible. */}
        <div className="card" style={{ padding: '.6rem .85rem', borderLeft: '3px solid var(--warning)', background: 'var(--bg-1)', margin: '.25rem 0 .75rem' }}>
          <small className="muted" style={{ display: 'block', marginBottom: '.4rem' }}>🛣️ <strong>Alerta por kilometraje / horómetro objetivo</strong>. Al acercarse, salta una tarjeta en Equipos. La lectura vigente se toma de <strong>Combustible</strong> (el km y el horómetro se cargan ahí).</small>
          <div className="form-grid">
            <div className="form-row">
              <label>Alerta a los (km)</label>
              <input name="f-alerta_km" className="input mono" type="number" step="any" defaultValue={f.alerta_km ?? ''} onChange={(e) => set('alerta_km', numField(e.target.value))} placeholder="Ej. 50000" />
            </div>
            <div className="form-row">
              <label>Alerta al horómetro (hrs)</label>
              <input name="f-alerta_horometro" className="input mono" type="number" step="any" defaultValue={f.alerta_horometro ?? ''} onChange={(e) => set('alerta_horometro', numField(e.target.value))} placeholder="Opcional" />
            </div>
          </div>
        </div>

        {/* Intervalos por ítem para el ESTADO CRÍTICO: vencido cuando (horómetro − último servicio) ≥ intervalo. */}
        <div className="card" style={{ padding: '.6rem .85rem', borderLeft: '3px solid var(--warning)', background: 'var(--bg-1)', margin: '.25rem 0 .75rem' }}>
          <small className="muted" style={{ display: 'block', marginBottom: '.4rem' }}>🛢 <strong>Intervalos de servicio</strong> (horas de horómetro). Se marca <strong>crítico</strong> cuando el equipo pasa el intervalo desde su último cambio (registrado en la bitácora).</small>
          <div className="form-grid">
            <div className="form-row">
              <label>Aceite cada (hrs)</label>
              <input name="f-aceite_cada_hrs" className="input mono" type="number" step="any" defaultValue={f.aceite_cada_hrs ?? ''} onChange={(e) => set('aceite_cada_hrs', numField(e.target.value))} placeholder="Ej. 250" />
            </div>
            <div className="form-row">
              <label>Filtro cada (hrs)</label>
              <input name="f-filtro_cada_hrs" className="input mono" type="number" step="any" defaultValue={f.filtro_cada_hrs ?? ''} onChange={(e) => set('filtro_cada_hrs', numField(e.target.value))} placeholder="Ej. 500" />
            </div>
            <div className="form-row">
              <label>Combustible cada (hrs)</label>
              <input name="f-combustible_cada_hrs" className="input mono" type="number" step="any" defaultValue={f.combustible_cada_hrs ?? ''} onChange={(e) => set('combustible_cada_hrs', numField(e.target.value))} placeholder="Ej. 50" />
            </div>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Grupo · Servicio de Mantenimiento</label>
            <select className="select" value={f.grupo_mantenimiento ?? ''} onChange={(e) => set('grupo_mantenimiento', e.target.value || null)}>
              <option value="">— sin grupo —</option>
              {GRUPOS_MANTENIMIENTO.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <small className="muted">Define bajo qué switch aparece el equipo en el submódulo <strong>Servicio de Mantenimiento</strong>.</small>
          </div>
        </div>

        {/* Integración con Combustible */}
        <div className="card" style={{ padding: '.6rem .85rem', borderLeft: '3px solid var(--primary)', background: 'var(--bg-1)', margin: '.25rem 0 .75rem' }}>
          <div className="form-row" style={{ margin: 0 }}>
            <label>⛽ Equipo de Combustible vinculado</label>
            <SearchSelect value={f.combustible_equipo ?? ''} onChange={(v) => set('combustible_equipo', v || null)} options={combOpts} placeholder="— sin vincular —" />
            <small className="muted">Al vincularlo, el <strong>horómetro</strong> y el <strong>gasoil consumido</strong> se traen del módulo de Combustible.</small>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row"><label>Documentación (tipo)</label><input name="f-documentacion" className="input" defaultValue={f.documentacion ?? ''} onChange={(e) => { e.target.value = upper(e.target.value); set('documentacion', e.target.value); }} placeholder="FACTURA / CERTIFICADO…" /></div>
          <div className="form-row"><label>Ficha técnica</label><input name="f-ficha_tecnica" className="input" defaultValue={f.ficha_tecnica ?? ''} onChange={(e) => { e.target.value = upper(e.target.value); set('ficha_tecnica', e.target.value); }} /></div>
        </div>

        <div className="form-row">
          <label>Documentos disponibles</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem 1rem' }}>
            <Check k="doc_fisico" label="Doc. físico" />
            <Check k="ficha_mantt" label="Ficha mantt." />
            <Check k="doc_drive" label="Doc. en Drive" />
            <Check k="esp_tecnicas" label="Esp. técnicas" />
            <Check k="revision_mina" label="Revisión en mina" />
          </div>
        </div>

        <div className="form-row">
          <label>Notas</label>
          <textarea name="f-notas" className="input" rows={2} defaultValue={f.notas ?? ''} onChange={(e) => set('notas', e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}
