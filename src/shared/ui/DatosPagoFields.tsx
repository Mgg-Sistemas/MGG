import { useMemo, useState } from 'react';
import { BANCOS_VE, labelBanco } from '@/shared/lib/bancos';
import type { DatosPago } from '@/modules/pedidos/datosPago.repository';
import { errorCiRif, errorCuenta, errorTelefono, errorTelefonoContraBanco, LARGO_CUENTA } from './datosPagoValidacion';

/** Selector de banco buscable (guarda el código SUDEBAN). */
function BancoSelect({ value, onChange }: { value: string; onChange: (codigo: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? BANCOS_VE.filter((b) => `${b.codigo} ${b.nombre}`.toLowerCase().includes(t)) : BANCOS_VE;
  }, [q]);
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        placeholder="Buscar banco (nombre o código)…"
        value={open ? q : (value ? labelBanco(value) : '')}
        onFocus={() => { setOpen(true); setQ(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQ(e.target.value)}
      />
      {open && (
        <div className="card" style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, margin: '.2rem 0 0', maxHeight: 220, overflowY: 'auto', padding: '.25rem' }}>
          {filtrados.length === 0 && <div className="muted" style={{ padding: '.4rem' }}>Sin resultados</div>}
          {filtrados.map((b) => (
            <button
              type="button"
              key={b.codigo}
              className="btn btn-ghost btn-sm"
              style={{ display: 'block', width: '100%', textAlign: 'left' }}
              onMouseDown={(e) => { e.preventDefault(); onChange(b.codigo); setOpen(false); }}
            >
              <strong>{b.codigo}</strong> · {b.nombre}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Campo({ label, children, hint, error }: {
  label: string; children: React.ReactNode; hint?: string;
  /** Aviso en rojo debajo del campo. Se muestra mientras se escribe, para
   *  corregir en el momento y no descubrirlo recién al guardar. */
  error?: string | null;
}) {
  return (
    <div className="form-row" style={{ margin: 0 }}>
      <label>{label}</label>
      {children}
      {error
        ? <span style={{ fontSize: '.7rem', color: 'var(--danger)' }}>⚠ {error}</span>
        : hint && <span className="muted" style={{ fontSize: '.7rem' }}>{hint}</span>}
    </div>
  );
}

/**
 * Campos de datos de pago del proveedor según el método. Devuelve los valores
 * vía onChange. Validaciones: cuenta solo números (20 dígitos), teléfono solo
 * números, email con tipo email.
 */
export function DatosPagoFields({ metodo, value, onChange }: {
  metodo: string;
  value: DatosPago;
  onChange: (d: DatosPago) => void;
}) {
  const set = (k: string, v: string) => onChange({ ...value, [k]: v });
  const soloNumeros = (v: string, max?: number) => { const d = v.replace(/\D/g, ''); return max ? d.slice(0, max) : d; };

  if (metodo === 'pago_movil') {
    return (
      <div style={{ display: 'grid', gap: '.5rem' }}>
        <Campo label="CI o RIF *" error={value.ci_rif ? errorCiRif(value.ci_rif) : null}>
          <input className="input" value={value.ci_rif ?? ''} onChange={(e) => set('ci_rif', e.target.value)} placeholder="V-12345678 / J-..." />
        </Campo>
        <Campo label="Banco *"><BancoSelect value={value.banco ?? ''} onChange={(c) => set('banco', c)} /></Campo>
        <Campo label="Teléfono *" hint="11 dígitos · 0414, 0424, 0412, 0416, 0422, 0426 o un fijo 02…"
          error={value.telefono
            ? (errorTelefono(value.telefono) ?? errorTelefonoContraBanco(value.telefono, value.banco))
            : null}>
          <input className="input mono" inputMode="numeric" value={value.telefono ?? ''} onChange={(e) => set('telefono', soloNumeros(e.target.value, 11))} placeholder="04141234567" />
        </Campo>
      </div>
    );
  }

  if (metodo === 'transferencia') {
    const cuenta = value.cuenta ?? '';
    return (
      <div style={{ display: 'grid', gap: '.5rem' }}>
        <Campo label="Nombre / Razón social *">
          <input className="input" value={value.nombre ?? ''} onChange={(e) => set('nombre', e.target.value)} />
        </Campo>
        <Campo label="CI / RIF *" error={value.ci ? errorCiRif(value.ci) : null}>
          <input className="input" value={value.ci ?? ''} onChange={(e) => set('ci', e.target.value)} placeholder="V-12345678 / J-..." />
        </Campo>
        <Campo label="Banco *"><BancoSelect value={value.banco ?? ''} onChange={(c) => set('banco', c)} /></Campo>
        <Campo label="Número de cuenta *" hint={`Solo números · ${cuenta.length}/20 dígitos`}
          error={cuenta.length === LARGO_CUENTA || !cuenta ? null : errorCuenta(cuenta)}>
          <input className="input mono" inputMode="numeric" value={cuenta} onChange={(e) => set('cuenta', soloNumeros(e.target.value, 20))} placeholder="01050000000000000000" />
        </Campo>
      </div>
    );
  }

  if (metodo === 'zelle') {
    return (
      <div style={{ display: 'grid', gap: '.5rem' }}>
        <Campo label="Nombre *">
          <input className="input" value={value.nombre ?? ''} onChange={(e) => set('nombre', e.target.value)} />
        </Campo>
        <Campo label="Correo *">
          <input className="input" type="email" value={value.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="correo@dominio.com" />
        </Campo>
      </div>
    );
  }

  if (metodo === 'binance_usdt') {
    return (
      <div style={{ display: 'grid', gap: '.5rem' }}>
        <Campo label="Correo o ID de Binance *">
          <input className="input" value={value.email_o_id ?? ''} onChange={(e) => set('email_o_id', e.target.value)} placeholder="correo@dominio.com o 123456789" />
        </Campo>
      </div>
    );
  }

  return null;
}

/**
 * Valida los datos del método. Devuelve el error o null.
 * El teléfono y la cuenta se revisan por FORMA, no solo por presencia: se
 * guardó un código de banco como teléfono y el nombre del banco dentro del RIF.
 */
export function validarDatosPago(metodo: string, d: DatosPago): string | null {
  if (metodo === 'pago_movil') {
    const eCi = errorCiRif(d.ci_rif); if (eCi) return eCi;
    if (!d.banco?.trim()) return 'Elegí el banco';
    const eTel = errorTelefono(d.telefono); if (eTel) return eTel;
    const eCruce = errorTelefonoContraBanco(d.telefono, d.banco); if (eCruce) return eCruce;
  } else if (metodo === 'transferencia') {
    if (!d.nombre?.trim()) return 'Indicá el nombre';
    const eCi = errorCiRif(d.ci); if (eCi) return eCi;
    if (!d.banco?.trim()) return 'Elegí el banco';
    const eCta = errorCuenta(d.cuenta); if (eCta) return eCta;
  } else if (metodo === 'zelle') {
    if (!d.nombre?.trim()) return 'Indicá el nombre';
    if (!d.email?.trim()) return 'Indicá el correo';
  } else if (metodo === 'binance_usdt') {
    if (!d.email_o_id?.trim()) return 'Indicá el correo o ID de Binance';
  }
  return null;
}

/** Resumen legible de los datos guardados (para mostrar en el detalle). */
export function resumenDatosPago(metodo: string, d: DatosPago): string {
  if (!d || !Object.keys(d).length) return '';
  if (metodo === 'pago_movil') return `${d.ci_rif ?? ''} · ${labelBanco(d.banco)} · ${d.telefono ?? ''}`;
  if (metodo === 'transferencia') return `${d.nombre ?? ''} · ${d.ci ?? ''} · ${labelBanco(d.banco)} · Cta ${d.cuenta ?? ''}`;
  if (metodo === 'zelle') return `${d.nombre ?? ''} · ${d.email ?? ''}`;
  if (metodo === 'binance_usdt') return `${d.email_o_id ?? ''}`;
  return '';
}
