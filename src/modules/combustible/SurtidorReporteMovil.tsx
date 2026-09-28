/* ============================================================
   MGG · Combustible · Reporte del surtidor (teléfono)

   Qué pasó en un rango de fechas, agrupado por TIPO de movimiento
   (surtidos, traslados, entradas, mermas, retornos), con los litros de
   cada grupo y las FOTOS de cada movimiento como miniaturas. Se mira en
   el teléfono y, tocando una foto, se abre grande.

   Se puede mandar el resumen por WhatsApp: en la mina se pide «¿cuánto
   gastó el camión esta semana?» y la respuesta tiene que caber en un
   mensaje, no en un PDF que nadie va a abrir desde el teléfono.
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { EmptyState } from '@/shared/ui/EmptyState';
import { toast } from '@/shared/ui/Toast';
import { num, date } from '@/shared/lib/format';
import type { AdjuntoCombustible, TanqueMovimiento, Tanque, TipoMovimientoTanque } from '@/shared/lib/types';
import { listTanqueMovimientos } from './combustible.repository';
import { esImagen, listarFotosDe, urlsFotos } from './adjuntosCombustible.repository';
import { EMOJI_MOVIMIENTO, TITULO_MOVIMIENTO, enlaceWhatsapp } from './mensajeMovimiento';

/** En qué orden se leen los grupos: primero lo que más se consulta. */
const ORDEN_TIPOS: TipoMovimientoTanque[] = ['consumo', 'traslado', 'ingreso', 'merma', 'retorno'];

const primerDiaMes = () => {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return `${d.slice(0, 7)}-01`;
};
const hoyVE = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** El día del movimiento en hora de Venezuela, para comparar contra el rango. */
const diaDe = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};

export function SurtidorReporteMovil({ tanques, tanqueInicial, onClose }: {
  tanques: Tanque[]; tanqueInicial: string; onClose: () => void;
}) {
  const [tanqueId, setTanqueId] = useState<string>(tanqueInicial);
  const [desde, setDesde] = useState(primerDiaMes());
  const [hasta, setHasta] = useState(hoyVE());
  const [movs, setMovs] = useState<TanqueMovimiento[]>([]);
  const [fotos, setFotos] = useState<AdjuntoCombustible[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const todos = await listTanqueMovimientos(tanqueId ? { tanqueId } : undefined);
      const enRango = todos
        .filter((m) => { const d = diaDe(m.fecha); return d >= desde && d <= hasta; })
        .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''));
      setMovs(enRango);
      const adj = await listarFotosDe(enRango.map((m) => m.id));
      setFotos(adj);
      setUrls(await urlsFotos(adj.map((a) => a.path)));
    } catch (e) { toast(e instanceof Error ? e.message : 'No se pudo armar el reporte', 'error'); }
    finally { setCargando(false); }
  }, [tanqueId, desde, hasta]);
  useEffect(() => { void cargar(); }, [cargar]);

  const grupos = useMemo(() => ORDEN_TIPOS
    .map((tipo) => {
      const lista = movs.filter((m) => m.tipo === tipo);
      return { tipo, lista, litros: lista.reduce((s, m) => s + (Number(m.litros) || 0), 0) };
    })
    .filter((g) => g.lista.length), [movs]);

  const fotosDe = (id: string) => fotos.filter((f) => f.ref_id === id);
  const nombreTanque = (id: string | null | undefined) => tanques.find((t) => t.id === id)?.nombre ?? '—';

  /** El resumen del rango, en un mensaje que cabe en un chat. */
  const resumenTexto = useMemo(() => {
    const cab = [
      '📊 *RESUMEN DE COMBUSTIBLE*',
      '',
      `🛢️ Tanque: ${tanqueId ? nombreTanque(tanqueId) : 'Todos'}`,
      `🗓️ Del ${date(desde)} al ${date(hasta)}`,
      '',
    ];
    if (!grupos.length) return [...cab, 'Sin movimientos en ese rango.', '', '_MGG · Mineral Group Guayana_'].join('\n');
    const cuerpo = grupos.map((g) =>
      `${EMOJI_MOVIMIENTO[g.tipo]} ${TITULO_MOVIMIENTO[g.tipo]}: *${num(g.litros)} L* (${g.lista.length})`);
    return [...cab, ...cuerpo, '', '_MGG · Mineral Group Guayana_'].join('\n');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos, tanqueId, desde, hasta, tanques]);

  async function copiar() {
    try { await navigator.clipboard.writeText(resumenTexto); toast('Resumen copiado', 'success'); }
    catch { toast('No se pudo copiar solo. Mantené presionado el texto para copiarlo.', 'warning'); }
  }

  return (
    <Modal title="📊 Reporte con fotos" size="lg" onClose={onClose}
      footer={(
        <>
          <button className="btn btn-ghost btn-grande" onClick={() => void copiar()} disabled={cargando}>📋 Copiar</button>
          <a className="btn btn-ghost btn-grande" href={enlaceWhatsapp(resumenTexto)} target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>
          <button className="btn btn-primary btn-grande" onClick={onClose}>Cerrar</button>
        </>
      )}>
      <div className="surt-grid2" style={{ marginBottom: '.6rem' }}>
        <div className="surt-campo">
          <label htmlFor="rep-desde">Desde</label>
          <input id="rep-desde" className="input surt-input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="surt-campo">
          <label htmlFor="rep-hasta">Hasta</label>
          <input id="rep-hasta" className="input surt-input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
      </div>
      <div className="surt-campo" style={{ marginBottom: '.8rem' }}>
        <label htmlFor="rep-tanque">Tanque</label>
        <select id="rep-tanque" className="select surt-input" value={tanqueId} onChange={(e) => setTanqueId(e.target.value)}>
          <option value="">Todos los tanques</option>
          {tanques.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
      </div>

      {cargando && <p className="muted">Armando el reporte…</p>}
      {!cargando && !grupos.length && <EmptyState icon="📊" message="Sin movimientos en ese rango." />}

      {!cargando && grupos.map((g) => (
        <section key={g.tipo} className="rep-grupo">
          <h3 className="rep-grupo-titulo">
            <span>{EMOJI_MOVIMIENTO[g.tipo]} {TITULO_MOVIMIENTO[g.tipo]}</span>
            <span className="mono">{g.lista.length} · {num(g.litros)} L</span>
          </h3>
          {g.lista.map((m) => {
            const fs = fotosDe(m.id);
            return (
              <div key={m.id} className="rep-mov">
                <div className="rep-mov-cab">
                  <div style={{ minWidth: 0 }}>
                    <div className="titulo">{m.equipo || m.observacion || TITULO_MOVIMIENTO[g.tipo]}</div>
                    <div className="sub">
                      {date(m.fecha)}{!tanqueId ? ` · ${nombreTanque(m.tanque_id)}` : ''}
                      {m.autorizado_por ? ` · Aut.: ${m.autorizado_por}` : ''}
                      {m.equipo && m.observacion ? ` · ${m.observacion}` : ''}
                    </div>
                  </div>
                  <span className="mono litros">{num(m.litros)} L</span>
                </div>
                {fs.length ? (
                  <div className="rep-fotos">
                    {fs.map((a) => (
                      <button key={a.id} type="button" className="rep-foto" title={a.nombre}
                        onClick={() => window.open(urls.get(a.path), '_blank', 'noopener')}>
                        {esImagen(a.content_type, a.nombre) && urls.get(a.path)
                          ? <img src={urls.get(a.path)} alt={a.nombre} loading="lazy" />
                          : <span className="rep-foto-doc">📄<small>{a.nombre}</small></span>}
                      </button>
                    ))}
                  </div>
                ) : <div className="muted" style={{ fontSize: '.78rem' }}>Sin fotos</div>}
              </div>
            );
          })}
        </section>
      ))}
    </Modal>
  );
}
