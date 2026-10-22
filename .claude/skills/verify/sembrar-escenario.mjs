// Escenario realista para juzgar la densidad de las secciones de Café.
const BASE = 'http://localhost:3100/api';

const post = async (ruta, cuerpo) => {
  const r = await fetch(`${BASE}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${ruta}: ${JSON.stringify(j)}`);
  return j;
};

const prod = await post('/productores', { nombre: 'Productor Uno', municipio: 'Chinácota', relacion: 'conocido' });
const prod2 = await post('/productores', { nombre: 'Rosa Peñaloza', municipio: 'Chinácota', relacion: 'vecino' });

// Tres lotes: uno terminado y vendiéndose, uno a medio procesar, uno recién comprado.
const l1 = await post('/lotes_cafe', {
  codigo: 'DT-2026-01', fecha: '2026-09-02', origen: 'compra', productor_id: prod.id,
  variedad: 'castillo', proceso_beneficio: 'lavado', estado_inicial: 'pergamino_seco',
  kg_inicial: 62, precio_cop_kg: 21500, humedad_pct: 11.2, puntaje_taza: 83.5,
});
const l2 = await post('/lotes_cafe', {
  codigo: 'RP-2026-02', fecha: '2026-10-05', origen: 'compra', productor_id: prod2.id,
  variedad: 'caturra', proceso_beneficio: 'honey', estado_inicial: 'pergamino_seco',
  kg_inicial: 45, precio_cop_kg: 23000, humedad_pct: 10.8,
});
const l3 = await post('/lotes_cafe', {
  codigo: 'DT-2026-03', fecha: '2026-10-21', origen: 'compra', productor_id: prod.id,
  variedad: 'castillo', estado_inicial: 'pergamino_seco', kg_inicial: 51, precio_cop_kg: 22000,
});

// Lote 1: trilla + tres tandas de tueste + molienda.
await post('/procesos_cafe', {
  lote_cafe_id: l1.id, fecha: '2026-09-04', tipo: 'trilla',
  estado_entrada: 'pergamino_seco', estado_salida: 'verde',
  kg_entrada: 62, kg_salida: 50.3, kg_subproducto: 11.2,
  subproducto_tipo: 'cascarilla_silverskin', valor_subproducto_cop: 45000,
  maquila_cop: 40000, transporte_cop: 15000, responsable: 'Maick',
});
for (const [i, [fecha, ent, sal, perfil]] of [
  ['2026-09-06', 18, 15.3, 'medio'],
  ['2026-09-13', 18, 15.1, 'medio'],
  ['2026-09-20', 14.3, 12.1, 'medio_claro'],
].entries()) {
  await post('/procesos_cafe', {
    lote_cafe_id: l1.id, fecha, tipo: 'tueste',
    estado_entrada: 'verde', estado_salida: 'tostado_grano',
    kg_entrada: ent, kg_salida: sal, perfil_tueste: perfil,
    mano_obra_cop: 45000, energia_cop: 18000, temperatura_c: 198 + i, duracion_min: 12.5,
    equipo: 'Tostadora 5 kg', responsable: 'Maick', puntaje_taza: 83 + i * 0.5,
  });
}
await post('/procesos_cafe', {
  lote_cafe_id: l1.id, fecha: '2026-09-22', tipo: 'molienda',
  estado_entrada: 'tostado_grano', estado_salida: 'tostado_molido',
  kg_entrada: 12, kg_salida: 11.9, molienda: 'medio', mano_obra_cop: 12000,
});

// Lote 2: solo trillado, esperando tueste.
await post('/procesos_cafe', {
  lote_cafe_id: l2.id, fecha: '2026-10-07', tipo: 'trilla',
  estado_entrada: 'pergamino_seco', estado_salida: 'verde',
  kg_entrada: 45, kg_salida: 36.1, kg_subproducto: 8.6,
  subproducto_tipo: 'cascarilla_silverskin', maquila_cop: 30000,
});

// Presentaciones con costo de empaque y precio.
const p250g = await post('/presentaciones', { nombre: 'Bolsa 250 g grano', codigo: '250G', estado_cafe: 'tostado_grano', gramos: 250, costo_empaque_cop: 1600, precio_venta_cop: 24000 });
const p250m = await post('/presentaciones', { nombre: 'Bolsa 250 g molido', codigo: '250M', estado_cafe: 'tostado_molido', gramos: 250, molienda: 'medio', costo_empaque_cop: 1600, precio_venta_cop: 24000 });
const p500 = await post('/presentaciones', { nombre: 'Bolsa 500 g grano', codigo: '500G', estado_cafe: 'tostado_grano', gramos: 500, costo_empaque_cop: 2200, precio_venta_cop: 45000 });
const pkilo = await post('/presentaciones', { nombre: 'Kilo para cafetería', codigo: '1KG', estado_cafe: 'tostado_grano', gramos: 1000, costo_empaque_cop: 1200, precio_venta_cop: 56000 });

// Ventas por varios canales y estados de pago.
const ventas = [
  ['2026-09-25', p250g.id, 'directo', 'Clientes de la finca', 12, 24000, 'pagado'],
  ['2026-09-28', pkilo.id, 'cafeteria', 'Café del Parque', 4, 56000, 'pagado'],
  ['2026-10-02', p250m.id, 'directo', 'Vecinos', 8, 24000, 'pagado'],
  ['2026-10-08', p500.id, 'tienda', 'Tienda La Esquina', 6, 45000, 'pendiente'],
  ['2026-10-12', pkilo.id, 'cafeteria', 'Café del Parque', 5, 55000, 'pagado'],
  ['2026-10-15', p250g.id, 'feria', 'Feria de Pamplona', 20, 25000, 'pagado'],
  ['2026-10-18', p250m.id, 'directo', 'Clientes de la finca', 6, 24000, 'pagado'],
  ['2026-10-20', pkilo.id, 'mayorista', 'Distribuidora Norte', 8, 50000, 'pendiente'],
];
for (const [fecha, pres, canal, cliente, unidades, precio, pago] of ventas) {
  await post('/ventas', {
    fecha, lote_cafe_id: l1.id, presentacion_id: pres, canal, cliente,
    unidades, precio_unitario_cop: precio, estado_pago: pago,
  });
}

// Gastos del periodo.
const gastos = [
  ['2026-09-01', 'empaque', 'Bolsas con válvula x200', 320000],
  ['2026-09-01', 'etiquetas', 'Etiquetas impresas x300', 145000],
  ['2026-09-15', 'transporte', 'Fletes del mes', 80000],
  ['2026-10-01', 'servicios', 'Gas y energía', 110000],
  ['2026-10-03', 'marketing', 'Diseño de empaques', 400000],
  ['2026-10-10', 'analisis_calidad', 'Catación de los dos lotes', 90000],
  ['2026-10-14', 'mano_obra', 'Jornal de empaque', 70000],
];
for (const [fecha, categoria, descripcion, valor_cop] of gastos) {
  await post('/gastos', { fecha, categoria, descripcion, valor_cop });
}
await post('/gastos', { fecha: '2026-09-01', categoria: 'equipos', descripcion: 'Tostadora 5 kg', valor_cop: 6200000, tipo_costo: 'inversion' });

const r = await (await fetch(`${BASE}/costos/lotes`)).json();
console.log('lotes sembrados:');
for (const l of r.datos) {
  console.log(` ${l.codigo} · ${l.procesos} procesos · ${l.estado_final} · $${l.cop_por_kg_final}/kg · ${l.kg_disponible.toFixed(2)} kg disp`);
}
const res = await (await fetch(`${BASE}/contabilidad/resultados?desde=2026-09-01&hasta=2026-10-31`)).json();
console.log(`ingresos $${res.ingresos_cop} · margen bruto $${res.margen_bruto_cop} · utilidad $${res.utilidad_operativa_cop}`);
