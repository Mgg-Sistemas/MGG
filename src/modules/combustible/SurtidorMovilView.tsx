/* ============================================================
   MGG · Combustible · Surtidor (vista de teléfono)

   La pantalla del que está al lado del tanque con el celular: elige el
   tanque, toca «Surtir a un equipo», «Pasar a otro tanque», «Entrada» o
   «Merma», pone los litros, a qué equipo va, quién autorizó, le saca
   fotos y guarda. Abajo ve los últimos movimientos del tanque y puede
   abrir cada uno para ver o agregar fotos, mandarlo por WhatsApp o
   borrarlo (con confirmación). El 📊 Reporte muestra un rango de fechas
   por tipo, con las fotos de cada movimiento.

   Escribe en las MISMAS tablas que el módulo de PC (crearTanqueMovimiento
   / eliminarTanqueMovimiento, con PMP y medidores encadenados), así que
   lo que se hace acá aparece al instante en la PC y viceversa (realtime).
   Corregir litros, equipo u hora es tarea de la PC.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { toast } from '@/shared/ui/Toast';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { num, date, dateTime, money } from '@/shared/lib/format';
import type { CatalogoCombustible, TanqueMovimiento, Tanque, TipoMovimientoTanque, VehiculoMaquina } from '@/shared/lib/types';
import {
  listTanques, listCatalogo, listVehiculos, listTanqueMovimientos, crearTanqueMovimiento,
  eliminarTanqueMovimiento, ultimoHorometroEquipo, ultimoContadorTanque, kilometrajesVigentesPorEquipo,
} from './combustible.repository';
import { contarFotos, eliminarFotosDe, subirFotos } from './adjuntosCombustible.repository';
import { FotosDelMovimiento, SelectorFotos } from './FotosMovimiento';
import { SurtidorReporteMovil } from './SurtidorReporteMovil';
import {
  EMOJI_MOVIMIENTO, TITULO_MOVIMIENTO, compartirMovimiento, enlaceWhatsapp, mensajeMovimiento, puedeCompartir,
} from './mensajeMovimiento';
import { errorHorometro, horasTrabajadas, textoHorometro } from './horometro';
import { errorSurtido, litrosTrasSurtido } from './saldoTanque';
import { claveEquipo } from './equipoVinculo';

/* La clave del rol vive con el resto de los permisos: el redirector de inicio la
   necesita antes de cargar ningún módulo de combustible. Se re-exporta acá para
   no romper a quien ya la importaba de esta pantalla. */
import { ROL_SURTIDOR, RUTA_SURTIDOR } from '@/modules/usuarios/permisos.repository';
import { AtajosTelefono } from '@/shared/ui/AtajosTelefono';
export { ROL_SURTIDOR };

/** Cuántos movimientos se ven en el teléfono. El libro completo está en la PC. */
export const ULTIMOS_EN_TELEFONO = 10;

const NOMBRE_TIPO: Record<TipoMovimientoTanque, string> = {
  ingreso: 'Entrada', consumo: 'Surtido', traslado: 'Traslado', retorno: 'Retorno', merma: 'Merma',
};

/** Lo que se puede registrar desde el teléfono (el retorno queda para la PC). */
type TipoSurtidor = 'consumo' | 'traslado' | 'ingreso' | 'merma';

const TITULO: Record<TipoSurtidor, string> = {
  consumo: 'Surtir a un equipo', traslado: 'Pasar a otro tanque',
  ingreso: 'Entrada de combustible', merma: 'Merma del tanque',
};

const hoyVE = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const horaVE = () => {
  const d = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  return d;
};

/** Fecha y hora de planta → el timestamp que guarda la base. Venezuela es UTC−4. */
function isoDePlanta(fecha: string, hora: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return new Date().toISOString();
  const h = /^\d{2}:\d{2}$/.test(hora) ? hora : '00:00';
  return `${fecha}T${h}:00-04:00`;
}

export function SurtidorMovilView() {
  const { user } = useSession();
  const { can, appUser, soloTelefono } = usePermissions();
  const canWrite = can('combustible', 'escritura');
  // Rol marcado «solo teléfono»: no tiene módulo de escritorio al que volver.
  const esSurtidor = soloTelefono;
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre?.trim() || user?.email || null;

  const [tanques, setTanques] = useState<Tanque[]>([]);
  const [autorizados, setAutorizados] = useState<CatalogoCombustible[]>([]);
  const [ubicaciones, setUbicaciones] = useState<CatalogoCombustible[]>([]);
  const [equipos, setEquipos] = useState<VehiculoMaquina[]>([]);
  const [selId, setSelId] = useState('');
  const [movs, setMovs] = useState<TanqueMovimiento[]>([]);
  const [conteo, setConteo] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [paso, setPaso] = useState<'inicio' | 'form'>('inicio');
  const [tipo, setTipo] = useState<TipoSurtidor>('consumo');
  const [detalle, setDetalle] = useState<TanqueMovimiento | null>(null);
  const [reporte, setReporte] = useState(false);

  const reloadBase = useCallback(async () => {
    const [ts, aut, ubi, eq] = await Promise.all([
      listTanques(),
      listCatalogo('combustible_autorizados'),
      listCatalogo('combustible_ubicaciones'),
      listVehiculos(),
    ]);
    const activos = ts.filter((t) => (t as { estado?: string }).estado !== 'inactivo');
    setTanques(activos);
    setAutorizados(aut.filter((c) => c.estado === 'activo'));
    setUbicaciones(ubi.filter((c) => c.estado === 'activo'));
    setEquipos(eq.filter((v) => v.estado === 'activo'));
    setSelId((prev) => (prev && activos.some((t) => t.id === prev) ? prev : activos[0]?.id ?? ''));
  }, []);

  // Solo los últimos 10 del tanque, del más nuevo al más viejo: en el teléfono no se
  // lee un libro mayor, se mira lo que acaba de pasar.
  const reloadMovs = useCallback(async (id: string) => {
    if (!id) { setMovs([]); setConteo(new Map()); return; }
    const todos = await listTanqueMovimientos({ tanqueId: id });
    const ordenados = [...todos].sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''));
    const ultimos = ordenados.slice(0, ULTIMOS_EN_TELEFONO);
    setMovs(ultimos);
    try { setConteo(await contarFotos(ultimos.map((m) => m.id))); }
    catch { /* el contador de fotos es adorno: sin él la lista se muestra igual */ }
  }, []);

  useEffect(() => {
    let cancel = false;
    reloadBase().catch((e) => { if (!cancel) toast(e instanceof Error ? e.message : 'No se pudo cargar', 'error'); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [reloadBase]);
  useEffect(() => { void reloadMovs(selId).catch(() => {}); }, [selId, reloadMovs]);
  useRealtime(['combustible_tanques', 'combustible_tanque_movimientos', 'combustible_adjuntos'], () => {
    void reloadBase().catch(() => {});
    void reloadMovs(selId).catch(() => {});
  });

  const sel = useMemo(() => tanques.find((t) => t.id === selId) ?? null, [tanques, selId]);
  // Si el movimiento abierto lo borró otro (o se borró acá), el detalle se cierra solo.
  const detalleVivo = detalle ? movs.find((m) => m.id === detalle.id) ?? null : null;
  useEffect(() => { if (detalle && !loading && movs.length && !movs.some((m) => m.id === detalle.id)) setDetalle(null); }, [detalle, movs, loading]);

  function abrirForm(t: TipoSurtidor) { setTipo(t); setPaso('form'); }

  return (
    <div className="surtidor">
      <header className="surt-head">
        <div>
          <h1>⛽ Surtidor</h1>
          <div className="muted" style={{ fontSize: '.85rem' }}>{actorName ?? actor}</div>
        </div>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" onClick={() => setReporte(true)} disabled={!tanques.length}
            title="Movimientos por rango de fechas, agrupados por tipo, con sus fotos">📊 Reporte</button>
          {!esSurtidor && <Link to="/app/combustible" className="btn btn-ghost">🖥 Módulo completo</Link>}
        </div>
      </header>
      <AtajosTelefono actual={RUTA_SURTIDOR} />

      {loading && <p className="muted">Cargando…</p>}
      {!loading && !tanques.length && <EmptyState icon="⛽" message="No hay tanques activos. Se crean desde el módulo en la PC." />}

      {!!tanques.length && (
        <>
          <div className="surt-rotulo">Tanque</div>
          <div className="surt-tanques" role="tablist" aria-label="Tanque">
            {tanques.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={t.id === selId}
                className={`surt-tanque${t.id === selId ? ' sel' : ''}`}
                onClick={() => { setSelId(t.id); setPaso('inicio'); }}>
                <div className="nombre">{t.nombre}</div>
                <div className="saldo">{num(t.litros)} <small>L</small></div>
              </button>
            ))}
          </div>
        </>
      )}

      {sel && paso === 'inicio' && canWrite && (
        <div className="surt-acciones">
          <button type="button" className="surt-btn primario" onClick={() => abrirForm('consumo')}>
            <span className="icono" aria-hidden>⛽</span>
            <span>Surtir a un equipo</span>
            <small>Sale combustible de {sel.nombre} a un equipo o camión</small>
          </button>
          <button type="button" className="surt-btn" onClick={() => abrirForm('traslado')}>
            <span className="icono" aria-hidden>🔁</span>
            <span>Pasar a otro tanque</span>
            <small>Traslado a otro tanque</small>
          </button>
          <button type="button" className="surt-btn entrada" onClick={() => abrirForm('ingreso')}>
            <span className="icono" aria-hidden>⬇</span>
            <span>Entrada</span>
            <small>Llega combustible al tanque</small>
          </button>
          <button type="button" className="surt-btn merma" onClick={() => abrirForm('merma')}>
            <span className="icono" aria-hidden>🔻</span>
            <span>Merma</span>
            <small>Pérdida o faltante del tanque</small>
          </button>
        </div>
      )}
      {sel && !canWrite && (
        <div className="aviso warning sm" style={{ margin: '.75rem 0' }}>
          <span className="aviso-icono">👁</span>
          <div>Tu rol solo puede ver. Para registrar surtidos hace falta escritura en Combustible.</div>
        </div>
      )}

      {sel && paso === 'form' && (
        <FormularioSurtido key={`${sel.id}-${tipo}`} tipo={tipo} tanque={sel} tanques={tanques}
          autorizados={autorizados} ubicaciones={ubicaciones} equipos={equipos}
          actor={actor} actorName={actorName}
          onCancel={() => setPaso('inicio')}
          onSaved={async () => { setPaso('inicio'); await reloadBase().catch(() => {}); await reloadMovs(sel.id).catch(() => {}); }} />
      )}

      {sel && (
        <section className="surt-lista">
          <h2>Últimos {ULTIMOS_EN_TELEFONO} movimientos · {sel.nombre}</h2>
          {!movs.length && <p className="muted">Este tanque no tiene movimientos todavía.</p>}
          {movs.map((m) => {
            // En un traslado, la pata que recibió sumó litros: se lee como entrada.
            const entra = m.tipo === 'ingreso' || m.tipo === 'retorno'
              || (m.tipo === 'traslado' && (Number(m.litros_despues) || 0) > (Number(m.litros_antes) || 0));
            const n = conteo.get(m.id) ?? 0;
            return (
              <button key={m.id} type="button" className="surt-mov" onClick={() => setDetalle(m)}>
                <span className="icono" aria-hidden>{EMOJI_MOVIMIENTO[m.tipo]}</span>
                <span style={{ minWidth: 0 }}>
                  <div className="titulo">{m.equipo || m.observacion || NOMBRE_TIPO[m.tipo]}</div>
                  <div className="sub">
                    {NOMBRE_TIPO[m.tipo]} · {date(m.fecha)}
                    {m.autorizado_por ? ` · Aut.: ${m.autorizado_por}` : ''}
                    {n > 0 ? ` · 📎 ${n}` : ''}
                  </div>
                </span>
                <span className={`litros${entra ? ' entra' : ''}`}>{entra ? '+' : '−'}{num(m.litros)} L</span>
              </button>
            );
          })}
          {movs.length >= ULTIMOS_EN_TELEFONO && (
            <p className="muted" style={{ fontSize: '.85rem' }}>Acá se ven los últimos {ULTIMOS_EN_TELEFONO}. El libro completo está en el módulo de Combustible en la PC.</p>
          )}
        </section>
      )}

      {detalleVivo && (
        <DetalleMovil mov={detalleVivo} tanque={tanques.find((t) => t.id === detalleVivo.tanque_id) ?? null} tanques={tanques}
          canWrite={canWrite} esSurtidor={esSurtidor} actor={actor} actorName={actorName} onClose={() => setDetalle(null)}
          onBorrado={async () => { setDetalle(null); await reloadBase().catch(() => {}); await reloadMovs(selId).catch(() => {}); }} />
      )}

      {reporte && <SurtidorReporteMovil tanques={tanques} tanqueInicial={selId} onClose={() => setReporte(false)} />}
    </div>
  );
}

/* ───────────── Formulario: surtido, traslado, entrada o merma ───────────── */
function FormularioSurtido({ tipo, tanque, tanques, autorizados, ubicaciones, equipos, actor, actorName, onCancel, onSaved }: {
  tipo: TipoSurtidor; tanque: Tanque; tanques: Tanque[];
  autorizados: CatalogoCombustible[]; ubicaciones: CatalogoCombustible[]; equipos: VehiculoMaquina[];
  actor: string; actorName: string | null; onCancel: () => void; onSaved: () => Promise<void>;
}) {
  const sale = tipo !== 'ingreso';
  const [litros, setLitros] = useState('');
  const [costo, setCosto] = useState(tanque.tasa ? String(tanque.tasa) : '');
  const [equipo, setEquipo] = useState('');
  const [autorizado, setAutorizado] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [ubicacion, setUbicacion] = useState('');
  const [observacion, setObservacion] = useState('');
  const [fecha, setFecha] = useState(hoyVE());
  const [hora, setHora] = useState(horaVE());
  const [hi, setHi] = useState(''); const [hiAuto, setHiAuto] = useState(false);
  const [hf, setHf] = useState('');
  const [km, setKm] = useState('');
  const [ci, setCi] = useState(''); const [ciAuto, setCiAuto] = useState(false);
  const [cf, setCf] = useState('');
  const [masDatos, setMasDatos] = useState(false);
  const [fotos, setFotos] = useState<File[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [etapa, setEtapa] = useState<'movimiento' | 'fotos'>('movimiento');
  // Con mala señal, subir fotos puede tardar: pasados unos segundos se avisa que el
  // movimiento ya está guardado, para que nadie lo vuelva a cargar.
  const [demorado, setDemorado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!guardando) { setDemorado(false); return; }
    const t = setTimeout(() => setDemorado(true), 12_000);
    return () => clearTimeout(t);
  }, [guardando]);

  // Igual que en la PC: el horómetro inicial es del equipo y el contador inicial es del
  // tanque; se traen del último final para que la cadena no se corte.
  //
  // Los dos horómetros se limpian ANTES de preguntar por el equipo nuevo. Si no, al
  // corregir el equipo elegido el HI del anterior quedaba en el campo —editable, porque
  // `hiAuto` sí se apagaba— y se guardaba como horómetro inicial de un equipo que nunca
  // estuvo en ese número. El HF también: era del equipo viejo.
  useEffect(() => {
    setHi(''); setHf(''); setHiAuto(false);
    if (!equipo) return;
    // Dos cambios seguidos de equipo con mala señal pueden responder al revés: la
    // respuesta de un equipo que ya no está elegido no escribe nada.
    let vigente = true;
    ultimoHorometroEquipo(equipo).then((u) => {
      if (!vigente || u == null) return;
      setHi(String(u)); setHiAuto(true);
      // El horómetro vivía detrás de «Más datos», así que en el teléfono casi nunca se
      // cargaba el final y la cadena del equipo no avanzaba. Si el equipo ya tiene
      // horómetro, se abre para que se vea que falta cerrarlo.
      setMasDatos(true);
    }).catch(() => {});
    kilometrajesVigentesPorEquipo().then((mapa) => {
      // El mapa viene con la clave NORMALIZADA (sin acentos, en mayúsculas). Buscándolo
      // con el nombre tal cual se teclea, «Camión NHR» nunca encontraba su kilometraje
      // y el campo quedaba vacío sin avisar.
      const u = mapa.get(claveEquipo(equipo));
      if (vigente && u != null) setKm(String(u));
    }).catch(() => {});
    return () => { vigente = false; };
  }, [equipo]);
  useEffect(() => {
    ultimoContadorTanque(tanque.id).then((u) => { if (u != null) { setCi(String(u)); setCiAuto(true); } else { setCi(''); setCiAuto(false); } }).catch(() => {});
  }, [tanque.id]);

  const litrosNum = Number(String(litros).replace(',', '.')) || 0;
  const costoNum = Number(String(costo).replace(',', '.')) || 0;
  const litrosContador = ci !== '' && cf !== '' ? Number(cf) - Number(ci) : null;
  // Las horas trabajadas no se teclean: son HF − HI. Mismo cálculo que en la PC.
  const horas = horasTrabajadas(hi, hf);
  const avisoHorometro = errorHorometro(hi, hf);
  // Lo que sale del tanque (surtido, traslado, merma) no puede dejarlo en negativo ni salir
  // de un tanque en 0 L: se avisa en vivo y el botón se apaga. La base lo vuelve a chequear.
  const dispTanque = Number(tanque.litros) || 0;
  const motivoSaldo = sale ? errorSurtido(dispTanque, litrosNum, tanque.nombre) : null;
  const quedarian = sale ? litrosTrasSurtido(dispTanque, litrosNum) : null;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!(litrosNum > 0)) {
      setError(tipo === 'ingreso' ? 'Indicá los litros que entraron.' : tipo === 'merma' ? 'Indicá los litros de la merma.' : 'Indicá los litros surtidos.');
      return;
    }
    if (tipo === 'consumo' && !equipo) { setError('Indicá a qué equipo o camión va el combustible.'); return; }
    if (tipo === 'traslado' && !destinoId) { setError('Indicá a qué tanque pasa el combustible.'); return; }
    if (tipo === 'merma' && !observacion.trim()) { setError('Indicá el motivo de la merma (faltante, derrame, evaporación…).'); return; }
    if (motivoSaldo) { setError(motivoSaldo); return; }
    // El HF de este surtido es el HI del próximo: un retroceso rompe la cadena del equipo.
    if (avisoHorometro) { setError(avisoHorometro); setMasDatos(true); return; }
    setGuardando(true); setEtapa('movimiento');
    try {
      const movId = await crearTanqueMovimiento({
        tanqueId: tanque.id,
        tipo,
        litros: litrosNum,
        costoLitro: tipo === 'ingreso' ? costoNum : null,
        fecha: isoDePlanta(fecha, hora),
        horometroInicial: hi === '' ? null : Number(hi),
        horometroFinal: hf === '' ? null : Number(hf),
        kilometrajeFinal: km === '' ? null : Number(km),
        contadorIni: ci === '' ? null : Number(ci),
        contadorFin: cf === '' ? null : Number(cf),
        equipo,
        autorizadoPor: autorizado,
        despachadoPor: actorName,
        destino: ubicacion,
        observacion,
        tanqueDestinoId: tipo === 'traslado' ? destinoId : null,
        actor,
        actorName,
      });
      // Las fotos se suben recién ahora: la carpeta lleva el id del movimiento.
      if (fotos.length) {
        setEtapa('fotos');
        const { fallos } = await subirFotos(movId, fotos, actor);
        for (const f of fallos) toast(`Movimiento guardado, pero una foto no se pudo subir: ${f}`, 'error');
      }
      toast(`${TITULO[tipo]}: registrado`, 'success');
      await onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo registrar.'); }
    finally { setGuardando(false); }
  }

  const destinos = tanques.filter((t) => t.id !== tanque.id);
  const subtitulo = tipo === 'ingreso'
    ? `Entra a ${tanque.nombre} · hoy tiene ${num(tanque.litros)} L a ${money(tanque.tasa)}/L`
    : `Desde ${tanque.nombre} · ${num(tanque.litros)} L disponibles`;

  return (
    <form className="surt-form card" onSubmit={guardar}>
      <div className="surt-form-titulo">
        <span className="icono" aria-hidden>{EMOJI_MOVIMIENTO[tipo]}</span>
        <div>
          <strong>{TITULO[tipo]}</strong>
          <div className="muted" style={{ fontSize: '.85rem' }}>{subtitulo}</div>
        </div>
      </div>

      {error && <div className="aviso danger"><span className="aviso-icono">⛔</span><div>{error}</div></div>}

      <div className="surt-campo">
        <label htmlFor="surt-litros">{tipo === 'merma' ? 'Litros perdidos' : 'Litros'}</label>
        <input id="surt-litros" className="input surt-input surt-litros" type="number" inputMode="decimal" step="any" min={0}
          value={litros} onChange={(e) => setLitros(e.target.value)} placeholder="0" autoFocus required
          aria-invalid={motivoSaldo ? true : undefined} />
        {sale && (motivoSaldo
          ? <small className="surt-alerta" role="alert">⛔ {motivoSaldo}</small>
          : <small className="muted">Disponible: {num(dispTanque)} L{quedarian != null ? ` · quedarían ${num(quedarian)} L` : ''}</small>)}
      </div>

      {tipo === 'ingreso' && (
        <div className="surt-campo">
          <label htmlFor="surt-costo">Costo por litro (USD)</label>
          <input id="surt-costo" className="input surt-input" type="number" inputMode="decimal" step="0.0001" min={0}
            value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="0,00" />
          <small className="muted">Recalcula la tasa promedio del combustible. Viene precargado con la tasa del tanque.</small>
        </div>
      )}

      {tipo === 'traslado' && (
        <div className="surt-campo">
          <label htmlFor="surt-destino">¿A qué tanque pasa?</label>
          <div className="surt-buscable">
            <SearchSelect id="surt-destino" value={destinoId} onChange={setDestinoId} placeholder="🔍 Buscá el tanque…"
              sinPreseleccion
              options={destinos.map((t) => ({ value: t.id, label: `${t.nombre} · ${num(t.litros)} L` }))} />
          </div>
        </div>
      )}

      {tipo === 'merma' && (
        <div className="surt-campo">
          <label htmlFor="surt-motivo">Motivo de la merma</label>
          <input id="surt-motivo" className="input surt-input" value={observacion} onChange={(e) => setObservacion(e.target.value)}
            placeholder="Faltante en conteo, derrame, evaporación…" required />
        </div>
      )}

      {tipo !== 'merma' && (
        <div className="surt-campo">
          <label htmlFor="surt-equipo">
            {tipo === 'consumo' ? '¿A qué equipo o camión va?' : tipo === 'ingreso' ? 'Camión o cisterna que lo trajo (opcional)' : 'Equipo / camión que lo lleva (opcional)'}
          </label>
          <div className="surt-buscable">
            <SearchSelect id="surt-equipo" value={equipo} onChange={setEquipo} placeholder="🔍 Escribí parte del nombre o la placa…"
              sinPreseleccion
              options={equipos.map((v) => ({ value: v.nombre, label: v.nombre, hint: v.descripcion ?? '' }))} />
          </div>
        </div>
      )}

      <div className="surt-campo">
        <label htmlFor="surt-autorizado">Autorizado por</label>
        <div className="surt-buscable">
          <SearchSelect id="surt-autorizado" value={autorizado} onChange={setAutorizado} placeholder="🔍 Buscá quién autorizó…"
            sinPreseleccion
            options={autorizados.map((c) => ({ value: c.nombre, label: c.nombre }))} />
        </div>
      </div>

      {(tipo === 'consumo' || tipo === 'traslado') && (
        <div className="surt-campo">
          <label htmlFor="surt-cf">Contador del surtidor al terminar</label>
          <input id="surt-cf" className="input surt-input" type="number" inputMode="decimal" step="any" value={cf} onChange={(e) => setCf(e.target.value)}
            placeholder={ciAuto ? `arrancó en ${ci}` : 'lectura final del contador'} />
          {litrosContador != null && (
            <small className={Math.abs(litrosContador - litrosNum) > 1 ? 'surt-alerta' : 'muted'}>
              Según el contador salieron {num(litrosContador)} L{Math.abs(litrosContador - litrosNum) > 1 && litrosNum > 0 ? ' · no coincide con los litros' : ''}
            </small>
          )}
        </div>
      )}

      <SelectorFotos archivos={fotos} onChange={setFotos}
        titulo={tipo === 'ingreso' ? '📷 Fotos (guía, cisterna, medida)' : tipo === 'merma' ? '📷 Fotos (regla, conteo)' : '📷 Fotos (contador, equipo, vale)'} />

      <button type="button" className="surt-mas" onClick={() => setMasDatos((v) => !v)}>
        {masDatos
          ? '▾ Menos datos'
          : hiAuto && hf === ''
            // Si el equipo tiene horómetro y falta el final, se dice acá: con la sección
            // cerrada no había ninguna señal de que quedaba un dato por poner.
            ? `▸ Más datos · falta el horómetro final (arrancó en ${hi})`
            : `▸ Más datos (${tipo === 'consumo' || tipo === 'traslado' ? 'horómetro, kilometraje, ' : ''}destino, hora${tipo === 'merma' ? '' : ', observación'})`}
      </button>
      {masDatos && (
        <>
          {(tipo === 'consumo' || tipo === 'traslado') && (
            <>
              {/* El HF de este surtido queda como HI del próximo del mismo equipo: por eso
                  el HI viene precargado y bloqueado, y las horas salen de la resta. */}
              <div className="surt-grid2">
                <div className="surt-campo">
                  <label htmlFor="surt-hi">Horómetro inicial{hiAuto ? ' 🔒' : ''}</label>
                  <input id="surt-hi" className="input surt-input" type="number" inputMode="decimal" step="any" value={hi} readOnly={hiAuto}
                    onChange={(e) => setHi(e.target.value)} placeholder={equipo ? 'primer horómetro del equipo' : 'elegí el equipo'} />
                </div>
                <div className="surt-campo">
                  <label htmlFor="surt-hf">Horómetro final</label>
                  <input id="surt-hf" className="input surt-input" type="number" inputMode="decimal" step="any" value={hf} onChange={(e) => setHf(e.target.value)} />
                </div>
              </div>
              {equipo && (
                <small className={avisoHorometro ? 'surt-alerta' : 'muted'}>
                  {avisoHorometro
                    ? avisoHorometro
                    : horas != null
                      ? <>Trabajó <strong className="mono">{num(horas)} h</strong> (final − inicial) · ese {num(Number(hf))} queda como inicial del próximo surtido</>
                      : hiAuto
                        ? `🔒 Arranca en ${hi}, el último horómetro de ${equipo}. Poné el final para saber las horas.`
                        : `Primer surtido de ${equipo}: poné el horómetro inicial y el final; de ahí en más se encadena solo.`}
                </small>
              )}
              <div className="surt-grid2">
                <div className="surt-campo">
                  <label htmlFor="surt-km">Kilometraje</label>
                  <input id="surt-km" className="input surt-input" type="number" inputMode="decimal" step="any" value={km} onChange={(e) => setKm(e.target.value)} placeholder="odómetro" />
                </div>
                <div className="surt-campo">
                  <label htmlFor="surt-ci">Contador inicial</label>
                  <input id="surt-ci" className="input surt-input" type="number" inputMode="decimal" step="any" value={ci} readOnly={ciAuto} onChange={(e) => setCi(e.target.value)} />
                </div>
              </div>
            </>
          )}
          <div className="surt-campo">
            <label htmlFor="surt-ubic">Destino / mina</label>
            <div className="surt-buscable">
              <SearchSelect id="surt-ubic" value={ubicacion} onChange={setUbicacion} placeholder="🔍 Buscá el destino…"
                sinPreseleccion
                options={[{ value: '', label: '— sin destino —' }, ...ubicaciones.map((c) => ({ value: c.nombre, label: c.nombre }))]} />
            </div>
          </div>
          <div className="surt-grid2">
            <div className="surt-campo">
              <label htmlFor="surt-fecha">Fecha</label>
              <input id="surt-fecha" className="input surt-input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="surt-campo">
              <label htmlFor="surt-hora">Hora</label>
              <input id="surt-hora" className="input surt-input" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>
          </div>
          {tipo !== 'merma' && (
            <div className="surt-campo">
              <label htmlFor="surt-obs">Observación</label>
              <input id="surt-obs" className="input surt-input" value={observacion} onChange={(e) => setObservacion(e.target.value)}
                placeholder={tipo === 'ingreso' ? 'Compra PDVSA, guía N°…' : 'SUMINISTRO COMBUSTIBLE…'} />
            </div>
          )}
        </>
      )}

      {guardando && demorado && (
        <div className="aviso warning">
          <span className="aviso-icono">⏳</span>
          <div>
            {etapa === 'fotos'
              ? <><strong>El movimiento ya quedó guardado</strong>; se están subiendo las fotos con poca señal. No lo vuelvas a cargar. Podés esperar o volver a la lista: las fotos siguen subiendo solas.</>
              : <>Está tardando más de lo normal por la señal. No lo vuelvas a cargar hasta revisar la lista.</>}
            <div style={{ marginTop: '.5rem' }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Ver la lista</button>
            </div>
          </div>
        </div>
      )}
      <button type="submit" className="btn btn-primary surt-guardar" disabled={guardando || !!motivoSaldo} title={motivoSaldo ?? undefined}>
        {guardando
          ? (etapa === 'fotos' ? `Subiendo ${fotos.length === 1 ? 'la foto' : `${fotos.length} fotos`}…` : 'Guardando…')
          : `✔ Registrar ${tipo === 'consumo' ? 'surtido' : tipo === 'traslado' ? 'traslado' : tipo === 'ingreso' ? 'entrada' : 'merma'}`}
      </button>
      <button type="button" className="btn btn-ghost btn-grande" onClick={onCancel} disabled={guardando}>Cancelar</button>
    </form>
  );
}

/* ───────────── Detalle de un movimiento (fotos, WhatsApp y borrado) ───────────── */
function DetalleMovil({ mov, tanque, tanques, canWrite, esSurtidor, actor, actorName, onClose, onBorrado }: {
  mov: TanqueMovimiento; tanque: Tanque | null; tanques: Tanque[];
  canWrite: boolean; esSurtidor: boolean; actor: string; actorName: string | null;
  onClose: () => void; onBorrado: () => Promise<void>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const destino = mov.tanque_destino_id ? tanques.find((t) => t.id === mov.tanque_destino_id)?.nombre : null;
  const Fila = ({ k, v }: { k: string; v: string | null | undefined }) => v ? (
    <div className="surt-fila"><span className="muted">{k}</span><span>{v}</span></div>
  ) : null;

  // El mismo texto para el portapapeles y para WhatsApp: si dice 120 litros es
  // porque en la base dice 120 litros.
  const texto = mensajeMovimiento(mov, {
    tanque: tanque?.nombre ?? mov.tanque_nombre,
    tanqueDestino: destino,
    combustible: tanque?.combustible_nombre ?? null,
    registradoPor: mov.actor_name ?? actorName,
  });

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      toast('Mensaje copiado', 'success');
    } catch {
      // Sin permiso de portapapeles (o navegador viejo): se muestra para copiar a mano.
      toast('No se pudo copiar solo. Mantené presionado el texto para copiarlo.', 'warning');
    }
  }

  async function borrar() {
    setBorrando(true);
    try {
      // Primero las fotos: si se borra el movimiento y falla esto, quedan
      // archivos apuntando a algo que ya no existe.
      await eliminarFotosDe(mov.id).catch(() => {});
      await eliminarTanqueMovimiento(mov.id, actor, actorName);
      toast('Movimiento borrado', 'success');
      await onBorrado();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo borrar', 'error');
      setBorrando(false);
    }
  }

  /*
   * La confirmación de borrado ocupa TODO el cuerpo del modal, y sus botones van
   * en el pie, que es donde está el dedo.
   *
   * Antes se dibujaba al final del cuerpo —después del detalle, de los botones de
   * aviso y del mensaje de WhatsApp entero—: en el teléfono quedaba media pantalla
   * más abajo y lo único que se veía al tocar 🗑 era desaparecer el botón. Parecía
   * que el sistema no preguntaba nada.
   */
  if (confirmando) {
    return (
      <Modal title="🗑 Borrar movimiento" size="md"
        onClose={() => { if (!borrando) setConfirmando(false); }}
        footer={<>
          <button type="button" className="btn btn-ghost btn-grande" onClick={() => setConfirmando(false)} disabled={borrando}>
            ↩ NO, VOLVER
          </button>
          <button type="button" className="btn btn-peligro btn-grande" onClick={() => void borrar()} disabled={borrando}>
            {borrando ? 'Borrando…' : '🗑 SÍ, BORRAR'}
          </button>
        </>}>
        <div className="surt-confirmar">
          <strong style={{ fontSize: '1.15rem', display: 'block' }}>
            ¿Borrar este {TITULO_MOVIMIENTO[mov.tipo].toLowerCase()} de {num(mov.litros)} L?
          </strong>
          <div className="surt-detalle" style={{ marginTop: '.7rem' }}>
            <Fila k="Tanque" v={tanque?.nombre ?? mov.tanque_nombre} />
            <Fila k="Fecha" v={dateTime(mov.fecha)} />
            <Fila k="Equipo" v={mov.equipo} />
            <Fila k="Autorizado por" v={mov.autorizado_por} />
          </div>
          <div className="muted" style={{ marginTop: '.7rem', fontSize: '.95rem' }}>
            Se borran también sus fotos{mov.mov_vinculado_id ? ' y el movimiento vinculado del otro tanque' : ''},
            y el saldo del tanque se recalcula. <strong>No se puede deshacer.</strong> Se refleja al instante en la PC.
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`${EMOJI_MOVIMIENTO[mov.tipo]} ${TITULO_MOVIMIENTO[mov.tipo]} · ${num(mov.litros)} L`} size="md"
      onClose={() => { if (!borrando) onClose(); }}
      footer={<>
        {canWrite && <button className="btn btn-danger btn-grande" onClick={() => setConfirmando(true)}>🗑 Eliminar</button>}
        {!esSurtidor && <Link to="/app/combustible" className="btn btn-ghost btn-grande" onClick={onClose}>🖥 Corregir en la PC</Link>}
        <button className="btn btn-primary btn-grande" onClick={onClose}>Cerrar</button>
      </>}>
      <div className="surt-detalle">
        <Fila k="Tanque" v={tanque?.nombre ?? mov.tanque_nombre} />
        <Fila k="Fecha" v={dateTime(mov.fecha)} />
        <Fila k="Equipo" v={mov.equipo} />
        <Fila k="A qué tanque" v={destino} />
        <Fila k="Autorizado por" v={mov.autorizado_por} />
        <Fila k="Despachado por" v={mov.despachado_por} />
        <Fila k="Destino / mina" v={mov.destino} />
        <Fila k="Observación" v={mov.observacion} />
        {mov.tipo === 'ingreso' && <Fila k="Costo por litro" v={money(mov.costo_litro)} />}
        <Fila k="Contador" v={mov.contador_global_ini != null || mov.contador_global_fin != null ? `${mov.contador_global_ini ?? '—'} → ${mov.contador_global_fin ?? '—'}` : null} />
        <Fila k="Horómetro" v={textoHorometro(mov.horometro_inicial, mov.horometro_final, num)} />
        <Fila k="Kilometraje" v={mov.kilometraje_final != null ? num(mov.kilometraje_final) : null} />
        <Fila k="Registrado" v={`${dateTime(mov.created_at)}${mov.actor_name || mov.actor ? ` · ${mov.actor_name || mov.actor}` : ''}`} />
      </div>

      {/* ── Avisar lo que se surtió ── */}
      <div className="surt-rotulo">Avisar</div>
      <div className="surt-grid2">
        <button type="button" className="btn btn-ghost btn-grande" onClick={() => void copiar()}>📋 Copiar mensaje</button>
        {/* En el teléfono va por la hoja de compartir del sistema: el texto viaja
            como string, sin pasar por ninguna URL, así que llega exacto. El
            `href` queda igual para la PC y para quien no tenga esa hoja. */}
        <a className="btn btn-primary btn-grande" href={enlaceWhatsapp(texto)}
          target="_blank" rel="noopener noreferrer"
          onClick={(e) => {
            // Sin hoja de compartir no se toca nada: navega el `href` solo. Abrirlo
            // a mano desde una promesa lo frenaría el bloqueador de ventanas, que
            // solo deja abrir dentro del toque.
            if (!puedeCompartir()) return;
            e.preventDefault();
            void compartirMovimiento(texto);
          }}>
          💬 Enviar por WhatsApp
        </a>
      </div>
      <pre className="surt-mensaje">{texto}</pre>

      <FotosDelMovimiento movId={mov.id} actor={actor} soloLectura={!canWrite} />
      <small className="muted" style={{ display: 'block', marginTop: '.6rem' }}>
        Acá se agregan o quitan fotos, se manda el aviso o se borra el movimiento completo. Los litros, el equipo, la hora y los medidores se corrigen desde el módulo de Combustible en la PC; el cambio se ve acá al instante.
      </small>
    </Modal>
  );
}
