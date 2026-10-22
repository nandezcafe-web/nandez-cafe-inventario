// Genera un HTML autónomo de demostración (un solo archivo, sin servidor) con una
// foto de los datos actuales: resumen, predicción, mapa y clima, plan y biomasa.
//
//   npm run demo                      → demo/cafe-demo.html
//   npm run demo -- ruta.html
//   npm run demo -- --sin-mosaicos    → sin imágenes satelitales incrustadas (más liviano)
//
// Usa la base de datos real (solo lectura de API) y consulta el clima en internet.
// La librería de mapas y una selección de imágenes satelitales quedan DENTRO del
// archivo, para que el mapa se vea aunque el visor bloquee internet.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { abrirDb } from '../src/db/index.js';
import { crearApp } from '../src/app.js';
import { SUBPRODUCTOS_INFO, REFERENCIAS } from '../src/conocimiento/subproductos.js';

const raiz = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const sinMosaicos = args.includes('--sin-mosaicos');
const destino = path.resolve(raiz, args.find((a) => !a.startsWith('--')) ?? 'demo/cafe-demo.html');

// ---------- Imágenes satelitales incrustadas ----------
// Niveles de zoom: región (cuadrícula de clima) → municipio → finca.
const NIVELES = [
  { z: 9, radio: 2, etiquetas: true },
  { z: 11, radio: 2, etiquetas: true },
  { z: 14, radio: 1, etiquetas: false },
  { z: 16, radio: 2, etiquetas: false },
];
const URL_SATELITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
const URL_ETIQUETAS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile';

function lonLatAMosaico(lon, lat, z) {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  };
}

function mosaicoALonLat(x, y, z) {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lon, lat };
}

async function descargarDataUri(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'cafe-chinacota-demo' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const tipo = resp.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
  return `data:${tipo};base64,${Buffer.from(await resp.arrayBuffer()).toString('base64')}`;
}

async function descargarMosaicos(finca) {
  const trabajos = [];
  for (const { z, radio, etiquetas } of NIVELES) {
    const c = lonLatAMosaico(finca.longitud, finca.latitud, z);
    for (let dx = -radio; dx <= radio; dx++) {
      for (let dy = -radio; dy <= radio; dy++) {
        const clave = `${z}/${c.x + dx}/${c.y + dy}`;
        trabajos.push({ conjunto: 'satelite', clave, url: `${URL_SATELITE}/${z}/${c.y + dy}/${c.x + dx}` });
        if (etiquetas) trabajos.push({ conjunto: 'etiquetas', clave, url: `${URL_ETIQUETAS}/${z}/${c.y + dy}/${c.x + dx}` });
      }
    }
  }

  const resultado = { satelite: {}, etiquetas: {} };
  let fallos = 0;
  const cola = [...trabajos];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cola.length) {
      const t = cola.shift();
      try {
        resultado[t.conjunto][t.clave] = await descargarDataUri(t.url);
      } catch {
        fallos++;
      }
    }
  }));

  // Límites del nivel más amplio, para no dejar navegar a zonas sin imagen.
  const { z, radio } = NIVELES[0];
  const c = lonLatAMosaico(finca.longitud, finca.latitud, z);
  const noroeste = mosaicoALonLat(c.x - radio, c.y - radio, z);
  const sureste = mosaicoALonLat(c.x + radio + 1, c.y + radio + 1, z);
  resultado.limites = [[sureste.lat, noroeste.lon], [noroeste.lat, sureste.lon]];
  resultado.zoom = { min: NIVELES[0].z, max: 18 };
  resultado.atribucion = 'Imágenes © Esri, Maxar, Earthstar Geographics';
  console.log(`  Imágenes satelitales: ${trabajos.length - fallos}/${trabajos.length} descargadas`);
  return resultado;
}

const sinCierreEtiqueta = (texto, etiqueta) => texto.replace(new RegExp(`</${etiqueta}`, 'gi'), `<\\/${etiqueta}`);

const db = abrirDb(config.dbPath);
const app = crearApp(db, { ...config, apiToken: null });
const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
const base = `http://127.0.0.1:${servidor.address().port}/api`;

async function obtener(ruta, { opcional = false } = {}) {
  const resp = await fetch(`${base}${ruta}`);
  if (!resp.ok) {
    const msg = `${ruta}: HTTP ${resp.status} ${await resp.text()}`;
    if (opcional) {
      console.warn(`  ⚠ ${msg}`);
      return null;
    }
    throw new Error(msg);
  }
  return resp.json();
}

try {
  console.log('Recolectando datos…');
  const [resumen, prediccion, climatologia, agenda, capas, climaRegional, ranking] = await Promise.all([
    obtener('/resumen'),
    obtener('/prediccion', { opcional: true }),
    obtener('/prediccion/climatologia', { opcional: true }),
    obtener('/plan/agenda?dias=30'),
    obtener('/mapa/capas'),
    obtener('/mapa/clima', { opcional: true }),
    obtener('/oportunidades-ranking'),
  ]);

  const datos = {
    generado: new Date().toISOString(),
    resumen, prediccion, climatologia, agenda, capas, climaRegional, ranking,
    conocimiento: SUBPRODUCTOS_INFO,
    referencias: REFERENCIAS,
  };

  const mosaicos = sinMosaicos ? null : await descargarMosaicos(capas.finca);

  const leer = (ruta) => fs.readFileSync(path.join(raiz, ruta), 'utf8');
  const plantilla = leer('scripts/demo/plantilla.html');
  const css = leer('public/estilos.css');
  const js = leer('scripts/demo/demo.js');
  // El CSS de Leaflet apunta a íconos que no usamos; se quitan esas rutas.
  const leafletCss = leer('node_modules/leaflet/dist/leaflet.css').replace(/url\(images\/[^)]+\)/g, 'none');
  const leafletJs = leer('node_modules/leaflet/dist/leaflet.js');
  // Evita que el contenido rompa las etiquetas <script>/<style>.
  const json = (valor) => JSON.stringify(valor).replace(/</g, '\\u003c');

  const html = plantilla
    .replace('/*__CSS__*/', () => sinCierreEtiqueta(css, 'style'))
    .replace('/*__LEAFLET_CSS__*/', () => sinCierreEtiqueta(leafletCss, 'style'))
    .replace('/*__DATOS__*/null', () => json(datos))
    .replace('/*__MOSAICOS__*/null', () => json(mosaicos))
    .replace('/*__LEAFLET_JS__*/', () => sinCierreEtiqueta(leafletJs, 'script'))
    .replace('/*__JS__*/', () => sinCierreEtiqueta(js, 'script'));

  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, html);
  console.log(`Listo: ${destino} (${Math.round(html.length / 1024)} KB)`);
} finally {
  servidor.close();
  db.close();
}
