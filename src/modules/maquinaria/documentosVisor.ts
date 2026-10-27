/* ============================================================
   Golden Touch · Control de Maquinaria · Ver documentos del equipo
   Abre un documento (o directo el informe técnico) en el visor del
   sistema con su enlace temporal, como la ventana 📎 Documentos.
   ============================================================ */
import { toast } from '@/shared/ui/Toast';
import { previewArchivo } from '@/shared/lib/reportePreview';
import { mensajeError } from '@/shared/lib/errores';
import { listDocumentosEquipo, urlDocumentoEquipo, type DocumentoEquipo } from './maquinariaDocumentos.repository';
import { nombreDescargaDocumento } from './maquinariaDocumentos';
import { documentoInforme } from './flotaDetalle';

/** Abre el documento en el visor del sistema con su enlace temporal (10 min). */
export async function verDocumentoEquipo(doc: Pick<DocumentoEquipo, 'path' | 'nombre' | 'archivo'>): Promise<void> {
  try {
    previewArchivo(await urlDocumentoEquipo(doc.path), nombreDescargaDocumento(doc.nombre, doc.archivo));
  } catch (e) {
    toast(mensajeError(e, 'No se pudo abrir el documento'), 'error');
  }
}

/** Abre directo el PDF del informe técnico del equipo (el chip «📄 Informe técnico»). */
export async function abrirInformeTecnico(equipoId: string): Promise<void> {
  try {
    const doc = documentoInforme(await listDocumentosEquipo(equipoId));
    if (!doc) { toast('Este equipo no tiene el PDF del informe técnico entre sus documentos.', 'warning'); return; }
    await verDocumentoEquipo(doc);
  } catch (e) {
    toast(mensajeError(e, 'No se pudo abrir el informe'), 'error');
  }
}
