let cachedDataUrl: string | null = null;
let cachedFirma: string | null | undefined;
let cachedFirmaSalidas: string | null | undefined;
let cachedFirmaOperaciones: string | null | undefined;

/**
 * Firma de MANUEL PALMA (Supervisor de Operaciones) para el reporte de peso de
 * Recepciones. Lee `public/firma3.png`. Devuelve null si no existe, así el PDF
 * se genera igual (queda la línea + nombre).
 */
export async function loadFirmaOperacionesDataUrl(): Promise<string | null> {
  if (cachedFirmaOperaciones !== undefined) return cachedFirmaOperaciones;
  try {
    const url = `${import.meta.env.BASE_URL}firma3.png`;
    const resp = await fetch(url);
    if (!resp.ok) { cachedFirmaOperaciones = null; return null; }
    const blob = await resp.blob();
    if (!blob.type.startsWith('image/')) { cachedFirmaOperaciones = null; return null; }
    cachedFirmaOperaciones = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('No se pudo leer la firma de operaciones'));
      fr.readAsDataURL(blob);
    });
    return cachedFirmaOperaciones;
  } catch {
    cachedFirmaOperaciones = null;
    return null;
  }
}

/**
 * Firma de LEYDI RENGEL para los PDF de Salidas/Traslados (Orden de Salida), en el
 * bloque "Autorizado por". Lee `public/firma2.jpeg`. Devuelve null si no existe,
 * así el PDF se genera igual. Solo se usa en el módulo de Salidas/Traslados.
 */
export async function loadFirmaSalidasDataUrl(): Promise<string | null> {
  if (cachedFirmaSalidas !== undefined) return cachedFirmaSalidas;
  try {
    const url = `${import.meta.env.BASE_URL}firma2.jpeg`;
    const resp = await fetch(url);
    if (!resp.ok) { cachedFirmaSalidas = null; return null; }
    const blob = await resp.blob();
    if (!blob.type.startsWith('image/')) { cachedFirmaSalidas = null; return null; }
    cachedFirmaSalidas = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('No se pudo leer la firma de salidas'));
      fr.readAsDataURL(blob);
    });
    return cachedFirmaSalidas;
  } catch {
    cachedFirmaSalidas = null;
    return null;
  }
}

/**
 * Firma del Gerente General para los PDF de OC (se coloca al aprobar la orden).
 * Lee `public/firma-gerente.png` (PNG con transparencia). Devuelve null si el
 * archivo no existe todavía, así el PDF se genera igual sin romper.
 */
export async function loadFirmaGerenteDataUrl(): Promise<string | null> {
  if (cachedFirma !== undefined) return cachedFirma;
  try {
    const url = `${import.meta.env.BASE_URL}firma.png`;
    const resp = await fetch(url);
    if (!resp.ok) { cachedFirma = null; return null; }
    const blob = await resp.blob();
    // En dev, un archivo inexistente devuelve el index.html (SPA fallback): filtramos por tipo.
    if (!blob.type.startsWith('image/')) { cachedFirma = null; return null; }
    cachedFirma = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('No se pudo leer la firma'));
      fr.readAsDataURL(blob);
    });
    return cachedFirma;
  } catch {
    cachedFirma = null;
    return null;
  }
}

/**
 * Devuelve el logo de MGG como data URL (JPEG con fondo blanco) para
 * embeberlo en PDFs generados con jsPDF. Cachea el resultado para no refetchar.
 * El fondo oscuro original del JPEG se reemplaza por blanco vía color-key.
 */
export async function loadLogoDataUrl(): Promise<string> {
  if (cachedDataUrl) return cachedDataUrl;
  const url = `${import.meta.env.BASE_URL}image.jpeg`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`No se pudo cargar el logo (${resp.status})`);
  const blob = await resp.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo decodificar el logo'));
      el.src = objectUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || 500;
    canvas.height = img.naturalHeight || 500;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D no disponible');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r < 55 && g < 55 && b < 55) {
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    cachedDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    return cachedDataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
