import { useEffect, useState, type ReactNode } from 'react';
import type { MotivosIvaCien } from './retencionesCalculo';

/**
 * Los supuestos del art. 5 (Providencia SNAT/2025/000054, que derogó a la SNAT/2015/0049) que llevan la retención de IVA al 100%.
 */
export const MOTIVOS_IVA_CIEN_LISTA: Array<[keyof MotivosIvaCien & string, string]> = [
  ['ivaNoDiscriminado', 'El IVA no está discriminado en la factura'],
  ['facturaNoCumple', 'La factura no cumple los requisitos de facturación'],
  ['proveedorNoInscrito', 'El proveedor está sujeto a retención del 100% según el Portal Fiscal, o no está inscrito en el RIF'],
  ['proveedorNoDomiciliado', 'El proveedor no está domiciliado en el país'],
  ['metalesPreciosos', 'Compra de metales o piedras preciosas'],
];

export interface SupuestoIvaItem {
  codigo: string;
  texto: string;
  pct: number;
}

/**
 * Componente acordeón expandible/colapsable para la lista de checks de supuestos de IVA (art. 5).
 * Por defecto permanece colapsado para no saturar el modal, mostrando el resumen y cantidad de marcados.
 */
export function SupuestosIvaAcordeon({
  motivos,
  supuestosIva,
  pctGeneral,
  pctActual,
  onChange,
  inicialAbierto,
}: {
  motivos: Record<string, boolean | undefined>;
  supuestosIva?: SupuestoIvaItem[] | null;
  pctGeneral: number;
  pctActual?: number;
  onChange: (codigo: string, valor: boolean) => void;
  inicialAbierto?: boolean;
}) {
  const marcados = Object.entries(motivos).filter(([_, v]) => !!v);
  const numMarcados = marcados.length;
  const [abierto, setAbierto] = useState(() => inicialAbierto ?? numMarcados > 0);

  // Si se marca un supuesto externamente, abrir automáticamente para visibilidad
  useEffect(() => {
    if (numMarcados > 0) setAbierto(true);
  }, [numMarcados]);

  const opciones = supuestosIva && supuestosIva.length > 0
    ? supuestosIva.map((x): [string, string] => [x.codigo, `${x.texto}${x.pct !== 100 ? ` (${x.pct} %)` : ''}`])
    : MOTIVOS_IVA_CIEN_LISTA;

  return (
    <div
      className="lf-checks-acordeon"
      style={{
        margin: '.35rem 0 .25rem',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        background: 'var(--surface-sunken, rgba(0,0,0,0.15))',
        overflow: 'hidden',
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
          <span>{supuestosIva ? '¿Aplica un supuesto con su propio porcentaje?' : '¿Corresponde retener el 100%? (art. 5)'}</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.45rem' }}>
          {numMarcados > 0 ? (
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
              {numMarcados} {numMarcados === 1 ? 'supuesto activo' : 'supuestos activos'} {pctActual ? `(${pctActual}%)` : '(100%)'}
            </span>
          ) : (
            <span className="muted" style={{ fontSize: '.76rem', fontWeight: 400 }}>
              General ({pctGeneral}%)
            </span>
          )}
          <span className="muted" style={{ fontSize: '.74rem', textDecoration: 'underline' }}>
            {abierto ? 'Ocultar' : 'Ver opciones'}
          </span>
        </span>
      </button>

      {abierto && (
        <div style={{ padding: '.5rem .75rem .6rem', borderTop: '1px solid var(--border)' }}>
          {opciones.length === 0 ? (
            <small className="hint muted">No hay supuestos vigentes a la fecha de la factura.</small>
          ) : (
            <div style={{ display: 'grid', gap: '.3rem' }}>
              {opciones.map(([k, label]) => (
                <label
                  key={k}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '.45rem',
                    fontSize: '.83rem',
                    cursor: 'pointer',
                    padding: '.25rem .35rem',
                    borderRadius: '4px',
                    background: motivos[k] ? 'rgba(255,138,0,0.08)' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!motivos[k]}
                    style={{ marginTop: '.2rem', accentColor: 'var(--brand, #ff8a00)', cursor: 'pointer' }}
                    onChange={(e) => onChange(k, e.target.checked)}
                  />
                  <span style={{ color: motivos[k] ? 'var(--brand, #ff8a00)' : 'inherit', fontWeight: motivos[k] ? 600 : 400 }}>
                    {label}
                  </span>
                </label>
              ))}
            </div>
          )}
          <small className="hint muted" style={{ display: 'block', marginTop: '.35rem' }}>
            Sin ninguna marcada se retiene la alícuota general del {pctGeneral}%.
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
