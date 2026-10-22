import os from 'node:os';
import { config } from './config.js';
import { abrirDb } from './db/index.js';
import { sembrarSiVacia } from './db/semilla.js';
import { crearApp } from './app.js';
import { monitorear } from './lib/monitoreo.js';

const db = await abrirDb(config.databaseUrl ?? config.dbPath);
if (await sembrarSiVacia(db)) console.log('Base de datos nueva: se cargaron la finca, los lotes y las oportunidades iniciales.');

const app = crearApp(db, config);
const servidor = app.listen(config.port, config.host, () => {
  console.log(`Nández Café · servidor escuchando en http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  if (config.host === '0.0.0.0') {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i?.family === 'IPv4' && !i.internal);
    for (const i of ips) console.log(`  En la red local: http://${i.address}:${config.port}`);
    if (!config.apiToken) console.warn('  ⚠ Accesible en la red SIN API_TOKEN. Defina API_TOKEN en .env.');
  }
  console.log(`Base de datos: ${config.databaseUrl ? `Postgres en ${new URL(config.databaseUrl).hostname}` : config.dbPath}`);
});

// Monitoreo automático de clima y riesgos (ver lib/monitoreo.js). En línea no
// corre esto: lo hace la tarea diaria de Vercel.
const monitorearAhora = () => monitorear(db, config);
let temporizador = null;
if (config.climaAutoHoras > 0) {
  setTimeout(monitorearAhora, 5_000);
  temporizador = setInterval(monitorearAhora, config.climaAutoHoras * 3_600_000);
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
