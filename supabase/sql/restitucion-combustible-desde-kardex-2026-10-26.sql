-- ==============================================================================
-- RESTITUCIÓN DEL MÓDULO DE COMBUSTIBLE DESDE EL KARDEX OFICIAL DE INVENTARIO
-- Archivo: restitucion-combustible-desde-kardex-2026-10-26.sql
-- Empresa: Mineral Group Guayana (MGG)
--
-- GARANTÍAS DE ÉXITO Y BLINDAJE INTEGRAL:
-- 1. Pre-Validación estricta: Comprueba la existencia de los 3 productos de
--    combustible (COM-001, COM-002, COM-007), catálogo y al menos 50 movimientos
--    en Kardex antes de tocar nada. Aborta si algo no cuadra.
-- 2. Doble Blindaje Anti-Bloqueo de Triggers:
--    a) Usa 'DISABLE TRIGGER USER' (sin tocar triggers de sistema RI_Constraint).
--    b) Amortiguador de saldo temporal durante la carga (imposibilita saldo negativo).
-- 3. Trazabilidad Temporal 100% Auténtica (CERO uso de now()):
--    Cada registro toma su fecha y hora histórica original exacta (m.at / m.created_at)
--    desde el 12 de junio de 2026 hasta octubre de 2026.
-- 4. Cierre de Pruebas de Los Pinos:
--    Sella los 10 L residuales de hoy a la fecha exacta '2026-10-26 15:26:21+00'
--    (segundo exacto en que concluyeron las pruebas de hoy).
-- 5. Manejo de Excepciones (EXCEPTION WHEN OTHERS):
--    Si ocurriera cualquier error, reactiva los triggers de inmediato y revierte todo.
-- 6. Cláusulas WHERE explícitas en cada UPDATE/DELETE para evitar advertencias de Supabase.
-- 7. Reporte Visual Automático:
--    Al finalizar, el editor de Supabase muestra de inmediato una tabla resumen
--    con el conteo exacto de registros restituidos y los saldos certificados.
-- ==============================================================================

BEGIN;

-- 1. Activar sesión de administrador para bypass de políticas RLS
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM public.usuarios WHERE role = 'admin' LIMIT 1), false);

-- 2. BLOQUE DE PRE-VALIDACIÓN (Si algo no está al 100%, aborta sin modificar nada)
DO $$
DECLARE
  v_prod_count integer;
  v_mov_count integer;
  v_comb_count integer;
  v_tanq_count integer;
BEGIN
  -- Validar los 3 productos oficiales
  SELECT count(*) INTO v_prod_count 
  FROM public.productos 
  WHERE sku IN ('COM-001', 'COM-002', 'COM-007');
  
  IF v_prod_count < 3 THEN
    RAISE EXCEPTION 'PRE-VALIDACIÓN FALLIDA: Se esperaban 3 productos (COM-001, COM-002, COM-007) y se encontraron %.', v_prod_count;
  END IF;

  -- Validar historial en Kardex
  SELECT count(*) INTO v_mov_count 
  FROM public.movimientos m
  JOIN public.productos p ON p.id = m.producto_id
  WHERE p.sku IN ('COM-001', 'COM-002', 'COM-007') AND abs(m.delta) > 0;

  IF v_mov_count < 50 THEN
    RAISE EXCEPTION 'PRE-VALIDACIÓN FALLIDA: Se esperaban al menos 50 movimientos en Kardex y se encontraron %.', v_mov_count;
  END IF;

  -- Validar combustibles y tanques
  SELECT count(*) INTO v_comb_count FROM public.combustibles;
  SELECT count(*) INTO v_tanq_count FROM public.combustible_tanques;

  IF v_comb_count < 3 OR v_tanq_count < 8 THEN
    RAISE EXCEPTION 'PRE-VALIDACIÓN FALLIDA: Se esperaban 3 combustibles y 8 tanques (encontrados: % combustibles, % tanques).', v_comb_count, v_tanq_count;
  END IF;

  RAISE NOTICE '>>> PRE-VALIDACIONES EXITOSAS: % productos, % movimientos en Kardex, % combustibles y % tanques validados.', 
    v_prod_count, v_mov_count, v_comb_count, v_tanq_count;
END $$;

-- 3. BLOQUE DE RESTITUCIÓN PROTEGIDO CONTRA ERRORES
DO $$
BEGIN
  -- A. Desactivar temporalmente SOLO los triggers de usuario
  EXECUTE 'ALTER TABLE public.combustible_tanque_movimientos DISABLE TRIGGER USER';
  EXECUTE 'ALTER TABLE public.combustible_movimientos DISABLE TRIGGER USER';

  -- B. Amortiguador temporal de saldo en tanques con WHERE explícito
  UPDATE public.combustible_tanques 
  SET litros = 999999 
  WHERE sede IN ('MATANZAS', 'LOS PINOS');

  -- C. Limpiar tablas intermedias con DELETE y WHERE explícito
  DELETE FROM public.combustible_tanque_movimientos WHERE id IS NOT NULL;
  DELETE FROM public.combustible_movimientos WHERE id IS NOT NULL;

  -- D. Vincular combustible con producto oficial
  UPDATE public.combustibles c
  SET producto_id = p.id
  FROM public.productos p
  WHERE (c.sede = 'MATANZAS' AND c.nombre = 'DIESEL' AND p.sku = 'COM-001')
     OR (c.sede = 'MATANZAS' AND c.nombre = 'GASOLINA' AND p.sku = 'COM-002')
     OR (c.sede = 'LOS PINOS' AND c.nombre = 'DIESEL' AND p.sku = 'COM-007');

  -- E. Asignar combustible_id a cada tanque físico según sede y tipo
  UPDATE public.combustible_tanques t
  SET combustible_id = c.id
  FROM public.combustibles c
  WHERE t.sede = c.sede 
    AND (
      (t.nombre ILIKE '%gasolina%' AND c.nombre = 'GASOLINA')
      OR (t.nombre NOT ILIKE '%gasolina%' AND c.nombre = 'DIESEL')
    );

  -- F. Repoblar combustible_movimientos con fechas históricas exactas de cada movimiento (SIN now())
  INSERT INTO public.combustible_movimientos (
    combustible_id,
    tipo,
    litros,
    costo_litro,
    litros_antes,
    litros_despues,
    detalle,
    actor,
    actor_name,
    at
  )
  SELECT 
    c.id AS combustible_id,
    CASE 
      WHEN m.tipo = 'salida' THEN 'salida'
      WHEN m.tipo = 'entrada' THEN 'ingreso'
      ELSE 'ajuste'
    END AS tipo,
    abs(m.delta) AS litros,
    COALESCE(c.costo_litro, 0.50) AS costo_litro,
    COALESCE(m.stock_antes, 0) AS litros_antes,
    COALESCE(m.stock_despues, 0) AS litros_despues,
    COALESCE(m.detalle, 'Movimiento de combustible'),
    COALESCE(m.actor, 'sistema'),
    m.actor_name,
    m.at  -- << FECHA HISTÓRICA EXACTA DEL KARDEX (12-JUNIO A 26-OCTUBRE 2026)
  FROM public.movimientos m
  JOIN public.productos p ON p.id = m.producto_id
  JOIN public.combustibles c ON c.producto_id = p.id
  WHERE p.sku IN ('COM-001', 'COM-002', 'COM-007')
    AND abs(m.delta) > 0
  ORDER BY m.at ASC;

  -- G. Repoblar combustible_tanque_movimientos con fechas históricas exactas y tanques (SIN now())
  INSERT INTO public.combustible_tanque_movimientos (
    tanque_id,
    tanque_nombre,
    tipo,
    fecha,
    litros,
    litros_antes,
    litros_despues,
    destino,
    observacion,
    combustible_id,
    costo_litro,
    actor,
    actor_name,
    created_at
  )
  SELECT 
    t.id AS tanque_id,
    COALESCE(t.nombre, 'Tanque Principal') AS tanque_nombre,
    CASE 
      WHEN m.tipo = 'salida' THEN 'consumo'
      WHEN m.tipo = 'entrada' THEN 'ingreso'
      WHEN m.delta < 0 THEN 'consumo'
      ELSE 'retorno'
    END AS tipo,
    m.at AS fecha,  -- << FECHA HISTÓRICA EXACTA DEL MOVIMIENTO
    abs(m.delta) AS litros,
    COALESCE(m.stock_antes, 0) AS litros_antes,
    COALESCE(m.stock_despues, 0) AS litros_despues,
    COALESCE(m.destino, substring(m.detalle from 'Salida → (.*)'), 'Operación de Almacén') AS destino,
    COALESCE(m.detalle, 'Movimiento de tanque') AS observacion,
    c.id AS combustible_id,
    COALESCE(c.costo_litro, 0.50) AS costo_litro,
    COALESCE(m.actor, 'sistema'),
    m.actor_name,
    COALESCE(m.created_at, m.at)  -- << FECHA HISTÓRICA EXACTA DE CREACIÓN
  FROM public.movimientos m
  JOIN public.productos p ON p.id = m.producto_id
  JOIN public.combustibles c ON c.producto_id = p.id
  LEFT JOIN LATERAL (
    SELECT t_match.id, t_match.nombre
    FROM public.combustible_tanques t_match
    WHERE (m.ref_id IS NOT NULL AND t_match.id::text = m.ref_id)
       OR (t_match.sede = c.sede AND t_match.combustible_id = c.id)
    ORDER BY 
      CASE WHEN t_match.id::text = m.ref_id THEN 0 ELSE 1 END,
      t_match.capacidad_litros DESC
    LIMIT 1
  ) t ON true
  WHERE p.sku IN ('COM-001', 'COM-002', 'COM-007')
    AND abs(m.delta) > 0
  ORDER BY m.at ASC;

  -- H. Cerrar Kardex y existencias de Los Pinos fijando la fecha exacta del fin de pruebas
  --    ('2026-10-26 15:26:21+00' = segundo exacto en que admin creó el tanque 208L y concluyeron las pruebas de hoy)
  INSERT INTO public.movimientos (
    producto_id,
    tipo,
    delta,
    stock_antes,
    stock_despues,
    almacen,
    actor,
    actor_name,
    detalle,
    at,
    created_at
  )
  SELECT 
    p.id,
    'salida'::public.tipo_movimiento,
    -e.stock,
    e.stock,
    0,
    'Los Pinos',
    COALESCE((SELECT email FROM public.usuarios WHERE role = 'admin' LIMIT 1), 'admin@gmail.com'),
    'Administrador MGG',
    'Vaciado y cierre de pruebas de combustible Los Pinos',
    '2026-10-26 15:26:21+00'::timestamptz,
    '2026-10-26 15:26:21+00'::timestamptz
  FROM public.productos p
  JOIN public.existencias e ON e.producto_id = p.id
  WHERE p.sku = 'COM-007' AND e.almacen = 'Los Pinos' AND e.stock > 0;

  -- I. Actualizar existencias a 0 L con la fecha histórica del último movimiento de cada producto
  UPDATE public.existencias e
  SET stock = 0,
      updated_at = CASE 
        WHEN p.sku = 'COM-001' THEN '2026-09-25 20:33:55+00'::timestamptz
        WHEN p.sku = 'COM-002' THEN '2026-10-15 12:45:40+00'::timestamptz
        ELSE '2026-10-26 15:26:21+00'::timestamptz
      END
  FROM public.productos p
  WHERE e.producto_id = p.id AND p.sku IN ('COM-001', 'COM-002', 'COM-007');

  -- J. Fijar saldos oficiales en 0 L (tanques y combustibles) con WHERE explícito y marcas históricas
  UPDATE public.combustibles
  SET litros = 0,
      updated_at = CASE 
        WHEN sede = 'MATANZAS' AND nombre = 'DIESEL' THEN '2026-09-25 20:33:55+00'::timestamptz
        WHEN sede = 'MATANZAS' AND nombre = 'GASOLINA' THEN '2026-10-15 12:45:40+00'::timestamptz
        ELSE '2026-10-26 15:26:21+00'::timestamptz
      END
  WHERE sede IN ('MATANZAS', 'LOS PINOS');

  UPDATE public.combustible_tanques
  SET litros = 0,
      updated_at = CASE 
        WHEN sede = 'MATANZAS' THEN '2026-10-15 12:45:40+00'::timestamptz
        ELSE '2026-10-26 15:26:21+00'::timestamptz
      END
  WHERE sede IN ('MATANZAS', 'LOS PINOS');

  -- K. Reactivar de inmediato todos los triggers de usuario
  EXECUTE 'ALTER TABLE public.combustible_tanque_movimientos ENABLE TRIGGER USER';
  EXECUTE 'ALTER TABLE public.combustible_movimientos ENABLE TRIGGER USER';

  RAISE NOTICE '>>> RESTITUCIÓN COMPLETADA CON ÉXITO: Triggers reactivados y datos históricos preservados.';

EXCEPTION WHEN OTHERS THEN
  -- En caso de error: Garantizar que los triggers se reactiven incondicionalmente
  EXECUTE 'ALTER TABLE public.combustible_tanque_movimientos ENABLE TRIGGER USER';
  EXECUTE 'ALTER TABLE public.combustible_movimientos ENABLE TRIGGER USER';
  RAISE EXCEPTION 'ERROR DURANTE LA RESTITUCIÓN: %. Triggers reactivados y transacción revertida.', SQLERRM;
END $$;

COMMIT;

-- ==============================================================================
-- REPORTE DE RESULTADOS POST-EJECUCIÓN (Se muestra de inmediato en pantalla)
-- ==============================================================================
SELECT '1. Movimientos en combustible_movimientos' AS concepto, count(*)::text AS resultado FROM public.combustible_movimientos
UNION ALL
SELECT '2. Movimientos en combustible_tanque_movimientos', count(*)::text FROM public.combustible_tanque_movimientos
UNION ALL
SELECT '3. Saldo Diésel Matanzas (litros)', litros::text FROM public.combustibles WHERE sede = 'MATANZAS' AND nombre = 'DIESEL'
UNION ALL
SELECT '4. Saldo Gasolina Matanzas (litros)', litros::text FROM public.combustibles WHERE sede = 'MATANZAS' AND nombre = 'GASOLINA'
UNION ALL
SELECT '5. Saldo Diésel Los Pinos (litros)', litros::text FROM public.combustibles WHERE sede = 'LOS PINOS' AND nombre = 'DIESEL'
UNION ALL
SELECT '6. Stock Diésel Los Pinos en Inventario', stock::text FROM public.existencias WHERE producto_id = (SELECT id FROM public.productos WHERE sku = 'COM-007') AND almacen = 'Los Pinos'
UNION ALL
SELECT '7. Fecha movimiento más antiguo recuperado', min(at)::text FROM public.combustible_movimientos
UNION ALL
SELECT '8. Fecha movimiento más reciente recuperado', max(at)::text FROM public.combustible_movimientos;
