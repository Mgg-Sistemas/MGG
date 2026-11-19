import type { CreditoDetalle, CreditoModalidad } from '../../shared/lib/types';
import { money } from '../../shared/lib/format';
import {
  formatearFechaCortaEs,
  hoyCaracasYmd,
  isoAYmdCaracas,
  normalizarCreditoDetalle,
  resolverInfoCredito,
  sumarDiasYmd,
  type AlertaCreditoItem,
  type FuenteCredito,
} from './creditoVencimiento';

const CHIPS_DIAS = [3, 7, 15, 30, 45, 60] as const;

export function validarCamposCredito(
  condicionesPago?: string | null,
  credito?: Partial<CreditoDetalle> | null,
): string | null {
  if (condicionesPago !== 'credito') return null;
  const dias = Number(credito?.dias) || 0;
  const primeroRecibe = credito?.modalidad === 'primero_recibe' || Boolean(credito?.primero_recibe);
  if (dias >= 1 || primeroRecibe) return null;
  return 'Indicá los días en los que se vence el crédito o marcá que la compra primero se recibe y luego se paga.';
}

export function CamposCreditoForm({
  value,
  onChange,
  fechaBaseIso,
}: {
  value?: CreditoDetalle | null;
  onChange: (next: CreditoDetalle | null) => void;
  fechaBaseIso?: string | null;
}) {
  const modalidadActual: CreditoModalidad =
    value?.modalidad === 'primero_recibe' || (value?.primero_recibe && !(Number(value?.dias) > 0))
      ? 'primero_recibe'
      : 'dias';
  const diasNum = Number(value?.dias) > 0 ? Math.max(1, Math.round(Number(value?.dias))) : '';
  const primeroRecibe = modalidadActual === 'primero_recibe' || Boolean(value?.primero_recibe);
  const baseYmd = isoAYmdCaracas(value?.fecha_inicio) ?? isoAYmdCaracas(fechaBaseIso) ?? hoyCaracasYmd();
  const vencPreview = typeof diasNum === 'number' && diasNum > 0 ? sumarDiasYmd(baseYmd, diasNum) : null;

  function actualizar(patch: Partial<CreditoDetalle>) {
    const merged: Partial<CreditoDetalle> = {
      modalidad: modalidadActual,
      dias: typeof diasNum === 'number' ? diasNum : null,
      primero_recibe: primeroRecibe,
      ...patch,
      // Recalcular siempre fecha_vencimiento a partir de la base + días nuevos
      fecha_inicio: baseYmd,
      fecha_vencimiento: undefined,
    };
    onChange(normalizarCreditoDetalle(merged, baseYmd));
  }

  return (
    <div
      className="card"
      style={{
        background: 'rgba(245, 177, 51, 0.06)',
        borderColor: 'rgba(245, 177, 51, 0.45)',
        padding: '.75rem .9rem',
        marginTop: '.5rem',
        marginBottom: '.75rem',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: '.86rem', marginBottom: '.45rem', display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
        <span>💳 Condiciones de la cuenta a crédito *</span>
        <span className="muted" style={{ fontWeight: 400, fontSize: '.76rem' }}>
          (visible en Compras y Tesorería · alerta a 2 días y 1 día del vencimiento)
        </span>
      </div>

      <div style={{ display: 'flex', gap: '.45rem', flexWrap: 'wrap', marginBottom: '.65rem' }}>
        <button
          type="button"
          className={modalidadActual === 'dias' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
          onClick={() =>
            actualizar({
              modalidad: 'dias',
              dias: typeof diasNum === 'number' && diasNum > 0 ? diasNum : 15,
            })
          }
        >
          ⏳ Días de vencimiento del crédito
        </button>
        <button
          type="button"
          className={modalidadActual === 'primero_recibe' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
          onClick={() =>
            actualizar({
              modalidad: 'primero_recibe',
              primero_recibe: true,
            })
          }
        >
          📦 Primero se recibe y luego se paga
        </button>
      </div>

      {modalidadActual === 'dias' ? (
        <div style={{ display: 'grid', gap: '.5rem' }}>
          <div className="form-row" style={{ margin: 0 }}>
            <label style={{ fontSize: '.82rem' }}>¿En cuántos días se vence el crédito? *</label>
            <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="number"
                min={1}
                max={365}
                step={1}
                className="input mono"
                style={{ maxWidth: 120 }}
                placeholder="Ej. 15"
                value={diasNum}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value) || 0);
                  actualizar({ modalidad: 'dias', dias: n > 0 ? n : null });
                }}
              />
              <span className="muted" style={{ fontSize: '.82rem' }}>días</span>
              <div style={{ display: 'inline-flex', gap: '.25rem', flexWrap: 'wrap', marginLeft: '.25rem' }}>
                {CHIPS_DIAS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={diasNum === d ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
                    style={{ padding: '.15rem .45rem', fontSize: '.75rem' }}
                    onClick={() => actualizar({ modalidad: 'dias', dias: d })}
                  >
                    {d} d
                  </button>
                ))}
              </div>
            </div>
            {vencPreview && (
              <small className="hint" style={{ color: 'var(--primary-3)', fontWeight: 600, marginTop: '.25rem', display: 'block' }}>
                📅 Vence el {formatearFechaCortaEs(vencPreview)} ({diasNum} {diasNum === 1 ? 'día' : 'días'}) · El sistema alertará a Tesorería y Compras a 2 días y 1 día de vencer.
              </small>
            )}
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', fontSize: '.83rem' }}>
            <input
              type="checkbox"
              checked={Boolean(value?.primero_recibe)}
              onChange={(e) => actualizar({ modalidad: 'dias', primero_recibe: e.target.checked })}
            />
            <span>📦 Además, la compra primero se recibe y luego se paga</span>
          </label>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '.5rem' }}>
          <div style={{ fontSize: '.83rem', padding: '.45rem .65rem', borderRadius: 'var(--r-sm)', background: 'rgba(59, 130, 246, 0.10)', border: '1px solid rgba(59, 130, 246, 0.30)' }}>
            📦 <strong>Primero se recibe y luego se paga:</strong> quedará indicado en Compras y en Tesorería que esta compra o servicio debe recibirse primero antes de pagar el crédito.
          </div>
          <div className="form-row" style={{ margin: 0 }}>
            <label style={{ fontSize: '.8rem' }}>Días de vencimiento del crédito (opcional)</label>
            <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="number"
                min={1}
                max={365}
                step={1}
                className="input mono"
                style={{ maxWidth: 120 }}
                placeholder="Sin plazo fijo"
                value={diasNum}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value) || 0);
                  actualizar({ modalidad: 'primero_recibe', primero_recibe: true, dias: n > 0 ? n : null });
                }}
              />
              <span className="muted" style={{ fontSize: '.8rem' }}>días</span>
              <button
                type="button"
                className={diasNum === '' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
                style={{ padding: '.15rem .45rem', fontSize: '.74rem' }}
                onClick={() => actualizar({ modalidad: 'primero_recibe', primero_recibe: true, dias: null })}
              >
                Sin días fijos
              </button>
              {[7, 15, 30].map((d) => (
                <button
                  key={d}
                  type="button"
                  className={diasNum === d ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
                  style={{ padding: '.15rem .45rem', fontSize: '.74rem' }}
                  onClick={() => actualizar({ modalidad: 'primero_recibe', primero_recibe: true, dias: d })}
                >
                  {d} d
                </button>
              ))}
            </div>
            {vencPreview && (
              <small className="hint" style={{ color: 'var(--primary-3)', fontWeight: 600, marginTop: '.25rem', display: 'block' }}>
                📅 Vencimiento estimado: {formatearFechaCortaEs(vencPreview)} · Alerta automática a 2 días y 1 día de vencer.
              </small>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function BadgesCondicionCredito({
  fuente,
  compact = false,
}: {
  fuente: FuenteCredito;
  compact?: boolean;
}) {
  const info = resolverInfoCredito(fuente);
  if (!info.esCredito || !info.configurado) return null;

  const fontSize = compact ? '.64rem' : '.78rem';
  const pad = compact ? '.08rem .38rem' : '.18rem .5rem';

  const clasePlazo =
    info.nivelAlerta === 'vencido' || info.nivelAlerta === 'vence_hoy' || info.nivelAlerta === 'por_vencer_1d'
      ? 'badge danger'
      : info.nivelAlerta === 'por_vencer_2d'
        ? 'badge warning'
        : 'badge info';

  const iconoPlazo =
    info.nivelAlerta === 'vencido' || info.nivelAlerta === 'vence_hoy' || info.nivelAlerta === 'por_vencer_1d'
      ? '🚨'
      : info.nivelAlerta === 'por_vencer_2d'
        ? '⚠'
        : '⏳';

  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '.3rem', alignItems: 'center' }}>
      {(info.dias || info.fechaVencimiento) && (
        <span className={clasePlazo} style={{ fontSize, padding: pad, fontWeight: 600 }} title={info.resumenLargo}>
          {iconoPlazo}{' '}
          {info.diasRestantes !== null && info.abiertaConSaldo
            ? info.diasRestantes < 0
              ? `Vencido (${Math.abs(info.diasRestantes)}d)`
              : info.diasRestantes === 0
                ? `Vence HOY (${info.fechaVencimientoFmt})`
                : `Vence en ${info.diasRestantes} ${info.diasRestantes === 1 ? 'día' : 'días'}${compact ? '' : ` · ${info.fechaVencimientoFmt}`}`
            : info.dias
              ? `Crédito ${info.dias}d${!compact && info.fechaVencimientoFmt ? ` · vence ${info.fechaVencimientoFmt}` : ''}`
              : `Vence ${info.fechaVencimientoFmt}`}
        </span>
      )}
      {info.primeroRecibe && (
        <span
          className={info.recibida ? 'badge success' : 'badge warning'}
          style={{ fontSize, padding: pad, fontWeight: 600 }}
          title={info.recibida ? 'Primero se recibe y luego se paga · Mercancía ya recibida' : 'Primero se recibe la compra y luego se paga'}
        >
          📦 {compact
            ? (info.recibida ? 'Recibida → pagar' : 'Primero recibe → paga')
            : (info.recibida ? 'Primero recibe y luego paga (ya recibida)' : 'Primero se recibe y luego se paga')}
        </span>
      )}
    </span>
  );
}

export function BannerAlertasCredito({
  alertas,
  contexto,
  onAccion,
}: {
  alertas: AlertaCreditoItem[];
  contexto: 'compras' | 'tesoreria';
  onAccion: (item: AlertaCreditoItem) => void;
}) {
  if (!alertas.length) return null;
  const hayCritica = alertas.some((a) => (a.info.diasRestantes ?? 99) <= 1);
  const borderColor = hayCritica ? 'var(--danger, #e5484d)' : 'var(--warning, #f5b133)';
  const bgColor = hayCritica ? 'rgba(229, 72, 77, 0.10)' : 'rgba(245, 177, 51, 0.10)';

  return (
    <div
      className="card"
      role="alert"
      style={{
        borderColor,
        borderWidth: 2,
        background: bgColor,
        marginBottom: '1rem',
        padding: '.85rem 1rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.55rem' }}>
        <div style={{ fontWeight: 800, fontSize: '.95rem', color: hayCritica ? 'var(--danger, #ff6b6b)' : 'var(--warning, #f5b133)' }}>
          🚨 Alerta de crédito pendiente por vencer ({alertas.length}) — Pagar cuenta a crédito
        </div>
        <span className="muted" style={{ fontSize: '.78rem' }}>
          {contexto === 'tesoreria'
            ? 'Cuentas a crédito de Compras (OC / OS) próximas a vencer o vencidas'
            : 'Coordinar con Tesorería el pago del crédito pendiente antes del vencimiento'}
        </span>
      </div>

      <div style={{ display: 'grid', gap: '.45rem' }}>
        {alertas.map((item) => {
          const d = item.info.diasRestantes ?? 0;
          const esRoja = d <= 1;
          return (
            <div
              key={item.orden.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '.6rem',
                flexWrap: 'wrap',
                padding: '.5rem .7rem',
                borderRadius: 'var(--r-sm)',
                background: 'var(--bg-1, rgba(0,0,0,0.22))',
                border: `1px solid ${esRoja ? 'rgba(229,72,77,0.45)' : 'rgba(245,177,51,0.45)'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', flexWrap: 'wrap', fontSize: '.85rem' }}>
                <span className="badge" style={{ fontWeight: 700 }}>{item.tipo}</span>
                <strong className="mono">{item.codigo}</strong>
                <span>· <strong>{item.proveedorNombre}</strong></span>
                <span className={esRoja ? 'badge danger' : 'badge warning'} style={{ fontWeight: 700 }}>
                  {d < 0
                    ? `🚨 Vencido hace ${Math.abs(d)} ${Math.abs(d) === 1 ? 'día' : 'días'} (${item.info.fechaVencimientoFmt})`
                    : d === 0
                      ? `🚨 Vence HOY (${item.info.fechaVencimientoFmt})`
                      : d === 1
                        ? `🚨 Falta 1 día · vence mañana (${item.info.fechaVencimientoFmt})`
                        : `⚠ Faltan 2 días · vence ${item.info.fechaVencimientoFmt}`}
                </span>
                {item.info.primeroRecibe && (
                  <span className={item.info.recibida ? 'badge success' : 'badge warning'} style={{ fontSize: '.74rem' }}>
                    📦 {item.info.recibida ? 'Compra ya recibida' : 'Primero recibe y luego paga'}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginLeft: 'auto' }}>
                <span className="mono" style={{ fontWeight: 800, fontSize: '.92rem', color: 'var(--warning)' }}>
                  Saldo: {money(item.saldoPendiente, item.orden.moneda ?? 'USD')}
                </span>
                <button
                  type="button"
                  className={contexto === 'tesoreria' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
                  onClick={() => onAccion(item)}
                >
                  {contexto === 'tesoreria' ? '💳 Pagar crédito' : '👁 Ver orden'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

