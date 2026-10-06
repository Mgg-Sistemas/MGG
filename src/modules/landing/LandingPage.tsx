import { Link } from 'react-router-dom';

export function LandingPage() {
  function scrollTo(id: string) {
    return (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }

  return (
    <div className="landing">
      <header className="landing-nav">
        <Link to="/" className="brand">
          <img src="/image.jpeg" alt="MGG" />
          <div className="brand-text">
            <strong>MGG</strong>
            <small>Mineral Group Guayana</small>
          </div>
        </Link>
        <nav>
          <a href="#empresa" onClick={scrollTo('empresa')}>Empresa</a>
          <a href="#productos" onClick={scrollTo('productos')}>Productos</a>
          <a href="#operaciones" onClick={scrollTo('operaciones')}>Operaciones</a>
          <a href="#contacto" onClick={scrollTo('contacto')}>Contacto</a>
        </nav>
        <Link to="/login" className="btn btn-primary btn-sm">Ingresar</Link>
      </header>

      <section className="hero">
        <div>
          <span className="hero-eyebrow">⬢ Mineral Group Guayana C.A.</span>
          <h1>
            Empresa líder en la <span className="grad">comercialización y exportación</span> de
            minerales.
          </h1>
          <p className="lead">
            Conectamos la minería guayanesa con mercados internacionales. Comercialización
            y exportación de casiterita, niobio y tantalio en estado mineral, con respaldo
            de la Corporación Venezolana de Minería.
          </p>
          <div className="hero-actions">
            <Link to="/login" className="btn btn-primary">Acceder al sistema →</Link>
            <a href="#contacto" onClick={scrollTo('contacto')} className="btn btn-ghost">Contáctanos</a>
          </div>
        </div>
        <div className="hero-visual">
          <img src="/image.jpeg" alt="Logo MGG" />
        </div>
      </section>

      {/* ───────────── Empresa ───────────── */}
      <section id="empresa" className="section">
        <div className="section-head">
          <div className="eyebrow">Empresa</div>
          <h2>Quiénes somos</h2>
          <p>
            Empresa líder en la comercialización y exportación de minerales estratégicos,
            experta en casiterita (óxido de estaño). Fundada en 2022 en Ciudad Guayana,
            Estado Bolívar, Venezuela. Operamos bajo alianza estratégica con la Corporación
            Venezolana de Minería (CVM), convenio CVM-CM-026-2022 del 3 de octubre de 2022.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1rem',
            maxWidth: 900,
            margin: '0 auto 2rem',
          }}
        >
          <article className="feature">
            <div className="icon">◎</div>
            <h3>Misión</h3>
            <p>
              Ser una empresa líder y competitiva en la comercialización de minerales
              estratégicos a nivel nacional e internacional con excelencia y aporte al
              crecimiento económico de Venezuela.
            </p>
          </article>
          <article className="feature">
            <div className="icon">✦</div>
            <h3>Visión</h3>
            <p>
              Contribuir al crecimiento económico y transformación social a través de la
              comercialización y fundición para obtener lingotes de estaño y abastecer
              el mercado nacional e internacional, garantizando el suministro a largo plazo.
            </p>
          </article>
        </div>

        <div
          style={{
            maxWidth: 900,
            margin: '0 auto',
            borderRadius: 'var(--r-lg)',
            overflow: 'hidden',
            border: '1px solid var(--border)',
          }}
        >
          <img
            src="https://plus.unsplash.com/premium_photo-1682142162574-b304bacbdc3f?fm=jpg&q=70&w=1400&auto=format&fit=crop"
            alt="Operaciones mineras de Mineral Group Guayana"
            style={{ width: '100%', height: 320, objectFit: 'cover', display: 'block' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      </section>

      {/* ───────────── Productos ───────────── */}
      <section id="productos" className="section">
        <div className="section-head">
          <div className="eyebrow">Nuestros minerales</div>
          <h2>Tres elementos estratégicos para la industria global</h2>
        </div>
        <div className="feature-grid">
          <article className="feature">
            <div className="icon">Sn</div>
            <h3>Casiterita · SnO₂</h3>
            <p>
              Óxido de estaño usado en hojalata, latas y envases, además de catalizadores,
              sensores de gases y celdas fotovoltaicas en aplicaciones tecnológicas.
            </p>
          </article>
          <article className="feature">
            <div className="icon">Nb</div>
            <h3>Niobio</h3>
            <p>
              Elemento estratégico para aceros de alta resistencia, superaleaciones y
              componentes superconductores. Demandado por industria aeroespacial y energética.
            </p>
          </article>
          <article className="feature">
            <div className="icon">Ta</div>
            <h3>Tantalio</h3>
            <p>
              Mineral crítico para condensadores electrónicos de alta capacidad, dispositivos
              médicos e implantes biocompatibles, además de aleaciones especiales.
            </p>
          </article>
        </div>
      </section>

      {/* ───────────── Operaciones ───────────── */}
      <section id="operaciones" className="section">
        <div className="section-head">
          <div className="eyebrow">Operaciones</div>
          <h2>Cifras que respaldan nuestra trayectoria</h2>
          <p>Desde nuestra primera exportación a China en marzo de 2023.</p>
        </div>

        <div
          style={{
            maxWidth: 1100,
            margin: '0 auto 2rem',
            borderRadius: 'var(--r-lg)',
            overflow: 'hidden',
            border: '1px solid var(--border)',
          }}
        >
          <img
            src="https://plus.unsplash.com/premium_photo-1681823926223-fc54d0c3b153?fm=jpg&q=70&w=1600&auto=format&fit=crop"
            alt="Equipo colaborando en operaciones"
            style={{ width: '100%', height: 280, objectFit: 'cover', display: 'block' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>

        <div className="feature-grid centered-last" style={{ gridTemplateColumns: 'repeat(2, 1fr)', maxWidth: 760, margin: '0 auto' }}>
          <article className="feature">
            <div className="icon">5</div>
            <h3>Centros de acopio</h3>
            <p>Centros autorizados por CVM distribuidos en el Estado Bolívar.</p>
          </article>
          <article className="feature">
            <div className="icon">49</div>
            <h3>Exportaciones</h3>
            <p>Exportaciones realizadas entre 2023 y 2024 hacia mercados internacionales.</p>
          </article>
          <article className="feature">
            <div className="icon">1.578</div>
            <h3>Toneladas métricas</h3>
            <p>Volumen total comercializado de óxido de estaño certificado.</p>
          </article>
          <article className="feature">
            <div className="icon">75</div>
            <h3>Clientes</h3>
            <p>Aliados comerciales nacionales e internacionales activos.</p>
          </article>
          <article className="feature">
            <div className="icon">61</div>
            <h3>Contenedores</h3>
            <p>Contenedores exportados al exterior con certificación de origen.</p>
          </article>
        </div>
      </section>

      {/* ───────────── Capacidades ───────────── */}
      <section className="section">
        <div className="section-head">
          <div className="eyebrow">Cómo trabajamos</div>
          <h2>Proceso integral con trazabilidad total</h2>
        </div>
        <div className="feature-grid">
          <article className="feature">
            <div className="icon">⌖</div>
            <h3>Recepción y verificación</h3>
            <p>Verificación de origen del material en cada centro de acopio autorizado.</p>
          </article>
          <article className="feature">
            <div className="icon">⚗</div>
            <h3>Laboratorio interno</h3>
            <p>Ensayos de laboratorio propios y alianza con empresa global de certificación.</p>
          </article>
          <article className="feature">
            <div className="icon">⬢</div>
            <h3>Homogenización y empaque</h3>
            <p>Procesos de homogenización y empaque en sacos de 1.350 kg para exportación.</p>
          </article>
        </div>
      </section>

      {/* ───────────── Contacto ───────────── */}
      <section id="contacto" className="section">
        <div className="section-head">
          <div className="eyebrow">Contacto</div>
          <h2>Contáctanos</h2>
          <p>Estamos disponibles para clientes, aliados estratégicos y proveedores.</p>
        </div>
        <div className="feature-grid cols-2 centered-last">
          <article className="feature">
            <div className="icon">✆</div>
            <h3>Teléfono</h3>
            <p>
              <a href="tel:+584249349731" style={{ color: 'inherit' }}>
                0424 934 9731
              </a>
            </p>
          </article>
          <article className="feature">
            <div className="icon">⌖</div>
            <h3>Ubicación</h3>
            <p>Calle Manzana 03 Parcela 15, Urb. Villa Betania, Puerto Ordaz, Estado Bolívar.</p>
          </article>
          <article className="feature">
            <div className="icon">⎙</div>
            <h3>RIF</h3>
            <p className="mono">J-50221930-7</p>
          </article>
        </div>

        {/* Redes y contacto directo · abren la app correspondiente (correo / Instagram) */}
        <SocialLinks />
      </section>

      <section className="cta">
        <h2>Sistema de gestión interna</h2>
        <p>Acceso al sistema operativo de inventarios y compras de MGG.</p>
        <Link to="/login" className="btn btn-primary">Ingresar al sistema</Link>
      </section>

      <footer className="landing-footer">
        <SocialLinks compact />
        <div style={{ marginTop: '.75rem' }}>
          © {new Date().getFullYear()} Mineral Group Guayana C.A. · Puerto Ordaz, Estado Bolívar · RIF J-50221930-7
        </div>
      </footer>

      <WhatsAppFab numero="584249349731" mensaje="Hola, escribo desde la página de Mineral Group Guayana." />
    </div>
  );
}

/** Logo de Instagram (degradado oficial). */
function InstagramIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <radialGradient id="igGrad" cx="0.3" cy="1" r="1">
          <stop offset="0" stopColor="#fdf497" />
          <stop offset="0.05" stopColor="#fdf497" />
          <stop offset="0.45" stopColor="#fd5949" />
          <stop offset="0.6" stopColor="#d6249f" />
          <stop offset="0.9" stopColor="#285AEB" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#igGrad)" />
      <circle cx="16" cy="16" r="6" fill="none" stroke="#fff" strokeWidth="2" />
      <circle cx="23" cy="9" r="1.6" fill="#fff" />
      <rect x="7" y="7" width="18" height="18" rx="6" fill="none" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

/** Ícono de correo (sobre). */
function MailIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="2" width="28" height="28" rx="8" fill="#ff8a00" />
      <path d="M8 11h16v10H8z" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <path d="M8 12l8 6 8-6" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Barra de redes sociales con enlaces directos:
 *  - Instagram: abre la app en celular (deep-link https) o el navegador en PC.
 *  - Correo: `mailto:` abre la app de correo en celular y PC.
 */
function SocialLinks({ compact = false }: { compact?: boolean }) {
  const linkStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '.5rem',
    textDecoration: 'none',
    color: 'inherit',
    padding: '.4rem .7rem',
    borderRadius: 'var(--r-md)',
    border: '1px solid var(--border)',
    transition: 'transform .15s ease',
  };
  return (
    <div
      style={{
        display: 'flex',
        gap: '.75rem',
        justifyContent: 'center',
        flexWrap: 'wrap',
        marginTop: compact ? 0 : '1.5rem',
      }}
    >
      <a
        href="https://www.instagram.com/mineralgroupguayana/"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Instagram de Mineral Group Guayana"
        title="Síguenos en Instagram"
        style={linkStyle}
        onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
      >
        <InstagramIcon size={compact ? 28 : 32} />
        {!compact && <span>@mineralgroupguayana</span>}
      </a>
      <a
        href="mailto:info@mineralgroupguayana.com"
        aria-label="Escríbenos por correo"
        title="Escríbenos por correo"
        style={linkStyle}
        onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
      >
        <MailIcon size={compact ? 28 : 32} />
        {!compact && <span>info@mineralgroupguayana.com</span>}
      </a>
    </div>
  );
}

interface WhatsAppFabProps {
  /** Número en formato internacional sin '+' ni espacios. */
  numero: string;
  mensaje?: string;
}

function WhatsAppFab({ numero, mensaje }: WhatsAppFabProps) {
  function abrir() {
    const ua = navigator.userAgent;
    const esMovil = /Android|iPhone|iPad|iPod/i.test(ua);
    const text = encodeURIComponent(mensaje ?? '');
    // En móvil: esquema wa.me abre la app si está instalada y cae al navegador si no.
    // En PC: api.whatsapp.com abre WhatsApp Web con la opción "Abrir en aplicación".
    const url = esMovil
      ? `https://wa.me/${numero}${text ? `?text=${text}` : ''}`
      : `https://api.whatsapp.com/send?phone=${numero}${text ? `&text=${text}` : ''}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <button
      type="button"
      onClick={abrir}
      aria-label="Contactarnos por WhatsApp"
      title="Escribinos por WhatsApp"
      style={{
        position: 'fixed',
        right: '1.25rem',
        bottom: '1.25rem',
        width: 60,
        height: 60,
        borderRadius: '50%',
        background: '#25D366',
        color: '#fff',
        border: 'none',
        boxShadow: '0 10px 30px rgba(37,211,102,.45), 0 4px 10px rgba(0,0,0,.18)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        transition: 'transform .15s ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
    >
      <svg viewBox="0 0 32 32" width="30" height="30" fill="currentColor" aria-hidden="true">
        <path d="M19.11 17.42c-.27-.13-1.6-.79-1.85-.88-.25-.09-.43-.13-.6.13-.18.27-.69.88-.85 1.06-.16.18-.31.2-.58.07-.27-.13-1.13-.42-2.16-1.33-.8-.71-1.34-1.59-1.49-1.86-.16-.27-.02-.42.12-.55.12-.12.27-.31.4-.47.13-.16.18-.27.27-.45.09-.18.04-.34-.02-.47-.06-.13-.6-1.45-.83-1.98-.22-.52-.44-.45-.6-.46-.16 0-.34 0-.52 0-.18 0-.47.07-.72.34-.25.27-.94.92-.94 2.25 0 1.33.96 2.61 1.09 2.79.13.18 1.89 2.89 4.59 3.94.64.28 1.14.44 1.53.56.64.2 1.22.18 1.68.11.51-.08 1.6-.65 1.83-1.28.23-.63.23-1.16.16-1.28-.07-.11-.25-.18-.52-.31zM16 4C9.37 4 4 9.37 4 16c0 2.26.63 4.38 1.74 6.18L4 28l5.99-1.7C11.74 27.4 13.83 28 16 28c6.63 0 12-5.37 12-12S22.63 4 16 4zm0 22c-1.93 0-3.73-.57-5.24-1.55l-.37-.23-3.55 1 .95-3.43-.23-.36C6.55 19.83 6 17.97 6 16c0-5.51 4.49-10 10-10s10 4.49 10 10-4.49 10-10 10z" />
      </svg>
    </button>
  );
}
