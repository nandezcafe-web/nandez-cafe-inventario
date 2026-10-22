import os from 'node:os';
import { config } from './config.js';
import { abrirDb } from './db/index.js';
import { sembrarSiVacia } from './db/semilla.js';
import { crearApp } from './app.js';
import { sincronizarOpenMeteo } from './routes/clima.js';
import { calcularPrediccion } from './lib/prediccion.js';

const db = await abrirDb(config.dbPath);
if (await sembrarSiVacia(db)) console.log('Base de datos nueva: se cargaron la finca, los lotes y las oportunidades iniciales.');

const app = crearApp(db, config);
const servidor = app.listen(config.port, config.host, () => {
  console.log(`Nández Café · servidor escuchando en http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  if (config.host === '0.0.0.0') {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i?.family === 'IPv4' && !i.internal);
    for (const i of ips) console.log(`  En la red local: http://${i.address}:${config.port}`);
    if (!config.apiToken) console.warn('  ⚠ Accesible en la red SIN API_TOKEN. Defina API_TOKEN en .env.');
  }
  console.log(`Base de datos: ${config.dbPath}`);
});

// Monitoreo automático de clima y riesgos para cada finca con coordenadas.
async function monitorear() {
  const fincas = await db.todos('SELECT id, nombre FROM fincas WHERE latitud IS NOT NULL AND longitud IS NOT NULL');
  for (const f of fincas) {
    try {
      const s = await sincronizarOpenMeteo(db, { fincaId: f.id, dias: 2, timezone: config.timezone, modelos: config.climaModelos });
      const p = await calcularPrediccion(db, f.id, { timezone: config.timezone, modelos: config.climaModelos });
      const altos = p.riesgos.filter((r) => r.nivel === 'alto').map((r) => r.nombre);
      console.log(`[monitoreo] ${f.nombre}: ${s.horas_guardadas} h de clima; riesgos altos: ${altos.join(', ') || 'ninguno'}`);
    } catch (e) {
      console.warn(`[monitoreo] ${f.nombre}: ${e.message}`);
    }
  }
}

let temporizador = null;
if (config.climaAutoHoras > 0) {
  setTimeout(monitorear, 5_000);
  temporizador = setInterval(monitorear, config.climaAutoHoras * 3_600_000);
}

function cerrar() {
  clearInterval(temporizador);
  servidor.close(async () => {
    await db.cerrar();
    process.exit(0);
  });
}
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
