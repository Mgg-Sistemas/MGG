-- ============================================================
-- Golden Touch · Administración · las columnas que le faltan a los documentos
-- Fecha: 12/11/2026
--
-- EL SÍNTOMA. Al subir un documento se configuraba carpeta, fecha de
-- vencimiento y estado, y el documento salía en «Otros Archivos» y
-- «Permanente (No vence)». La configuración se perdía entera.
--
-- LA CAUSA. La tabla `admin_empresa_documentos` nunca recibió sus columnas:
-- de las 24 que el sistema le escribe, FALTAN DOCE. Y el código, al fallar el
-- guardado, reintentaba EN SILENCIO con una fila mínima (solo empresa, tipo,
-- nombre, archivo, tipo de archivo y tamaño), tirando todo lo demás. Por eso
-- decía «subido» y la configuración no estaba por ningún lado.
--
-- El archivo 2026-11-04-admin-documentos-carpetas-vencimientos.sql añade diez
-- de esas doce, pero tampoco se aplicó. Este las deja TODAS, así que basta con
-- aplicar este. Si aquel se aplica después, no estorba: ambos comprueban antes.
--
-- Aditivo e idempotente: solo añade columnas nullables. No borra ni altera
-- nada de lo que ya existe.
-- ============================================================

ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS carpeta            text DEFAULT 'otros';
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS centro_acopio_id   text;
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS responsable        text;
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS fecha_vencimiento  date;
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS fecha_emision      date;
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS status_vencimiento text DEFAULT 'vigente';
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS socio_nombre       text;
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS entidad_emisora    text;
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS numero_registro    text;
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS nota_tramite       text;
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS historial          jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE admin_empresa_documentos ADD COLUMN IF NOT EXISTS updated_at         timestamptz NOT NULL DEFAULT now();

-- Para que la lista por carpeta y la agenda de vencimientos no barran la tabla.
CREATE INDEX IF NOT EXISTS idx_admin_docs_carpeta     ON admin_empresa_documentos (carpeta);
CREATE INDEX IF NOT EXISTS idx_admin_docs_vencimiento ON admin_empresa_documentos (fecha_vencimiento);

-- Comprobación: debe devolver 12.
SELECT count(*) AS columnas_presentes_de_12
  FROM information_schema.columns
 WHERE table_name = 'admin_empresa_documentos'
   AND column_name IN ('carpeta','centro_acopio_id','responsable','fecha_vencimiento',
                       'fecha_emision','status_vencimiento','socio_nombre','entidad_emisora',
                       'numero_registro','nota_tramite','historial','updated_at');

-- Los dos documentos ya subidos quedaron sin carpeta ni vencimiento: no se
-- pueden adivinar. Al aplicar esto, quedan en «Otros Archivos» y se les pone
-- su carpeta y su fecha a mano desde «Detalle», que ahora sí guardará.
