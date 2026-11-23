import { useMemo, useState } from 'react';
import {
  listarFeriadosSudeban,
  esFeriadoBancario,
  esFinDeSemana,
  type FeriadoSudebanCompleto,
} from '@/shared/lib/calendarioBancario';
import { hoyVE } from './tasas.repository';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const DIAS_SEMANA_HEADERS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function formatearFechaVE(iso: string) {
  const parts = iso.slice(0, 10).split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function CalendarioBancarioView({ fechaHoy }: { fechaHoy?: string }) {
  const hoyStr = fechaHoy || hoyVE();
  const anioActual = Number(hoyStr.slice(0, 4)) || 2026;
  const mesActual = (Number(hoyStr.slice(5, 7)) || 1) - 1;

  const [anio, setAnio] = useState<number>(anioActual);
  const [vista, setVista] = useState<'calendario' | 'lista'>('calendario');
  const [mes, setMes] = useState<number>(mesActual);
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'bancario' | 'nacional'>('todos');
  const [busqueda, setBusqueda] = useState<string>('');

  // Feriados del año seleccionado
  const feriadosAnio = useMemo(() => listarFeriadosSudeban(anio), [anio]);

  // Feriados filtrados para la vista de lista
  const feriadosFiltradosLista = useMemo(() => {
    return feriadosAnio.filter((f) => {
      if (filtroTipo === 'bancario' && f.tipo !== 'bancario') return false;
      if (filtroTipo === 'nacional' && f.tipo !== 'nacional') return false;
      if (busqueda.trim()) {
        const q = busqueda.toLowerCase().trim();
        const coincideMotivo = f.motivo.toLowerCase().includes(q);
        const coincideFecha = f.fecha.includes(q) || formatearFechaVE(f.fecha).includes(q);
        const coincideDia = f.diaNombre.toLowerCase().includes(q);
        if (!coincideMotivo && !coincideFecha && !coincideDia) return false;
      }
      return true;
    });
  }, [feriadosAnio, filtroTipo, busqueda]);

  // Mapa de feriados para consulta rápida en la cuadrícula del calendario
  const mapaFeriados = useMemo(() => {
    const map = new Map<string, FeriadoSudebanCompleto>();
    feriadosAnio.forEach((f) => map.set(f.fecha, f));
    return map;
  }, [feriadosAnio]);

  // Cantidad de feriados por mes en el año actual (para mostrar badges en los botones de mes)
  const conteoPorMes = useMemo(() => {
    const counts = new Array(12).fill(0);
    feriadosAnio.forEach((f) => {
      const m = parseInt(f.fecha.slice(5, 7), 10) - 1;
      if (m >= 0 && m < 12) counts[m]++;
    });
    return counts;
  }, [feriadosAnio]);

  // Feriados del mes actualmente seleccionado
  const feriadosMes = useMemo(() => {
    const prefix = `${anio}-${pad2(mes + 1)}`;
    return feriadosAnio.filter((f) => f.fecha.startsWith(prefix));
  }, [feriadosAnio, anio, mes]);

  // Cuadrícula de días del mes seleccionado
  const diasMes = useMemo(() => {
    const primerDia = new Date(Date.UTC(anio, mes, 1, 12, 0, 0));
    const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0, 12, 0, 0));
    const totalDias = ultimoDia.getUTCDate();

    let primerDiaSemana = primerDia.getUTCDay() - 1;
    if (primerDiaSemana === -1) primerDiaSemana = 6;

    const celdas: Array<{ dia: number | null; iso: string; feriado: FeriadoSudebanCompleto | null; esFinde: boolean; esHoy: boolean }> = [];

    for (let i = 0; i < primerDiaSemana; i++) {
      celdas.push({ dia: null, iso: '', feriado: null, esFinde: false, esHoy: false });
    }

    for (let d = 1; d <= totalDias; d++) {
      const iso = `${anio}-${pad2(mes + 1)}-${pad2(d)}`;
      const feriado = mapaFeriados.get(iso) ?? null;
      const esFinde = esFinDeSemana(iso);
      const esHoy = iso === hoyStr;
      celdas.push({ dia: d, iso, feriado, esFinde, esHoy });
    }

    return celdas;
  }, [anio, mes, mapaFeriados, hoyStr]);

  const feriadoHoy = useMemo(() => {
    return esFeriadoBancario(hoyStr) ? mapaFeriados.get(hoyStr) ?? null : null;
  }, [hoyStr, mapaFeriados]);

  function cambiarMes(delta: number) {
    setMes((m) => {
      const nuevo = m + delta;
      if (nuevo < 0) {
        setAnio((a) => a - 1);
        return 11;
      }
      if (nuevo > 11) {
        setAnio((a) => a + 1);
        return 0;
      }
      return nuevo;
    });
  }

  return (
    <div className="calendario-bancario-view" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Banner si hoy es feriado bancario */}
      {feriadoHoy && (
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(217,119,6,0.18) 0%, rgba(180,83,9,0.25) 100%)',
            border: '1px solid rgba(245,158,11,0.5)',
            borderRadius: '8px',
            padding: '.75rem 1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '.75rem',
          }}
        >
          <span style={{ fontSize: '1.6rem' }}>🏦</span>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
              <span className="badge badge-warning" style={{ fontWeight: 700, fontSize: '.72rem' }}>
                ¡HOY ES {feriadoHoy.tipo === 'bancario' ? 'LUNES BANCARIO' : 'FERIADO NACIONAL'}!
              </span>
              <strong style={{ fontSize: '.92rem' }}>{feriadoHoy.motivo}</strong>
            </div>
            <div className="muted" style={{ fontSize: '.8rem', marginTop: '.25rem', color: '#cbd5e1' }}>
              Los bancos no operan hoy. La tasa oficial del BCV rige con <strong>fecha valor del {feriadoHoy.diaEfectivoNombre} ({formatearFechaVE(feriadoHoy.fechaEfectivaBcv)})</strong>.
            </div>
          </div>
        </div>
      )}

      {/* Barra superior de controles: Años y Modo de vista */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.6rem' }}>
        {/* Selector de Año */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem' }}>
          <span className="muted" style={{ fontSize: '.82rem', marginRight: '.2rem' }}>Año:</span>
          {[2025, 2026, 2027].map((a) => (
            <button
              key={a}
              type="button"
              className={`btn btn-sm ${anio === a ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontWeight: anio === a ? 700 : 500 }}
              onClick={() => setAnio(a)}
            >
              {a}
            </button>
          ))}
        </div>

        {/* Selector de Vista: Calendario vs Lista */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem', background: 'rgba(255,255,255,0.05)', padding: '.2rem', borderRadius: '6px' }}>
          <button
            type="button"
            className={`btn btn-sm ${vista === 'calendario' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontSize: '.82rem', padding: '.25rem .75rem' }}
            onClick={() => setVista('calendario')}
          >
            📅 Vista Calendario
          </button>
          <button
            type="button"
            className={`btn btn-sm ${vista === 'lista' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontSize: '.82rem', padding: '.25rem .75rem' }}
            onClick={() => setVista('lista')}
          >
            📋 Vista Lista ({feriadosAnio.length})
          </button>
        </div>
      </div>

      {/* ─── VISTA CALENDARIO ─── */}
      {vista === 'calendario' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.8rem' }}>
          {/* Navegador de meses rápido */}
          <div style={{ display: 'flex', gap: '.25rem', overflowX: 'auto', paddingBottom: '.25rem' }}>
            {MESES_CORTOS.map((mNombre, idx) => {
              const esActivo = mes === idx;
              const cantFeriados = conteoPorMes[idx];
              return (
                <button
                  key={mNombre}
                  type="button"
                  className={`btn btn-xs ${esActivo ? 'btn-primary' : 'btn-ghost'}`}
                  style={{
                    flex: '1 0 auto',
                    position: 'relative',
                    padding: '.3rem .5rem',
                    fontWeight: esActivo ? 700 : 500,
                  }}
                  onClick={() => setMes(idx)}
                >
                  {mNombre}
                  {cantFeriados > 0 && (
                    <span
                      style={{
                        marginLeft: '.3rem',
                        fontSize: '.62rem',
                        padding: '1px 4px',
                        borderRadius: '999px',
                        background: esActivo ? 'rgba(0,0,0,0.3)' : 'rgba(245,158,11,0.3)',
                        color: esActivo ? '#fff' : '#f59e0b',
                        fontWeight: 700,
                      }}
                      title={`${cantFeriados} feriado(s) en ${MESES[idx]}`}
                    >
                      {cantFeriados}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Encabezado del mes con flechas */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => cambiarMes(-1)}
              title="Mes anterior"
            >
              ◀ {MESES[(mes + 11) % 12]}
            </button>
            <div style={{ textAlign: 'center' }}>
              <strong style={{ fontSize: '1.1rem' }}>{MESES[mes]} {anio}</strong>
              <div className="muted" style={{ fontSize: '.76rem' }}>
                {feriadosMes.length === 0
                  ? 'Sin feriados bancarios este mes'
                  : `${feriadosMes.length} feriado(s) oficial(es) SUDEBAN`}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => cambiarMes(1)}
              title="Mes siguiente"
            >
              {MESES[(mes + 1) % 12]} ▶
            </button>
          </div>

          {/* Cuadrícula del mes */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: '4px',
              background: 'rgba(255,255,255,0.03)',
              padding: '.5rem',
              borderRadius: '8px',
              border: '1px solid var(--border)',
            }}
          >
            {DIAS_SEMANA_HEADERS.map((diaH, idx) => (
              <div
                key={diaH}
                style={{
                  textAlign: 'center',
                  fontSize: '.75rem',
                  fontWeight: 700,
                  padding: '.3rem 0',
                  color: idx >= 5 ? '#94a3b8' : 'var(--text-color, #e2e8f0)',
                }}
              >
                {diaH}
              </div>
            ))}

            {diasMes.map((c, i) => {
              if (c.dia === null) {
                return <div key={`empty-${i}`} style={{ minHeight: '68px', opacity: 0.2 }} />;
              }

              const esBancario = c.feriado?.tipo === 'bancario';
              const esNacional = c.feriado?.tipo === 'nacional';

              return (
                <div
                  key={c.iso}
                  style={{
                    minHeight: '68px',
                    borderRadius: '6px',
                    padding: '.35rem',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    border: c.esHoy
                      ? '2px solid #3b82f6'
                      : c.feriado
                        ? esBancario ? '1px solid rgba(245,158,11,0.6)' : '1px solid rgba(59,130,246,0.6)'
                        : '1px solid rgba(255,255,255,0.06)',
                    background: c.esHoy
                      ? 'rgba(59,130,246,0.15)'
                      : esBancario
                        ? 'rgba(217,119,6,0.15)'
                        : esNacional
                          ? 'rgba(37,99,235,0.14)'
                          : c.esFinde
                            ? 'rgba(0,0,0,0.15)'
                            : 'rgba(255,255,255,0.02)',
                    transition: 'all 0.15s ease',
                  }}
                  title={c.feriado ? `${c.feriado.motivo} (${esBancario ? 'Lunes Bancario' : 'Feriado Nacional'})` : c.esFinde ? 'Fin de semana (no bancario)' : 'Día hábil bancario'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span
                      style={{
                        fontWeight: c.esHoy || c.feriado ? 800 : 500,
                        fontSize: '.85rem',
                        color: c.esHoy ? '#60a5fa' : c.feriado ? (esBancario ? '#fbbf24' : '#93c5fd') : c.esFinde ? '#64748b' : undefined,
                      }}
                    >
                      {c.dia}
                    </span>
                    {c.esHoy && (
                      <span
                        style={{
                          fontSize: '.58rem',
                          background: '#2563eb',
                          color: '#fff',
                          padding: '1px 4px',
                          borderRadius: '4px',
                          fontWeight: 700,
                        }}
                      >
                        HOY
                      </span>
                    )}
                  </div>

                  {c.feriado && (
                    <div
                      style={{
                        fontSize: '.66rem',
                        lineHeight: 1.15,
                        marginTop: '.2rem',
                        color: esBancario ? '#fde68a' : '#bfdbfe',
                        fontWeight: 600,
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {esBancario ? '🏦 ' : '🇻🇪 '}
                      {c.feriado.motivo}
                    </div>
                  )}

                  {!c.feriado && c.esFinde && (
                    <div style={{ fontSize: '.6rem', color: '#475569', textAlign: 'right' }}>
                      Cierre
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Tarjetas resumen de los feriados del mes */}
          <div style={{ marginTop: '.4rem' }}>
            <h4 style={{ margin: '0 0 .5rem', fontSize: '.88rem' }}>
              Feriados oficiales en {MESES[mes]} {anio}:
            </h4>
            {feriadosMes.length === 0 ? (
              <div className="muted" style={{ fontSize: '.82rem', padding: '.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '6px' }}>
                No hay feriados bancarios ni nacionales en este mes. Operaciones interbancarias normales todos los días de semana.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '.6rem' }}>
                {feriadosMes.map((f) => (
                  <div
                    key={f.fecha}
                    style={{
                      border: f.fecha === hoyStr
                        ? '1px solid #3b82f6'
                        : f.tipo === 'bancario' ? '1px solid rgba(245,158,11,0.4)' : '1px solid rgba(59,130,246,0.4)',
                      background: f.tipo === 'bancario' ? 'rgba(217,119,6,0.08)' : 'rgba(37,99,235,0.08)',
                      borderRadius: '6px',
                      padding: '.6rem .75rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '.25rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '.88rem' }}>
                        {f.diaNombre} {formatearFechaVE(f.fecha)}
                      </strong>
                      <span
                        className={`badge ${f.tipo === 'bancario' ? 'badge-warning' : 'badge-info'}`}
                        style={{ fontSize: '.68rem' }}
                      >
                        {f.tipo === 'bancario' ? '🏦 Lunes Bancario' : '🇻🇪 Feriado Nacional'}
                      </span>
                    </div>
                    <div style={{ fontSize: '.82rem', fontWeight: 600 }}>{f.motivo}</div>
                    <div className="muted" style={{ fontSize: '.74rem', borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: '.25rem', marginTop: '.2rem' }}>
                      📈 Tasa BCV rige para: <strong>{f.diaEfectivoNombre} {formatearFechaVE(f.fechaEfectivaBcv)}</strong>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── VISTA LISTA ─── */}
      {vista === 'lista' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.6rem' }}>
            <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn btn-xs ${filtroTipo === 'todos' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFiltroTipo('todos')}
              >
                Todos ({feriadosAnio.length})
              </button>
              <button
                type="button"
                className={`btn btn-xs ${filtroTipo === 'bancario' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFiltroTipo('bancario')}
              >
                🏦 Lunes Bancarios ({feriadosAnio.filter((x) => x.tipo === 'bancario').length})
              </button>
              <button
                type="button"
                className={`btn btn-xs ${filtroTipo === 'nacional' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFiltroTipo('nacional')}
              >
                🇻🇪 Feriados Nacionales ({feriadosAnio.filter((x) => x.tipo === 'nacional').length})
              </button>
            </div>

            <div style={{ minWidth: '180px' }}>
              <input
                className="input"
                type="search"
                placeholder="🔍 Buscar feriado..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                style={{ padding: '.25rem .5rem', fontSize: '.82rem' }}
              />
            </div>
          </div>

          <div className="table-wrap">
            <table className="table" style={{ fontSize: '.84rem' }}>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Día</th>
                  <th>Motivo / Conmemoración</th>
                  <th>Tipo</th>
                  <th>Fecha Valor BCV</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {!feriadosFiltradosLista.length && (
                  <tr>
                    <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '1rem' }}>
                      No se encontraron feriados con los filtros seleccionados.
                    </td>
                  </tr>
                )}
                {feriadosFiltradosLista.map((f) => {
                  const esHoy = f.fecha === hoyStr;
                  const esPasado = f.fecha < hoyStr;

                  return (
                    <tr
                      key={f.fecha}
                      style={{
                        background: esHoy ? 'rgba(59,130,246,0.12)' : undefined,
                        fontWeight: esHoy ? 700 : undefined,
                      }}
                    >
                      <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                        {formatearFechaVE(f.fecha)}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{f.diaNombre}</td>
                      <td>
                        <strong>{f.motivo}</strong>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span
                          className={`badge ${f.tipo === 'bancario' ? 'badge-warning' : 'badge-info'}`}
                          style={{ fontSize: '.68rem' }}
                        >
                          {f.tipo === 'bancario' ? '🏦 Lunes Bancario' : '🇻🇪 Nacional'}
                        </span>
                      </td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                        {f.diaEfectivoNombre} {formatearFechaVE(f.fechaEfectivaBcv)}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {esHoy ? (
                          <span className="badge badge-primary" style={{ fontSize: '.68rem', fontWeight: 700 }}>
                            ¡HOY!
                          </span>
                        ) : esPasado ? (
                          <span className="muted" style={{ fontSize: '.72rem' }}>
                            Pasado
                          </span>
                        ) : (
                          <span className="badge badge-ghost" style={{ fontSize: '.68rem' }}>
                            Próximo
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Nota normativa legal al pie */}
      <div
        className="muted"
        style={{
          fontSize: '.74rem',
          borderTop: '1px solid var(--border)',
          paddingTop: '.6rem',
          marginTop: '.2rem',
          display: 'flex',
          gap: '.5rem',
          alignItems: 'flex-start',
        }}
      >
        <span>⚖️</span>
        <div>
          <strong>Normativa SUDEBAN y Banco Central de Venezuela (BCV):</strong> Los feriados bancarios aplican a todas las instituciones financieras del país. Los días no bancarios y fines de semana no se realizan mesas de cambio, por lo que la tasa oficial publicada por el BCV rige con <em>fecha valor</em> del siguiente día hábil bancario.
        </div>
      </div>
    </div>
  );
}
