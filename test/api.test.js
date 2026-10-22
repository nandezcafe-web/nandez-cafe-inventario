import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirDb } from '../src/db/index.js';
import { sembrarSiVacia } from '../src/db/semilla.js';
import { crearApp } from '../src/app.js';
import { sincronizarOpenMeteo } from '../src/routes/clima.js';

let servidor;
let base;
let db;
let uploadsDir;

const pedir = async (ruta, { metodo = 'GET', cuerpo, headers = {} } = {}) => {
  const resp = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await resp.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* no json */ }
  return { status: resp.status, json, texto, headers: resp.headers };
};

before(async () => {
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cafe-test-'));
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

test('semilla: finca, 2 lotes y 8 ideas de oportunidad', async () => {
  const lotes = await pedir('/api/lotes');
  assert.equal(lotes.json.total, 2);
  assert.equal((await pedir('/api/oportunidades')).json.total, 8);
  assert.equal(await sembrarSiVacia(db), false, 'no debe volver a sembrar');
});

test('CRUD de labores con validación', async () => {
  const malo = await pedir('/api/actividades', { metodo: 'POST', cuerpo: { lote_id: 1, tipo: 'volar', fecha: '2026-02-30', xyz: 1 } });
  assert.equal(malo.status, 400);
  assert.match(malo.json.detalles.tipo, /opción inválida/);
  assert.match(malo.json.detalles.fecha, /fecha inválida/);
  assert.equal(malo.json.detalles.xyz, 'campo desconocido');

  const creado = await pedir('/api/actividades', {
    metodo: 'POST', cuerpo: { lote_id: 1, fecha: '2026-09-10', tipo: 'fertilizacion', producto: 'DAP', dosis: '30,5', unidad: 'g/planta' },
  });
  assert.equal(creado.status, 201);
  assert.equal(creado.json.dosis, 30.5);

  const parche = await pedir(`/api/actividades/${creado.json.id}`, { metodo: 'PATCH', cuerpo: { costo_cop: 120000 } });
  assert.equal(parche.json.costo_cop, 120000);
  assert.equal(parche.json.producto, 'DAP');

  const filtrado = await pedir('/api/actividades?lote_id=1&desde=2026-09-01&hasta=2026-09-30&q=DAP');
  assert.equal(filtrado.json.total, 1);

  const refMala = await pedir('/api/actividades', { metodo: 'POST', cuerpo: { lote_id: 999, fecha: '2026-09-10', tipo: 'poda' } });
  assert.equal(refMala.status, 409);
});

test('no se borra un lote con registros asociados', async () => {
  const r = await pedir('/api/lotes/1', { metodo: 'DELETE' });
  assert.equal(r.status, 409);
});

test('floración calcula ventana de cosecha y genera alerta cercana', async () => {
  const r = await pedir('/api/floraciones', { metodo: 'POST', cuerpo: { lote_id: 1, fecha: '2026-02-20', intensidad: 5, es_principal: 'si' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.cosecha_estimada.probable, '2026-10-02');

  const resumen = await pedir('/api/resumen');
  assert.equal(resumen.status, 200);
  assert.equal(resumen.json.totales.plantas, 4500);
  assert.ok(Array.isArray(resumen.json.alertas));
  assert.ok(resumen.json.datos_pendientes.some((p) => p.includes('altitud')));
});

test('motor "tengo X kg de Y": equivalencias y oportunidades ordenadas', async () => {
  const r = await pedir('/api/biomasa/evaluar', { metodo: 'POST', cuerpo: { tipo: 'pulpa', kg: 50, humedad_pct: 80 } });
  assert.equal(r.status, 200);
  assert.equal(r.json.equivalencias.kg_materia_seca, 10);
  assert.equal(r.json.equivalencias.kg_agua, 40);
  assert.ok(r.json.oportunidades.length >= 3);
  const puntajes = r.json.oportunidades.map((o) => o.puntaje);
  assert.deepEqual(puntajes, [...puntajes].sort((a, b) => b - a));
  const harina = r.json.oportunidades.find((o) => o.id === 'harina_pulpa');
  // 10 kg secos × 0.80–0.95, expresado al 10 % de humedad
  assert.equal(harina.producto_estimado.kg_min, 8.9);
  assert.equal(harina.viabilidad, 'requiere_laboratorio');

  const vencida = await pedir('/api/biomasa/evaluar', { metodo: 'POST', cuerpo: { tipo: 'mucilago', kg: 100, horas_desde_generacion: 30 } });
  assert.match(vencida.json.advertencias[0], /vida útil/);

  assert.equal((await pedir('/api/biomasa/evaluar', { metodo: 'POST', cuerpo: { tipo: 'oro', kg: 1 } })).status, 400);
});

test('generación de subproductos por kg de cereza', async () => {
  const r = await pedir('/api/biomasa/generacion?kg_cereza=1000&proceso=lavado');
  const pulpa = r.json.subproductos.find((s) => s.tipo === 'pulpa');
  assert.equal(pulpa.kg, 436);
});

test('costo puesto en planta: viajes limitados por volumen y distancia estimada', async () => {
  const prod = await pedir('/api/productores', {
    metodo: 'POST', cuerpo: { nombre: 'Vecino de prueba', latitud: 7.62, longitud: -72.60, disposicion: 'regalar' },
  });
  assert.equal(prod.status, 201);

  const r = await pedir('/api/logistica/costo', {
    metodo: 'POST',
    cuerpo: { tipo: 'pergamino', kg: 500, humedad_pct: 10, productor_id: prod.json.id, capacidad_kg: 1000, capacidad_m3: 2, costo_km_cop: 1500 },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.carga.limitante, 'volumen'); // 500 kg / 130 kg/m³ ≈ 3.85 m³ → 2 viajes
  assert.equal(r.json.carga.viajes, 2);
  assert.ok(r.json.distancia_estimada.linea_recta_km > 3);
  assert.equal(r.json.costos_cop.transporte, Math.round(r.json.entrada.distancia_km * 2 * 2 * 1500));

  const faltan = await pedir('/api/logistica/costo', { metodo: 'POST', cuerpo: { tipo: 'pulpa', kg: 10 } });
  assert.equal(faltan.status, 400);
  assert.ok(faltan.json.detalles.costo_km_cop);
});

test('ranking de oportunidades con índice 0–100', async () => {
  const puntajes = Object.fromEntries(
    ['disponibilidad', 'costo_adquisicion', 'logistica', 'estabilidad', 'complejidad_tecnica', 'inversion', 'rendimiento',
      'precio_venta', 'demanda', 'competencia', 'regulacion', 'diferenciacion', 'propiedad_intelectual', 'escalabilidad',
      'impacto_ambiental'].map((c) => [c, 5]),
  );
  await pedir('/api/oportunidades/1', { metodo: 'PATCH', cuerpo: puntajes });
  await pedir('/api/oportunidades/2', { metodo: 'PATCH', cuerpo: { disponibilidad: 1 } });

  const r = await pedir('/api/oportunidades-ranking');
  assert.equal(r.json.ranking[0].id, 1);
  assert.equal(r.json.ranking[0].indice, 100);
  const op2 = r.json.ranking.find((o) => o.id === 2);
  assert.equal(op2.indice, 0);
  assert.equal(op2.criterios_evaluados, 1);

  const fueraDeRango = await pedir('/api/oportunidades/1', { metodo: 'PATCH', cuerpo: { demanda: 9 } });
  assert.equal(fueraDeRango.status, 400);
});

test('clima: sincronización Open-Meteo guarda solo horas pasadas y no duplica', async () => {
  const falso = async () => ({
    ok: true,
    json: async () => ({
      elevation: 1480,
      hourly: {
        time: ['2020-01-01T00:00', '2020-01-01T01:00', '2999-01-01T00:00'],
        temperature_2m: [18.5, 18.1, 20],
        relative_humidity_2m: [90, 92, 80],
        precipitation: [0.2, 0, 0],
        shortwave_radiation: [0, 0, 0],
        wind_speed_10m: [1.1, 0.9, 2],
      },
    }),
  });
  const r1 = await sincronizarOpenMeteo(db, { fincaId: 1, dias: 1, timezone: 'America/Bogota', fetchImpl: falso });
  assert.equal(r1.horas_guardadas, 2);
  await sincronizarOpenMeteo(db, { fincaId: 1, dias: 1, timezone: 'America/Bogota', fetchImpl: falso });
  const clima = await pedir('/api/clima?fuente=open_meteo');
  assert.equal(clima.json.total, 2);

  const diario = await pedir('/api/clima/diario?finca_id=1');
  assert.equal(diario.json.datos[0].lluvia_mm, 0.2);
});

test('adjuntos: sube una imagen y valida la entidad', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('entidad', 'lotes');
  fd.append('entidad_id', '1');
  fd.append('archivos', new Blob([png], { type: 'image/png' }), 'hoja.png');
  const resp = await fetch(`${base}/api/adjuntos`, { method: 'POST', body: fd });
  assert.equal(resp.status, 201);
  const { datos } = await resp.json();
  assert.equal(fs.existsSync(path.join(uploadsDir, datos[0].archivo)), true);

  const img = await fetch(`${base}/uploads/${datos[0].archivo}`);
  assert.equal(img.status, 200);

  const malo = new FormData();
  malo.append('entidad', 'lotes');
  malo.append('entidad_id', '999');
  malo.append('archivos', new Blob([png], { type: 'image/png' }), 'x.png');
  const r2 = await fetch(`${base}/api/adjuntos`, { method: 'POST', body: malo });
  assert.equal(r2.status, 400);
  assert.equal(fs.readdirSync(uploadsDir).length, 1, 'el archivo rechazado se elimina');
});

test('exportar CSV con separador ; y BOM', async () => {
  const r = await pedir('/api/exportar/lotes.csv');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.ok(r.texto.startsWith('id;finca_id;nombre'));
  const bytes = new Uint8Array(await (await fetch(`${base}/api/exportar/lotes.csv`)).arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8 para Excel');
});

test('token de acceso cuando API_TOKEN está definido', async () => {
  const app = crearApp(db, { apiToken: 'secreto', timezone: 'America/Bogota', uploadsDir, publicDir: path.resolve('public') });
  const srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await fetch(`${url}/api/lotes`)).status, 401);
    assert.equal((await fetch(`${url}/api/lotes`, { headers: { Authorization: 'Bearer secreto' } })).status, 200);
    assert.equal((await fetch(`${url}/api/salud`)).status, 200);
    assert.equal((await fetch(`${url}/`)).status, 200, 'el panel carga sin token');
  } finally {
    srv.close();
  }
});

test('panel web y rutas inexistentes', async () => {
  const html = await pedir('/');
  assert.match(html.texto, /Nández Café/);
  assert.equal((await pedir('/api/no-existe')).status, 404);
  assert.equal((await pedir('/api/lotes/9999')).status, 404);
});
