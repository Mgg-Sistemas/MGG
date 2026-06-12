/* ============================================================
   Stub de desacople — Contratos de Producción (Centro de Acopio)
   El módulo de producción/contratos del sistema original NO existe
   todavía en este sistema. Para mantener el Centro de Acopio como
   módulo standalone (solo parte visual + su propio backend acopio_*),
   esta integración queda desconectada: devuelve una lista vacía.
   Cuando se construya el módulo de contratos, reemplazar este stub
   por el import real `@/modules/produccion/contratos.repository`.
   ============================================================ */
import type { ContratoAcopio } from '@/shared/lib/types';

export async function listContratos(): Promise<ContratoAcopio[]> {
  return [];
}
