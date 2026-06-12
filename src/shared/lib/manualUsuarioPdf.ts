/* ============================================================
   MGG · Manual de Usuario (PDF)
   Genera un PDF descargable que explica, pantalla por pantalla,
   cómo usar el sistema de gestión de Mineral Group Guayana.
   Se descarga SOLO cuando el usuario hace clic en el menú.
   ============================================================ */
import { dateTime } from '@/shared/lib/format';
import { loadLogoDataUrl } from '@/shared/lib/pdfLogo';

const NARANJA: [number, number, number] = [255, 138, 0];
const GRIS_TEXTO: [number, number, number] = [60, 60, 60];

interface Seccion {
  /** Ícono tal como aparece en el menú (decorativo). */
  icono: string;
  titulo: string;
  /** Clave de captura: coincide con la vista capturada en vivo (o null si no aplica). */
  captura?: string;
  /** Párrafo introductorio: ¿para qué sirve la pantalla? */
  intro: string;
  /** Funcionalidades concretas, en lenguaje sencillo. */
  puntos: string[];
}

/** Una captura de pantalla embebida (PNG) con sus dimensiones reales. */
export interface CapturaManual {
  dataUrl: string;
  w: number;
  h: number;
}

export type CapturasManual = Record<string, CapturaManual>;

/** Contenido del manual: una entrada por pantalla del sistema. */
const SECCIONES: Seccion[] = [
  {
    icono: '🔐',
    titulo: 'Inicio de sesión',
    intro:
      'Es la primera pantalla que ves al abrir el sistema. Sirve para identificarte y proteger la información de la empresa: solo las personas autorizadas pueden entrar.',
    puntos: [
      'Escribí tu correo electrónico y tu contraseña, y presioná "Ingresar".',
      'Si los datos son correctos, el sistema te lleva al tablero principal (Dashboard).',
      'Cada usuario ve únicamente los módulos que su rol tiene permitidos.',
      'Para salir de forma segura usá el botón de cerrar sesión (⎋), abajo a la izquierda.',
    ],
  },
  {
    icono: '🧭',
    titulo: 'Cómo está organizado el sistema',
    intro:
      'Todas las pantallas comparten la misma estructura, para que siempre sepas dónde estás parado.',
    puntos: [
      'Menú lateral (izquierda): es el índice del sistema. Está dividido en "Operación" (el trabajo del día a día) y "Sistema" (configuración).',
      'Podés ocultar o mostrar el menú con el botón ☰ de la barra superior para tener más espacio.',
      'Barra superior: contiene el buscador general y la campana de notificaciones.',
      'Buscador general: escribí cualquier producto, proveedor u orden y el sistema lo encuentra en todo el sistema; al hacer clic en un resultado te lleva directo a su detalle.',
      'Campana de notificaciones (◔): te avisa, por ejemplo, cuando un producto está por agotarse. El número rojo indica cuántos avisos sin leer tenés.',
    ],
  },
  {
    icono: '▦',
    titulo: 'Dashboard (Tablero principal)',
    captura: 'dashboard',
    intro:
      'Es el resumen general de la empresa. De un vistazo muestra cómo está el inventario y la actividad reciente, sin tener que entrar a cada módulo.',
    puntos: [
      'Tarjetas con los indicadores clave: valor del inventario, cantidad de productos, alertas de stock bajo, entre otros.',
      'Gráficos que muestran la evolución y la composición del inventario.',
      'Lista de "Movimientos recientes": las últimas entradas, salidas y ajustes registrados.',
      'Al hacer clic en un movimiento se abre el detalle del producto involucrado.',
    ],
  },
  {
    icono: '⬢',
    titulo: 'Inventario',
    captura: 'inventario',
    intro:
      'Es el corazón del sistema: el listado de todos los materiales y productos, con su stock, costo y ubicación. Desde aquí se crean productos, se registran movimientos y se administran los almacenes.',
    puntos: [
      'Listado de productos con su SKU (código), nombre, categoría, stock y estado.',
      'Nuevo producto: al crearlo, el SKU se genera solo y de forma correlativa según la categoría (por ejemplo LUB-001, LUB-002 para Lubricantes). No hace falta inventarlo a mano.',
      'Cada producto guarda su stock por almacén y su costo promedio ponderado (PMP), que se actualiza automáticamente con cada compra o entrada.',
      'Movimientos: se pueden registrar entradas, salidas, transferencias y ajustes; el sistema lleva el historial completo (kardex) de cada producto.',
      'Detalle del producto: muestra su ficha completa y todos sus movimientos; permite descargar su trazabilidad en PDF.',
      'Alertas de stock: el sistema marca en rojo los productos por debajo del mínimo para que sepas qué reponer.',
      'Almacenes: se pueden ver en formato lista o en tarjetas (kanban) con totales de productos, productos usados y consumo diario.',
      'Exportar: se pueden descargar los productos de cada almacén en Excel o PDF, e importar productos masivamente desde un Excel.',
    ],
  },
  {
    icono: '✉',
    titulo: 'Pedidos / Compras',
    captura: 'pedidos',
    intro:
      'Aquí se gestiona todo el ciclo de compra: desde que se pide un material hasta que se recibe. También deja un registro ordenado (trazabilidad) de cada paso.',
    puntos: [
      'Orden de pedido: es la solicitud interna de lo que se necesita. Al crearla se indica su clasificación: Fundición, Bienes o Servicios.',
      'Realizar OC (Orden de Compra): convierte el pedido en una compra a un proveedor. Antes de emitirla se eligen los documentos que la acompañan: Nota de entrega y/o Nota de despacho.',
      'Recepción: cuando llega la mercadería se registra la entrada, y el inventario se actualiza solo con su costo.',
      'Trazabilidad: cada orden tiene una línea de tiempo con todo lo que ocurrió (creación, emisión, documentos, recepción, etc.).',
      'Si un proveedor desiste, se registra la fecha, la hora y el motivo; eso queda reflejado en el PDF de la orden.',
      'Todas las órdenes se pueden descargar en PDF (orden de compra y trazabilidad).',
    ],
  },
  {
    icono: '⚒',
    titulo: 'Proveedores',
    captura: 'proveedores',
    intro:
      'Es el directorio de proveedores de la empresa y la herramienta para comparar sus ofertas y elegir la mejor de forma objetiva.',
    puntos: [
      'Registro de cada proveedor con sus datos de contacto.',
      'Comparación de ofertas: el sistema ayuda a elegir la mejor opción combinando criterios (precio, tiempo de entrega, condiciones y otros).',
      'Detalle de cada proveedor con su historial.',
      'Desde el buscador general o desde una orden se puede llegar directo a la ficha del proveedor.',
    ],
  },
  {
    icono: '🔥',
    titulo: 'Fundición',
    captura: 'produccion',
    intro:
      'Gestiona la fabricación o fundición de productos a partir de materiales del inventario, usando "recetas" que indican qué insumos y en qué cantidad se necesitan.',
    puntos: [
      'Recetas: definen los materiales que consume cada producto que se fabrica; al producir, el sistema descuenta esos insumos del inventario.',
      'Vista kanban: muestra las producciones en proceso y las últimas finalizadas.',
      'Cada fundición registra el horno utilizado y la cantidad producida.',
      'Se puede descargar la receta/fundición en Excel, con el encabezado naranja característico del sistema.',
    ],
  },
  {
    icono: '↘',
    titulo: 'Salidas / Traslados',
    captura: 'salidas',
    intro:
      'Controla la salida de cosas de la empresa y los movimientos internos. Tiene un interruptor superior para elegir entre Salidas y Traslados, y un segundo interruptor entre Material y Dinero.',
    puntos: [
      'Salida de material: despacha un producto desde un almacén hacia un destino. El sistema no permite sacar más de lo que hay en stock y descuenta el inventario automáticamente.',
      'Traslado de material: mueve productos de un almacén a otro, conservando su costo (PMP).',
      '"A quién va dirigido": es un interruptor: si elegís Almacén se despliegan los almacenes registrados (más "Consumo Interno"); si elegís Persona se despliega la lista de usuarios (nombre, apellido y cargo).',
      'Salida de dinero: es un adelanto que sale de una caja (en USD o Bs) y queda en estado "pendiente".',
      'Conciliación con mineral: la salida de dinero pendiente se "casa" después con la recepción del mineral equivalente (cantidad, costo por KG/G y descripción), que ingresa al inventario.',
      'Traslado de dinero: mueve saldo entre cajas de la misma moneda.',
      'Cajas: se administran desde el botón de cajas (crear, renombrar, habilitar/deshabilitar y ajustar saldo).',
      'Cada salida queda en un historial; al hacer clic se ve su detalle, con opción de PDF y trazabilidad. El PDF se genera solo cuando lo pedís con el botón.',
    ],
  },
  {
    icono: '👤',
    titulo: 'Usuarios',
    captura: 'usuarios',
    intro:
      'Permite administrar las personas que usan el sistema y, sobre todo, qué puede hacer cada una. (Disponible para perfiles administradores.)',
    puntos: [
      'Alta y edición de usuarios con su nombre, cargo y departamento.',
      'Roles y permisos: se define, por rol, a qué módulos puede entrar cada persona y si puede solo ver o también modificar.',
      'Cambio de clave de los usuarios.',
      'Esto garantiza que cada quien acceda solo a lo que le corresponde.',
    ],
  },
  {
    icono: '⚙',
    titulo: 'Ajustes',
    captura: 'ajustes',
    intro:
      'Es tu espacio personal de configuración dentro del sistema.',
    puntos: [
      'Perfil: revisá y actualizá tus datos.',
      'Preferencias: ajustá opciones de tu cuenta.',
      'Cambiar tu contraseña de forma segura.',
    ],
  },
  {
    icono: '📘',
    titulo: 'Menú de Usuario',
    intro:
      'Es el acceso a este manual. Al hacer clic, el sistema genera y descarga este documento en PDF para que puedas consultarlo o imprimirlo cuando lo necesites.',
    puntos: [
      'El manual se descarga únicamente cuando vos lo pedís con el clic; no se envía ni se descarga solo.',
      'Podés volver a descargarlo siempre que quieras; reflejará las pantallas disponibles del sistema.',
    ],
  },
];

const CONSEJOS: string[] = [
  'Si no ves un módulo en el menú, es porque tu rol no tiene permiso para entrar; pedíselo a un administrador.',
  'Usá el buscador de la barra superior para llegar rápido a cualquier producto, proveedor u orden.',
  'Revisá la campana de notificaciones: te avisa cuando un material está por agotarse.',
  'Los reportes en PDF y Excel siempre se descargan con un botón; nada se descarga ni se envía por correo de forma automática.',
  'Ante cualquier duda, cerrá sesión con el botón ⎋ y volvé a ingresar; tus datos quedan guardados.',
];

export async function descargarManualUsuario(capturas: CapturasManual = {}): Promise<void> {
  const [logoDataUrl, { jsPDF }] = await Promise.all([
    loadLogoDataUrl().catch(() => null),
    import('jspdf'),
  ]);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const MARGIN = 42.52; // 1,5 cm (margen uniforme en todos los lados)
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const BOTTOM = PAGE_H - 54;
  let y = MARGIN;

  // Asegura espacio vertical; si no entra, agrega página nueva.
  function ensure(h: number) {
    if (y + h > BOTTOM) {
      doc.addPage();
      y = MARGIN;
    }
  }

  function texto(t: string, size: number, style: 'normal' | 'bold' | 'italic', color = GRIS_TEXTO, lineGap = 4) {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(t, CONTENT_W) as string[];
    for (const line of lines) {
      ensure(size + lineGap);
      doc.text(line, MARGIN, y);
      y += size + lineGap;
    }
  }

  function bullet(t: string) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(GRIS_TEXTO[0], GRIS_TEXTO[1], GRIS_TEXTO[2]);
    const lines = doc.splitTextToSize(t, CONTENT_W - 16) as string[];
    lines.forEach((line, i) => {
      ensure(14);
      if (i === 0) {
        doc.setTextColor(NARANJA[0], NARANJA[1], NARANJA[2]);
        doc.text('•', MARGIN + 2, y);
        doc.setTextColor(GRIS_TEXTO[0], GRIS_TEXTO[1], GRIS_TEXTO[2]);
      }
      doc.text(line, MARGIN + 16, y);
      y += 14;
    });
    y += 2;
  }

  // Embebe una captura de pantalla, escalada al ancho de contenido, con marco
  // y leyenda. Salta de página si no entra completa.
  function captura(cap: CapturaManual, leyenda: string) {
    const ratio = cap.h > 0 ? cap.h / cap.w : 0.6;
    let w = CONTENT_W;
    let h = w * ratio;
    const MAX_H = 380; // no más de ~media página, para que respire
    if (h > MAX_H) { h = MAX_H; w = h / ratio; }
    const x = MARGIN + (CONTENT_W - w) / 2;

    ensure(h + 22);
    try {
      doc.addImage(cap.dataUrl, 'JPEG', x, y, w, h);
      doc.setDrawColor(210, 210, 210);
      doc.setLineWidth(0.8);
      doc.rect(x, y, w, h);
    } catch { /* si la imagen falla, seguimos con el texto */ }
    y += h + 4;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(140, 140, 140);
    doc.text(leyenda, PAGE_W / 2, y + 8, { align: 'center' });
    y += 20;
  }

  // ───────── Portada / bienvenida ─────────
  const LOGO = 92;
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'JPEG', (PAGE_W - LOGO) / 2, y, LOGO, LOGO); } catch { /* logo opcional */ }
  }
  y += LOGO + 30;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(NARANJA[0], NARANJA[1], NARANJA[2]);
  doc.text('Manual de Usuario', PAGE_W / 2, y, { align: 'center' });
  y += 26;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(GRIS_TEXTO[0], GRIS_TEXTO[1], GRIS_TEXTO[2]);
  doc.text('Sistema de Gestión · Mineral Group Guayana C.A.', PAGE_W / 2, y, { align: 'center' });
  y += 40;

  // Mensaje de bienvenida (recuadro).
  const bienvenida = 'Bienvenido al manual de usuario del sistema de gestión de la empresa Mineral Group Guayana.';
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(13);
  const bLines = doc.splitTextToSize(bienvenida, CONTENT_W - 40) as string[];
  const boxH = bLines.length * 20 + 28;
  doc.setFillColor(255, 244, 230);
  doc.setDrawColor(NARANJA[0], NARANJA[1], NARANJA[2]);
  doc.setLineWidth(1);
  doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 8, 8, 'FD');
  doc.setTextColor(120, 70, 0);
  let by = y + 24;
  bLines.forEach((line) => {
    doc.text(line, PAGE_W / 2, by, { align: 'center' });
    by += 20;
  });
  y += boxH + 36;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(GRIS_TEXTO[0], GRIS_TEXTO[1], GRIS_TEXTO[2]);
  const presentacion =
    'Este documento explica, pantalla por pantalla, cómo usar el sistema de manera sencilla. ' +
    'Si recién empezás, te recomendamos leerlo en orden; si ya lo conocés, podés ir directo a la sección que necesites. ' +
    'Recordá que cada usuario ve solo los módulos que su rol tiene habilitados, por lo que es posible que algunas pantallas no aparezcan en tu menú.';
  const pLines = doc.splitTextToSize(presentacion, CONTENT_W) as string[];
  pLines.forEach((line) => {
    doc.text(line, MARGIN, y);
    y += 16;
  });

  doc.setFontSize(9);
  doc.setTextColor(140, 140, 140);
  doc.text(`Generado el ${dateTime(new Date().toISOString())}`, MARGIN, BOTTOM);

  // ───────── Secciones por pantalla ─────────
  doc.addPage();
  y = MARGIN;

  SECCIONES.forEach((s, idx) => {
    // Título de sección con barra naranja a la izquierda.
    ensure(46);
    const headH = 26;
    doc.setFillColor(NARANJA[0], NARANJA[1], NARANJA[2]);
    doc.rect(MARGIN, y, 4, headH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(30, 30, 30);
    doc.text(`${idx + 1}. ${s.icono}  ${s.titulo}`, MARGIN + 14, y + 18);
    y += headH + 8;

    texto(s.intro, 10.5, 'normal');
    y += 4;

    // Captura de pantalla de la vista (si se pudo tomar en vivo).
    const cap = s.captura ? capturas[s.captura] : undefined;
    if (cap) captura(cap, `Vista de “${s.titulo}”`);

    s.puntos.forEach((p) => bullet(p));
    y += 14;
  });

  // ───────── Consejos finales ─────────
  ensure(46);
  doc.setFillColor(NARANJA[0], NARANJA[1], NARANJA[2]);
  doc.rect(MARGIN, y, 4, 26, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(30, 30, 30);
  doc.text('Consejos rápidos', MARGIN + 14, y + 18);
  y += 34;
  CONSEJOS.forEach((c) => bullet(c));

  // ───────── Pie de página con numeración ─────────
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('Mineral Group Guayana C.A. · Manual de Usuario', MARGIN, PAGE_H - 28);
    doc.text(`Página ${i} de ${total}`, PAGE_W - MARGIN, PAGE_H - 28, { align: 'right' });
  }

  doc.save('Manual-de-Usuario-MGG.pdf');
}
