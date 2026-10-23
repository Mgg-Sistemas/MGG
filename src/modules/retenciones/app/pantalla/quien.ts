import type { RetencionPracticada } from '../datos/puerta';

/** «por Ana Pérez · 10/10 12:16» (o «anuló · …» si está anulada), como en la maqueta. */
export function quienYCuando(r: Pick<RetencionPracticada, 'actorName' | 'createdAt' | 'anulada'>): string {
  const d = r.createdAt ? new Date(r.createdAt) : null;
  const cuando = d && !Number.isNaN(d.getTime())
    ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : '';
  const quien = r.actorName ? `por ${r.actorName}` : '';
  return [r.anulada ? 'anulada' : '', quien, cuando].filter(Boolean).join(' · ');
}
