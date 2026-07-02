import { useState } from 'react';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { PersonalTab } from './PersonalTab';
import { AnticiposTab } from './AnticiposTab';
import { NominaTab } from './NominaTab';
import { VacacionesTab } from './VacacionesTab';
import { AdministrativoTab } from './AdministrativoTab';

type Vista = 'personal' | 'anticipos' | 'nomina' | 'vacaciones' | 'administrativo';

const TABS: { key: Vista; label: string; icon: string }[] = [
  { key: 'personal', label: 'Personal', icon: '👥' },
  { key: 'anticipos', label: 'Anticipos / Préstamos', icon: '💵' },
  { key: 'nomina', label: 'Nómina', icon: '📋' },
  { key: 'vacaciones', label: 'Vacaciones', icon: '🏖' },
  { key: 'administrativo', label: 'Administrativo', icon: '🗂' },
];

export function RrhhPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('rrhh', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;
  const [vista, setVista] = useState<Vista>('personal');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>👥 RRHH / Nómina</h1>
          <p className="hint muted" style={{ margin: '.25rem 0 0' }}>Personal, nómina quincenal y administrativo. La nómina se paga desde Tesorería.</p>
        </div>
      </div>

      <div className="view-toggle" role="tablist" aria-label="Vista de RRHH" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} className={vista === t.key ? 'active' : ''} onClick={() => setVista(t.key)}>{t.icon} {t.label}</button>
        ))}
      </div>

      {vista === 'personal' && <PersonalTab canWrite={canWrite} actor={actor} />}
      {vista === 'anticipos' && <AnticiposTab canWrite={canWrite} actor={actor} actorName={actorName} />}
      {vista === 'nomina' && <NominaTab canWrite={canWrite} actor={actor} actorName={actorName} />}
      {vista === 'vacaciones' && <VacacionesTab canWrite={canWrite} actor={actor} actorName={actorName} />}
      {vista === 'administrativo' && <AdministrativoTab canWrite={canWrite} actor={actor} actorName={actorName} />}
    </div>
  );
}
