import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirDb } from '../src/db/index.js';
import { sembrarSiVacia } from '../src/db/semilla.js';
import { crearApp } from '../src/app.js';
import { sumarDias } from '../src/lib/derivados.js';
import { hoyEn } from '../src/lib/prediccion.js';
import { parsearOni, faseEnso, combinarModelos } from '../src/lib/fuentesClima.js';
import { mejorDia } from '../src/lib/agroclima.js';

const TZ = 'America/Bogota';
const HOY = hoyEn(TZ);
let servidor;
let base;
let db;
let uploadsDir;
let llamadasExternas = 0;

// Escenario: 20 días lluviosos, 10 días secos hasta ayer, hoy seco,
// mañana aguacero de 55 mm y después lluvias leves. ONI en La Niña fuerte.
function diarioSimulado() {
  const dias = [];
  for (let i = -30; i < 16; i++) {
    const fecha = sumarDias(HOY, i);
    let d;
    if (i < -10) d = { ll: 5, p: 90, tm: 20, hr: 90, et0: 3 };
    else if (i <= 0) d = { ll: 0, p: 10, tm: 22, hr: 60, et0: 4 };
    else if (i === 1) d = { ll: 55, p: 100, tm: 19, hr: 95, et0: 2 };
    else d = { ll: 3, p: 80, tm: 20, hr: 88, et0: 3 };
    dias.push({ fecha, ...d, tmax: i === 3 ? 31 : 25, tmin: 15 });
  }
  return {
    elevation: 1487,
    daily: {
      time: dias.map((d) => d.fecha),
      precipitation_sum: dias.map((d) => d.ll),
      precipitation_probability_max: dias.map((d) => d.p),
      temperature_2m_max: dias.map((d) => d.tmax),
      temperature_2m_min: dias.map((d) => d.tmin),
      temperature_2m_mean: dias.map((d) => d.tm),
      relative_humidity_2m_mean: dias.map((d) => d.hr),
      wind_speed_10m_max: dias.map(() => 2),
      wind_gusts_10m_max: dias.map(() => 5),
      et0_fao_evapotranspiration: dias.map((d) => d.et0),
    },
  };
}

function archivoSimulado(url) {
  const inicio = url.searchParams.get('start_date');
  const fin = url.searchParams.get('end_date');
  const time = [];
  const lluvia = [];
  for (let f = inicio; f <= fin; f = sumarDias(f, 1)) {
    const mes = Number(f.slice(5, 7));
    time.push(f);
    lluvia.push([1, 2, 12].includes(mes) ? 0.5 : [4, 5, 10, 11].includes(mes) ? 8 : 3);
  }
  return {
    elevation: 1487,
    daily: {
      time,
      precipitation_sum: lluvia,
      temperature_2m_mean: time.map(() => 19.5),
      temperature_2m_max: time.map(() => 25),
      temperature_2m_min: time.map(() => 15),
      et0_fao_evapotranspiration: time.map(() => 3),
    },
  };
}

const ONI = `SEAS  YR   TOTL   ANOM
  JJA 2026  26.10  -0.80
  JAS 2026  25.90  -1.10
`;

async function fetchFalso(entrada) {
  llamadasExternas++;
  const url = new URL(String(entrada));
  const ok = (cuerpo, texto = false) => ({ ok: true, status: 200, json: async () => cuerpo, text: async () => (texto ? cuerpo : JSON.stringify(cuerpo)) });
  if (url.hostname === 'api.open-meteo.com') return ok(diarioSimulado());
  if (url.hostname === 'archive-api.open-meteo.com') return ok(archivoSimulado(url));
  if (url.hostname === 'www.cpc.ncep.noaa.gov') return ok(ONI, true);
  throw new Error(`URL inesperada ${url}`);
}

const pedir = async (ruta, { metodo = 'GET', cuerpo } = {}) => {
  const resp = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: resp.status, json: resp.status === 204 ? null : await resp.json() };
};

before(async () => {
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cafe-pred-'));
  db = await abrirDb(':memory:');
  await sembrarSiVacia(db);
  const app = crearApp(db, { apiToken: null, timezone: TZ, uploadsDir, publicDir: path.resolve('public'), fetchImpl: fetchFalso });
  await new Promise((ok) => { servidor = app.listen(0, '127.0.0.1', ok); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  servidor.close();
  await db.cerrar();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
});

test('ONI: lectura y fase', () => {
  const filas = parsearOni(ONI);
  assert.equal(filas.length, 2);
  assert.deepEqual(filas[1], { trimestre: 'JAS', anio: 2026, anomalia: -1.1 });
  assert.equal(faseEnso(-1.1), 'la_nina');
  assert.equal(faseEnso(0.2), 'neutral');
  assert.equal(faseEnso(0.7), 'el_nino');
});

test('combinarModelos: mediana y rango con varios modelos o uno solo', () => {
  const bloque = {
    time: ['2026-09-14', '2026-09-15'],
    precipitation_sum_a: [30, 1], precipitation_sum_b: [2, null], precipitation_sum_c: [4, 3],
  };
  const r = combinarModelos(bloque, 'precipitation_sum', ['a', 'b', 'c']);
  assert.deepEqual(r[0], { mediana: 4, min: 2, max: 30, n: 3 });
  assert.deepEqual(r[1], { mediana: 2, min: 1, max: 3, n: 2 });
  const solo = combinarModelos({ time: ['x'], precipitation_sum: [7] }, 'precipitation_sum', ['a']);
  assert.equal(solo[0].mediana, 7);
});

test('predicción: riesgos del escenario simulado', async () => {
  const r = await pedir('/api/prediccion');
  assert.equal(r.status, 200);
  assert.equal(r.json.pronostico.length, 16);
  assert.equal(r.json.historial.length, 30);
  assert.equal(r.json.resumen.lluvia_proximos_7d_mm, 55 + 5 * 3);

  const porId = Object.fromEntries(r.json.riesgos.map((x) => [x.id.startsWith('floracion') ? 'floracion' : x.id, x]));
  assert.equal(porId.lluvia_intensa.nivel, 'alto');
  assert.equal(porId.sequia.nivel, 'medio');
  assert.match(porId.sequia.evidencia.join(' '), /11 días seguidos/);
  assert.match(porId.sequia.evidencia.join(' '), /Lote 1, Lote 2/, 'señala los lotes jóvenes');
  assert.equal(porId.calor.nivel, 'medio');
  assert.equal(porId.enso.nivel, 'alto');
  assert.equal(porId.enso.nombre, 'Fenómeno La Niña activo');
  assert.equal(porId.floracion.periodo.desde, sumarDias(HOY, 8));
  assert.equal(porId.floracion.periodo.hasta, sumarDias(HOY, 13));
  assert.equal(porId.broca, undefined, 'sin lotes con frutos no se evalúa broca');
  assert.equal(r.json.riesgos[0].nivel, 'alto', 'ordenados por nivel');
});

test('predicción: ventanas de labores', async () => {
  const { json } = await pedir('/api/prediccion');
  const fert = json.ventanas.fertilizacion.dias;
  assert.equal(fert[0].apto, false);
  assert.ok(fert[0].motivos.some((m) => m.includes('día siguiente')));
  const dron = json.ventanas.vuelo_dron.dias;
  assert.equal(dron[0].apto, true);
  assert.equal(dron[1].apto, false);
  // Día 2: lluvia de 3 mm, suelo húmedo por el aguacero anterior → apto para fertilizar
  assert.equal(fert[2].apto, true);
});

test('predicción usa caché y el resumen muestra los riesgos sin consultar internet', async () => {
  const antes = llamadasExternas;
  await pedir('/api/prediccion');
  assert.equal(llamadasExternas, antes, 'segunda consulta dentro de 1 h sale de caché');

  const resumen = await pedir('/api/resumen');
  assert.ok(resumen.json.alertas.some((a) => a.tipo === 'clima_riesgo' && a.nivel === 'alta'));
  assert.equal(llamadasExternas, antes);
});

test('climatología de la ubicación y próximos meses', async () => {
  const r = await pedir('/api/prediccion/climatologia');
  assert.equal(r.status, 200);
  assert.equal(r.json.meses.length, 12);
  const enero = r.json.meses[0];
  assert.equal(enero.temporada, 'mas_seco');
  assert.equal(enero.lluvia_media_mm, 15.5); // 31 días × 0.5 mm
  assert.equal(enero.anios, 10);
  assert.ok(r.json.meses.filter((m) => m.temporada === 'mas_lluvioso').length === 3);
  assert.equal(r.json.proximos_meses.length, 4);
  assert.ok(r.json.proximos_meses[0].que_esperar.length > 10);
});

test('plan de cultivo: generar, evitar duplicados, completar y repetir', async () => {
  const gen = await pedir('/api/plan/generar', { metodo: 'POST', cuerpo: { lote_id: 2 } });
  assert.equal(gen.status, 201);
  assert.equal(gen.json.etapa, 'levante');
  assert.equal(gen.json.datos.length, 6);

  assert.equal((await pedir('/api/plan/generar', { metodo: 'POST', cuerpo: { lote_id: 2 } })).status, 409);
  const re = await pedir('/api/plan/generar', { metodo: 'POST', cuerpo: { lote_id: 2, reemplazar: true } });
  assert.equal(re.status, 201);
  assert.equal((await pedir('/api/plan_labores?lote_id=2&estado=pendiente')).json.total, 6);

  const monitoreo = re.json.datos.find((t) => t.tipo === 'monitoreo_plagas');
  assert.equal(monitoreo.fecha_programada, HOY);
  const hecho = await pedir(`/api/plan/${monitoreo.id}/completar`, { metodo: 'POST', cuerpo: { notas: 'Sin roya visible', jornales: 0.5 } });
  assert.equal(hecho.status, 201);
  assert.equal(hecho.json.tarea.estado, 'hecha');
  assert.equal(hecho.json.actividad.tipo, 'monitoreo_plagas');
  assert.match(hecho.json.actividad.notas, /Sin roya visible/);
  assert.equal(hecho.json.siguiente.fecha_programada, sumarDias(HOY, 15));

  assert.equal((await pedir(`/api/plan/${monitoreo.id}/completar`, { metodo: 'POST', cuerpo: {} })).status, 409);
});

test('agenda: mejor día según el clima, proyecciones y vencidas', async () => {
  const vencida = await pedir('/api/plan_labores', {
    metodo: 'POST',
    cuerpo: { lote_id: 1, tipo: 'poda', titulo: 'Poda atrasada', fecha_programada: sumarDias(HOY, -5), prioridad: 'alta' },
  });
  assert.equal(vencida.status, 201);

  const r = await pedir('/api/plan/agenda?dias=45');
  assert.equal(r.status, 200);
  const dron = r.json.datos.find((t) => t.tipo === 'vuelo_dron' && !t.proyectada);
  assert.equal(dron.fecha_programada, sumarDias(HOY, 3));
  assert.equal(dron.clima.estado, 'mover');
  assert.equal(dron.clima.fecha_sugerida, HOY);

  const atrasada = r.json.datos.find((t) => t.titulo === 'Poda atrasada');
  assert.equal(atrasada.vencida, true);
  assert.equal(atrasada.dias_vencida, 5);
  assert.match(atrasada.consejo, /Atrasada/);

  assert.ok(r.json.datos.some((t) => t.proyectada && t.tipo === 'monitoreo_plagas'), 'proyecta repeticiones');

  const resumen = await pedir('/api/resumen');
  assert.ok(resumen.json.alertas.some((a) => a.tipo === 'plan' && a.nivel === 'alta'));
});

test('mejorDia sin pronóstico para fechas lejanas', () => {
  const dias = [{ fecha: HOY, apto: true, motivos: [] }];
  assert.equal(mejorDia(dias, sumarDias(HOY, 40), 3, HOY).estado, 'sin_pronostico');
  assert.equal(mejorDia(dias, HOY, 3, HOY).estado, 'apto');
});
