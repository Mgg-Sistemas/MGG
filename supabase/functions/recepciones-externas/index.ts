// MGG · Edge Function: recepciones-externas (PULL SOLO-LECTURA del puente inter-sistema)
// Lee las RECEPCIONES de OTRO sistema (otro Supabase) y devuelve un RESUMEN por centro,
// sin exponer credenciales del otro sistema al navegador. El front la invoca con su JWT:
//   { sistema } → { grupos: [{ id, nombre, nRecepciones, totalKg, netoHumedo, netoSeco }], label, at }
//
// Es de SOLO LECTURA: nunca escribe en el sistema externo (solo SELECT vía PostgREST).
//
// Para conectar otro sistema: agregá su entrada en FUENTES con sus secretos {URL}/{KEY}.
//
// Secrets en MGG (ya usados por `metricas-externas`):
//   GT_URL          → https://<ref-de-golden-touch>.supabase.co
//   GT_SERVICE_KEY  → service_role de Golden Touch (NUNCA viaja al cliente)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Lee filas del sistema externo vía PostgREST (SOLO SELECT). Límite alto para no truncar.
async function getRows<T>(base: string, key: string, path: string): Promise<T[]> {
  const resp = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${resp.status}: ${text}`);
  const data = JSON.parse(text);
  return Array.isArray(data) ? (data as T[]) : [];
}

interface CentroOut { id: string; nombre: string; nRecepciones: number; totalKg: number; netoHumedo: number; netoSeco: number }
interface FilaOut { id: string; item: number; fecha: string; peso_kg: number; procedencia: string; centro: string; nota: string }

// Registro de sistemas externos: etiqueta, secretos (URL + service key) y un ADAPTADOR
// que lee su esquema propio de recepciones (cada sistema puede tener tablas distintas).
const FUENTES: Record<string, {
  label: string; url: () => string | undefined; key: () => string | undefined;
  cargar: (base: string, key: string) => Promise<{ grupos: CentroOut[]; recepciones: FilaOut[] }>;
}> = {
  // Golden Touch: recepción GLOBAL (sin tarjetas/centros). `recepciones_lab` son las
  // recepciones (item, peso, procedencia) y `recepciones_pesadas` trae los netos.
  'golden-touch': {
    label: 'Golden Touch',
    url: () => Deno.env.get('GT_URL'),
    key: () => Deno.env.get('GT_SERVICE_KEY'),
    cargar: async (base, key) => {
      const [lab, pesadas] = await Promise.all([
        getRows<{ item: number; fecha_hora: string; peso_kg: number; procedencia: string; observacion: string | null }>(base, key, 'recepciones_lab?select=item,fecha_hora,peso_kg,procedencia,observacion&order=fecha_hora.desc&limit=100000'),
        getRows<{ neto_humedo: number | null; neto_seco: number | null }>(base, key, 'recepciones_pesadas?select=neto_humedo,neto_seco&limit=100000'),
      ]);
      const recepciones: FilaOut[] = lab.map((r, i) => ({
        id: `lab-${r.item ?? i}`, item: num(r.item), fecha: r.fecha_hora, peso_kg: round2(num(r.peso_kg)),
        procedencia: r.procedencia ?? '', centro: 'Golden Touch', nota: r.observacion ?? '',
      }));
      const totalKg = round2(recepciones.reduce((a, r) => a + r.peso_kg, 0));
      const netoHumedo = round2(pesadas.reduce((a, p) => a + num(p.neto_humedo), 0));
      const netoSeco = round2(pesadas.reduce((a, p) => a + num(p.neto_seco), 0));
      const grupos: CentroOut[] = (recepciones.length || netoHumedo || netoSeco)
        ? [{ id: 'golden-touch', nombre: 'Golden Touch', nRecepciones: recepciones.length, totalKg, netoHumedo, netoSeco }]
        : [];
      return { grupos, recepciones };
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let payload: { sistema?: string };
  try { payload = await req.json(); } catch { return json({ error: 'Body JSON inválido' }, 400); }

  const sistema = String(payload.sistema ?? '').trim() || 'golden-touch';
  const fuente = FUENTES[sistema];
  if (!fuente) return json({ error: `Sistema externo desconocido: ${sistema}` }, 400);

  const url = fuente.url();
  const key = fuente.key();
  if (!url || !key) return json({ error: `El sistema "${sistema}" no está configurado todavía (faltan secretos en el servidor).` }, 503);
  const base = url.replace(/\/+$/, '');

  try {
    const { grupos, recepciones } = await fuente.cargar(base, key);
    return json({ grupos, recepciones, label: fuente.label, sistema, at: new Date().toISOString() });
  } catch (e) {
    return json({ error: `No se pudieron leer las recepciones de "${sistema}": ${String(e)}` }, 502);
  }
});
