/* ============================================================
   MGG · Chat interno por Orden de Compra (puente de compatibilidad)
   Delega en ChatOrden con el nuevo diseño Linear/Slack y formato rico.
   ============================================================ */
import { ChatOrden } from './ChatOrden';

export function ChatOC({
  ordenId,
  ordenCodigo,
  autorEmail,
  autorNombre,
  personaMap,
}: {
  ordenId: string;
  ordenCodigo: string;
  userId?: string;
  autorEmail: string;
  autorNombre: string;
  personaMap?: Map<string, string>;
}) {
  const nombre = autorNombre || (autorEmail ? personaMap?.get(autorEmail.toLowerCase()) : '') || autorEmail || 'Usuario';
  return (
    <div style={{ marginTop: '1.25rem' }}>
      <ChatOrden
        ordenId={ordenId}
        ordenLabel={ordenCodigo}
        autorNombre={nombre}
        contextoModulo="compras"
      />
    </div>
  );
}
