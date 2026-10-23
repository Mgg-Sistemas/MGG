/* ============================================================
   MGG · Choferes / Conductores · Rutas y viajes

   Una orden de ruta nace PROGRAMADA (chofer, vehículo, origen, destino,
   paradas, carga, hora de salida y tarifa). Se INICIA cuando el chofer sale
   (hora y km reales), se van marcando las paradas, y se FINALIZA al llegar
   (hora y km). Después se liquidan sus viáticos y entra en un recibo de viaje.
   Cancelar deja el motivo; nada se borra. Un viaje que ya pasó (histórico o que
   no se cargó a tiempo) se carga con «Viaje ya realizado»: entra directo como
   FINALIZADO con sus horas y km reales, listo para liquidar; mientras no esté
   liquidado ni en recibo se corrige con ✎ (12-10-2026).

   Tipo de viaje (14-10-2026): CAMIÓN (lo de arriba) o VOLQUETA, que se carga
   por día como la hoja física: nombre, vehículo, material, origen, destino,
   fecha y CUÁNTOS viajes. La tarifa es por viaje (el recibo paga tarifa × viajes).
   Cada orden se puede eliminar (🗑) salvo que ya esté en un recibo.

   Avisos al programar: chofer de descanso ese día, documentos vencidos,
   vehículo en taller. La base no deja dos rutas EN RUTA del mismo chofer o
   del mismo vehículo.
   ============================================================ */
import { useMemo, useState, type FormEvent } from 'react';
import { Modal, ConfirmDialog } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { EmptyState } from '@/shared/ui/EmptyState';
import { DecimalInput } from '@/shared/ui/DecimalInput';
import { toast } from '@/shared/ui/Toast';
import { money, date as fmtDate, formatoCI } from '@/shared/lib/format';
import { listadoFlotaPdf } from '@/modules/maquinaria/flotaPdf';
import { listadoFlotaExcel } from '@/modules/maquinaria/flotaExcel';
import {
  ESTADO_VIAJE, TIPO_VIAJE, CATEGORIAS_VIAJE, categoriaDeViaje, tarifaSugeridaCategoria, viajeEstaPagado,
  alertasDocumentos, errorViajeRealizado, progresoParadas, textoRuta,
  tarifaTotalViaje, totalViajes, horasDiaVolqueta, errorViajesVolqueta, cantidadViajes, datosConductor,
  tasasDeConductor, clasificarCategoriaPorTasa,
  type EstadoViaje, type Parada, type TipoViaje, type CategoriaViaje,
} from './choferes';
import {
  cancelarViaje, crearViaje, editarViaje, eliminarViaje, finalizarViaje, guardarParadas, iniciarViaje,
  type Conductor, type VehiculoFlota, type Viaje, type ViajeInput,
} from './choferes.repository';
import { FlotaModal } from './ExpedienteTab';
import { aDatetimeLocal, ahoraLocal, fechaHora, nombreConductor, textoVehiculo, type PropsTab } from './ChoferesPage';

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function ViajesTab({ datos, canWrite, actor, actorName }: PropsTab) {
  const { conductores, flota, viajes, descansos, hoy, loading, recargar } = datos;
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState<EstadoViaje | ''>('');
  const [choferId, setChoferId] = useState('');
  const [form, setForm] = useState<Viaje | 'nuevo' | null>(null);
  const [detalle, setDetalle] = useState<Viaje | null>(null);
  const [accion, setAccion] = useState<{ tipo: 'iniciar' | 'finalizar' | 'cancelar'; viaje: Viaje } | null>(null);
  const [tipo, setTipo] = useState<TipoViaje | ''>('');
  const [borrar, setBorrar] = useState<Viaje | null>(null);

  const porId = useMemo(() => new Map(conductores.map((c) => [c.id, c])), [conductores]);
  const vehPorId = useMemo(() => new Map(flota.map((v) => [v.id, v])), [flota]);

  const filas = useMemo(() => {
    const t = normal(texto.trim());
    return viajes.filter((v) =>
      (!estado || v.estado === estado)
      && (!tipo || v.tipo_viaje === tipo)
      && (!choferId || v.chofer_id === choferId)
      && (!t || normal(`${v.numero} ${nombreConductor(porId.get(v.chofer_id))} ${v.origen} ${v.destino} ${v.carga ?? ''} ${textoVehiculo(vehPorId.get(v.vehiculo_id ?? ''))} ${(v.paradas ?? []).map((p) => p.lugar).join(' ')}`).includes(t)));
  }, [viajes, texto, estado, tipo, choferId, porId, vehPorId]);

  const conteo = useMemo(() => {
    const m: Record<EstadoViaje, number> = { programado: 0, en_ruta: 0, finalizado: 0, cancelado: 0 };
    for (const v of viajes) m[v.estado]++;
    return m;
  }, [viajes]);

  /** Listado para PDF / Excel: con el filtro «Volqueta» sale el formato de la hoja (nombre, vehículo, material, origen, destino, fecha, viajes). */
  function listado() {
    const volq = tipo === 'volqueta';
    const subtitulo = [tipo ? TIPO_VIAJE[tipo].label : 'Camión y volqueta', estado ? ESTADO_VIAJE[estado].label : 'todos los estados',
      choferId ? nombreConductor(porId.get(choferId)) : 'todos los choferes', texto ? `«${texto}»` : ''].filter(Boolean).join(' · ') + ` · ${totalViajes(filas)} viaje(s)`;
    const archivo = `${volq ? 'viajes-volqueta' : 'rutas-y-viajes'}-${new Date().toISOString().slice(0, 10)}`;
    if (volq) {
      return {
        titulo: 'VIAJES DE VOLQUETA', subtitulo, archivo,
        encabezados: ['Nombre y apellido', 'Vehículo', 'Material', 'Origen', 'Destino', 'Fecha', 'Viajes'], anchos: [3, 3, 2.4, 2.6, 2.6, 1.6, 1], numeros: [6],
        filas: filas.map((v) => [nombreConductor(porId.get(v.chofer_id)), textoVehiculo(vehPorId.get(v.vehiculo_id ?? '')), v.carga ?? '', v.origen, v.destino, fmtDate(v.salida_real_at ?? v.fecha_salida), v.viajes]),
      };
    }
    return {
      titulo: 'RUTAS Y VIAJES', subtitulo, archivo,
      encabezados: ['N°', 'Tipo', 'Fecha', 'Chofer', 'Vehículo', 'Material / carga', 'Origen', 'Destino', 'Viajes', 'Tarifa $', 'Estado'],
      anchos: [1.8, 1.3, 1.6, 2.8, 2.8, 2.2, 2.2, 2.2, 1, 1.3, 1.5], numeros: [8, 9],
      filas: filas.map((v) => [v.numero, TIPO_VIAJE[v.tipo_viaje].label, fmtDate(v.salida_real_at ?? v.fecha_salida), nombreConductor(porId.get(v.chofer_id)),
        textoVehiculo(vehPorId.get(v.vehiculo_id ?? '')), v.carga ?? '', v.origen, v.destino, v.viajes, tarifaTotalViaje(v), ESTADO_VIAJE[v.estado].label]),
    };
  }
  async function exportar(t: 'pdf' | 'excel') {
    try { if (t === 'pdf') await listadoFlotaPdf(listado()); else await listadoFlotaExcel(listado()); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo exportar', 'error'); }
  }
  async function confirmarBorrar() {
    const v = borrar; setBorrar(null);
    if (!v) return;
    try { await eliminarViaje(v); toast(`${v.numero} eliminado`, 'success'); await recargar(); }
    catch (e) { toast(e instanceof Error ? e.message : 'No se pudo eliminar', 'error'); }
  }

  return (
    <div>
      <div className="desc-barra">
        <input className="input desc-buscar" placeholder="🔍 Buscar por N°, chofer, origen, destino, carga, placa…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <select className="select" style={{ width: 'auto' }} value={estado} onChange={(e) => setEstado(e.target.value as EstadoViaje | '')} aria-label="Estado">
          <option value="">Todos los estados</option>
          {Object.entries(ESTADO_VIAJE).map(([k, e]) => <option key={k} value={k}>{e.icon} {e.label} ({conteo[k as EstadoViaje]})</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={tipo} onChange={(e) => setTipo(e.target.value as TipoViaje | '')} aria-label="Tipo de viaje">
          <option value="">Camión y volqueta</option>
          {(Object.keys(TIPO_VIAJE) as TipoViaje[]).map((t) => <option key={t} value={t}>{TIPO_VIAJE[t].icon} {TIPO_VIAJE[t].label}</option>)}
        </select>
        <select className="select" style={{ width: 'auto', maxWidth: 220 }} value={choferId} onChange={(e) => setChoferId(e.target.value)} aria-label="Chofer">
          <option value="">Todos los choferes</option>
          {conductores.map((c) => <option key={c.id} value={c.id}>{nombreConductor(c)}</option>)}
        </select>
        <div className="desc-acciones">
          <span className="chip">🚛 {conteo.en_ruta} en ruta · 📅 {conteo.programado} programados · Σ {totalViajes(filas)} viajes</span>
          <button className="btn btn-sm btn-ghost" disabled={!filas.length} onClick={() => void exportar('pdf')} title={tipo === 'volqueta' ? 'Formato de la hoja de volqueta' : 'Listado de viajes'}>↓ PDF</button>
          <button className="btn btn-sm btn-ghost" disabled={!filas.length} onClick={() => void exportar('excel')} title={tipo === 'volqueta' ? 'Formato de la hoja de volqueta' : 'Listado de viajes'}>↓ Excel</button>
          {canWrite && <button className="btn btn-sm btn-primary" onClick={() => setForm('nuevo')} disabled={!conductores.some((c) => c.activo)} title={conductores.some((c) => c.activo) ? 'Programar una ruta o cargar un viaje ya realizado' : 'Primero abre expedientes en «Expediente y flota»'}>+ Orden de ruta</button>}
        </div>
      </div>

      {loading ? <div className="muted" style={{ textAlign: 'center', padding: '1rem' }}>Cargando…</div>
        : !viajes.length ? <EmptyState icon="🗺" message="Todavía no hay órdenes de ruta. Crea la primera con «+ Orden de ruta»." />
        : !filas.length ? <EmptyState icon="🔍" message="Ningún viaje coincide con el filtro." />
        : (
          <div className="table-wrap card" style={{ padding: 0 }}>
            <table className="table" style={{ fontSize: '.85rem' }}>
              <thead><tr><th>N°</th><th>Salida</th><th>Chofer</th><th>Ruta</th><th>Vehículo</th><th>Categoría</th><th>Paradas</th><th style={{ textAlign: 'right' }}>Viajes</th><th style={{ textAlign: 'right' }}>Tarifa</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {filas.map((v) => {
                  const e = ESTADO_VIAJE[v.estado];
                  const pr = progresoParadas(v.paradas);
                  const cat = categoriaDeViaje(v, porId.get(v.chofer_id));
                  const pagado = viajeEstaPagado(v);
                  return (
                    <tr key={v.id}>
                      <td className="mono">{v.numero}{v.tipo_viaje === 'volqueta' && <div className="muted" style={{ fontSize: '.7rem' }}>🚜 Volqueta</div>}</td>
                      <td className="mono" style={{ fontSize: '.8rem' }}>{fechaHora(v.salida_real_at ?? v.fecha_salida)}{v.estado === 'finalizado' && v.llegada_real_at ? <div className="muted">llegó {fechaHora(v.llegada_real_at)}</div> : null}</td>
                      <td>{nombreConductor(porId.get(v.chofer_id))}</td>
                      <td>{textoRuta(v)}{v.carga ? <div className="muted" style={{ fontSize: '.75rem' }}>{v.carga}</div> : null}</td>
                      <td style={{ fontSize: '.8rem' }}>{textoVehiculo(vehPorId.get(v.vehiculo_id ?? ''))}</td>
                      <td style={{ fontSize: '.78rem' }}>
                        <span className="badge" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>{cat}</span>
                        {pagado ? (
                          <div style={{ fontSize: '.7rem', marginTop: 2, color: 'var(--success)', fontWeight: 600 }}>
                            ✅ Pagado {v.pagado_at ? `(${v.pagado_at.slice(0, 10)})` : ''}
                          </div>
                        ) : (
                          <div style={{ fontSize: '.7rem', marginTop: 2 }} className="muted">
                            ⏳ Pendiente pago
                          </div>
                        )}
                      </td>
                      <td className="mono">{pr.total ? `${pr.hechas}/${pr.total}` : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{v.viajes}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{money(tarifaTotalViaje(v))}{v.viajes > 1 ? <div className="muted" style={{ fontSize: '.7rem' }}>{money(v.tarifa_usd)} × {v.viajes}</div> : null}</td>
                      <td>
                        <span className={`badge ${e.clase}`}>{e.icon} {e.label}</span>
                        {v.estado === 'finalizado' && (
                          <div style={{ fontSize: '.7rem', marginTop: 2 }} className="muted">
                            {v.pago_id ? '🧾 con recibo' : v.liquidado_at ? '💵 liquidado' : 'sin liquidar'}
                          </div>
                        )}
                      </td>
                      <td className="actions" style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => setDetalle(v)} title="Ver detalle y paradas">👁</button>
                        {canWrite && (v.estado === 'programado' || v.estado === 'en_ruta' || (v.estado === 'finalizado' && !v.liquidado_at && !v.pago_id)) && <button className="btn btn-sm btn-ghost" onClick={() => setForm(v)} title={v.estado === 'finalizado' ? 'Corregir el viaje (aún sin liquidar)' : 'Editar'}>✎</button>}
                        {canWrite && v.estado === 'programado' && <button className="btn btn-sm btn-primary" onClick={() => setAccion({ tipo: 'iniciar', viaje: v })} title="Iniciar ruta">▶</button>}
                        {canWrite && v.estado === 'en_ruta' && <button className="btn btn-sm btn-success" onClick={() => setAccion({ tipo: 'finalizar', viaje: v })} title="Finalizar ruta">🏁</button>}
                        {canWrite && (v.estado === 'programado' || v.estado === 'en_ruta') && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setAccion({ tipo: 'cancelar', viaje: v })} title="Cancelar">✖</button>}
                        {canWrite && <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setBorrar(v)} title={v.pago_id ? 'Eliminar viaje pagado' : 'Eliminar'}>🗑</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      {form && (
        <ViajeModal inicial={form === 'nuevo' ? null : form} conductores={conductores} flota={flota} viajes={viajes} descansos={descansos} hoy={hoy}
          canWrite={canWrite} actor={actor} actorName={actorName} onClose={() => setForm(null)} onSaved={async () => { setForm(null); await recargar(); }} />
      )}
      {detalle && (
        <DetalleViajeModal viaje={viajes.find((x) => x.id === detalle.id) ?? detalle} conductor={porId.get(detalle.chofer_id)} vehiculo={vehPorId.get(detalle.vehiculo_id ?? '')}
          canWrite={canWrite} onClose={() => setDetalle(null)} onChanged={recargar} />
      )}
      {accion && (
        <AccionViajeModal accion={accion.tipo} viaje={accion.viaje} conductor={porId.get(accion.viaje.chofer_id)}
          onClose={() => setAccion(null)} onDone={async () => { setAccion(null); await recargar(); }} />
      )}
      {borrar && (
        <ConfirmDialog title={`Eliminar ${borrar.numero}`} danger confirmText="Sí, eliminar"
          message={<>Se borra la orden <strong>{borrar.numero}</strong> ({textoRuta(borrar)} · {nombreConductor(porId.get(borrar.chofer_id))}{borrar.viajes > 1 ? ` · ${borrar.viajes} viajes` : ''}) con sus paradas y su liquidación. Los viáticos cargados a ese viaje quedan como caja chica del chofer. {borrar.pago_id ? 'Este viaje figura como pagado: al eliminarlo se descontará de los registros. Esto no se deshace.' : 'Esto no se deshace.'}</>}
          onConfirm={() => { void confirmarBorrar(); }} onCancel={() => setBorrar(null)} />
      )}
    </div>
  );
}

/* ───────── Nueva / editar orden de ruta ───────── */
export function ViajeModal({ inicial, conductores, flota, viajes, descansos, hoy, canWrite, actor, actorName, onClose, onSaved }: {
  inicial: Viaje | null; conductores: Conductor[]; flota: VehiculoFlota[]; viajes: Viaje[];
  descansos: { personal_id: string; desde: string; hasta: string }[]; hoy: string;
  canWrite: boolean; actor: string; actorName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [choferId, setChoferId] = useState(inicial?.chofer_id ?? '');
  const [vehiculoId, setVehiculoId] = useState(inicial?.vehiculo_id ?? '');
  const [origen, setOrigen] = useState(inicial?.origen ?? '');
  const [destino, setDestino] = useState(inicial?.destino ?? '');
  const [paradas, setParadas] = useState<Parada[]>(inicial?.paradas ?? []);
  const [carga, setCarga] = useState(inicial?.carga ?? '');
  const [salida, setSalida] = useState(inicial ? aDatetimeLocal(inicial.estado === 'finalizado' ? inicial.salida_real_at ?? inicial.fecha_salida : inicial.fecha_salida) : ahoraLocal());
  const [llegada, setLlegada] = useState(inicial?.llegada_prevista ? aDatetimeLocal(inicial.llegada_prevista) : '');
  const [tarifa, setTarifa] = useState<number | null>(inicial?.tarifa_usd ?? null);
  const [nota, setNota] = useState(inicial?.nota ?? '');
  const [verFlota, setVerFlota] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nuevaParada, setNuevaParada] = useState('');
  // «Viaje ya realizado» (12-10-2026): se carga un viaje pasado directo como finalizado, con horas y km reales.
  const [realizado, setRealizado] = useState(inicial?.estado === 'finalizado');
  const [llegadaReal, setLlegadaReal] = useState(inicial?.llegada_real_at ? aDatetimeLocal(inicial.llegada_real_at) : '');
  const [kmSalida, setKmSalida] = useState<number | null>(inicial?.km_salida ?? null);
  const [kmLlegada, setKmLlegada] = useState<number | null>(inicial?.km_llegada ?? null);
  // Camión o volqueta (14-10-2026) y cuántos viajes trae la orden.
  const [tipoV, setTipoV] = useState<TipoViaje>(inicial?.tipo_viaje ?? 'camion');
  const [categoria, setCategoria] = useState<CategoriaViaje>(categoriaDeViaje(inicial));
  const [nViajes, setNViajes] = useState<number | null>(inicial?.viajes ?? 1);
  const [fechaDia, setFechaDia] = useState((inicial ? aDatetimeLocal(inicial.salida_real_at ?? inicial.fecha_salida) : ahoraLocal()).slice(0, 10));
  const volq = tipoV === 'volqueta';
  function elegirTipo(t: TipoViaje) {
    setTipoV(t);
    // Un día de volqueta casi siempre se carga ya realizado (la hoja se llena al final del día).
    if (t === 'volqueta' && !inicial) setRealizado(true);
  }
  const chofer = conductores.find((c) => c.id === choferId) ?? null;
  const vehiculo = flota.find((v) => v.id === vehiculoId) ?? null;
  const diaSalida = salida.slice(0, 10);
  const choferTasas = useMemo(() => tasasDeConductor(chofer), [chofer]);

  function elegirCategoria(c: CategoriaViaje) {
    setCategoria(c);
    const sugerida = tarifaSugeridaCategoria(c, chofer);
    if (sugerida > 0) {
      setTarifa(sugerida);
    }
  }

  // Al elegir chofer, la tarifa propuesta es la de su tasa configurada y clasifica de inmediato.
  function elegirChofer(id: string) {
    setChoferId(id);
    const c = conductores.find((x) => x.id === id);
    if (c) {
      const t = tasasDeConductor(c);
      if (tarifa == null || tarifa === 0) {
        setTarifa(t.corto);
        setCategoria('VIAJE CORTO');
      } else {
        const cat = clasificarCategoriaPorTasa(tarifa, c);
        setCategoria(cat);
      }
    }
  }

  function aplicarTasa(monto: number) {
    setTarifa(monto);
    const cat = clasificarCategoriaPorTasa(monto, chofer);
    setCategoria(cat);
  }

  const avisos = useMemo(() => {
    const out: string[] = [];
    if (chofer) {
      if (descansos.some((d) => d.personal_id === chofer.personal_id && d.desde <= diaSalida && diaSalida <= d.hasta)) out.push(`${nombreConductor(chofer)} está de descanso el ${diaSalida.split('-').reverse().join('/')}.`);
      for (const a of alertasDocumentos(chofer, hoy)) out.push(`${a.label} del chofer ${a.estado === 'vencido' ? 'VENCIDO' : 'por vencer'} (${a.vence?.split('-').reverse().join('/')}).`);
      if (!realizado && viajes.some((v) => v.id !== inicial?.id && v.chofer_id === chofer.id && v.estado === 'en_ruta')) out.push('Ese chofer está en ruta en otro viaje ahora mismo.');
    }
    if (vehiculo) {
      if (vehiculo.estado_flota === 'taller') out.push('El vehículo está en taller.');
      if (vehiculo.estado_flota === 'inactivo') out.push('El vehículo está inactivo.');
      if (vehiculo.seguro_vence && vehiculo.seguro_vence < hoy) out.push('El seguro del vehículo está vencido.');
      if (!realizado && viajes.some((v) => v.id !== inicial?.id && v.vehiculo_id === vehiculo.id && v.estado === 'en_ruta')) out.push('Ese vehículo está en ruta en otro viaje ahora mismo.');
    }
    return out;
  }, [chofer, vehiculo, descansos, diaSalida, hoy, viajes, inicial, realizado]);

  function agregarParada() {
    const l = nuevaParada.trim();
    if (!l) return;
    setParadas((p) => [...p, { lugar: l, nota: null, hecha_at: null }]);
    setNuevaParada('');
  }
  function moverParada(i: number, d: number) {
    setParadas((p) => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n; });
  }

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (volq) {
      const ev = errorViajesVolqueta(nViajes, carga);
      if (ev) { setError(ev); return; }
    }
    // Volqueta: la hoja va por día; las horas quedan 06:00 → 18:00 (o «ahora» si es hoy).
    const horas = volq ? horasDiaVolqueta(fechaDia, ahoraLocal()) : null;
    const salidaF = horas ? horas.salida : salida;
    const llegadaRealF = horas ? horas.llegada : llegadaReal;
    const input: ViajeInput = {
      chofer_id: choferId, vehiculo_id: vehiculoId || null, origen, destino, paradas: volq ? [] : paradas, carga,
      fecha_salida: salidaF, llegada_prevista: volq ? null : (llegada || null), tarifa_usd: tarifa ?? 0, nota,
      tipo_viaje: tipoV, categoria_viaje: categoria, viajes: cantidadViajes(nViajes),
      realizado: realizado ? { salida_real_at: salidaF, llegada_real_at: llegadaRealF, km_salida: volq ? null : kmSalida, km_llegada: volq ? null : kmLlegada } : null,
    };
    if (realizado && !volq) {
      const e = errorViajeRealizado({ salida, llegada: llegadaReal, kmSalida, kmLlegada, ahora: ahoraLocal() });
      if (e) { setError(e); return; }
    } else if (!volq && llegada && llegada < salida) { setError('La llegada prevista no puede ser antes de la salida.'); return; }
    setSaving(true);
    try {
      if (inicial) { await editarViaje(inicial.id, input); toast(realizado ? 'Viaje corregido' : 'Orden de ruta guardada', 'success'); }
      else {
        const v = await crearViaje(input, actor, actorName);
        toast(volq && realizado ? `${v.numero}: ${cantidadViajes(nViajes)} viaje(s) de volqueta cargados.` : realizado ? `Viaje ${v.numero} cargado como finalizado. Ahora se pueden liquidar sus viáticos.` : `Orden de ruta ${v.numero} creada`, 'success');
      }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar'); setSaving(false); }
  }

  const activos = conductores.filter((c) => c.activo || c.id === inicial?.chofer_id);

  return (
    <Modal title={inicial ? `${TIPO_VIAJE[tipoV].icon} ${inicial.estado === 'finalizado' ? 'Corregir viaje' : 'Orden de ruta'} ${inicial.numero}` : volq ? (realizado ? '🚜 Cargar viajes de volqueta del día' : '🚜 Programar día de volqueta') : realizado ? '🕓 Cargar viaje ya realizado' : '🗺 Nueva orden de ruta'} size="lg" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        {canWrite && <button type="submit" form="viaje-form" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : inicial ? 'Guardar cambios' : volq && realizado ? 'Cargar viajes del día' : realizado ? 'Cargar viaje finalizado' : 'Crear orden'}</button>}
      </>
    }>
      <form id="viaje-form" onSubmit={guardar}>
        {error && <div className="aviso danger" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">⛔</span><div>{error}</div></div>}
        <div className="form-row" style={{ marginBottom: '.6rem' }}><label>Tipo de viaje</label>
          <div role="group" aria-label="Tipo de viaje" style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
            {(Object.keys(TIPO_VIAJE) as TipoViaje[]).map((t) => (
              <button key={t} type="button" className={`btn btn-sm ${tipoV === t ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={tipoV === t} onClick={() => elegirTipo(t)}>{TIPO_VIAJE[t].icon} {TIPO_VIAJE[t].label}</button>
            ))}
            <span className="muted" style={{ fontSize: '.75rem', alignSelf: 'center' }}>{TIPO_VIAJE[tipoV].hint}</span>
          </div>
        </div>
        {!inicial && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '.45rem', marginBottom: '.6rem', fontSize: '.88rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={realizado} onChange={(e) => setRealizado(e.target.checked)} style={{ marginTop: 3 }} />
            <span><strong>🕓 Viaje ya realizado</strong> <span className="muted">· para cargar un viaje pasado: entra directo como <em>finalizado</em>, con sus horas y kilometraje reales, listo para liquidar viáticos y entrar en el recibo.</span></span>
          </label>
        )}
        {inicial?.estado === 'finalizado' && (
          <div className="aviso info sm" style={{ marginBottom: '.6rem' }}><span className="aviso-icono">ℹ</span><div>Viaje finalizado sin liquidar: se puede corregir cualquier dato, incluidas las horas y el kilometraje reales.</div></div>
        )}
        <div className="form-grid">
          <div className="form-row"><label htmlFor="vj-chofer">Chofer</label>
            <SearchSelect id="vj-chofer" value={choferId} onChange={elegirChofer} placeholder="🔍 Buscar chofer…"
              options={activos.map((c) => ({ value: c.id, label: nombreConductor(c), hint: [formatoCI(datosConductor(c).cedula), c.externo ? 'externo' : null, c.licencia_grado ? `Lic. ${c.licencia_grado}` : null].filter(Boolean).join(' · ') }))} /></div>
          <div className="form-row"><label htmlFor="vj-veh">Vehículo</label>
            <div style={{ display: 'flex', gap: '.35rem' }}>
              <SearchSelect id="vj-veh" value={vehiculoId} onChange={setVehiculoId} placeholder="🔍 Placa, marca, modelo…" style={{ flex: 1 }}
                options={flota.filter((v) => v.activo && v.estado_flota !== 'inactivo' || v.id === vehiculoId).map((v) => ({ value: v.id, label: textoVehiculo(v), hint: v.capacidad ?? undefined }))} />
              <button type="button" className="btn btn-ghost" onClick={() => setVerFlota(true)} title="Ver la flota / agregar vehículo">🚚</button>
            </div></div>
          <div className="form-row"><label htmlFor="vj-origen">Origen</label><input id="vj-origen" className="input" value={origen} onChange={(e) => setOrigen(e.target.value)} required placeholder={volq ? 'Playa Escondida' : 'Galpón Los Pinos'} /></div>
          <div className="form-row"><label htmlFor="vj-destino">Destino</label><input id="vj-destino" className="input" value={destino} onChange={(e) => setDestino(e.target.value)} required placeholder={volq ? 'Interno' : 'Centro de Fundición Matanzas'} /></div>
          {volq ? (
            <div className="form-row"><label htmlFor="vj-fecha">Fecha</label><input id="vj-fecha" className="input" type="date" value={fechaDia} max={realizado ? ahoraLocal().slice(0, 10) : undefined} onChange={(e) => setFechaDia(e.target.value)} required />
              <span className="muted" style={{ fontSize: '.75rem' }}>Un renglón por día, como la hoja: las horas quedan 06:00 → 18:00.</span></div>
          ) : (
            <div className="form-row"><label htmlFor="vj-salida">{realizado ? 'Salida real (fecha y hora)' : 'Salida programada'}</label><input id="vj-salida" className="input" type="datetime-local" value={salida} max={realizado ? ahoraLocal() : undefined} onChange={(e) => setSalida(e.target.value)} required /></div>
          )}
          {volq ? null : realizado ? (
            <>
              <div className="form-row"><label htmlFor="vj-llegada-real">Llegada real (fecha y hora)</label><input id="vj-llegada-real" className="input" type="datetime-local" value={llegadaReal} min={salida || undefined} max={ahoraLocal()} onChange={(e) => setLlegadaReal(e.target.value)} required /></div>
              <div className="form-row"><label>Kilometraje de salida</label><DecimalInput className="input" value={kmSalida} onChange={setKmSalida} placeholder="opcional" aria-label="Kilometraje de salida" /></div>
              <div className="form-row"><label>Kilometraje de llegada</label><DecimalInput className="input" value={kmLlegada} onChange={setKmLlegada} placeholder="opcional" aria-label="Kilometraje de llegada" /></div>
            </>
          ) : (
            <div className="form-row"><label htmlFor="vj-llegada">Llegada prevista</label><input id="vj-llegada" className="input" type="datetime-local" value={llegada} min={salida || undefined} onChange={(e) => setLlegada(e.target.value)} /></div>
          )}
          <div className="form-row"><label htmlFor="vj-carga">{volq ? 'Material' : 'Carga / motivo'}</label><input id="vj-carga" className="input" value={carga} onChange={(e) => setCarga(e.target.value)} required={volq} placeholder={volq ? 'Escombros · cabilla · arena…' : 'Casiterita 20 t · víveres · repuestos…'} /></div>
          <div className="form-row"><label htmlFor="vj-viajes">{volq ? 'Viajes del día' : 'Viajes'}</label>
            <input id="vj-viajes" className="input mono" type="number" min={1} step={1} inputMode="numeric" value={nViajes ?? ''} onChange={(e) => setNViajes(e.target.value === '' ? null : Number(e.target.value))} required />
            <span className="muted" style={{ fontSize: '.75rem' }}>{volq ? 'Cuántos viajes hizo ese día (02, 25, 21…).' : 'Normalmente 1; si fue ida y vuelta varias veces, pon cuántas.'}</span></div>
          <div className="form-row" style={{ gridColumn: '1 / -1', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '.75rem', marginTop: '.35rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.4rem' }}>
              <label style={{ margin: 0, fontWeight: 600, fontSize: '.9rem' }}>💵 Tasa y clasificación del viaje</label>
              {chofer && (
                <span className="muted" style={{ fontSize: '.76rem' }}>
                  Tasas de <strong>{nombreConductor(chofer)}</strong>: Corto ${choferTasas.corto} · Largo ${choferTasas.largo} · Interno ${choferTasas.interno}
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.75rem', alignItems: 'start' }}>
              <div>
                <label style={{ fontSize: '.8rem', marginBottom: 3, display: 'block' }}>
                  Tasa / Tarifa por viaje ($)
                </label>
                <DecimalInput
                  className="input"
                  value={tarifa}
                  onChange={(n) => {
                    setTarifa(n);
                    const cat = clasificarCategoriaPorTasa(n, chofer);
                    setCategoria(cat);
                  }}
                  placeholder="0,00"
                  aria-label="Tarifa por viaje en dólares"
                />
                <div style={{ display: 'flex', gap: '.3rem', marginTop: '.4rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={`btn btn-xs ${categoria === 'VIAJE CORTO' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => aplicarTasa(choferTasas.corto)}
                    title={`Aplicar tasa corto ($${choferTasas.corto})`}
                  >
                    🚗 Corto (${choferTasas.corto})
                  </button>
                  <button
                    type="button"
                    className={`btn btn-xs ${categoria === 'VIAJE LARGO' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => aplicarTasa(choferTasas.largo)}
                    title={`Aplicar tasa largo ($${choferTasas.largo})`}
                  >
                    🚚 Largo (${choferTasas.largo})
                  </button>
                  <button
                    type="button"
                    className={`btn btn-xs ${categoria === 'VIAJE INTERNO' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => aplicarTasa(choferTasas.interno)}
                    title={`Aplicar tasa interno ($${choferTasas.interno})`}
                  >
                    🔄 Interno (${choferTasas.interno})
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="vj-cat" style={{ fontSize: '.8rem', marginBottom: 3, display: 'block' }}>
                  Tipo de viaje detectado automáticamente
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', minHeight: 38 }}>
                  <span
                    className={`badge ${categoria === 'VIAJE LARGO' ? 'info' : categoria === 'VIAJE INTERNO' ? 'warning' : 'primary'}`}
                    style={{ fontSize: '.88rem', padding: '.35rem .7rem', fontWeight: 700 }}
                  >
                    {categoria === 'VIAJE LARGO' ? '🚚 VIAJE LARGO' : categoria === 'VIAJE INTERNO' ? '🔄 VIAJE INTERNO' : '🚗 VIAJE CORTO'}
                  </span>
                  <select
                    id="vj-cat"
                    className="select"
                    value={categoria}
                    onChange={(e) => elegirCategoria(e.target.value as CategoriaViaje)}
                    style={{ width: 'auto', fontSize: '.8rem', padding: '.2rem .4rem' }}
                    title="Permite ajustar manualmente la categoría si se requiere"
                  >
                    {CATEGORIAS_VIAJE.map((c) => (
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <span className="muted" style={{ fontSize: '.75rem', display: 'block', marginTop: 4 }}>
                  ⚡ Detectado al colocar la tasa ({money(tarifa ?? 0)}){cantidadViajes(nViajes) > 1 ? ` · total ${money((tarifa ?? 0) * cantidadViajes(nViajes))}` : ''}.
                </span>
              </div>
            </div>
          </div>
          {!volq && <div className="form-row" style={{ gridColumn: '1 / -1' }}>
            <label>Puntos de parada (en orden){realizado && <span className="muted" style={{ fontWeight: 400 }}> · en un viaje ya realizado quedan marcadas como cumplidas a la hora de llegada</span>}</label>
            <div className="chf-paradas">
              {paradas.map((p, i) => (
                <div key={i} className={`chf-parada${p.hecha_at ? ' hecha' : ''}`}>
                  <span className="orden">{i + 1}</span>
                  <input className="input lugar" value={p.lugar} onChange={(e) => setParadas((ps) => ps.map((x, j) => j === i ? { ...x, lugar: e.target.value } : x))} style={{ padding: '.2rem .4rem' }} />
                  <input className="input" value={p.nota ?? ''} placeholder="nota" onChange={(e) => setParadas((ps) => ps.map((x, j) => j === i ? { ...x, nota: e.target.value } : x))} style={{ padding: '.2rem .4rem', width: 160 }} />
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => moverParada(i, -1)} disabled={i === 0} aria-label="Subir">↑</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => moverParada(i, 1)} disabled={i === paradas.length - 1} aria-label="Bajar">↓</button>
                  <button type="button" className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setParadas((ps) => ps.filter((_, j) => j !== i))} aria-label="Quitar">✖</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '.35rem' }}>
                <input className="input" value={nuevaParada} onChange={(e) => setNuevaParada(e.target.value)} placeholder="Agregar parada: lugar…"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarParada(); } }} />
                <button type="button" className="btn btn-ghost" onClick={agregarParada} disabled={!nuevaParada.trim()}>+ Parada</button>
              </div>
            </div>
          </div>}
          <div className="form-row" style={{ gridColumn: '1 / -1' }}><label htmlFor="vj-nota">Nota</label><input id="vj-nota" className="input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Instrucciones, contacto en destino…" /></div>
        </div>
        {!!avisos.length && (
          <div className="aviso warning sm" style={{ marginTop: '.6rem' }}><span className="aviso-icono">⚠</span>
            <div>{avisos.map((a) => <div key={a}>{a}</div>)}<div className="muted" style={{ marginTop: '.2rem' }}>Se puede guardar igual; queda a criterio de quien programa.</div></div></div>
        )}
      </form>
      {verFlota && <FlotaModal flota={flota} canWrite={canWrite} actor={actor} hoy={hoy} onClose={() => setVerFlota(false)} onChanged={() => undefined}
        onElegir={(v) => { setVehiculoId(v.id); setVerFlota(false); }} />}
    </Modal>
  );
}

/* ───────── Detalle + paradas ───────── */
export function DetalleViajeModal({ viaje: v, conductor, vehiculo, canWrite, onClose, onChanged }: {
  viaje: Viaje; conductor?: Conductor; vehiculo?: VehiculoFlota; canWrite: boolean; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const e = ESTADO_VIAJE[v.estado];
  async function alternarParada(i: number) {
    setSaving(true);
    try {
      const ps = v.paradas.map((p, j) => j === i ? { ...p, hecha_at: p.hecha_at ? null : new Date().toISOString() } : p);
      await guardarParadas(v.id, ps); await onChanged();
    } catch (err) { toast(err instanceof Error ? err.message : 'No se pudo guardar', 'error'); }
    finally { setSaving(false); }
  }
  const km = v.km_salida != null && v.km_llegada != null ? v.km_llegada - v.km_salida : null;
  return (
    <Modal title={`🗺 ${v.numero} · ${textoRuta(v)}`} size="md" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Cerrar</button>}>
      <div className="form-grid" style={{ fontSize: '.88rem' }}>
        <div><span className="muted">Estado</span><div><span className={`badge ${e.clase}`}>{e.icon} {e.label}</span></div></div>
        <div><span className="muted">Tipo · viajes</span><div>{TIPO_VIAJE[v.tipo_viaje].icon} {TIPO_VIAJE[v.tipo_viaje].label} · <span className="mono">{v.viajes}</span> viaje{v.viajes === 1 ? '' : 's'}</div></div>
        <div><span className="muted">Categoría</span><div><span className="badge" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>{categoriaDeViaje(v, conductor)}</span></div></div>
        <div><span className="muted">Nómina viajes</span><div>{viajeEstaPagado(v) ? <span style={{ color: 'var(--success)', fontWeight: 600 }}>✅ Pagado {v.pagado_at ? `(${v.pagado_at.slice(0, 10)})` : ''}</span> : <span className="muted">⏳ Pendiente de pago</span>}</div></div>
        <div><span className="muted">Chofer</span><div><strong>{nombreConductor(conductor)}</strong></div></div>
        <div><span className="muted">Vehículo</span><div>{textoVehiculo(vehiculo)}</div></div>
        <div><span className="muted">Carga</span><div>{v.carga ?? '—'}</div></div>
        <div><span className="muted">Salida programada</span><div className="mono">{fechaHora(v.fecha_salida)}</div></div>
        <div><span className="muted">Llegada prevista</span><div className="mono">{fechaHora(v.llegada_prevista)}</div></div>
        <div><span className="muted">Salida real</span><div className="mono">{fechaHora(v.salida_real_at)}{v.km_salida != null ? ` · ${v.km_salida.toLocaleString('es-VE')} km` : ''}</div></div>
        <div><span className="muted">Llegada real</span><div className="mono">{fechaHora(v.llegada_real_at)}{v.km_llegada != null ? ` · ${v.km_llegada.toLocaleString('es-VE')} km` : ''}</div></div>
        <div><span className="muted">Recorrido</span><div className="mono">{km != null ? `${km.toLocaleString('es-VE')} km` : '—'}</div></div>
        <div><span className="muted">Tarifa</span><div className="mono">{money(tarifaTotalViaje(v))}{v.viajes > 1 ? <span className="muted"> ({money(v.tarifa_usd)} × {v.viajes})</span> : null}</div></div>
      </div>
      <div style={{ marginTop: '.8rem' }}>
        <strong style={{ fontSize: '.88rem' }}>Paradas ({progresoParadas(v.paradas).hechas}/{v.paradas.length})</strong>
        {!v.paradas.length ? <div className="muted" style={{ fontSize: '.82rem' }}>Sin paradas intermedias.</div> : (
          <div className="chf-paradas" style={{ marginTop: '.35rem' }}>
            {v.paradas.map((p, i) => (
              <div key={i} className={`chf-parada${p.hecha_at ? ' hecha' : ''}`}>
                <span className="orden">{i + 1}</span>
                <span className="lugar">{p.lugar}{p.nota ? <span className="muted"> · {p.nota}</span> : null}</span>
                {p.hecha_at && <span className="mono muted" style={{ fontSize: '.72rem' }}>{fechaHora(p.hecha_at)}</span>}
                {canWrite && v.estado === 'en_ruta' && (
                  <button type="button" className={`btn btn-sm ${p.hecha_at ? 'btn-ghost' : 'btn-success'}`} disabled={saving} onClick={() => void alternarParada(i)}>
                    {p.hecha_at ? 'Desmarcar' : '✔ Llegó'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {v.nota && <p className="muted" style={{ fontSize: '.82rem', marginTop: '.6rem' }}>📝 {v.nota}</p>}
      {v.liquidacion && (
        <p className="muted" style={{ fontSize: '.82rem' }}>💵 Viáticos liquidados: anticipos {money(v.liquidacion.anticipos)} · gastos {money(v.liquidacion.gastos)} · devoluciones {money(v.liquidacion.devoluciones)} → {v.liquidacion.reembolso ? `reembolso ${money(v.liquidacion.reembolso)}` : v.liquidacion.deduccion ? `deducción ${money(v.liquidacion.deduccion)}` : 'cuadrado'}.</p>
      )}
      <p className="muted" style={{ fontSize: '.75rem', marginTop: '.4rem' }}>Creada {fechaHora(v.created_at)}{v.actor_name ? ` por ${v.actor_name}` : ''}.</p>
    </Modal>
  );
}

/* ───────── Iniciar / finalizar / cancelar ───────── */
export function AccionViajeModal({ accion, viaje: v, conductor, onClose, onDone }: {
  accion: 'iniciar' | 'finalizar' | 'cancelar'; viaje: Viaje; conductor?: Conductor; onClose: () => void; onDone: () => Promise<void>;
}) {
  const [cuando, setCuando] = useState(ahoraLocal());
  const [km, setKm] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ejecutar() {
    setError(null); setSaving(true);
    try {
      if (accion === 'iniciar') { await iniciarViaje(v.id, { km_salida: km, salida_real_at: cuando }); toast(`${v.numero} en ruta`, 'success'); }
      else if (accion === 'finalizar') {
        if (km != null && v.km_salida != null && km < v.km_salida) throw new Error(`El kilometraje de llegada no puede ser menor que el de salida (${v.km_salida.toLocaleString('es-VE')} km).`);
        await finalizarViaje(v.id, { km_llegada: km, llegada_real_at: cuando }); toast(`${v.numero} finalizado. Ahora se pueden liquidar sus viáticos.`, 'success');
      } else { await cancelarViaje(v.id, motivo); toast(`${v.numero} cancelado`, 'success'); }
      await onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar'); setSaving(false); }
  }

  if (accion === 'cancelar') {
    return (
      <Modal title={`✖ Cancelar ${v.numero}`} size="sm" onClose={() => !saving && onClose()} footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Volver</button>
          <button className="btn btn-danger" onClick={() => void ejecutar()} disabled={saving || !motivo.trim()}>{saving ? 'Cancelando…' : 'Sí, cancelar la ruta'}</button>
        </>
      }>
        {error && <div className="aviso danger sm" style={{ marginBottom: '.5rem' }}><span className="aviso-icono">⛔</span><div>{error}</div></div>}
        <p style={{ fontSize: '.88rem', marginTop: 0 }}>{textoRuta(v)} · {nombreConductor(conductor)}. La orden queda en el histórico como cancelada.</p>
        <div className="form-row"><label htmlFor="vj-motivo">Motivo</label><input id="vj-motivo" className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus placeholder="Vehículo dañado, cliente canceló…" /></div>
      </Modal>
    );
  }

  const titulo = accion === 'iniciar' ? `▶ Iniciar ruta ${v.numero}` : `🏁 Finalizar ruta ${v.numero}`;
  return (
    <Modal title={titulo} size="sm" onClose={() => !saving && onClose()} footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
        <button className={`btn ${accion === 'iniciar' ? 'btn-primary' : 'btn-success'}`} onClick={() => void ejecutar()} disabled={saving}>{saving ? 'Guardando…' : accion === 'iniciar' ? 'Salió' : 'Llegó'}</button>
      </>
    }>
      {error && <div className="aviso danger sm" style={{ marginBottom: '.5rem' }}><span className="aviso-icono">⛔</span><div>{error}</div></div>}
      <p style={{ fontSize: '.88rem', marginTop: 0 }}>{textoRuta(v)} · <strong>{nombreConductor(conductor)}</strong></p>
      <div className="form-grid">
        <div className="form-row"><label htmlFor="vj-cuando">{accion === 'iniciar' ? 'Hora de salida' : 'Hora de llegada'}</label>
          <input id="vj-cuando" className="input" type="datetime-local" value={cuando} onChange={(e) => setCuando(e.target.value)} /></div>
        <div className="form-row"><label>{accion === 'iniciar' ? 'Kilometraje de salida' : 'Kilometraje de llegada'}</label>
          <DecimalInput className="input" value={km} onChange={setKm} placeholder={accion === 'finalizar' && v.km_salida != null ? `salió con ${v.km_salida.toLocaleString('es-VE')} km` : 'opcional'} aria-label="Kilometraje" /></div>
      </div>
    </Modal>
  );
}

