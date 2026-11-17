/* ============================================================
   Golden Touch · Administración · el Tablero (overview del panel)
   Fila de KPIs + donut por categoría + barras por empresa. Datos puros de
   administracionTablero.ts; gráficos en SVG/CSS (sin librerías). Acento
   dorado del sistema. Estilo en administracion.css (.adm-tablero…).
   ============================================================ */
import { useMemo } from 'react';
import type { Empresa, GastoFijo } from './admin.repository';
import { barrasEmpresa, donutCategoria, filasTablero, kpisTablero } from './administracionTablero';

/** Tasa Bs/USD para los equivalentes (demo). En la app real la pone getTasaHoy(). */
const TASA_DEMO = 40;
const COLORES = ['var(--gold, #ffd54a)', 'var(--primary, #ff8a00)', 'var(--success, #29c081)', '#5aa9e6', '#c792ea', 'var(--warning, #f5b133)', '#8a94a6'];

const usd = (n: number) => `$ ${Math.round(n).toLocaleString('es-VE')}`;
const num = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 0 });

function Donut({ datos }: { datos: ReturnType<typeof donutCategoria> }) {
  const R = 52; const CX = 70; const CY = 70; const SW = 20; const C = 2 * Math.PI * R;
  let off = 0;
  return (
    <div className="adm-donut">
      <svg viewBox="0 0 140 140" role="img" aria-label="Gasto por categoría">
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={SW} />
        {datos.map((d, i) => {
          const len = (C * d.pct) / 100;
          const el = (
            <circle key={d.clave} cx={CX} cy={CY} r={R} fill="none" stroke={COLORES[i % COLORES.length]}
              strokeWidth={SW} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off}
              transform={`rotate(-90 ${CX} ${CY})`} strokeLinecap="butt" />
          );
          off += len;
          return el;
        })}
        <text x={CX} y={CY - 4} textAnchor="middle" className="adm-donut-tot">{datos.length}</text>
        <text x={CX} y={CY + 14} textAnchor="middle" className="adm-donut-lbl">categorías</text>
      </svg>
      <ul className="adm-leyenda">
        {datos.map((d, i) => (
          <li key={d.clave}>
            <span className="adm-punto" style={{ background: COLORES[i % COLORES.length] }} />
            <span className="adm-leyenda-nom">{d.clave}</span>
            <span className="adm-leyenda-val">{d.pct} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Barras({ datos }: { datos: ReturnType<typeof barrasEmpresa> }) {
  const max = Math.max(...datos.map((d) => d.equivUsd), 1);
  return (
    <ul className="adm-barras">
      {datos.map((d) => (
        <li key={d.clave}>
          <span className="adm-barra-nom" title={d.clave}>{d.clave}</span>
          <span className="adm-barra-pista"><span className="adm-barra-fill" style={{ width: `${(d.equivUsd / max) * 100}%` }} /></span>
          <span className="adm-barra-val">{usd(d.equivUsd)}</span>
        </li>
      ))}
    </ul>
  );
}

export function TableroAdmin({ gastos, empresas, nombreCat, tasa = TASA_DEMO }: {
  gastos: GastoFijo[];
  empresas: Empresa[];
  nombreCat: Map<string, string>;
  tasa?: number;
}) {
  const filas = useMemo(() => filasTablero(gastos, empresas, nombreCat), [gastos, empresas, nombreCat]);

  const k = useMemo(() => kpisTablero(filas, tasa), [filas, tasa]);
  const donut = useMemo(() => donutCategoria(filas, tasa), [filas, tasa]);
  const barras = useMemo(() => barrasEmpresa(filas, tasa), [filas, tasa]);

  return (
    <div className="adm-tablero">
      <div className="adm-kpis">
        <div className="adm-kpi oro">
          <span className="adm-kpi-lbl">Gasto fijo / mes</span>
          <span className="adm-kpi-num">{usd(k.gastoMes.equivUsd)}</span>
          <span className="adm-kpi-sub">{num(k.gastoMes.bs)} Bs · {num(k.gastoMes.usd)} $</span>
        </div>
        <div className="adm-kpi">
          <span className="adm-kpi-lbl">Por pagar este mes</span>
          <span className="adm-kpi-num">{usd(k.esteMes.equivUsd)}</span>
          <span className="adm-kpi-sub">{k.esteMes.n} {k.esteMes.n === 1 ? 'gasto' : 'gastos'}</span>
        </div>
        <div className={`adm-kpi${k.venceEn.n > 0 ? ' alerta' : ''}`}>
          <span className="adm-kpi-lbl">Vence en {k.venceEn.dias} días</span>
          <span className="adm-kpi-num">{k.venceEn.n > 0 ? '⚠ ' : ''}{k.venceEn.n}</span>
          <span className="adm-kpi-sub">{usd(k.venceEn.equivUsd)}</span>
        </div>
        <div className="adm-kpi">
          <span className="adm-kpi-lbl">Activos</span>
          <span className="adm-kpi-num">{k.activos.activos}<span className="adm-kpi-de"> / {k.activos.total}</span></span>
          <span className="adm-kpi-sub">gastos fijos</span>
        </div>
      </div>

      <div className="adm-graficos">
        <div className="card adm-grafico">
          <div className="adm-grafico-tit">Gasto por categoría</div>
          {donut.length ? <Donut datos={donut} /> : <p className="muted">Sin datos.</p>}
        </div>
        <div className="card adm-grafico">
          <div className="adm-grafico-tit">Gasto por empresa</div>
          {barras.length ? <Barras datos={barras} /> : <p className="muted">Sin datos.</p>}
        </div>
      </div>
    </div>
  );
}
