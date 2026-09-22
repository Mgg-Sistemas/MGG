import { useState } from 'react';
import { useSession } from '@/modules/auth/authStore';
import { usePermissions } from '@/modules/auth/PermissionsContext';
import { PersonalTab } from './PersonalTab';
import { AnticiposTab } from './AnticiposTab';
import { NominaTab } from './NominaTab';
import { VacacionesTab } from './VacacionesTab';
import { AdministrativoTab } from './AdministrativoTab';
import { EMPRESA_POR_DEFECTO, definicionEmpresa } from './empresa';

type Vista = 'personal' | 'anticipos' | 'nomina' | 'vacaciones' | 'administrativo';

const TABS: { key: Vista; label: string; icon: string }[] = [
  { key: 'personal', label: 'Personal', icon: '👥' },
  { key: 'anticipos', label: 'Anticipos / Préstamos', icon: '💵' },
  { key: 'nomina', label: 'Nómina', icon: '📋' },
  { key: 'vacaciones', label: 'Vacaciones', icon: '🏖' },
  { key: 'administrativo', label: 'Administrativo', icon: '🗂' },
];

/* Hubo un interruptor acá arriba para pasar de la nómina de MGG a la de
   GoMetal. Se quitó: hay una sola nómina y es la de MGG. Las pestañas siguen
   recibiendo la empresa porque la columna vive en la base y cada ficha la
   lleva; lo que ya no existe es un segundo lado que se pueda dejar mal puesto. */
const EMPRESA = EMPRESA_POR_DEFECTO;
const DEF = definicionEmpresa(EMPRESA);

export function RrhhPage() {
  const { user } = useSession();
  const { can, appUser } = usePermissions();
  const canWrite = can('rrhh', 'escritura');
  const actor = user?.email ?? 'sistema';
  const actorName = appUser?.nombre ?? null;
  const [vista, setVista] = useState<Vista>('personal');

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>👥 RRHH · Nómina</h1>
        <p className="hint muted" style={{ margin: '.25rem 0 0' }}>
          Personal, nómina quincenal y administrativo de <strong>{DEF.razonSocial}</strong>. La nómina se paga desde Tesorería.
        </p>
      </div>

      <div className="view-toggle" role="tablist" aria-label="Vista de RRHH" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} className={vista === t.key ? 'active' : ''} onClick={() => setVista(t.key)}>{t.icon} {t.label}</button>
        ))}
      </div>

      {vista === 'personal' && <PersonalTab canWrite={canWrite} actor={actor} actorName={actorName} empresa={EMPRESA} />}
      {vista === 'anticipos' && <AnticiposTab canWrite={canWrite} actor={actor} actorName={actorName} empresa={EMPRESA} />}
      {vista === 'nomina' && <NominaTab canWrite={canWrite} actor={actor} actorName={actorName} empresa={EMPRESA} />}
      {vista === 'vacaciones' && <VacacionesTab canWrite={canWrite} actor={actor} actorName={actorName} empresa={EMPRESA} />}
      {vista === 'administrativo' && <AdministrativoTab canWrite={canWrite} actor={actor} actorName={actorName} empresa={EMPRESA} />}
    </div>
  );
}
