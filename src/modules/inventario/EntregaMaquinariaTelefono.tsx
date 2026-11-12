/* ============================================================
   MGG · Inventario · teléfono · «¿Es para el mantenimiento de una máquina?»
   (12-11-2026, traído de Golden Touch y adaptado a la salida del teléfono
   de MGG). Si el almacenista dice SÍ y elige la máquina, al guardar la
   salida se crea la ENTREGA (EMA-…) que les llega a todos los de Maquinaria.
   Si el aviso falla, la salida ya quedó: se reintenta desde la pantalla
   de «Salida registrada».
   ============================================================ */
import { useState } from 'react';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { TIPOS_MANTENIMIENTO } from '@/modules/maquinaria/maquinariaMant.repository';
import { crearEntregaTelefono } from '@/modules/maquinaria/entregasAlmacen.repository';
import { AvisoFaltaMigracion, opcionesMaquinas, useMaquinasActivas } from '@/modules/maquinaria/EntregasAlmacenPanel';
import type { SalidaTelefono } from './inventarioTelefono';

/** Lo que se eligió en el formulario y cómo terminó el aviso a Maquinaria. */
export interface EnvioMaquinaria {
  equipoId: string;
  equipoNombre: string;
  tipo: string | null;
  nota: string | null;
  codigo: string | null;
  error: string | null;
}

const errMsg = (e: unknown, d: string) => String((e as { message?: string } | null)?.message ?? '').trim() || d;

/** Crea la entrega de una salida ya guardada. Nunca lanza: el error queda en el resultado. */
export async function enviarSalidaAMaquinaria(salidas: SalidaTelefono[], envio: EnvioMaquinaria): Promise<EnvioMaquinaria> {
  try {
    const e = await crearEntregaTelefono({
      salidaIds: salidas.map((s) => s.id), equipoId: envio.equipoId, tipoSugerido: envio.tipo, nota: envio.nota,
    });
    return { ...envio, equipoNombre: e.equipo_nombre, codigo: e.codigo, error: null };
  } catch (err) {
    return { ...envio, codigo: null, error: errMsg(err, 'No se pudo avisar a Maquinaria.') };
  }
}

/** La pregunta SÍ / NO, la máquina y para qué mantenimiento (opcional). */
export function CampoParaMantenimiento({ disponible, paraMant, onParaMant, equipoId, onEquipo, tipo, onTipo }: {
  disponible: boolean | null;
  paraMant: boolean | null; onParaMant: (v: boolean) => void;
  equipoId: string; onEquipo: (id: string, nombre: string) => void;
  tipo: string; onTipo: (v: string) => void;
}) {
  const { equipos, error } = useMaquinasActivas(!!paraMant);
  if (disponible === false) return <AvisoFaltaMigracion compacto />;
  return (
    <>
      <div className="surt-campo">
        <span className="surt-rotulo" id="inv-tel-salida-mant">¿Es para el mantenimiento de una máquina?</span>
        <div className="surt-sino" role="group" aria-labelledby="inv-tel-salida-mant">
          <button type="button" className={`surt-btn si${paraMant === true ? ' sel' : ''}`} aria-pressed={paraMant === true} onClick={() => onParaMant(true)}>
            <span className="icono" aria-hidden>🔧</span><span>SÍ</span><small>Le llega a Maquinaria</small>
          </button>
          <button type="button" className={`surt-btn no${paraMant === false ? ' sel' : ''}`} aria-pressed={paraMant === false} onClick={() => onParaMant(false)}>
            <span className="icono" aria-hidden>📦</span><span>NO</span><small>Salida normal</small>
          </button>
        </div>
      </div>
      {paraMant && (
        <>
          <div className="surt-campo">
            <label htmlFor="inv-tel-salida-maquina">Máquina *</label>
            <SearchSelect id="inv-tel-salida-maquina" value={equipoId} placeholder="🔍 Busca la máquina…" emptyText="Ninguna máquina coincide"
              options={opcionesMaquinas(equipos)}
              onChange={(id) => onEquipo(id, equipos.find((x) => x.id === id)?.equipo ?? '')} />
            {error && <small className="surt-alerta">{error}</small>}
          </div>
          <div className="surt-campo">
            <label htmlFor="inv-tel-salida-tipo-mant">Para qué mantenimiento · opcional</label>
            <select id="inv-tel-salida-tipo-mant" className="input surt-input" value={tipo} onChange={(e) => onTipo(e.target.value)}>
              <option value="">— Lo indica Maquinaria —</option>
              {TIPOS_MANTENIMIENTO.filter((t) => t.value !== 'lectura').map((t) => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
            </select>
            <small className="muted">Maquinaria recibe la entrega, registra el trabajo con el horómetro y queda en la bitácora de la máquina.</small>
          </div>
        </>
      )}
    </>
  );
}

/** En «Salida registrada»: si llegó a Maquinaria, o el error con el botón para reintentar. */
export function AvisoEnvioMaquinaria({ envio, salidas, onCambio }: {
  envio: EnvioMaquinaria; salidas: SalidaTelefono[]; onCambio: (e: EnvioMaquinaria) => void;
}) {
  const [reintentando, setReintentando] = useState(false);
  async function reintentar() {
    setReintentando(true);
    try { onCambio(await enviarSalidaAMaquinaria(salidas, envio)); }
    finally { setReintentando(false); }
  }
  return (
    <div className="surt-campo" style={{ borderLeft: `4px solid ${envio.error ? 'var(--danger)' : 'var(--success)'}`, paddingLeft: '.6rem' }}>
      {envio.codigo
        ? <span>🔧 Entrega <strong>{envio.codigo}</strong> enviada a Maquinaria para <strong>{envio.equipoNombre}</strong>.</span>
        : (
          <>
            <span>⚠ La salida quedó registrada, pero no se pudo avisar a Maquinaria: {envio.error}</span>
            <button type="button" className="btn btn-primary btn-grande" disabled={reintentando} onClick={() => void reintentar()}>
              {reintentando ? 'Enviando…' : '↻ Reintentar envío a Maquinaria'}
            </button>
          </>
        )}
    </div>
  );
}
