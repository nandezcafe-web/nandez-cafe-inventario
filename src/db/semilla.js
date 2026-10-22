// Datos iniciales tomados del cuestionario y del plan maestro (septiembre 2026).
// Solo se cargan si la base está vacía. Los valores dudosos quedan vacíos y
// anotados para que aparezcan como "datos pendientes" en el resumen.
export async function sembrarSiVacia(db) {
  if (Number((await db.uno('SELECT COUNT(*) AS n FROM fincas')).n) > 0) return false;

  await db.transaccion(async () => {
    const finca = await db.uno(`INSERT INTO fincas (nombre, municipio, departamento, hectareas, latitud, longitud, altitud_msnm, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, [
      'Finca familiar', 'Chinácota', 'Norte de Santander', 13, 7.590401, -72.592821, null,
      'Altitud reportada "desde los 1500": confirmar en m s. n. m. Primer laboratorio de campo del proyecto.',
    ]);
    const fincaId = Number(finca.id);

    const lote = 'INSERT INTO lotes (finca_id, nombre, num_plantas, estado, notas) VALUES (?, ?, ?, ?, ?)';
    await db.ejecutar(lote, [fincaId, 'Lote 1', 1500, 'levante',
      'Plantas de ~1,5 años (a sept. 2026). ~800 plantas con producción prevista en diciembre. Confirmar variedad (¿Geisha?) y fecha de siembra.']);
    await db.ejecutar(lote, [fincaId, 'Lote 2', 3000, 'levante',
      'Plantas recién pasadas a tierra. Verificar cantidad exacta, variedad y fecha de trasplante.']);

    const idea = "INSERT INTO oportunidades (nombre, subproducto, linea, descripcion, estado) VALUES (?, ?, ?, ?, 'idea')";
    for (const fila of [
      ['Compost de pulpa para uso en la finca', 'pulpa', 'bioinsumos', 'Validación rápida y reducción de costos de fertilización.'],
      ['Lombricompuesto de pulpa', 'pulpa', 'bioinsumos', 'Producto de mayor valor que el compost; posible venta local.'],
      ['Pulpa deshidratada / harina', 'pulpa', 'ingredientes', 'Ruta documentada por Cenicafé (2025); exige inocuidad.'],
      ['Infusión de cáscara (cascara)', 'cascara', 'ingredientes', 'Requiere proceso natural y registro sanitario.'],
      ['Biochar de cisco y podas', 'pergamino', 'bioinsumos', 'Materia prima seca y estable; uso propio como enmienda.'],
      ['Pellets/briquetas de cisco', 'pergamino', 'energia', 'Combustible para secado propio o venta.'],
      ['Orellanas sobre borra de café', 'borra', 'ingredientes', 'Red de cafeterías urbanas como proveedores.'],
      ['Biomateriales/aglomerados de cisco', 'pergamino', 'biomateriales', 'Alta diferenciación y posible propiedad intelectual; requiere aliados (SENA/universidad).'],
    ]) await db.ejecutar(idea, fila);
  });
  return true;
}
