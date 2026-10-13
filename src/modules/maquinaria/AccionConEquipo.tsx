import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/ui/Modal';
import { SearchSelect } from '@/shared/ui/SearchSelect';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useSession } from '@/modules/auth/authStore';
import { toast } from '@/shared/ui/Toast';
import type { MaquinariaEquipo } from './maquinariaEquipos.repository';
import { ESTADOS_EQUIPO, avisoMasUrgente, avisoServicio, estadoEfectivo } from './flota';
import { equipoAdmite, type AccionSubmodulo } from './flotaListados';
import { lecturasVigentesEquipo, listLavados, type LavadoEquipo } from './flota.repository';
import { OrdenServicioModal } from './OrdenServicioModal';
import { EstadoEquipoModal } from './EstadoEquipoModal';
import { LavadoModal } from './LavadoModal';

const TITULO: Record<AccionSubmodulo, string> = {
  orden: '🔧 Nueva orden de servicio',
  averia: '🔴 Reportar avería',
  lavado: '🚿 Registrar lavado',
};

/**
 * Desde un submódulo: primero se elige el equipo (buscador) y luego se abre la MISMA
 * ventana del expediente (orden de servicio, avería o lavado), con sus lecturas vigentes.
 */
export function AccionConEquipo({ accion, equipos, equipoInicial, onClose, onDone }: {
  accion: AccionSubmodulo;
  equipos: MaquinariaEquipo[];
  equipoInicial?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { can, appUser } = usePermissions();
  const { user } = useSession();
  const actor = { email: user?.email ?? 'sistema', nombre: appUser?.nombre ?? null };
  const [equipoId, setEquipoId] = useState(equipoInicial ?? '');
  const [listo, setListo] = useState<{ eq: MaquinariaEquipo; horometro: number | null; km: number | null; ultimo: LavadoEquipo | null } | null>(null);
  const [cargando, setCargando] = useState(false);

  const opciones = useMemo(() => equipos
    .filter((e) => equipoAdmite(accion, estadoEfectivo(e)))
    .sort((a, b) => a.equipo.localeCompare(b.equipo, 'es'))
    .map((e) => ({ value: e.id, label: `${e.equipo}${e.tipo ? ` · ${e.tipo}` : ''} · ${ESTADOS_EQUIPO[estadoEfectivo(e)].label}` })), [equipos, accion]);

  useEffect(() => {
    if (!equipoInicial) return;
    void continuar(equipoInicial);
    // Solo al abrir con un equipo ya elegido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function continuar(id = equipoId) {
    const eq = equipos.find((e) => e.id === id);
    if (!eq) { toast('Elige el equipo.', 'warning'); return; }
    setCargando(true);
    try {
      const [{ horometro, km }, lavs] = await Promise.all([
        lecturasVigentesEquipo(eq),
        accion === 'lavado' ? listLavados(eq.id).catch(() => [] as LavadoEquipo[]) : Promise.resolve([] as LavadoEquipo[]),
      ]);
      setListo({ eq, horometro, km, ultimo: lavs[0] ?? null });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudieron leer los datos del equipo', 'error');
    } finally { setCargando(false); }
  }

  if (listo) {
    const { eq, horometro, km, ultimo } = listo;
    if (accion === 'orden') {
      const aviso = avisoMasUrgente(
        avisoServicio(eq.mantenimiento_cada_hrs, horometro, eq.mantenimiento_base_hrs, 'h'),
        avisoServicio(eq.mantenimiento_cada_km, km, eq.mantenimiento_base_km, 'km'),
      );
      return (
        <OrdenServicioModal equipo={eq} horometro={horometro} kilometraje={km} aviso={aviso}
          puedeSalidas={can('salidas', 'escritura')} puedePedidos={can('pedidos', 'escritura')} actor={actor}
          onClose={onClose} onCreated={onDone} />
      );
    }
    if (accion === 'averia') return <EstadoEquipoModal equipo={eq} modo="averia" onClose={onClose} onSaved={onDone} />;
    return <LavadoModal equipo={eq} horometro={horometro} km={km} ultimo={ultimo} actor={actor} onClose={onClose} onSaved={onDone} />;
  }

  return (
    <Modal compact title={TITULO[accion]} onClose={onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" disabled={!equipoId || cargando} onClick={() => void continuar()}>{cargando ? 'Cargando…' : 'Continuar'}</button>
      </>}>
      <div className="flo" style={{ display: 'grid', gap: '.6rem' }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Equipo</label>
          <SearchSelect options={opciones} value={equipoId} onChange={setEquipoId} placeholder="Buscar equipo…" emptyText="No hay equipos disponibles para esto" />
        </div>
        {accion === 'averia' && <p className="muted" style={{ margin: 0, fontSize: '.8rem' }}>No aparecen los equipos retirados ni los que ya están averiados o parados.</p>}
        {accion !== 'averia' && <p className="muted" style={{ margin: 0, fontSize: '.8rem' }}>No aparecen los equipos retirados.</p>}
      </div>
    </Modal>
  );
}
