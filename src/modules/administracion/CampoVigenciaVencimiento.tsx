/* ============================================================
   Golden Touch · Administración · Control de Vigencia y Vencimiento
   (05/11/2026)

   Componente interactivo para ingreso dual:
     1. Fecha de Vencimiento directa (calendario).
     2. Tiempo de Vigencia (presets de 15d, 1m, 3m, 6m, 1 año, etc.
        o cantidad personalizada), traduciéndose automáticamente en fecha.
     3. Variación automática del Status de Vigencia según la cercanía a vencer.
     4. Alerta visual con cuenta regresiva y soporte para «Vencido en Trámite».
   ============================================================ */

import { useState } from 'react';
import type { StatusVencimiento } from './admin.repository';
import { STATUS_VENCIMIENTO_LABEL } from './admin.repository';
import {
  PRESETS_TIEMPO_VIGENCIA,
  sumarTiempoVigencia,
  calcularStatusPorCercania,
  type UnidadVigencia,
} from './administracionVigencia';

interface Props {
  fechaEmision?: string | null;
  fechaVencimiento?: string | null;
  statusVencimiento: StatusVencimiento;
  notaTramite?: string | null;
  disabled?: boolean;
  compacto?: boolean;
  onChange: (vals: {
    fechaVencimiento: string | null;
    statusVencimiento: StatusVencimiento;
    notaTramite?: string | null;
  }) => void;
}

export function CampoVigenciaVencimiento({
  fechaEmision,
  fechaVencimiento,
  statusVencimiento,
  notaTramite,
  disabled = false,
  compacto = false,
  onChange,
}: Props) {
  const [mostrarPersonalizado, setMostrarPersonalizado] = useState(false);
  const [cantPers, setCantPers] = useState<number>(30);
  const [unidadPers, setUnidadPers] = useState<UnidadVigencia>('dias');

  // Calcular cercanía e info visual en tiempo real
  const esTramite = statusVencimiento === 'vencido_en_tramite';
  const info = calcularStatusPorCercania(fechaVencimiento, {
    esTramite,
    statusManual: statusVencimiento,
  });

  // Al cambiar la fecha de vencimiento directamente
  const handleCambioFecha = (nuevaFechaIso: string) => {
    if (!nuevaFechaIso) {
      onChange({
        fechaVencimiento: null,
        statusVencimiento: 'no_vence',
        notaTramite,
      });
      return;
    }

    const nuevaInfo = calcularStatusPorCercania(nuevaFechaIso, {
      esTramite,
      statusManual: esTramite ? 'vencido_en_tramite' : undefined,
    });

    onChange({
      fechaVencimiento: nuevaFechaIso,
      statusVencimiento: nuevaInfo.status,
      notaTramite,
    });
  };

  // Al elegir un preset de tiempo de vigencia
  const handleAplicarPreset = (presetId: string) => {
    const preset = PRESETS_TIEMPO_VIGENCIA.find((p) => p.id === presetId);
    if (!preset) return;

    if (preset.esNoVence) {
      onChange({
        fechaVencimiento: null,
        statusVencimiento: 'no_vence',
        notaTramite: null,
      });
      return;
    }

    const fechaBase = fechaEmision || undefined;
    const nuevaFecha = sumarTiempoVigencia(fechaBase, preset.cantidad, preset.unidad);
    const nuevaInfo = calcularStatusPorCercania(nuevaFecha);

    onChange({
      fechaVencimiento: nuevaFecha,
      statusVencimiento: nuevaInfo.status,
      notaTramite,
    });
  };

  // Al aplicar tiempo personalizado
  const handleAplicarPersonalizado = () => {
    if (cantPers <= 0) return;
    const fechaBase = fechaEmision || undefined;
    const nuevaFecha = sumarTiempoVigencia(fechaBase, cantPers, unidadPers);
    const nuevaInfo = calcularStatusPorCercania(nuevaFecha);

    onChange({
      fechaVencimiento: nuevaFecha,
      statusVencimiento: nuevaInfo.status,
      notaTramite,
    });
    setMostrarPersonalizado(false);
  };

  // Al cambiar manualmente el status (ej. marcar 'vencido_en_tramite')
  const handleCambioStatus = (nuevoStatus: StatusVencimiento) => {
    if (nuevoStatus === 'no_vence') {
      onChange({
        fechaVencimiento: null,
        statusVencimiento: 'no_vence',
        notaTramite: null,
      });
    } else {
      onChange({
        fechaVencimiento: fechaVencimiento || null,
        statusVencimiento: nuevoStatus,
        notaTramite: nuevoStatus === 'vencido_en_tramite' ? (notaTramite || '') : notaTramite,
      });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem', width: '100%' }}>
      {/* Fila principal: Fecha de vencimiento + Status + Indicador de cercanía */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', flexWrap: 'wrap' }}>
        {/* Input Fecha de Vencimiento */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flex: '1 1 140px', minWidth: 140 }}>
          <span className="muted hint" style={{ fontSize: '.7rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>Fecha Vencimiento</span>
            {fechaEmision && <span title="Vigencia contada desde emisión">Emisión: {fechaEmision}</span>}
          </span>
          <input
            type="date"
            className="input"
            disabled={disabled}
            style={{ fontSize: '.78rem', padding: '.25rem .45rem', width: '100%' }}
            value={fechaVencimiento || ''}
            onChange={(e) => handleCambioFecha(e.target.value)}
          />
        </label>

        {/* Selector de Status (se actualiza automáticamente por cercanía, pero permite override como 'vencido_en_tramite') */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: '.2rem', flex: '1 1 150px', minWidth: 150 }}>
          <span className="muted hint" style={{ fontSize: '.7rem' }}>
            Status Vigencia
          </span>
          <select
            className="input"
            disabled={disabled}
            style={{
              fontSize: '.78rem',
              padding: '.25rem .45rem',
              width: '100%',
              borderColor: info.border,
              background: info.bg,
              color: info.color,
              fontWeight: 700,
            }}
            value={statusVencimiento}
            onChange={(e) => handleCambioStatus(e.target.value as StatusVencimiento)}
          >
            {(Object.keys(STATUS_VENCIMIENTO_LABEL) as StatusVencimiento[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_VENCIMIENTO_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Chip de cercanía dinámica y advertencia en tiempo real */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '.4rem',
          fontSize: '.72rem',
          padding: '.2rem .5rem',
          borderRadius: 6,
          background: info.bg,
          border: `1px solid ${info.border}`,
          color: info.color,
          fontWeight: 600,
        }}
      >
        <span>
          {statusVencimiento === 'vencido'
            ? '🔴'
            : statusVencimiento === 'vencido_en_tramite'
            ? '🟣'
            : statusVencimiento === 'por_vencer'
            ? '🟡'
            : statusVencimiento === 'vigente'
            ? '🟢'
            : '⚪'}
        </span>
        <span style={{ flex: 1 }}>{info.label}</span>
        {info.dias !== null && (
          <span
            style={{
              fontSize: '.66rem',
              padding: '.1rem .35rem',
              borderRadius: 999,
              background: 'rgba(0,0,0,0.2)',
              fontWeight: 700,
            }}
          >
            {info.dias < 0 ? `${info.dias}d` : `+${info.dias}d`}
          </span>
        )}
      </div>

      {/* Botones de Presets de Tiempo de Vigencia («Se debe permitir ingresar fecha de vencimiento o Tiempo de vigencia») */}
      {!disabled && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.4rem' }}>
            <span className="muted hint" style={{ fontSize: '.68rem', letterSpacing: '.02em' }}>
              ⏱️ Tiempo de Vigencia sugerido:
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              style={{ fontSize: '.66rem', padding: '0 .25rem', height: 'auto', color: '#ff8a00' }}
              onClick={() => setMostrarPersonalizado((v) => !v)}
            >
              {mostrarPersonalizado ? 'Ocultar personalizado' : '+ Otro plazo'}
            </button>
          </div>

          {/* Fila de presets rápidos */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem' }}>
            {PRESETS_TIEMPO_VIGENCIA.map((p) => (
              <button
                key={p.id}
                type="button"
                className="btn btn-ghost btn-xs"
                style={{
                  fontSize: '.68rem',
                  padding: '.15rem .4rem',
                  height: 'auto',
                  border: '1px solid var(--border)',
                  background: 'var(--surface-1)',
                  borderRadius: 4,
                  whiteSpace: 'nowrap',
                }}
                onClick={() => handleAplicarPreset(p.id)}
                title={`Traducir a fecha de vencimiento (+${p.cantidad} ${p.unidad})`}
              >
                {compacto ? p.labelCorto : p.label}
              </button>
            ))}
          </div>

          {/* Formulario personalizado de tiempo de vigencia */}
          {mostrarPersonalizado && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '.35rem',
                marginTop: '.2rem',
                padding: '.35rem .45rem',
                background: 'var(--surface-2)',
                borderRadius: 6,
                border: '1px solid var(--border)',
              }}
            >
              <span className="muted" style={{ fontSize: '.7rem' }}>Sumar:</span>
              <input
                type="number"
                min={1}
                max={999}
                className="input input-sm"
                value={cantPers}
                onChange={(e) => setCantPers(Number(e.target.value) || 1)}
                style={{ width: 60, fontSize: '.76rem', padding: '.15rem .3rem' }}
              />
              <select
                className="input input-sm"
                value={unidadPers}
                onChange={(e) => setUnidadPers(e.target.value as UnidadVigencia)}
                style={{ fontSize: '.76rem', padding: '.15rem .3rem' }}
              >
                <option value="dias">días</option>
                <option value="meses">meses</option>
                <option value="anos">años</option>
              </select>
              <button
                type="button"
                className="btn btn-primary btn-xs"
                style={{ fontSize: '.7rem', background: '#ff8a00', color: '#000', fontWeight: 700 }}
                onClick={handleAplicarPersonalizado}
              >
                ✓ Aplicar
              </button>
            </div>
          )}
        </div>
      )}

      {/* Campo para Nota de Trámite en Curso (se muestra si está vencido en trámite) */}
      {statusVencimiento === 'vencido_en_tramite' && (
        <div style={{ marginTop: '.2rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '.15rem' }}>
            <span style={{ fontSize: '.68rem', fontWeight: 700, color: '#a855f7' }}>
              🟣 Nota / Radicado de Renovación en Curso:
            </span>
            <input
              type="text"
              className="input input-sm"
              placeholder="Ej: Radicado N° 88123-2026 taquilla MINEC / Esperando resolución..."
              style={{ fontSize: '.75rem', borderColor: '#a855f7' }}
              value={notaTramite || ''}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  fechaVencimiento: fechaVencimiento || null,
                  statusVencimiento,
                  notaTramite: e.target.value,
                })
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}

