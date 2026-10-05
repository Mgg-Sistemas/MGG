/* ============================================================
   MGG · RRHH · Lo que se ve al escanear el QR del carnet (05-10-2026)

   Página PÚBLICA (sin iniciar sesión): el QR del carnet abre
   #/carnet/<id>. Se consulta en vivo `carnet_publico`:
   · persona ACTIVA → sus datos (los mismos que antes iban escritos en el QR);
   · DESACTIVADA o inexistente → directo al logo de la empresa.
   Así un carnet ya impreso deja de valer en cuanto se desactiva a la persona.
   ============================================================ */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/shared/lib/supabase';
import { lineasSaludQR } from './condicionesSalud';
import { carnetVencido, textoVence } from './carnetVence';

interface CarnetPublico {
  activo: boolean;
  nombre?: string | null; apellido?: string | null; cedula?: string | null;
  cargo?: string | null; departamento?: string | null; telefono?: string | null;
  grupo_sanguineo?: string | null;
  contacto_emergencia?: string | null; contacto_emergencia_tlf?: string | null;
  tiene_alergias?: boolean | null; alergias_detalle?: string | null;
  tiene_enfermedad?: boolean | null; enfermedad_detalle?: string | null;
  carnet_vence?: string | null;
}

/** El logo de la empresa (el mismo de los PDF). */
const urlLogo = () => new URL(`${import.meta.env.BASE_URL}image.jpeg`, window.location.origin).toString();

export function CarnetPublicoPage() {
  const { id = '' } = useParams();
  const [datos, setDatos] = useState<CarnetPublico | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vivo = true;
    const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!esUuid) { window.location.replace(urlLogo()); return; }
    supabase.rpc('carnet_publico', { p_id: id }).then(({ data, error: e }) => {
      if (!vivo) return;
      if (e) { setError(true); return; }
      const d = data as CarnetPublico | null;
      // Desactivado o inexistente: directo al logo de la empresa.
      if (!d?.activo) { window.location.replace(urlLogo()); return; }
      setDatos(d);
    });
    return () => { vivo = false; };
  }, [id]);

  const fondo: React.CSSProperties = {
    minHeight: '100vh', background: '#14110d', color: '#f4efe6', fontFamily: 'system-ui, sans-serif',
    display: 'flex', justifyContent: 'center', padding: '24px 16px',
  };
  if (error) return <div style={fondo}><p>No se pudo verificar el carnet. Revisá la conexión e intentá de nuevo.</p></div>;
  if (!datos) return <div style={fondo}><p style={{ opacity: 0.7 }}>Verificando carnet…</p></div>;

  const nombre = `${datos.nombre ?? ''} ${datos.apellido ?? ''}`.trim();
  const vencido = carnetVencido(datos.carnet_vence);
  const salud = lineasSaludQR(datos);
  const emerg = [datos.contacto_emergencia, datos.contacto_emergencia_tlf].filter(Boolean).join(' · ');
  const filas: [string, string | null | undefined][] = [
    ['Cédula', datos.cedula],
    ['Cargo', datos.cargo],
    ['Departamento', datos.departamento],
    ['Teléfono', datos.telefono],
    ['Grupo sanguíneo', datos.grupo_sanguineo],
    ['Emergencia', emerg],
    ['Vigencia', textoVence(datos.carnet_vence)],
  ];

  return (
    <div style={fondo}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <img src={urlLogo()} alt="" style={{ width: 52, height: 52, borderRadius: 10, objectFit: 'cover' }} />
          <div>
            <div style={{ fontWeight: 800, color: '#e0a64a', letterSpacing: '.02em' }}>MINERAL GROUP GUAYANA C.A.</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Carnet de identificación · verificado en línea</div>
          </div>
        </div>
        <div style={{
          padding: '10px 12px', borderRadius: 10, marginBottom: 14, fontWeight: 700, fontSize: 14,
          background: vencido ? 'rgba(220,60,60,.18)' : 'rgba(60,180,100,.18)',
          border: `1px solid ${vencido ? '#dc3c3c' : '#3cb464'}`,
        }}>
          {vencido ? `⚠ CARNET VENCIDO desde el ${textoVence(datos.carnet_vence)}` : '✓ Trabajador activo · carnet vigente'}
        </div>
        <h1 style={{ fontSize: 24, margin: '0 0 12px', lineHeight: 1.2 }}>{nombre || '—'}</h1>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', fontSize: 15 }}>
          {filas.filter(([, v]) => v).map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt style={{ opacity: 0.65 }}>{k}</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd>
            </div>
          ))}
        </dl>
        {salud.length > 0 && (
          <div style={{ marginTop: 16, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,138,0,.14)', border: '1px solid #ff8a00' }}>
            {salud.map((l) => <div key={l} style={{ fontWeight: 700 }}>{l}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
