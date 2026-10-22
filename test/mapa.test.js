import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { abrirDb } from '../src/db/index.js';
import { sembrarSiVacia } from '../src/db/semilla.js';
import { crearApp } from '../src/app.js';
import { areaHectareas, centroide, geometriaValida } from '../src/lib/geo.js';
import { generarCuadricula, direccionVectorial } from '../src/lib/mapaClima.js';

let servidor;
let base;
let db;
let consultas = 0;

// Cuadrado de ~100 m × 100 m cerca de la finca (1 ha aprox.)
const dLat = 100 / 111_320;
const dLon = 100 / (111_320 * Math.cos((7.59 * Math.PI) / 180));
const CUADRADO = {
  type: 'Polygon',
  coordinates: [[[-72.5928, 7.59], [-72.5928 + dLon, 7.59], [-72.5928 + dLon, 7.59 + dLat], [-72.5928, 7.59 + dLat], [-72.5928, 7.59]]],
};

async function fetchFalso(entrada) {
  consultas++;
  const url = new URL(String(entrada));
  const lats = url.searchParams.get('latitude').split(',');
  const horas = Number(url.searchParams.get('forecast_hours'));
  const time = Array.from({ length: horas }, (_, i) => `2026-09-15T${String(i % 24).padStart(2, '0')}:00`);
  const serie = (v) => time.map(() => v);
  const cuerpo = lats.map((lat, k) => ({
    latitude: Number(lat),
    hourly: {
      time,
      precipitation_a: serie(k), precipitation_b: serie(k + 2), precipitation_c: serie(100),
      wind_speed_10m_a: serie(2), wind_speed_10m_b: serie(2),
      wind_direction_10m_a: serie(350), wind_direction_10m_b: serie(10),
      temperature_2m_a: serie(20), cloud_cover_a: serie(30), is_day_a: serie(1),
    },
    daily: { time: ['2026-09-15'], sunrise_a: ['2026-09-15T05:40'], sunset_a: ['2026-09-15T17:50'], sunshine_duration_a: [36000] },
  }));
  return { ok: true, json: async () => cuerpo };
}

before(async () => {
  db = await abrirDb(':memory:');
  await sembrarSiVacia(db);
  const app = crearApp(db, {
    apiToken: null, timezone: 'America/Bogota', uploadsDir: path.join(os.tmpdir(), 'cafe-mapa-test'), publicDir: path.resolve('public'),
    fetchImpl: fetchFalso, climaModelos: 'a,b,c',
  });
  await new Promise((ok) => { servidor = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  servidor.close();
  await db.cerrar();
});

test('geo: área, centroide y validación de polígonos', () => {
  const ha = areaHectareas(CUADRADO);
  assert.ok(Math.abs(ha - 1) < 0.02, `área ${ha}`);
  assert.ok(Math.abs(centroide(CUADRADO).latitud - 7.5904) < 0.001);
  assert.equal(geometriaValida(CUADRADO), true);
  assert.equal(geometriaValida({ type: 'Point', coordinates: [1, 2] }), false);
  assert.equal(geometriaValida({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }), false);
});

test('cuadrícula y viento vectorial', () => {
  const c = generarCuadricula(7.6, -72.6, 3, 0.2);
  assert.equal(c.length, 9);
  assert.deepEqual(c[4], { latitud: 7.6, longitud: -72.6 });
  assert.deepEqual(c[0], { latitud: 7.8, longitud: -72.8 });
  // 350° y 10° deben promediar ~0° (norte), no 180°
  assert.equal(direccionVectorial([350, 10], [2, 2]), 0);
  assert.equal(direccionVectorial([90, 90], [1, 3]), 90);
  assert.equal(direccionVectorial([null], [null]), null);
});

test('lote: guardar borde dibujado, rechazar geometría inválida y calcular área', async () => {
  const malo = await fetch(`${base}/api/lotes/1`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geometria: { type: 'Point', coordinates: [0, 0] } }),
  });
  assert.equal(malo.status, 400);

  const ok = await fetch(`${base}/api/lotes/1`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geometria: CUADRADO, area_ha: 1 }),
  });
  assert.equal(ok.status, 200);
  const lote = await ok.json();
  assert.equal(lote.geometria.type, 'Polygon');
  assert.ok(Math.abs(lote.area_mapa_ha - 1) < 0.02);

  const capas = await (await fetch(`${base}/api/mapa/capas`)).json();
  assert.equal(capas.lotes[0].geometria.type, 'Polygon');
  assert.ok(capas.lotes[0].centro.latitud > 7.59);
  assert.equal(capas.finca.nombre, 'Finca familiar');
});

test('clima regional: mediana por punto, finca aparte y caché', async () => {
  const r = await fetch(`${base}/api/mapa/clima?n=3&paso=0.2&horas=24`);
  assert.equal(r.status, 200);
  const c = await r.json();
  assert.equal(c.puntos.length, 9);
  assert.equal(c.horas.length, 24);
  // finca = índice 0 → lluvias [0, 2, 100] → mediana 2 (el valor extremo no domina)
  assert.equal(c.finca.lluvia_mm[0], 2);
  assert.equal(c.puntos[0].lluvia_mm[0], 3); // k=1 → [1, 3, 100]
  assert.equal(c.finca.viento_dir[0], 0);
  assert.equal(c.finca.diario.amanecer[0], '05:40');
  assert.equal(c.finca.diario.horas_sol[0], 10);
  assert.equal(c.cuadricula.paso_km_aprox, 22);

  const antes = consultas;
  await fetch(`${base}/api/mapa/clima?n=3&paso=0.2&horas=24`);
  assert.equal(consultas, antes, 'segunda consulta desde caché');

  assert.equal((await fetch(`${base}/api/mapa/clima?n=4`)).status, 400);
});

test('Leaflet se sirve localmente', async () => {
  const r = await fetch(`${base}/vendor/leaflet/leaflet.js`);
  assert.equal(r.status, 200);
  const m = await fetch(`${base}/mapa.js`);
  assert.equal(m.status, 200);
});
