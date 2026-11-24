import { useState, type ReactNode } from 'react';
import type { MotivosIvaCien } from './retencionesCalculo';
import { obtenerInfoAvisoIva } from './avisoRetencionIva';

/**
 * Los supuestos del art. 5 (Providencia SNAT/2025/000054, que derogó a la SNAT/2015/0049) que llevan la retención de IVA al 100%.
 */
export const MOTIVOS_IVA_CIEN_LISTA: Array<[keyof MotivosIvaCien & string, string]> = [
  ['proveedorNoInscrito', 'El proveedor está sujeto a retención del 100% según el Portal Fiscal, o no está inscrito en el RIF'],
  ['facturaNoCumple', 'La factura no cumple los requisitos de facturación legal'],
  ['ivaNoDiscriminado', 'El IVA no está discriminado en la factura'],
  ['proveedorNoDomiciliado', 'El proveedor no está domiciliado en el país'],
  ['metalesPreciosos', 'Compra de metales o piedras preciosas'],
];

export interface SupuestoIvaItem {
  codigo: string;
  texto: string;
  pct: number;
}

/**
 * Componente para el control de retención de IVA (Etapa 2 del rediseño):
 * 1. Casilla directa y visible para indicar «Retener el 100 % del IVA».
 * 2. Despliegue del selector formal de causales del Art. 5 solo cuando el 100% está activo.
 * 3. Aviso claro en palabras del usuario explicando el porcentaje y por qué.
 * 4. Monto sugerido en base al IVA facturado.
 */
export function SupuestosIvaAcordeon({
  motivos,
  supuestosIva,
  pctGeneral,
  pctActual,
  ivaFactura = 0,
  moneda = 'Bs',
  onChange,
  onLimpiarMotivos,
}: {
  motivos: Record<string, boolean | undefined>;
  supuestosIva?: SupuestoIvaItem[] | null;
  pctGeneral: number;
  pctActual?: number;
  ivaFactura?: number;
  moneda?: string;
  onChange: (codigo: string, valor: boolean) => void;
  onLimpiarMotivos?: () => void;
  inicialAbierto?: boolean;
}) {
  const marcados = Object.entries(motivos).filter(([_, v]) => !!v);
  const esCien = marcados.length > 0;

  // Supuesto activo si vino parametrizado desde base de datos
  const supuestoActivo = supuestosIva?.find((s) => marcados.some(([k]) => k === s.codigo));

  const infoAviso = obtenerInfoAvisoIva({
    ivaFactura,
    pctGeneral,
    pctEspecial: 100,
    motivos,
    supuestoTexto: supuestoActivo?.texto,
    supuestoPct: supuestoActivo?.pct,
    moneda,
  });

  const opciones = supuestosIva && supuestosIva.length > 0
    ? supuestosIva.map((x): [string, string] => [x.codigo, `${x.texto}${x.pct !== 100 ? ` (${x.pct} %)` : ''}`])
    : MOTIVOS_IVA_CIEN_LISTA;

  const handleToggleCien = (activar: boolean) => {
    if (activar) {
      // Si se activa y no hay ningún motivo marcado, marcar por omisión la causal estándar: 'proveedorNoInscrito'
      if (marcados.length === 0) {
        onChange('proveedorNoInscrito', true);
      }
    } else {
      // Si se desmarca, limpiar todas las causales marcadas
      if (onLimpiarMotivos) {
        onLimpiarMotivos();
      } else {
        for (const [k] of marcados) {
          onChange(k, false);
        }
      }
    }
  };

  return (
    <div
      className="lf-iva-retencion-control"
      style={{
        margin: '.45rem 0 .35rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '.35rem',
      }}
    >
      {/* 1. Casilla principal directa para activar/desactivar 100% */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '.55rem .75rem',
          background: esCien ? 'rgba(255, 138, 0, 0.12)' : 'var(--surface-sunken, rgba(0,0,0,0.15))',
          border: esCien ? '1px solid var(--brand, #ff8a00)' : '1px solid var(--border)',
          borderRadius: '6px',
          transition: 'all .15s ease',
        }}
      >
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '.55rem',
            cursor: 'pointer',
            margin: 0,
            fontWeight: 700,
            fontSize: '.85rem',
            color: esCien ? 'var(--brand, #ff8a00)' : 'var(--text)',
          }}
        >
          <input
            type="checkbox"
            checked={esCien}
            onChange={(e) => handleToggleCien(e.target.checked)}
            style={{ width: '1.15rem', height: '1.15rem', accentColor: 'var(--brand, #ff8a00)', cursor: 'pointer' }}
          />
          <span>Retener el 100 % del IVA (Artículo 5 de la Providencia)</span>
        </label>
        <span
          className="badge"
          style={{
            fontSize: '.72rem',
            background: esCien ? 'var(--brand, #ff8a00)' : 'rgba(255,255,255,0.08)',
            color: esCien ? '#000' : 'var(--text-muted)',
            fontWeight: 700,
          }}
        >
          {esCien ? (pctActual ? `${pctActual}% ACTIVO` : '100% ACTIVO') : `General ${pctGeneral}%`}
        </span>
      </div>

      {/* 2. Aviso en palabras claras con monto sugerido */}
      <div
        style={{
          margin: 0,
          padding: '.45rem .65rem',
          borderRadius: '6px',
          fontSize: '.81rem',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '.5rem',
          background: esCien ? 'rgba(255, 138, 0, 0.08)' : 'rgba(59, 130, 246, 0.08)',
          borderLeft: esCien ? '3px solid var(--brand, #ff8a00)' : '3px solid #3b82f6',
        }}
      >
        <span style={{ fontSize: '1rem', lineHeight: 1 }}>{esCien ? '⚠️' : 'ℹ️'}</span>
        <div style={{ flex: 1, lineHeight: 1.4 }}>
          {infoAviso.mensajeDetallado}
        </div>
      </div>

      {/* 3. Panel de Causales del Artículo 5 (solo visible si la casilla está marcada) */}
      {esCien && (
        <div
          style={{
            padding: '.6rem .75rem',
            background: 'var(--surface-sunken, rgba(0,0,0,0.18))',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '.35rem',
          }}
        >
          <div style={{ fontSize: '.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--brand, #ff8a00)' }}>
            Causal jurídica del Artículo 5 (se registrará e imprimirá en el comprobante oficial):
          </div>

          <div style={{ display: 'grid', gap: '.3rem' }}>
            {opciones.map(([k, label]) => {
              const activo = !!motivos[k];
              return (
                <label
                  key={k}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '.45rem',
                    fontSize: '.82rem',
                    cursor: 'pointer',
                    padding: '.3rem .45rem',
                    borderRadius: '4px',
                    background: activo ? 'rgba(255,138,0,0.1)' : 'transparent',
                    border: activo ? '1px solid rgba(255,138,0,0.3)' : '1px solid transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={activo}
                    style={{ marginTop: '.2rem', accentColor: 'var(--brand, #ff8a00)', cursor: 'pointer' }}
                    onChange={(e) => {
                      onChange(k, e.target.checked);
                    }}
                  />
                  <span style={{ color: activo ? 'var(--brand, #ff8a00)' : 'inherit', fontWeight: activo ? 600 : 400 }}>
                    {label}
                  </span>
                </label>
              );
            })}
          </div>
          <small className="hint muted" style={{ fontSize: '.72rem', marginTop: '.2rem' }}>
            Puedes marcar una o más causales si aplican simultáneamente al documento.
          </small>
        </div>
      )}
    </div>
  );
}

/**
 * Acordeón genérico expandible y colapsable para listas de checkboxes en modales.
 */
export function ListaChecksAcordeon({
  titulo,
  conteoMarcados = 0,
  conteoTotal,
  resumen,
  inicialAbierto = false,
  children,
}: {
  titulo: string;
  conteoMarcados?: number;
  conteoTotal?: number;
  resumen?: string;
  inicialAbierto?: boolean;
  children: ReactNode;
}) {
  const [abierto, setAbierto] = useState(() => inicialAbierto || conteoMarcados > 0);

  return (
    <div
      className="lf-checks-acordeon"
      style={{
        margin: '.35rem 0 .25rem',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        background: 'var(--surface-sunken, rgba(0,0,0,0.15))',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '.5rem',
          padding: '.45rem .65rem',
          background: abierto ? 'rgba(255,255,255,0.03)' : 'transparent',
          border: 0,
          color: 'var(--text)',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: '.82rem',
          userSelect: 'none',
        }}
        aria-expanded={abierto}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', fontWeight: 600 }}>
          <span
            style={{
              fontSize: '.72rem',
              transform: abierto ? 'rotate(90deg)' : 'none',
              transition: 'transform .15s ease',
              display: 'inline-block',
            }}
          >
            ▶
          </span>
          <span>{titulo}</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.45rem' }}>
          {conteoMarcados > 0 ? (
            <span
              style={{
                fontSize: '.72rem',
                fontWeight: 700,
                padding: '.15rem .45rem',
                borderRadius: '4px',
                background: 'var(--brand, #ff8a00)',
                color: '#000',
              }}
            >
              {conteoMarcados}{conteoTotal != null ? ` / ${conteoTotal}` : ''} seleccionados
            </span>
          ) : resumen ? (
            <span className="muted" style={{ fontSize: '.76rem', fontWeight: 400 }}>{resumen}</span>
          ) : null}
          <span className="muted" style={{ fontSize: '.74rem', textDecoration: 'underline' }}>
            {abierto ? 'Ocultar' : 'Desplegar'}
          </span>
        </span>
      </button>

      {abierto && (
        <div style={{ padding: '.5rem .75rem .6rem', borderTop: '1px solid var(--border)' }}>
          {children}
        </div>
      )}
    </div>
  );
}
