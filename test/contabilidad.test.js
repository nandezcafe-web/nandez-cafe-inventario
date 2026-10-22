import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirDb } from '../src/db/index.js';
import { sembrarSiVacia } from '../src/db/semilla.js';
import { crearApp } from '../src/app.js';
import { rendimientoEsperado } from '../src/conocimiento/procesos_cafe.js';

let servidor;
let base;
let db;
let uploadsDir;

const pedir = async (ruta, { metodo = 'GET', cuerpo } = {}) => {
  const resp = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await resp.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* no json */ }
  return { status: resp.status, json, texto };
};

before(async () => {
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cafe-cont-'));
  db = await abrirDb(process.env.BD_PRUEBAS ?? ':memory:');
  await sembrarSiVacia(db);
  const app = crearApp(db, { apiToken: null, timezone: 'America/Bogota', uploadsDir, publicDir: path.resolve('public') });
  await new Promise((ok) => { servidor = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  servidor.close();
  await db.cerrar();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});

// Caso real: 51 kg de pergamino castillo comprados en $1.122.000.
let loteId;
let presentacionId;

test('lote de café: costo de entrada por kg', async () => {
  const prod = await pedir('/api/productores', {
    metodo: 'POST',
    cuerpo: { nombre: 'Productor de prueba', municipio: 'Chinácota', relacion: 'conocido', disposicion: 'vender' },
  });
  assert.equal(prod.status, 201);

  const creado = await pedir('/api/lotes_cafe', {
    metodo: 'POST',
    cuerpo: {
      codigo: 'DT-2026-01', fecha: '2026-10-21', origen: 'compra', productor_id: prod.json.id,
      variedad: 'castillo', estado_inicial: 'pergamino_seco', kg_inicial: 51,
      precio_cop_kg: 22000, valor_compra_cop: 1122000,
    },
  });
  assert.equal(creado.status, 201);
  loteId = creado.json.id;
  assert.equal(creado.json.costo_entrada_cop, 1122000);
  assert.equal(creado.json.cop_por_kg_entrada, 22000);

  const c = await pedir(`/api/costos/lote/${loteId}`);
  assert.equal(c.json.entrada.total_cop, 1122000);
  assert.equal(c.json.etapas.length, 1);
  assert.equal(c.json.etapas[0].kg_disponible, 51);
  assert.equal(c.json.etapas[0].cop_por_kg, 22000);
});

test('trilla y tueste: el costo por kg sube con la merma', async () => {
  const trilla = await pedir('/api/procesos_cafe', {
    metodo: 'POST',
    cuerpo: {
      lote_cafe_id: loteId, fecha: '2026-10-22', tipo: 'trilla',
      estado_entrada: 'pergamino_seco', estado_salida: 'verde',
      kg_entrada: 51, kg_salida: 41.2, kg_subproducto: 9.5, subproducto_tipo: 'cascarilla_silverskin',
      maquila_cop: 30000,
    },
  });
  assert.equal(trilla.status, 201);
  assert.equal(trilla.json.costo_proceso_cop, 30000);
  assert.equal(trilla.json.rendimiento_pct, 80.78);

  const tueste = await pedir('/api/procesos_cafe', {
    metodo: 'POST',
    cuerpo: {
      lote_cafe_id: loteId, fecha: '2026-10-22', tipo: 'tueste',
      estado_entrada: 'verde', estado_salida: 'tostado_grano',
      kg_entrada: 41.2, kg_salida: 35, perfil_tueste: 'medio',
      maquila_cop: 0, mano_obra_cop: 60000, energia_cop: 25000,
    },
  });
  assert.equal(tueste.status, 201);

  const { json: c } = await pedir(`/api/costos/lote/${loteId}`);
  assert.equal(c.pasos.length, 2);

  // Pergamino: 1.122.000 + 30.000 de trilla = 1.152.000 entre 41,2 kg verde.
  const verde = c.etapas.find((e) => e.estado === 'verde');
  assert.equal(verde.cop_por_kg, 27961.17);
  assert.equal(verde.kg_disponible, 0, 'el verde se consumió en el tueste');

  // Verde + 85.000 de tueste = 1.237.000 entre 35 kg tostados.
  const tostado = c.etapas.find((e) => e.estado === 'tostado_grano');
  assert.equal(tostado.kg_disponible, 35);
  assert.equal(tostado.cop_por_kg, 35342.86);
  assert.equal(c.totales.costo_total_cop, 1237000);
  assert.equal(c.totales.cop_por_kg_final, 35342.86);
  // 35 kg tostados de 51 kg de pergamino.
  assert.equal(c.totales.rendimiento_global, 0.686);
});

test('avisa cuando el rendimiento se sale de lo esperado', async () => {
  const otro = await pedir('/api/lotes_cafe', {
    metodo: 'POST',
    cuerpo: { codigo: 'RARO-01', fecha: '2026-10-01', origen: 'compra', estado_inicial: 'pergamino_seco', kg_inicial: 10, precio_cop_kg: 20000 },
  });
  await pedir('/api/procesos_cafe', {
    metodo: 'POST',
    cuerpo: {
      lote_cafe_id: otro.json.id, fecha: '2026-10-02', tipo: 'trilla',
      estado_entrada: 'pergamino_seco', estado_salida: 'verde', kg_entrada: 10, kg_salida: 6,
    },
  });
  const { json: c } = await pedir(`/api/costos/lote/${otro.json.id}`);
  assert.match(c.avisos.map((a) => a.texto).join(' '), /por debajo de lo esperado/);

  // Tomar más kg de los que hay disponibles es un error de peso.
  await pedir('/api/procesos_cafe', {
    metodo: 'POST',
    cuerpo: {
      lote_cafe_id: otro.json.id, fecha: '2026-10-03', tipo: 'tueste',
      estado_entrada: 'verde', estado_salida: 'tostado_grano', kg_entrada: 99, kg_salida: 80,
    },
  });
  const { json: c2 } = await pedir(`/api/costos/lote/${otro.json.id}`);
  assert.ok(c2.avisos.some((a) => a.nivel === 'alta' && /solo había/.test(a.texto)));

  await pedir(`/api/lotes_cafe/${otro.json.id}`, { metodo: 'PATCH', cuerpo: { estado: 'descartado' } });
});

test('kg de salida sin pesar se estiman y quedan marcados', async () => {
  const l = await pedir('/api/lotes_cafe', {
    metodo: 'POST',
    cuerpo: { codigo: 'SINPESO-01', fecha: '2026-10-05', origen: 'compra', estado_inicial: 'verde', kg_inicial: 20, precio_cop_kg: 30000 },
  });
  await pedir('/api/procesos_cafe', {
    metodo: 'POST',
    cuerpo: { lote_cafe_id: l.json.id, fecha: '2026-10-06', tipo: 'tueste', estado_entrada: 'verde', estado_salida: 'tostado_grano', kg_entrada: 20 },
  });
  const { json: c } = await pedir(`/api/costos/lote/${l.json.id}`);
  assert.equal(c.pasos[0].kg_salida_estimado, true);
  assert.equal(c.pasos[0].kg_salida, 16.9); // 20 × 0,845
  assert.ok(c.avisos.some((a) => /no tiene kg de salida/.test(a.texto)));
  await pedir(`/api/lotes_cafe/${l.json.id}`, { metodo: 'PATCH', cuerpo: { estado: 'descartado' } });
});

test('precio recomendado: margen sobre el precio de venta', async () => {
  const r = await pedir('/api/precios/sugerir', {
    metodo: 'POST',
    cuerpo: { costo_cop_kg: 35342.86, gramos: 250, costo_empaque_cop: 1500, gastos_generales_cop_kg: 0, merma_empaque_pct: 0 },
  });
  assert.equal(r.status, 200);
  // 250 g de café: 8.835,7 + 1.500 de empaque = 10.336.
  assert.equal(r.json.costo_unitario.total_cop, 10336);
  const directo = r.json.canales.find((c) => c.canal === 'directo');
  assert.equal(directo.margen_objetivo_pct, 50);
  // 10.336 / 0,5 = 20.672 → redondeado a 21.000 (nunca por debajo del objetivo).
  assert.equal(directo.precio_sugerido_cop, 21000);
  assert.ok(directo.margen_real_pct >= 50);
  assert.equal(r.json.costo_unitario.precio_minimo_cop, 10500);

  const cafeteria = r.json.canales.find((c) => c.canal === 'cafeteria');
  assert.ok(cafeteria.precio_sugerido_cop < directo.precio_sugerido_cop);

  // Un precio por debajo del costo se señala.
  const malo = await pedir('/api/precios/sugerir', {
    metodo: 'POST',
    cuerpo: { costo_cop_kg: 35342.86, gramos: 250, costo_empaque_cop: 1500, precio_actual_cop: 9000 },
  });
  assert.equal(malo.json.evaluacion.cubre_costo, false);
  assert.match(malo.json.evaluacion.veredicto, /por debajo del costo/);

  const sinCosto = await pedir('/api/precios/sugerir', { metodo: 'POST', cuerpo: { gramos: 250 } });
  assert.equal(sinCosto.status, 400);
  assert.equal(sinCosto.json.detalles.costo_cop_kg, 'es obligatorio');
});

test('presentaciones y precios con el costo real del lote', async () => {
  const pres = await pedir('/api/presentaciones', {
    metodo: 'POST',
    cuerpo: { nombre: 'Bolsa 250 g grano', estado_cafe: 'tostado_grano', gramos: 250, costo_empaque_cop: 1500, precio_venta_cop: 21000 },
  });
  assert.equal(pres.status, 201);
  presentacionId = pres.json.id;
  assert.equal(pres.json.precio_cop_kg, 84000);

  const r = await pedir(`/api/precios/lote/${loteId}?gastos_generales_cop_kg=0`);
  assert.equal(r.status, 200);
  const p = r.json.presentaciones.find((x) => x.presentacion_id === presentacionId);
  assert.ok(p.costo_unitario_cop > 10000 && p.costo_unitario_cop < 11000);
  assert.equal(p.evaluacion.cubre_costo, true);
});

test('venta: baja el inventario y arma el margen', async () => {
  const v = await pedir('/api/ventas', {
    metodo: 'POST',
    cuerpo: {
      fecha: '2026-10-25', lote_cafe_id: loteId, presentacion_id: presentacionId,
      cliente: 'Cafetería del parque', canal: 'cafeteria', unidades: 20,
      precio_unitario_cop: 15000, estado_pago: 'pagado',
    },
  });
  assert.equal(v.status, 201);
  assert.equal(v.json.total_calculado_cop, 300000);

  const { json: c } = await pedir(`/api/costos/lote/${loteId}`);
  const tostado = c.etapas.find((e) => e.estado === 'tostado_grano');
  assert.equal(tostado.kg_vendido, 5); // 20 bolsas × 250 g
  assert.equal(tostado.kg_disponible, 30);

  const { json: inv } = await pedir('/api/inventario');
  const estado = inv.estados.find((e) => e.estado === 'tostado_grano');
  assert.equal(estado.kg, 30);
  assert.equal(estado.valor_cop, 1060286); // 30 kg × 35.342,86

  const { json: res } = await pedir('/api/contabilidad/resultados?desde=2026-10-01&hasta=2026-10-31');
  assert.equal(res.ingresos_cop, 300000);
  assert.equal(res.costo_vendido_cop, 176714); // 5 kg × 35.342,86
  assert.equal(res.margen_bruto_cop, 123286);
  assert.equal(res.kg_vendidos, 5);
  const canal = res.por_canal.find((x) => x.canal === 'cafeteria');
  assert.equal(canal.ingresos_cop, 300000);
});

test('gastos: generales por kg y utilidad del periodo', async () => {
  await pedir('/api/gastos', {
    metodo: 'POST',
    cuerpo: { fecha: '2026-10-23', categoria: 'empaque', descripcion: 'Bolsas con válvula x100', valor_cop: 150000 },
  });
  await pedir('/api/gastos', {
    metodo: 'POST',
    cuerpo: { fecha: '2026-10-23', categoria: 'equipos', descripcion: 'Tostadora', valor_cop: 4000000, tipo_costo: 'inversion' },
  });

  await pedir('/api/gastos', {
    metodo: 'POST',
    cuerpo: { fecha: '2026-10-24', categoria: 'servicios', descripcion: 'Gas y energía', valor_cop: 90000 },
  });

  const { json: gg } = await pedir('/api/costos/gastos-por-kg?desde=2026-10-01&hasta=2026-10-31');
  // El empaque NO entra: ya se cobra por unidad en cada presentación. Contarlo
  // aquí también haría que cada bolsa pagara su empaque dos veces.
  assert.equal(gg.gastos_generales_cop, 90000);
  assert.equal(gg.gastos_por_unidad_excluidos_cop, 150000);
  assert.deepEqual(gg.categorias_excluidas, ['empaque', 'etiquetas']);
  assert.match(gg.avisos.join(' '), /dos veces/);
  assert.ok(gg.kg_producidos > 0);
  assert.ok(gg.cop_por_kg > 0);

  // Pero en el estado de resultados sí cuentan los dos: es plata que salió.
  const { json: res } = await pedir('/api/contabilidad/resultados?desde=2026-10-01&hasta=2026-10-31');
  assert.equal(res.gastos_operativos_cop, 240000);
  assert.equal(res.inversiones_cop, 4000000, 'la inversión no castiga la utilidad del mes');
  assert.equal(res.utilidad_operativa_cop, res.margen_bruto_cop - 240000);
  assert.equal(res.gastos_por_categoria[0].categoria, 'empaque');
});

test('avisa cuando los gastos generales pesan más que el café', async () => {
  const r = await pedir('/api/precios/sugerir', {
    metodo: 'POST',
    cuerpo: { costo_cop_kg: 36000, gramos: 1000, costo_empaque_cop: 1200, gastos_generales_cop_kg: 28000 },
  });
  assert.equal(r.status, 200);
  assert.match(r.json.avisos.join(' '), /pesan más del 40 %/);

  const sano = await pedir('/api/precios/sugerir', {
    metodo: 'POST',
    cuerpo: { costo_cop_kg: 36000, gramos: 1000, costo_empaque_cop: 1200, gastos_generales_cop_kg: 8000 },
  });
  assert.ok(!sano.json.avisos.join(' ').includes('pesan más del 40 %'));
});

test('inversión con vida útil: se reparte por mes y baja la utilidad', async () => {
  // Tostadora de 6.000.000 a 60 meses = 100.000 por mes, desde noviembre.
  const inv = await pedir('/api/gastos', {
    metodo: 'POST',
    cuerpo: {
      fecha: '2026-11-05', categoria: 'equipos', descripcion: 'Tostadora 5 kg',
      valor_cop: 6000000, tipo_costo: 'inversion', amortizar_meses: 60,
    },
  });
  assert.equal(inv.status, 201);

  // Un mes cobra una cuota, no los 6.000.000 de golpe.
  const { json: nov } = await pedir('/api/contabilidad/resultados?desde=2026-11-01&hasta=2026-11-30');
  assert.equal(nov.depreciacion_cop, 100000);
  assert.equal(nov.amortizacion.cuota_mensual_cop, 100000);
  assert.equal(nov.amortizacion.detalle[0].termina, '2031-10');
  assert.equal(nov.utilidad_operativa_cop, nov.margen_bruto_cop - nov.gastos_operativos_cop - 100000);

  // Tres meses, tres cuotas.
  const { json: tri } = await pedir('/api/contabilidad/resultados?desde=2026-11-01&hasta=2027-01-31');
  assert.equal(tri.depreciacion_cop, 300000);

  // Antes de comprarla no carga nada.
  const { json: oct } = await pedir('/api/contabilidad/resultados?desde=2026-10-01&hasta=2026-10-31');
  assert.equal(oct.depreciacion_cop, 0);

  // Pasada la vida útil deja de cargar: 60 cuotas y ni una más.
  const { json: todo } = await pedir('/api/contabilidad/resultados?desde=2026-11-01&hasta=2040-12-31');
  assert.equal(todo.depreciacion_cop, 6000000);
});

test('valor residual: la cuota se reparte sobre valor − residual', async () => {
  // 2.400.000 con residual de 400.000 en 20 meses = 100.000 por mes.
  const inv = await pedir('/api/gastos', {
    metodo: 'POST',
    cuerpo: {
      fecha: '2027-03-10', categoria: 'equipos', descripcion: 'Molino con residual',
      valor_cop: 2400000, tipo_costo: 'inversion', amortizar_meses: 20, valor_residual_cop: 400000,
    },
  });
  assert.equal(inv.status, 201);

  const { json: mes } = await pedir('/api/contabilidad/resultados?desde=2027-03-01&hasta=2027-03-31');
  const linea = mes.amortizacion.detalle.find((a) => a.descripcion === 'Molino con residual');
  assert.equal(linea.cuota_mensual_cop, 100000, '(2.400.000 − 400.000) ÷ 20');
  assert.equal(linea.valor_residual_cop, 400000);

  // Toda la vida útil amortiza 2.000.000, no 2.400.000: el residual se queda.
  const { json: todo } = await pedir('/api/contabilidad/resultados?desde=2027-03-01&hasta=2028-10-31');
  const total = todo.amortizacion.detalle.find((a) => a.descripcion === 'Molino con residual');
  assert.equal(total.cop, 2000000);
});

test('venta del equipo: corta la amortización y deja ganancia o pérdida', async () => {
  // 1.200.000 en 12 meses = 100.000 por mes, desde abril de 2027.
  // Vendida en junio: 3 cuotas (abr, may, jun) -> en libros 900.000.
  await pedir('/api/gastos', {
    metodo: 'POST',
    cuerpo: {
      fecha: '2027-04-05', categoria: 'equipos', descripcion: 'Selladora vendida',
      valor_cop: 1200000, tipo_costo: 'inversion', amortizar_meses: 12,
      fecha_venta: '2027-06-20', valor_venta_cop: 1000000,
    },
  });

  const { json: jun } = await pedir('/api/contabilidad/resultados?desde=2027-06-01&hasta=2027-06-30');
  const venta = jun.amortizacion.ventas.find((v) => v.descripcion === 'Selladora vendida');
  assert.equal(venta.meses_amortizados, 3);
  assert.equal(venta.valor_en_libros_cop, 900000);
  assert.equal(venta.resultado_cop, 100000, 'se vendió en 1.000.000 y quedaban 900.000');
  // El resultado de la venta va aparte de la utilidad operativa.
  assert.equal(jun.resultado_venta_equipos_cop, 100000);
  assert.equal(jun.resultado_periodo_cop, jun.utilidad_operativa_cop + 100000);

  // Después de vendida ya no amortiza, y el resultado no se repite.
  const { json: jul } = await pedir('/api/contabilidad/resultados?desde=2027-07-01&hasta=2027-12-31');
  assert.ok(!jul.amortizacion.detalle.some((a) => a.descripcion === 'Selladora vendida'));
  assert.equal(jul.amortizacion.ventas.length, 0);

  // En total amortizó 3 cuotas de las 12, no las 12.
  const { json: vida } = await pedir('/api/contabilidad/resultados?desde=2027-04-01&hasta=2028-12-31');
  const corte = vida.amortizacion.detalle.find((a) => a.descripcion === 'Selladora vendida');
  assert.equal(corte.cop, 300000);
  assert.equal(corte.cortado_por_venta, true);
  assert.equal(corte.termina, '2027-06');
});

test('venta sin precio anotado: pérdida total y aviso', async () => {
  await pedir('/api/gastos', {
    metodo: 'POST',
    cuerpo: {
      fecha: '2028-01-10', categoria: 'equipos', descripcion: 'Balanza dada de baja',
      valor_cop: 600000, tipo_costo: 'inversion', amortizar_meses: 12, fecha_venta: '2028-02-15',
    },
  });
  const { json: feb } = await pedir('/api/contabilidad/resultados?desde=2028-02-01&hasta=2028-02-28');
  const v = feb.amortizacion.ventas.find((x) => x.descripcion === 'Balanza dada de baja');
  assert.equal(v.valor_venta_cop, 0);
  assert.equal(v.valor_en_libros_cop, 500000, '600.000 menos 2 cuotas de 50.000');
  assert.equal(v.resultado_cop, -500000);
  assert.match(feb.amortizacion.avisos.join(' '), /sin anotar por cuánto/);
});

test('la cuota de la inversión entra al costo del kg; sin vida útil no carga pero avisa', async () => {
  const { json: gg } = await pedir('/api/costos/gastos-por-kg?desde=2026-11-01&hasta=2026-11-30');
  assert.equal(gg.amortizacion_cop, 100000);
  assert.equal(gg.gastos_generales_cop, gg.gastos_operativos_cop + 100000);

  // La tostadora de 4.000.000 registrada antes no tiene vida útil: no carga
  // nada al costo del kg, y eso se dice en vez de pasarlo por alto.
  assert.ok(gg.amortizacion.sin_vida_util.some((g) => g.valor_cop === 4000000));
  assert.match(gg.avisos.join(' '), /inversiones sin vida útil/);
});

test('simulación antes de comprar', async () => {
  const r = await pedir('/api/costos/simular', {
    metodo: 'POST',
    cuerpo: {
      kg: 51, precio_cop_kg: 22000, estado_inicial: 'pergamino_seco', estado_final: 'tostado_grano',
      perfil_tueste: 'medio', costos_proceso_cop_kg: { trilla: 600, tueste: 2000 },
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.pasos.length, 2);
  // 51 × 0,81 × 0,85 ≈ 35 kg
  assert.ok(r.json.resultado.kg_final.tipico > 34 && r.json.resultado.kg_final.tipico < 36);
  assert.ok(r.json.resultado.cop_por_kg.peor > r.json.resultado.cop_por_kg.tipico);
  assert.ok(r.json.resultado.cop_por_kg.tipico > 22000 / 0.69);

  const malo = await pedir('/api/costos/simular', {
    metodo: 'POST',
    cuerpo: { kg: 10, estado_inicial: 'tostado_grano', estado_final: 'verde' },
  });
  assert.equal(malo.status, 400);
  assert.match(malo.json.detalles.estado_final, /posterior/);
});

test('rendimiento esperado de pergamino a tostado', () => {
  const r = rendimientoEsperado('pergamino_seco', 'tostado_grano');
  assert.deepEqual(r.pasos, ['trilla', 'tueste']);
  assert.equal(r.tipico, 0.684);
  assert.equal(rendimientoEsperado('tostado_grano', 'verde'), null);
});

test('el resumen muestra el negocio y alerta por frescura y precio', async () => {
  const { json: r } = await pedir('/api/resumen');
  assert.ok(r.negocio.inventario.total_kg > 0);
  assert.ok(r.negocio.anio.ingresos_cop > 0);
  assert.equal(r.registros.lotes_cafe, 3);

  // Un precio de lista por debajo del costo tiene que salir en alertas.
  await pedir('/api/presentaciones', {
    metodo: 'POST',
    cuerpo: { nombre: 'Bolsa 500 g regalada', estado_cafe: 'tostado_grano', gramos: 500, precio_venta_cop: 10000 },
  });
  const { json: r2 } = await pedir('/api/resumen');
  assert.ok(r2.alertas.some((a) => a.tipo === 'precio' && a.nivel === 'alta'), 'debe alertar el precio bajo el costo');
});

test('conocimiento de procesos disponible para el panel', async () => {
  const { json: c } = await pedir('/api/costos/conocimiento');
  assert.equal(c.transiciones.trilla.subproducto, 'cascarilla_silverskin');
  assert.equal(c.canales_venta.directo.margen_pct, 50);
  assert.ok(c.perfiles_tueste.oscuro.rendimiento.tipico < c.perfiles_tueste.claro.rendimiento.tipico);
  assert.match(c.aviso_iva, /contador/);
});

test('exportar a CSV los nuevos recursos', async () => {
  const r = await fetch(`${base}/api/exportar/lotes_cafe.csv`);
  assert.equal(r.status, 200);
  const texto = await r.text();
  assert.match(texto, /codigo/);
  assert.match(texto, /DT-2026-01/);
});

test('respaldo: entrega una copia consistente y legible de la base', async () => {
  const resp = await fetch(`${base}/api/respaldo`);
  assert.equal(resp.status, 200);
  assert.match(resp.headers.get('content-disposition') ?? '', /nandez-cafe-\d{4}-\d{2}-\d{2}\.sqlite/);
  assert.ok(Number(resp.headers.get('x-respaldo-bytes')) > 0);

  // El archivo bajado tiene que abrirse como base de SQLite y traer los datos.
  const archivo = path.join(uploadsDir, 'respaldo.sqlite');
  fs.writeFileSync(archivo, Buffer.from(await resp.arrayBuffer()));
  assert.equal(fs.readFileSync(archivo).subarray(0, 15).toString(), 'SQLite format 3');

  const copia = await abrirDb(archivo);
  const lote = await copia.uno('SELECT codigo, kg_inicial FROM lotes_cafe WHERE codigo = ?', ['DT-2026-01']);
  assert.equal(lote.kg_inicial, 51);
  const procesos = Number((await copia.uno('SELECT COUNT(*) AS n FROM procesos_cafe WHERE lote_cafe_id = 1')).n);
  assert.equal(procesos, 2, 'la copia trae la trilla y el tueste');
  const ventas = Number((await copia.uno('SELECT COUNT(*) AS n FROM ventas')).n);
  assert.equal(ventas, 1);
  await copia.cerrar();
});

test('respaldo: exige la clave de acceso', async () => {
  const conClave = crearApp(db, { apiToken: 'clave-de-prueba', timezone: 'America/Bogota', uploadsDir, publicDir: path.resolve('public') });
  const s = conClave.listen(0, '127.0.0.1');
  await new Promise((ok) => s.once('listening', ok));
  const url = `http://127.0.0.1:${s.address().port}/api/respaldo`;
  try {
    assert.equal((await fetch(url)).status, 401, 'sin clave no debe entregar la base');
    const ok = await fetch(url, { headers: { Authorization: 'Bearer clave-de-prueba' } });
    assert.equal(ok.status, 200);
  } finally {
    s.close();
  }
});

test('claves por persona: marcan quién registró y no se pueden falsear', async () => {
  const app = crearApp(db, {
    apiToken: 'clave-compartida',
    usuarios: [{ nombre: 'Maick', token: 'clave-de-maick' }, { nombre: 'Jhon', token: 'clave-de-jhon' }],
    timezone: 'America/Bogota',
    uploadsDir,
    publicDir: path.resolve('public'),
  });
  const s = app.listen(0, '127.0.0.1');
  await new Promise((ok) => s.once('listening', ok));
  const url = `http://127.0.0.1:${s.address().port}`;
  const como = (clave, ruta, opciones = {}) => fetch(`${url}${ruta}`, {
    ...opciones,
    headers: { ...(opciones.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${clave}` },
  });

  try {
    // Cada clave dice quién es; la compartida entra sin nombre.
    assert.equal((await (await como('clave-de-maick', '/api/yo')).json()).usuario, 'Maick');
    assert.equal((await (await como('clave-de-jhon', '/api/yo')).json()).usuario, 'Jhon');
    const compartida = await (await como('clave-compartida', '/api/yo')).json();
    assert.equal(compartida.usuario, null);
    assert.equal(compartida.clave_compartida, true);
    assert.deepEqual(compartida.personas, ['Maick', 'Jhon']);
    assert.equal((await fetch(`${url}/api/yo`)).status, 401);

    // Lo que registra cada uno queda marcado con su nombre.
    const deJhon = await (await como('clave-de-jhon', '/api/gastos', {
      method: 'POST',
      body: JSON.stringify({ fecha: '2026-10-26', categoria: 'transporte', descripcion: 'Flete de la trilla', valor_cop: 30000 }),
    })).json();
    assert.equal(deJhon.registrado_por, 'Jhon');

    // Mandarlo en el cuerpo no sirve: lo pone el servidor, no el cliente.
    const mentira = await (await como('clave-de-maick', '/api/gastos', {
      method: 'POST',
      body: JSON.stringify({ fecha: '2026-10-26', categoria: 'otros', descripcion: 'Intento', valor_cop: 1000, registrado_por: 'Jhon' }),
    })).json();
    assert.equal(mentira.registrado_por, 'Maick');

    // Y editar después no reescribe quién lo registró.
    const editado = await (await como('clave-de-maick', `/api/gastos/${deJhon.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ valor_cop: 35000, registrado_por: 'Maick' }),
    })).json();
    assert.equal(editado.valor_cop, 35000);
    assert.equal(editado.registrado_por, 'Jhon', 'el registro sigue siendo de quien lo hizo');

    // Un PUT completo tampoco lo borra.
    const reemplazado = await (await como('clave-de-maick', `/api/gastos/${deJhon.id}`, {
      method: 'PUT',
      body: JSON.stringify({ fecha: '2026-10-26', categoria: 'transporte', descripcion: 'Flete', valor_cop: 40000 }),
    })).json();
    assert.equal(reemplazado.registrado_por, 'Jhon');
  } finally {
    s.close();
  }
});

test('sin claves por persona todo sigue funcionando sin nombre', async () => {
  const { json } = await pedir('/api/yo');
  assert.equal(json.usuario, null);
  assert.equal(json.clave_compartida, false, 'este servidor de prueba no pide clave');
  const g = await pedir('/api/gastos', {
    metodo: 'POST',
    cuerpo: { fecha: '2026-10-27', categoria: 'otros', descripcion: 'Sin clave propia', valor_cop: 500 },
  });
  assert.equal(g.json.registrado_por, null);
});

test('el total de la venta se guarda calculado, no solo al mostrar', async () => {
  const v = await pedir('/api/ventas', {
    metodo: 'POST',
    cuerpo: {
      fecha: '2026-10-28', canal: 'directo', cliente: 'Vecino',
      unidades: 3, precio_unitario_cop: 24000, descuento_cop: 2000,
    },
  });
  assert.equal(v.status, 201);
  assert.equal(v.json.total_cop, 70000, '3 × 24.000 − 2.000, guardado en la columna');

  // Guardado de verdad: aparece en el CSV, que lee las columnas crudas.
  const csv = await (await fetch(`${base}/api/exportar/ventas.csv`)).text();
  assert.ok(csv.includes('70000'), 'el CSV trae el total');

  // Si cambian las unidades, el total se recalcula.
  const editada = await pedir(`/api/ventas/${v.json.id}`, { metodo: 'PATCH', cuerpo: { unidades: 5 } });
  assert.equal(editada.json.total_cop, 118000, '5 × 24.000 − 2.000');

  // Pero un total escrito a mano se respeta.
  const aMano = await pedir(`/api/ventas/${v.json.id}`, { metodo: 'PATCH', cuerpo: { total_cop: 100000 } });
  assert.equal(aMano.json.total_cop, 100000);
});
