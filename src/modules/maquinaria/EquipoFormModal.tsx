import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect, SearchCreateSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { listActivosMaquinaria, addCatalogoMaquinaria } from './maquinaria.repository';
import { listCatalogos } from '@/modules/combustible/tanques.repository';
import { addEquipo, updateEquipo, vincularEquipoEnCombustible, GRUPOS_MANTENIMIENTO, type MaquinariaEquipo, type MaquinariaEquipoInput } from './maquinariaEquipos.repository';
import { norm } from '@/shared/lib/texto';
import { CLASES_EQUIPO, claseEquipo, type ClaseEquipo } from './flota';

const COMBUSTIBLES = ['GASOIL', 'GASOLINA', 'GAS', 'ELÉCTRICO', 'N/A'];
const TIPOS_SUGERIDOS = ['CAMIÓN', 'CAMIONETA', 'EXCAVADORA', 'RETROEXCAVADORA', 'PLANTA ELÉCTRICA', 'GENERADOR', 'MOTO', 'LANCHA', 'BOTE'];

export function EquipoFormModal({ equipo, actor, onClose, onSaved, tipoInicial, claseInicial }: {
  equipo: MaquinariaEquipo | null;
  actor: string;
  onClose: () => void;
  onSaved: () => void;
  tipoInicial?: string | null;
  claseInicial?: ClaseEquipo | null;
}) {
  const esNuevo = !equipo;

  const tipoArrancada = useMemo(() => {
    if (equipo?.tipo) return equipo.tipo;
    if (tipoInicial?.trim()) return tipoInicial.trim().toUpperCase();
    if (claseInicial === 'lancha') return 'LANCHA';
    if (claseInicial === 'moto') return 'MOTO';
    if (claseInicial === 'vehiculo') return 'VEHÍCULO';
    if (claseInicial === 'maquinaria') return 'MAQUINARIA PESADA';
    return null;
  }, [equipo, tipoInicial, claseInicial]);

  const combustibleArrancada = useMemo(() => {
    if (equipo?.combustible) return equipo.combustible;
    if (claseInicial === 'lancha' || tipoInicial?.toUpperCase() === 'LANCHA') return 'GASOLINA';
    if (claseInicial === 'moto' || tipoInicial?.toUpperCase() === 'MOTO') return 'GASOLINA';
    return 'GASOIL';
  }, [equipo, claseInicial, tipoInicial]);

  const [claseSel, setClaseSel] = useState<ClaseEquipo>(() => {
    if (equipo) return claseEquipo(equipo);
    if (claseInicial && claseInicial !== 'equipo') return claseInicial;
    if (tipoInicial) return claseEquipo({ tipo: tipoInicial });
    return 'maquinaria';
  });

  const [f, setF] = useState<MaquinariaEquipoInput>(() => ({
    equipo: equipo?.equipo ?? '',
    tipo: tipoArrancada,
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
    combustible: combustibleArrancada,
    litros_consume: equipo?.litros_consume ?? null,
    mantenimiento_cada_hrs: equipo?.mantenimiento_cada_hrs ?? null,
    mantenimiento_cada_km: equipo?.mantenimiento_cada_km ?? null,
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
    encargado_responsable: equipo?.encargado_responsable ?? null,
    notas: equipo?.notas ?? null,
  }));
  const [tipos, setTipos] = useState<string[]>([]);
  const [props, setProps] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [encargados, setEncargados] = useState<string[]>([]);
  const [combEquipos, setCombEquipos] = useState<string[]>([]);        // solo activos: lo que ofrece el selector
  const [combEquiposTodos, setCombEquiposTodos] = useState<string[]>([]); // todos: para saber si el vinculo existe
  const [ubicaciones, setUbicaciones] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [vinculando, setVinculando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listActivosMaquinaria('tipo_maquinaria').then((t) => {
      const combinados = Array.from(new Set([...t, ...TIPOS_SUGERIDOS])).sort((a, b) => a.localeCompare(b, 'es'));
      setTipos(combinados);
    }).catch(() => {
      setTipos(TIPOS_SUGERIDOS);
    });
    listActivosMaquinaria('propietario').then(setProps).catch(() => {});
    listActivosMaquinaria('status').then((s) => setStatuses(s.length ? s : ['ACTIVO'])).catch(() => setStatuses(['ACTIVO']));
    listActivosMaquinaria('encargado_responsable').then(setEncargados).catch(() => {});
    // Equipos y UBICACIONES se traen del catálogo de Combustible (fuente única).
    // Se guardan DOS listas de equipos a propósito: el desplegable solo ofrece los
    // ACTIVOS (no tiene sentido elegir uno dado de baja), pero para decidir si el
    // vínculo está roto valen TODOS — apuntar a un valor inactivo no es un vínculo
    // roto, el equipo sigue viendo su horómetro y su gasoil. Con una sola lista, un
    // vínculo sano a un valor inactivo se marcaba en rojo sin motivo.
    listCatalogos().then((c) => {
      const equipos = c.filter((x) => x.tipo === 'equipo');
      setCombEquipos(equipos.filter((x) => x.activo).map((x) => x.valor));
      setCombEquiposTodos(equipos.map((x) => x.valor));
      setUbicaciones(c.filter((x) => x.tipo === 'ubicacion' && x.activo).map((x) => x.valor));
    }).catch(() => {});
  }, []);

  const set = <K extends keyof MaquinariaEquipoInput>(k: K, v: MaquinariaEquipoInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const upper = (s: string) => s.toUpperCase();
  const numField = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

  const combOpts = useMemo(() => combEquipos.map((e) => ({ value: e, label: e })), [combEquipos]);

  // GT-INT-15 · El vínculo con Combustible es por TEXTO. Si renombraron el valor en el
  // catálogo, la ficha queda apuntando a un nombre que ya no existe y el equipo pierde su
  // horómetro y su gasoil — con lo cual la alerta de mantenimiento se apaga sin avisar.
  // Aquí se avisa. Se mira contra TODOS los valores, no solo los activos: apuntar a uno
  // dado de baja no rompe nada (el vínculo es por texto y los movimientos se siguen
  // viendo), así que marcarlo en rojo sería una falsa alarma.
  // (La lista vacía todavía no cargó: no se acusa un vínculo roto de más.)
  const vinculoRoto = useMemo(() => {
    const v = (f.combustible_equipo ?? '').trim();
    if (!v || !combEquiposTodos.length) return false;
    return !combEquiposTodos.some((e) => e.trim() === v);
  }, [f.combustible_equipo, combEquiposTodos]);

  /**
   * Vincula el equipo a un nombre del catálogo de Combustible (26/10/2026). Si el nombre ya
   * existe (sin que importen mayúsculas ni acentos) se toma ese tal como está escrito; si no,
   * se crea en Combustible (tipo «equipo», activo) y se suma a las listas del desplegable para
   * que quede elegido sin recargar. Lo usan la opción «➕ Crear … en Combustible» y el botón
   * «🔗 Vincular a sí mismo».
   */
  async function vincularCon(nombre: string) {
    const n = nombre.trim();
    if (!n) return;
    const existente = combEquiposTodos.find((e) => norm(e) === norm(n));
    if (existente) { set('combustible_equipo', existente); return; }
    setVinculando(true);
    try {
      const valor = await vincularEquipoEnCombustible(n);
      setCombEquipos((prev) => (prev.some((e) => norm(e) === norm(valor)) ? prev : [...prev, valor].sort((a, b) => a.localeCompare(b, 'es'))));
      setCombEquiposTodos((prev) => (prev.some((e) => norm(e) === norm(valor)) ? prev : [...prev, valor]));
      set('combustible_equipo', valor);
      toast(`«${valor}» creado en el catálogo de Combustible`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo crear el equipo en Combustible.', 'error');
    } finally { setVinculando(false); }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!f.equipo?.trim()) { setError('Indica el nombre del equipo.'); return; }
    setSaving(true);
    try {
      if (esNuevo) await addEquipo(f, actor);
      else await updateEquipo(equipo!.id, f);
      if (f.tipo?.trim()) {
        addCatalogoMaquinaria('tipo_maquinaria', f.tipo.trim().toUpperCase()).catch(() => {});
      }
      if (f.encargado_responsable?.trim()) {
        addCatalogoMaquinaria('encargado_responsable', f.encargado_responsable.trim().toUpperCase()).catch(() => {});
      }
      toast(esNuevo ? 'Equipo creado' : 'Equipo actualizado', 'success');
      onSaved(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally { setSaving(false); }
  }

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" form="equipo-form" className="btn btn-primary" disabled={saving}>
        {saving ? 'Guardando…' : (esNuevo ? (claseSel === 'moto' ? 'Crear moto' : claseSel === 'lancha' ? 'Crear lancha' : claseSel === 'vehiculo' ? 'Crear vehículo' : claseSel === 'maquinaria' ? 'Crear maquinaria' : 'Crear equipo') : 'Guardar')}
      </button>
    </>
  );

  const Check = ({ k, label }: { k: keyof MaquinariaEquipoInput; label: string }) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontSize: '.84rem', cursor: 'pointer' }}>
      <input type="checkbox" checked={!!f[k]} onChange={(e) => set(k, e.target.checked as never)} /> {label}
    </label>
  );

  function handleCambiarClase(c: ClaseEquipo) {
    setClaseSel(c);
    if (c === 'lancha') {
      setF((prev) => ({
        ...prev,
        tipo: 'LANCHA',
        combustible: prev.combustible === 'GASOIL' ? 'GASOLINA' : prev.combustible,
      }));
    } else if (c === 'moto') {
      setF((prev) => ({
        ...prev,
        tipo: 'MOTO',
        combustible: 'GASOLINA',
      }));
    } else if (c === 'vehiculo') {
      setF((prev) => ({
        ...prev,
        tipo: prev.tipo && /lancha|moto/i.test(prev.tipo) ? 'VEHÍCULO' : (prev.tipo || 'VEHÍCULO'),
        combustible: prev.combustible ?? 'GASOIL',
      }));
    } else {
      setF((prev) => ({
        ...prev,
        tipo: prev.tipo && /lancha|moto/i.test(prev.tipo) ? 'MAQUINARIA PESADA' : (prev.tipo || 'MAQUINARIA PESADA'),
        combustible: prev.combustible ?? 'GASOIL',
      }));
    }
  }

  const tituloModal = useMemo(() => {
    if (!esNuevo) return `Editar · ${equipo?.equipo}`;
    if (claseSel === 'moto') return '🏍️ Nueva Moto';
    if (claseSel === 'lancha') return '🚤 Nueva Lancha / Embarcación';
    if (claseSel === 'vehiculo') return '🚚 Nuevo Vehículo';
    if (claseSel === 'maquinaria') return '🚜 Nueva Maquinaria / Equipo Pesado';
    return 'Nuevo equipo / maquinaria';
  }, [esNuevo, equipo, claseSel]);

  const placeholderEquipo = useMemo(() => {
    if (claseSel === 'moto') return 'Ej. BERA SBR 150 · MOTO 01';
    if (claseSel === 'lancha') return 'Ej. LANCHA YAMAHA 200HP · RÍO 01';
    if (claseSel === 'vehiculo') return 'Ej. TOYOTA HILUX 4X4 · CAMIONETA 05';
    return 'Ej. VOLVO A35F 484';
  }, [claseSel]);

  return (
    <Modal title={tituloModal} size="lg" onClose={onClose} footer={footer}>
      <form id="equipo-form" onSubmit={handleSubmit}>
        {error && <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: '.75rem' }}><strong>Error:</strong> {error}</div>}

        {/* Selector de Categoría / Clase de Flota (permite cambiarlo desde el formulario) */}
        <div style={{ marginBottom: '.85rem', padding: '.65rem .75rem', background: 'var(--surface-2, rgba(255,255,255,0.04))', borderRadius: '8px', border: '1px solid var(--border-color, rgba(255,255,255,0.08))' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
            <label style={{ fontSize: '.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', margin: 0, color: 'var(--text-secondary, #94a3b8)' }}>
              Categoría de la unidad (puedes cambiarla aquí)
            </label>
            <span style={{ fontSize: '.76rem', color: 'var(--primary, #3b82f6)', fontWeight: 600 }}>
              {claseSel === 'moto' ? '🏍️ Moto seleccionada' : claseSel === 'lancha' ? '🚤 Lancha seleccionada' : claseSel === 'vehiculo' ? '🚚 Vehículo seleccionado' : '🚜 Maquinaria seleccionada'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.4rem' }}>
            {CLASES_EQUIPO.map((c) => {
              const activa = claseSel === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`btn btn-sm ${activa ? 'btn-primary' : 'btn-ghost'}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '.45rem .2rem',
                    gap: '.2rem',
                    fontSize: '.76rem',
                    fontWeight: activa ? 700 : 500,
                    border: activa ? '2px solid var(--primary, #3b82f6)' : undefined,
                  }}
                  onClick={() => handleCambiarClase(c.id)}
                >
                  <span style={{ fontSize: '1.25rem' }}>{c.icon}</span>
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Equipo / designación *</label>
            <input name="f-equipo" className="input" defaultValue={f.equipo ?? ''} onChange={(e) => { e.target.value = upper(e.target.value); set('equipo', e.target.value); }} placeholder={placeholderEquipo} required />
          </div>
          <div className="form-row">
            <label>Tipo (maquinaria, vehículo, moto, lancha…)</label>
            <SearchCreateSelect
              value={f.tipo ?? ''}
              onChange={(v) => {
                const up = upper(v);
                set('tipo', up || null);
                if (up) {
                  setClaseSel(claseEquipo({ tipo: up }));
                }
              }}
              options={tipos}
              placeholder="Elige o escribe el tipo…"
            />
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Propietario</label>
            <SearchSelect value={f.propietario ?? ''} onChange={(v) => set('propietario', v || null)} options={props.map((t) => ({ value: t, label: t }))} placeholder="— elige el propietario —" />
          </div>
          <div className="form-row">
            <label>Status</label>
            <select className="select" value={f.status ?? 'ACTIVO'} onChange={(e) => set('status', e.target.value)}>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="form-row" style={{ marginTop: '.25rem' }}>
          <label>Encargado responsable (chofer / operador / mecánico)</label>
          <SearchCreateSelect
            value={f.encargado_responsable ?? ''}
            onChange={(v) => set('encargado_responsable', upper(v) || null)}
            options={encargados}
            placeholder="Elige o escribe el nombre del encargado…"
          />
          <small className="muted">Catálogo de encargados: al escribir un nombre nuevo se guarda para los demás equipos.</small>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Última ubicación</label>
            <SearchCreateSelect value={f.ubicacion ?? ''} onChange={(v) => set('ubicacion', upper(v) || null)} options={ubicaciones} placeholder="Busca una ubicación de Combustible o escribe una nueva…" />
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
            <small className="muted">Frecuencia (por horómetro) para la alerta de mantenimiento. Maquinaria pesada / plantas.</small>
          </div>
          <div className="form-row">
            <label>Mantenimiento cada (km)</label>
            <input name="f-mantenimiento_cada_km" className="input mono" type="number" step="any" defaultValue={f.mantenimiento_cada_km ?? ''} onChange={(e) => set('mantenimiento_cada_km', numField(e.target.value))} placeholder="Ej. 10000" />
            <small className="muted">Frecuencia (por kilometraje) para la alerta. Vehículos. El km vigente se trae de Combustible.</small>
          </div>
        </div>

        <div className="form-grid">
          <div className="form-row">
            <label>Grupo · Servicio de Mantenimiento</label>
            <SearchSelect value={f.grupo_mantenimiento ?? ''} onChange={(v) => set('grupo_mantenimiento', v || null)}
              options={GRUPOS_MANTENIMIENTO.map((g) => ({ value: g, label: g }))} placeholder="— sin grupo —" />
            <small className="muted">Agrupa el equipo en el submódulo <strong>Servicio de Mantenimiento</strong> (FLOTA PESADA / VEHÍCULOS DE CARGA / PLANTAS ELÉCTRICAS).</small>
          </div>
        </div>

        {/* Integración con Combustible */}
        <div className="card" style={{ padding: '.6rem .85rem', borderLeft: '3px solid var(--primary)', background: 'var(--bg-1)', margin: '.25rem 0 .75rem' }}>
          <div className="form-row" style={{ margin: 0 }}>
            <label>⛽ Equipo de Combustible vinculado</label>
            <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
              <SearchSelect
                value={f.combustible_equipo ?? ''}
                onChange={(v) => {
                  const val = v.trim();
                  if (!val) { set('combustible_equipo', null); return; }
                  // Elegido de la lista → se guarda tal cual; escrito nuevo → se crea en Combustible.
                  if (combEquiposTodos.some((e) => e === val)) set('combustible_equipo', val);
                  else void vincularCon(val.toUpperCase());
                }}
                options={combOpts}
                placeholder="— sin vincular —"
                disabled={vinculando}
                allowCreate
                createLabel={(q) => `➕ Crear «${q.toUpperCase()}» en Combustible`}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ whiteSpace: 'nowrap' }}
                disabled={vinculando || !f.equipo?.trim()}
                title={f.equipo?.trim()
                  ? `Vincular con «${f.equipo.trim()}» (se crea en Combustible si no existe)`
                  : 'Escribe primero el nombre del equipo (arriba) para poder vincularlo a sí mismo'}
                onClick={() => void vincularCon(f.equipo.trim())}
              >
                {vinculando ? '⏳ Vinculando…' : '🔗 Vincular a sí mismo'}
              </button>
            </div>
            {esNuevo && !(f.combustible_equipo ?? '').trim() && (
              <small className="muted" style={{ display: 'block' }}>
                Si lo dejas vacío, el equipo queda vinculado a sí mismo: se crea con su mismo nombre en Combustible.
              </small>
            )}
            {vinculoRoto ? (
              <small style={{ color: 'var(--danger)' }}>
                ⚠ <strong>Vínculo roto.</strong> Este equipo apunta a «{f.combustible_equipo}», que ya no
                existe en el catálogo de Combustible — seguramente lo renombraron. Mientras siga así,
                el equipo <strong>no ve su horómetro ni su gasoil</strong> y su{' '}
                <strong>alerta de mantenimiento no suena</strong>. Elige arriba el nombre correcto.
              </small>
            ) : (
              <small className="muted">Al vincularlo, el <strong>horómetro</strong> y el <strong>gasoil consumido</strong> se traen del módulo de Combustible.</small>
            )}
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
