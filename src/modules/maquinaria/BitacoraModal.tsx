import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { toast } from '@/shared/ui/Toast';
import { useRealtime } from '@/shared/lib/useRealtime';
import { date as fmtDate, num as fmtNum } from '@/shared/lib/format';
import {
  listMantenimientos, addMantenimiento, eliminarMantenimiento, resumenHorometro, sumarConsumos, insumosPorConcepto,
  solicitudesServicioPorEquipo,
  type MantenimientoCalc, type InsumoMant, type SolicitudServicioEquipo,
} from './maquinariaMant.repository';
import { datosCombustibleDeEquipo, type DatosCombustibleEquipo } from './maquinariaEquipos.repository';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';

/** Etiqueta del estado de un servicio (alineada con Servicio de Mantenimiento / Pedidos). */
const SERVICIO_ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Solicitado', aprobada: 'Aprobado (cotizar)', oc_creada: 'Pendiente por aprobación',
  cuenta_abierta: 'Crédito / cuenta abierta', confirmada_metodo: 'Confirmado (método de pago)',
  oc_aprobada: 'Confirmado pagar', por_recibir: 'Pendiente por realizar', pagada: 'Pagado',
  recibida: 'Servicio realizado', finalizada: 'Finalizado', cancelada: 'Cancelado', anulada: 'Anulado',
  en_proceso: '🔧 Servicio directo · en proceso',
};

/** Tipos de mantenimiento — misma lista curada (con íconos) que «Tipo de servicio» en Pedidos. */
const TIPOS_MANT: { value: string; label: string }[] = [
  { value: 'CAMBIO DE ACEITE', label: '🛢️ Cambio de aceite' },
  { value: 'CAMBIO DE FILTRO', label: '🧯 Cambio de filtro' },
  { value: 'CAMBIO DE CAUCHOS / NEUMÁTICOS', label: '🛞 Cambio de cauchos / neumáticos' },
  { value: 'REPUESTOS', label: '🛠️ Repuestos' },
  { value: 'CAMBIO DE PIEZA', label: '⚙️ Cambio de pieza' },
  { value: 'PINTURA / LATONERÍA', label: '🎨 Pintura / latonería' },
  { value: 'FRENOS', label: '🛑 Frenos' },
  { value: 'BATERÍA', label: '🔋 Batería' },
  { value: 'SISTEMA ELÉCTRICO', label: '💡 Sistema eléctrico' },
  { value: 'SISTEMA HIDRÁULICO', label: '💧 Sistema hidráulico' },
  { value: 'SOLDADURA', label: '🔥 Soldadura' },
  { value: 'ENGRASE / LUBRICACIÓN', label: '🧴 Engrase / lubricación' },
  { value: 'REFRIGERANTE', label: '❄️ Refrigerante' },
  { value: 'SERVICIO / PREVENTIVO', label: '🔧 Servicio / preventivo' },
  { value: 'REPARACIÓN', label: '🛠️ Reparación' },
  { value: 'INSPECCIÓN', label: '🔍 Inspección' },
  { value: 'LECTURA DE HORÓMETRO', label: '⏱️ Lectura de horómetro' },
  { value: 'OTRO', label: '• Otro' },
];

export function BitacoraModal({ equipo, canWrite, actor, actorName, onClose }: {
  equipo: MaquinariaEquipo;
  canWrite: boolean;
  actor: string;
  actorName: string | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<MantenimientoCalc[]>([]);
  const [comb, setComb] = useState<DatosCombustibleEquipo | null>(null);
  const [solicitudes, setSolicitudes] = useState<SolicitudServicioEquipo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [borrarId, setBorrarId] = useState<string | null>(null);
  // alta
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [tipo, setTipo] = useState('');
  const [pieza, setPieza] = useState('');
  const [horometro, setHorometro] = useState('');
  // Kilometraje (odómetro) leído en este registro. El NIVEL de alerta se fija en la ficha del equipo.
  const [kilometraje, setKilometraje] = useState('');
  const [aceite, setAceite] = useState('');
  const [refrigerante, setRefrigerante] = useState('');
  const [gasoil, setGasoil] = useState('');
  const [filtrosCant, setFiltrosCant] = useState('');
  const [filtrosTipo, setFiltrosTipo] = useState('');
  // Servicio solicitado que se está atendiendo + cuánto se colocó del mismo.
  const [solicitudId, setSolicitudId] = useState('');
  const [cantidadColocada, setCantidadColocada] = useState('');
  // Repuestos / insumos cambiados (cauchos, pintura, batería…): lista repetible.
  const [insumos, setInsumos] = useState<{ id: number; concepto: string; cantidad: string; unidad: string }[]>([]);
  const [insSeq, setInsSeq] = useState(1);
  const addInsumo = () => { setInsumos((xs) => [...xs, { id: insSeq, concepto: '', cantidad: '1', unidad: 'UND' }]); setInsSeq((s) => s + 1); };
  const setInsumo = (id: number, patch: Partial<{ concepto: string; cantidad: string; unidad: string }>) => setInsumos((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const delInsumo = (id: number) => setInsumos((xs) => xs.filter((x) => x.id !== id));
  const [trabajo, setTrabajo] = useState('');
  const [consumibles, setConsumibles] = useState('');
  const [mecanico, setMecanico] = useState('');
  const [ubicacion, setUbicacion] = useState(equipo.ubicacion ?? '');
  const [saving, setSaving] = useState(false);
  // Filtro por fechas del detalle (movimientos): acota la tabla y los totales.
  const [fDesde, setFDesde] = useState('');
  const [fHasta, setFHasta] = useState('');

  const cargar = useCallback(async () => {
    try {
      const [m, c, sol] = await Promise.all([
        listMantenimientos(equipo.id),
        datosCombustibleDeEquipo(equipo.combustible_equipo).catch(() => null),
        solicitudesServicioPorEquipo().then((mp) => mp.get(equipo.id) ?? []).catch(() => [] as SolicitudServicioEquipo[]),
      ]);
      setRows(m); setComb(c); setSolicitudes(sol);
    } finally { setLoading(false); }
  }, [equipo.id, equipo.combustible_equipo]);
  useEffect(() => { void cargar(); }, [cargar]);
  useRealtime(['maquinaria_mantenimientos', 'combustible_tanque_movimientos', 'ordenes', 'servicios_directos'], () => { void cargar(); });

  const res = useMemo(() => resumenHorometro(rows), [rows]);
  // Registros acotados por el filtro de fechas (para la tabla y los totales del detalle).
  const rowsFiltradas = useMemo(
    () => rows.filter((r) => (!fDesde || r.fecha >= fDesde) && (!fHasta || r.fecha <= fHasta)),
    [rows, fDesde, fHasta],
  );
  const totales = useMemo(() => sumarConsumos(rowsFiltradas), [rowsFiltradas]);
  // Repuestos/insumos cambiados, sumados por concepto en el rango (cuántos cauchos, etc.).
  const insumosTot = useMemo(() => insumosPorConcepto(rowsFiltradas), [rowsFiltradas]);
  // Mantenimiento preventivo: horas del último período vs frecuencia del equipo.
  const freq = equipo.mantenimiento_cada_hrs;
  const horasUlt = res.horasUltimo ?? 0;
  const alerta = freq != null && freq > 0 && horasUlt >= freq;
  // Horómetro vigente: prioriza el de Combustible (vínculo), si no el de la bitácora.
  const horometroVigente = comb?.horometro ?? res.ultimoHorometro;
  // Kilometraje vigente (última lectura) + km de alerta (último indicado). rows: nuevo→viejo.
  const kmVigente = rows.find((r) => r.kilometraje != null)?.kilometraje ?? null;
  const alertaKmVigente = equipo.alerta_km ?? null;  // nivel de disparo fijado en la ficha
  const faltanKm = kmVigente != null && alertaKmVigente != null ? Math.round(alertaKmVigente - kmVigente) : null;
  const alertaKmDispara = faltanKm != null && faltanKm <= 1000;

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (tipo === 'CAMBIO DE PIEZA' && !pieza.trim()) { toast('Indicá qué pieza se cambió (ej: MOTOR).', 'error'); return; }
    setSaving(true);
    try {
      await addMantenimiento({
        equipo_id: equipo.id, fecha,
        tipo: tipo || null,
        pieza: tipo === 'Cambio de pieza' ? (pieza || null) : (pieza || null),
        horometro: horometro === '' ? null : Number(horometro),
        kilometraje: kilometraje === '' ? null : Number(kilometraje),
        aceite_lts: aceite === '' ? null : Number(aceite),
        refrigerante_lts: refrigerante === '' ? null : Number(refrigerante),
        gasoil_lts: gasoil === '' ? null : Number(gasoil),
        filtros_cant: filtrosCant === '' ? null : Number(filtrosCant),
        filtros_tipo: filtrosTipo || null,
        insumos: insumos
          .map((x): InsumoMant => ({ concepto: x.concepto.trim().toUpperCase(), cantidad: x.cantidad === '' ? null : Number(x.cantidad), unidad: x.unidad.trim().toUpperCase() || null }))
          .filter((x) => x.concepto !== ''),
        solicitud_id: solicitudId || null,
        solicitud_codigo: solicitudId ? (solicitudes.find((s) => s.id === solicitudId)?.codigo ?? null) : null,
        cantidad_colocada: cantidadColocada === '' ? null : Number(cantidadColocada),
        trabajo: trabajo || null, consumibles: consumibles || null,
        mecanico: mecanico || null, ubicacion: ubicacion || null,
      }, actor, actorName);
      toast('Registro agregado', 'success');
      setTipo(''); setPieza(''); setHorometro(''); setKilometraje(''); setAceite(''); setRefrigerante(''); setGasoil(''); setFiltrosCant(''); setFiltrosTipo(''); setTrabajo(''); setConsumibles(''); setMecanico(''); setInsumos([]); setSolicitudId(''); setCantidadColocada('');
      setShowForm(false);
      await cargar();
    } catch (err) { toast(err instanceof Error ? err.message : 'No se pudo agregar', 'error'); }
    finally { setSaving(false); }
  }

  async function borrar(id: string) {
    try { await eliminarMantenimiento(id); await cargar(); toast('Eliminado', 'success'); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  const footer = <button className="btn btn-primary" onClick={onClose}>Cerrar</button>;

  return (
    <Modal title={`🔧 Bitácora · ${equipo.equipo}`} size="xl" onClose={onClose} footer={footer}>
      {/* KPIs de horómetro */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '.6rem', marginBottom: '.75rem' }}>
        <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
          <div className="muted" style={{ fontSize: '.68rem' }}>HORÓMETRO VIGENTE{comb?.horometro != null ? ' (⛽)' : ''}</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{horometroVigente != null ? fmtNum(horometroVigente) : '—'}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
          <div className="muted" style={{ fontSize: '.68rem' }}>KILOMETRAJE VIGENTE</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{kmVigente != null ? `${fmtNum(kmVigente)} km` : '—'}</div>
          {alertaKmVigente != null && <div className="muted" style={{ fontSize: '.66rem' }}>⚠️ alerta {fmtNum(alertaKmVigente)} km</div>}
        </div>
        <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
          <div className="muted" style={{ fontSize: '.68rem' }}>HRS. ÚLTIMO PERÍODO</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{res.horasUltimo != null ? fmtNum(res.horasUltimo) : '—'}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
          <div className="muted" style={{ fontSize: '.68rem' }}>MANTENIMIENTO CADA</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{freq != null ? `${fmtNum(freq)} h` : '—'}</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.55rem .8rem' }}>
          <div className="muted" style={{ fontSize: '.68rem' }}>GASOIL CONSUMIDO (⛽)</div>
          <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700 }}>{comb ? `${fmtNum(comb.gasoilLts)} L` : '—'}</div>
        </div>
      </div>

      {alerta && (
        <div className="card" style={{ borderColor: 'var(--warning)', background: 'var(--bg-1)', marginBottom: '.75rem', padding: '.55rem .85rem' }}>
          ⚠️ <strong>Mantenimiento preventivo:</strong> el último período acumuló <strong>{fmtNum(horasUlt)} h</strong> y supera la frecuencia de <strong>{fmtNum(freq!)} h</strong>. Conviene programar servicio.
        </div>
      )}

      {alertaKmDispara && (
        <div className="card" style={{ borderColor: 'var(--warning)', background: 'var(--bg-1)', marginBottom: '.75rem', padding: '.55rem .85rem' }}>
          🛣️ <strong>Alerta de kilometraje:</strong> va en <strong>{fmtNum(kmVigente!)} km</strong> y el objetivo es <strong>{fmtNum(alertaKmVigente!)} km</strong> ·{' '}
          {faltanKm! < 0 ? <span style={{ color: 'var(--danger)' }}>lo superó por {fmtNum(Math.abs(faltanKm!))} km</span> : faltanKm === 0 ? <span style={{ color: 'var(--danger)' }}>alcanzó el objetivo</span> : <>faltan <strong>{fmtNum(faltanKm!)} km</strong></>}.
        </div>
      )}

      {/* Solicitudes de servicio casadas a este equipo (vienen de Pedidos → Servicios). */}
      {solicitudes.length > 0 && (
        <div className="card" style={{ marginBottom: '.75rem', padding: '.6rem .85rem' }}>
          <div className="card-title" style={{ marginBottom: '.4rem' }}>
            <span>🔧 Solicitudes de servicio de este equipo <span className="badge" style={{ marginLeft: '.3rem' }}>{solicitudes.length}</span></span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
            {solicitudes.map((s) => (
              <div key={`${s.id}-${s.equipo_id}`} style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', alignItems: 'baseline', fontSize: '.82rem', opacity: s.abierta ? 1 : 0.6 }}>
                <span className="mono">{s.codigo}</span>
                <span className="badge" style={s.abierta ? { color: 'var(--warning)', borderColor: 'var(--warning)' } : undefined}>{SERVICIO_ESTADO_LABEL[s.estado] ?? s.estado}</span>
                <span className="muted">{fmtDate(s.created_at)}</span>
                <span>{s.descripcion}</span>
              </div>
            ))}
          </div>
          <small className="muted" style={{ display: 'block', marginTop: '.4rem', fontSize: '.72rem' }}>
            Vienen de <strong>Pedidos → Nuevo servicio</strong> (mantenimiento casado a este equipo). Acá registrás el seguimiento real (litros, filtros, trabajo…) en la bitácora.
          </small>
        </div>
      )}

      {canWrite && (
        <div style={{ marginBottom: '.6rem' }}>
          <button className="btn btn-sm btn-primary" onClick={() => setShowForm((v) => !v)}>{showForm ? '✕ Cancelar' : '+ Nuevo registro'}</button>
        </div>
      )}

      {showForm && canWrite && (
        <form onSubmit={handleAdd} className="card" style={{ padding: '.75rem', marginBottom: '.75rem' }}>
          <div className="form-grid">
            <div className="form-row"><label>Fecha</label><input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
            <div className="form-row"><label>Horómetro (lectura)</label><input className="input mono" name="bit-horometro" type="number" step="any" defaultValue={horometro} onChange={(e) => setHorometro(e.target.value)} /></div>
          </div>
          <div className="form-grid">
            <div className="form-row">
              <label>Kilometraje (lectura)</label>
              <input className="input mono" name="bit-km" type="number" step="any" min={0} value={kilometraje} onChange={(e) => setKilometraje(e.target.value)} placeholder="Odómetro en km" />
              <small className="muted" style={{ fontSize: '.72rem' }}>El nivel de alerta se fija en la ficha del equipo (Alerta a los X km).</small>
            </div>
          </div>
          {/* Vínculo con la Solicitud de Servicio + cuánto se colocó del servicio solicitado. */}
          {solicitudes.length > 0 && (
            <div className="form-grid">
              <div className="form-row">
                <label>Servicio solicitado (vincular)</label>
                <select className="select" value={solicitudId} onChange={(e) => setSolicitudId(e.target.value)}>
                  <option value="">— ninguno —</option>
                  {solicitudes.map((s) => (
                    <option key={s.id} value={s.id}>{s.codigo} · {s.descripcion}{s.abierta ? '' : ' (cerrado)'}</option>
                  ))}
                </select>
                <small className="muted" style={{ fontSize: '.72rem' }}>Vinculá el registro a la solicitud que se está atendiendo.</small>
              </div>
              <div className="form-row">
                <label>Cantidad colocada</label>
                <input className="input mono" type="number" step="any" min={0} value={cantidadColocada}
                  onChange={(e) => setCantidadColocada(e.target.value)} placeholder="¿Cuánto se colocó del servicio?" disabled={!solicitudId} />
                <small className="muted" style={{ fontSize: '.72rem' }}>Cuánto se aplicó del servicio solicitado.</small>
              </div>
            </div>
          )}
          <div className="form-grid">
            <div className="form-row">
              <label>Tipo de mantenimiento</label>
              <SearchSelect value={tipo} onChange={setTipo} allowCreate
                options={TIPOS_MANT}
                placeholder="🔎 Elegí el tipo (caucho, repuesto, aceite, pintura…)" emptyText="Escribí uno nuevo." />
            </div>
            <div className="form-row">
              <label>{tipo === 'CAMBIO DE PIEZA' ? 'Pieza cambiada *' : 'Pieza / repuesto'}</label>
              <input className="input" name="bit-pieza" placeholder={tipo === 'CAMBIO DE PIEZA' ? 'Ej: MOTOR, BOMBA, ALTERNADOR…' : 'Opcional'}
                value={pieza} onChange={(e) => setPieza(e.target.value.toUpperCase())} />
            </div>
          </div>
          <div className="form-grid">
            <div className="form-row"><label>Aceite (Lts)</label><input className="input mono" name="bit-aceite" type="number" step="any" defaultValue={aceite} onChange={(e) => setAceite(e.target.value)} /></div>
            <div className="form-row"><label>Refrigerante (Lts)</label><input className="input mono" name="bit-refrigerante" type="number" step="any" defaultValue={refrigerante} onChange={(e) => setRefrigerante(e.target.value)} /></div>
          </div>
          <div className="form-grid">
            <div className="form-row"><label>Gasoil (Lts)</label><input className="input mono" name="bit-gasoil" type="number" step="any" defaultValue={gasoil} onChange={(e) => setGasoil(e.target.value)} /></div>
            <div className="form-row"><label>Mecánico / taller</label><input className="input" name="bit-mecanico" defaultValue={mecanico} onChange={(e) => { e.target.value = e.target.value.toUpperCase(); setMecanico(e.target.value); }} /></div>
          </div>
          <div className="form-grid">
            <div className="form-row"><label>Filtros (cant.)</label><input className="input mono" name="bit-filtros-cant" type="number" step="any" min={0} defaultValue={filtrosCant} onChange={(e) => setFiltrosCant(e.target.value)} placeholder="0" /></div>
            <div className="form-row">
              <label>Tipo de filtro</label>
              <input className="input" name="bit-filtros-tipo" list="bit-filtros-tipos" defaultValue={filtrosTipo}
                onChange={(e) => { e.target.value = e.target.value.toUpperCase(); setFiltrosTipo(e.target.value); }}
                placeholder="ACEITE / AIRE / COMBUSTIBLE / HIDRÁULICO…" />
              <datalist id="bit-filtros-tipos">
                {['ACEITE', 'AIRE', 'COMBUSTIBLE', 'HIDRÁULICO', 'REFRIGERANTE', 'SEPARADOR'].map((t) => <option key={t} value={t} />)}
              </datalist>
            </div>
          </div>
          {/* Repuestos / insumos cambiados: cauchos, pintura, batería, repuestos… con su cantidad */}
          <div className="form-row" style={{ marginTop: '.2rem' }}>
            <label>Repuestos / insumos cambiados</label>
            <datalist id="bit-insumo-conceptos">
              {['CAUCHOS', 'BATERÍA', 'PINTURA', 'CORREA', 'AMORTIGUADOR', 'PASTILLAS DE FRENO', 'BUJÍAS', 'MANGUERA', 'BOMBA DE AGUA', 'ALTERNADOR', 'ARRANQUE', 'EMPACADURA', 'RODAMIENTO', 'REPUESTO'].map((c) => <option key={c} value={c} />)}
            </datalist>
            <datalist id="bit-insumo-unidades">
              {['UND', 'JGO', 'PAR', 'GAL', 'LTS', 'KG', 'MTS'].map((u) => <option key={u} value={u} />)}
            </datalist>
            {insumos.length === 0 && <small className="muted" style={{ fontSize: '.72rem' }}>Agregá lo que se le cambió al equipo (cauchos, pintura, repuestos…) con su cantidad, para llevar el seguimiento.</small>}
            <div style={{ display: 'grid', gap: '.4rem' }}>
              {insumos.map((x) => (
                <div key={x.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 80px 80px auto', gap: '.4rem', alignItems: 'center' }}>
                  <input className="input" list="bit-insumo-conceptos" value={x.concepto}
                    onChange={(e) => setInsumo(x.id, { concepto: e.target.value.toUpperCase() })} placeholder="Caucho, pintura, batería, repuesto…" />
                  <input className="input mono" type="number" step="any" min={0} value={x.cantidad}
                    onChange={(e) => setInsumo(x.id, { cantidad: e.target.value })} placeholder="Cant." title="Cantidad" />
                  <input className="input" list="bit-insumo-unidades" value={x.unidad}
                    onChange={(e) => setInsumo(x.id, { unidad: e.target.value.toUpperCase() })} placeholder="UND" title="Unidad" />
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => delInsumo(x.id)} title="Quitar">✕</button>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: '.4rem', justifySelf: 'start' }} onClick={addInsumo}>＋ Agregar repuesto / insumo</button>
          </div>
          <div className="form-row"><label>Trabajo y/o servicio</label><input className="input" name="bit-trabajo" defaultValue={trabajo} onChange={(e) => setTrabajo(e.target.value)} /></div>
          <div className="form-grid">
            <div className="form-row"><label>Consumibles utilizados</label><input className="input" name="bit-consumibles" defaultValue={consumibles} onChange={(e) => setConsumibles(e.target.value)} /></div>
            <div className="form-row"><label>Ubicación</label><input className="input" name="bit-ubicacion" defaultValue={ubicacion} onChange={(e) => { e.target.value = e.target.value.toUpperCase(); setUbicacion(e.target.value); }} /></div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar registro'}</button>
          </div>
        </form>
      )}

      {/* Filtro por fechas del detalle (movimientos) + totales del rango */}
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.5rem' }}>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
          Desde <input className="input" type="date" value={fDesde} max={fHasta || undefined} onChange={(e) => setFDesde(e.target.value)} style={{ width: 'auto' }} />
        </label>
        <label className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', fontSize: '.8rem' }}>
          Hasta <input className="input" type="date" value={fHasta} min={fDesde || undefined} onChange={(e) => setFHasta(e.target.value)} style={{ width: 'auto' }} />
        </label>
        {(fDesde || fHasta) && <button className="btn btn-sm btn-ghost" onClick={() => { setFDesde(''); setFHasta(''); }}>✕ Fechas</button>}
        <span className="muted" style={{ fontSize: '.78rem', marginLeft: 'auto' }}>{rowsFiltradas.length} de {rows.length} registro(s)</span>
      </div>

      {/* Totales del rango: cuánto se llevó de aceite / gasoil / filtros */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '.5rem', marginBottom: '.6rem' }}>
        <div className="card" style={{ margin: 0, padding: '.45rem .7rem' }}>
          <div className="muted" style={{ fontSize: '.66rem' }}>ACEITE (Σ)</div>
          <div className="mono" style={{ fontSize: '1rem', fontWeight: 700 }}>{fmtNum(totales.aceite)} L</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.45rem .7rem' }}>
          <div className="muted" style={{ fontSize: '.66rem' }}>GASOIL (Σ)</div>
          <div className="mono" style={{ fontSize: '1rem', fontWeight: 700 }}>{fmtNum(totales.gasoil)} L</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.45rem .7rem' }}>
          <div className="muted" style={{ fontSize: '.66rem' }}>REFRIGERANTE (Σ)</div>
          <div className="mono" style={{ fontSize: '1rem', fontWeight: 700 }}>{fmtNum(totales.refrigerante)} L</div>
        </div>
        <div className="card" style={{ margin: 0, padding: '.45rem .7rem' }}>
          <div className="muted" style={{ fontSize: '.66rem' }}>FILTROS (Σ)</div>
          <div className="mono" style={{ fontSize: '1rem', fontWeight: 700 }}>{fmtNum(totales.filtros)}</div>
        </div>
      </div>

      {/* Repuestos / insumos cambiados, sumados por concepto en el rango (cuántos cauchos, pintura…). */}
      {insumosTot.length > 0 && (
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '.6rem' }}>
          <span className="muted" style={{ fontSize: '.7rem' }}>REPUESTOS / INSUMOS (Σ):</span>
          {insumosTot.map((i) => (
            <span key={i.concepto} className="badge" title={i.concepto}>
              🔧 {i.concepto} <strong className="mono">{fmtNum(i.cantidad)}{i.unidad ? ` ${i.unidad}` : ''}</strong>
            </span>
          ))}
        </div>
      )}

      <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
        <table className="table" style={{ fontSize: '.8rem' }}>
          <thead><tr>
            <th>Fecha</th><th>Tipo</th><th style={{ textAlign: 'right' }}>Horómetro</th><th style={{ textAlign: 'right' }}>HRS.</th>
            <th style={{ textAlign: 'right' }}>Aceite</th><th style={{ textAlign: 'right' }}>Gasoil</th><th style={{ textAlign: 'right' }}>Lts/h</th>
            <th style={{ textAlign: 'right' }}>Filtros</th>
            <th>Repuestos / insumos</th>
            <th>Servicio solicitado</th>
            <th>Trabajo</th><th>Mecánico</th><th>Ubicación</th>{canWrite && <th></th>}
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={canWrite ? 14 : 13} className="muted" style={{ textAlign: 'center' }}>Cargando…</td></tr>}
            {!loading && !rowsFiltradas.length && <tr><td colSpan={canWrite ? 14 : 13} className="muted" style={{ textAlign: 'center' }}>{rows.length ? 'Sin registros en el rango de fechas.' : 'Sin registros.'}</td></tr>}
            {rowsFiltradas.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.fecha)}</td>
                <td style={{ fontSize: '.76rem' }}>
                  {r.tipo ? <span className="badge">{r.tipo}</span> : '—'}
                  {r.pieza ? <div className="muted mono" style={{ fontSize: '.7rem' }}>🔩 {r.pieza}</div> : null}
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.horometro != null ? fmtNum(r.horometro) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.horas != null ? fmtNum(r.horas) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.aceite_lts != null ? fmtNum(r.aceite_lts) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.gasoil_lts != null ? fmtNum(r.gasoil_lts) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{r.consumoLh != null ? fmtNum(r.consumoLh) : '—'}</td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {r.filtros_cant != null ? fmtNum(r.filtros_cant) : '—'}
                  {r.filtros_tipo ? <div className="muted" style={{ fontSize: '.68rem' }}>{r.filtros_tipo}</div> : null}
                </td>
                <td style={{ fontSize: '.74rem' }}>
                  {(r.insumos && r.insumos.length)
                    ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem' }}>
                        {r.insumos.map((i, k) => (
                          <span key={k} className="badge" style={{ fontSize: '.68rem' }}>{i.concepto}{i.cantidad != null ? ` ×${fmtNum(i.cantidad)}${i.unidad ? ` ${i.unidad}` : ''}` : ''}</span>
                        ))}
                      </div>
                    : '—'}
                </td>
                <td style={{ fontSize: '.74rem' }}>
                  {r.solicitud_codigo
                    ? <span className="mono">{r.solicitud_codigo}{r.cantidad_colocada != null ? <span className="badge" style={{ marginLeft: '.3rem' }}>colocado {fmtNum(r.cantidad_colocada)}</span> : null}</span>
                    : '—'}
                </td>
                <td style={{ fontSize: '.78rem' }}>{r.trabajo || '—'}</td>
                <td style={{ fontSize: '.78rem' }}>{r.mecanico || '—'}</td>
                <td style={{ fontSize: '.78rem' }}>{r.ubicacion || '—'}</td>
                {canWrite && <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-ghost" title="Eliminar" onClick={() => setBorrarId(r.id)}>🗑</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint muted" style={{ fontSize: '.72rem', margin: '.4rem 0 0' }}>
        HRS. = horómetro de este registro − el del registro anterior. Lts/h = gasoil ÷ HRS. {equipo.combustible_equipo ? `Horómetro y gasoil ⛽ vinculados a Combustible (${equipo.combustible_equipo}).` : 'Equipo sin vincular a Combustible.'}
      </p>

      {borrarId && (
        <ConfirmDialog title="Eliminar registro" message="¿Eliminar este registro de la bitácora?" confirmText="Eliminar" danger
          onCancel={() => setBorrarId(null)} onConfirm={() => { const id = borrarId; setBorrarId(null); void borrar(id); }} />
      )}
    </Modal>
  );
}
