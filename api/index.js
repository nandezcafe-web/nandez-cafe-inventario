import { config } from '../src/config.js';
import { abrirDb } from '../src/db/index.js';
import { sembrarSiVacia } from '../src/db/semilla.js';
import { crearApp } from '../src/app.js';

// Punto de entrada en Vercel. vercel.json manda aquí todo /api y /uploads; las
// páginas del panel las sirve Vercel directo desde public/.
//
// Cada instancia arranca en frío una vez: abre la base, la migra si cambió el
// modelo y arma la app; las peticiones siguientes reutilizan todo eso. Se
// guarda la promesa, no el resultado, para que dos peticiones que llegan juntas
// al arrancar no abran la base dos veces. Si el arranque falla, se olvida y el
// siguiente intento vuelve a probar.
let preparando = null;

function preparar() {
  preparando ??= (async () => {
    if (!config.databaseUrl) {
      throw new Error('Falta DATABASE_URL: en línea la base es Supabase (ver DESPLIEGUE.md).');
    }
    const db = await abrirDb(config.databaseUrl);
    await sembrarSiVacia(db);
    return crearApp(db, config);
  })().catch((e) => {
    preparando = null;
    throw e;
  });
  return preparando;
}

export default async function handler(req, res) {
  let app;
  try {
    app = await preparar();
  } catch (e) {
    // El detalle va al registro de Vercel, no al navegador: un error de
    // conexión puede nombrar el servidor de la base.
    console.error('[arranque]', e);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      error: config.databaseUrl
        ? 'El servidor no pudo conectarse a la base de datos. Revise DATABASE_URL en Vercel y el registro de la función.'
        : 'Falta configurar DATABASE_URL en Vercel.',
    }));
    return;
  }
  return app(req, res);
}
