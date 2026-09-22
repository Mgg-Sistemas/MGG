import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { useRealtime } from '@/shared/lib/useRealtime';
import { PersonalTab } from './PersonalTab';
import { AnticiposTab } from './AnticiposTab';
import { NominaTab } from './NominaTab';
import { VacacionesTab } from './VacacionesTab';
import { AdministrativoTab } from './AdministrativoTab';
import { listPersonalTodasLasEmpresas } from './personal.repository';
import { EMPRESAS, colorEmpresa, contarPorEmpresa, definicionEmpresa, type Empresa } from './empresa';

type Vista = 'personal' | 'anticipos' | 'nomina' | 'vacaciones' | 'administrativo';

const TABS: { key: Vista; label: string; icon: string }[] = [
  { key: 'personal', label: 'Personal', icon: '👥' },
  { key: 'anticipos', label: 'Anticipos / Préstamos', icon: '💵' },
  { key: 'nomina', label: 'Nómina', icon: '📋' },
  { key: 'vacaciones', label: 'Vacaciones', icon: '🏖' },
  { key: 'administrativo', label: 'Administrativo', icon: '🗂' },
];

/** Lo último que se estuvo mirando, para no volver a MGG en cada recarga. */
const RECUERDO = 'mgg.rrhh.empresa';

function empresaGuardada(): Empresa {
  try {
    const v = localStorage.getItem(RECUERDO);
    return v === 'GOMETAL' ? 'GOMETAL' : 'MGG';
  } catch { return 'MGG'; }
}

export function RrhhPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('rrhh', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;
  const [vista, setVista] = useState<Vista>('personal');
  const [empresa, setEmpresa] = useState<Empresa>(empresaGuardada);
  const [conteo, setConteo] = useState<Record<Empresa, number>>({ MGG: 0, GOMETAL: 0 });

  function cambiarEmpresa(e: Empresa) {
    setEmpresa(e);
    try { localStorage.setItem(RECUERDO, e); } catch { /* modo privado: no es grave */ }
  }

  // Cuánta gente tiene cada nómina, para mostrarlo en el interruptor.
  const contar = useCallback(async () => {
    try { setConteo(contarPorEmpresa(await listPersonalTodasLasEmpresas(true))); }
    catch { /* el conteo es informativo: si falla, no rompe la pantalla */ }
  }, []);
  useEffect(() => { void contar(); }, [contar]);
  useRealtime(['personal'], () => { void contar(); });

  const def = definicionEmpresa(empresa);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>
            👥 RRHH · <span style={{ color: colorEmpresa(empresa) }}>Nómina {def.label}</span>
          </h1>
          <p className="hint muted" style={{ margin: '.25rem 0 0' }}>
            Personal, nómina quincenal y administrativo de <strong>{def.razonSocial}</strong>. La nómina se paga desde Tesorería.
          </p>
        </div>

        {/* El interruptor entre las dos nóminas. Son empresas distintas: lo que
            se ve de un lado no existe del otro. */}
        <div role="tablist" aria-label="Empresa de la nómina"
          style={{ display: 'flex', gap: '.3rem', padding: '.3rem', borderRadius: 12, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
          {EMPRESAS.map((e) => {
            const activa = empresa === e.key;
            return (
              <button key={e.key} role="tab" aria-selected={activa}
                onClick={() => cambiarEmpresa(e.key)}
                className="btn"
                style={{
                  background: activa ? e.color : 'transparent',
                  color: activa ? '#fff' : 'var(--text)',
                  border: 'none', fontWeight: activa ? 800 : 600,
                  boxShadow: activa ? 'inset 0 0 0 1px rgba(0,0,0,.08)' : 'none',
                }}>
                {e.icono} Nómina {e.label}
                <span style={{ opacity: .75, marginLeft: '.4rem', fontSize: '.8em' }}>({conteo[e.key]})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Franja del color de la empresa: que nunca haya dudas de qué nómina se
          está tocando. Cargarle un aumento a la persona equivocada porque el
          interruptor estaba del otro lado es un error caro. */}
      <div style={{ height: 3, borderRadius: 3, background: colorEmpresa(empresa), marginBottom: '1rem' }} />

      <div className="view-toggle" role="tablist" aria-label="Vista de RRHH" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} className={vista === t.key ? 'active' : ''} onClick={() => setVista(t.key)}>{t.icon} {t.label}</button>
        ))}
      </div>

      {/* La `key` fuerza a la pestaña a arrancar de cero al cambiar de empresa:
          sin eso quedarían en pantalla los datos de la otra nómina mientras
          llegan los nuevos, que es justo lo que no puede pasar acá. */}
      {vista === 'personal' && <PersonalTab key={empresa} canWrite={canWrite} actor={actor} actorName={actorName} empresa={empresa} />}
      {vista === 'anticipos' && <AnticiposTab key={empresa} canWrite={canWrite} actor={actor} actorName={actorName} empresa={empresa} />}
      {vista === 'nomina' && <NominaTab key={empresa} canWrite={canWrite} actor={actor} actorName={actorName} empresa={empresa} />}
      {vista === 'vacaciones' && <VacacionesTab key={empresa} canWrite={canWrite} actor={actor} actorName={actorName} empresa={empresa} />}
      {vista === 'administrativo' && <AdministrativoTab key={empresa} canWrite={canWrite} actor={actor} actorName={actorName} empresa={empresa} />}
    </div>
  );
}
