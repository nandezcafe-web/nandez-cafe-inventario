import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');

// "Nombre:clave,Otro:clave" → [{ nombre, token }]. Se ignora lo que esté mal
// formado en vez de tumbar el arranque: una clave de menos deja a alguien sin
// entrar, pero una excepción deja a los dos sin sistema.
function parsearUsuarios(valor) {
  if (!valor) return [];
  return valor
    .split(',')
    .map((par) => {
      const corte = par.indexOf(':');
      if (corte <= 0) return null;
      const nombre = par.slice(0, corte).trim();
      const token = par.slice(corte + 1).trim();
      return nombre && token ? { nombre, token } : null;
    })
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
  dbPath: process.env.DB_PATH === ':memory:'
    ? ':memory:'
    : path.resolve(raiz, process.env.DB_PATH ?? 'data/cafe.db'),
  // Con DATABASE_URL (Supabase) la base vive en Postgres; sin ella, en el
  // archivo SQLite de dbPath. Ver src/db/index.js.
  databaseUrl: process.env.DATABASE_URL || null,
  // En Vercel no hay disco propio ni un proceso que siga vivo entre peticiones:
  // cambia dónde van las fotos y cómo se sincroniza el clima.
  enLinea: Boolean(process.env.VERCEL),
  // Supabase Storage para fotos y documentos en línea. Opcional: sin esto, en
  // línea las subidas se rechazan con un aviso en vez de perderse.
  storage: process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? {
      url: process.env.SUPABASE_URL,
      clave: process.env.SUPABASE_SERVICE_ROLE_KEY,
      bucket: process.env.SUPABASE_BUCKET || 'adjuntos',
    }
    : null,
  // Vercel la manda en Authorization al llamar las tareas programadas.
  cronSecret: process.env.CRON_SECRET || null,
  uploadsDir: path.resolve(raiz, process.env.UPLOADS_DIR ?? 'data/uploads'),
  apiToken: process.env.API_TOKEN || null,
  // USUARIOS=Maick:clave1,Jhon:clave2 — una clave por persona, para saber quién
  // registró cada cosa. Conviven con API_TOKEN, que queda como clave compartida.
  usuarios: parsearUsuarios(process.env.USUARIOS),
  timezone: process.env.TIMEZONE ?? 'America/Bogota',
  // Cada cuántas horas se sincroniza el clima y se recalculan los riesgos (0 = desactivado).
  climaAutoHoras: Number(process.env.CLIMA_AUTO_HORAS ?? 3),
  // Modelos de Open-Meteo combinados por mediana (ver src/lib/fuentesClima.js).
  climaModelos: process.env.CLIMA_MODELOS || undefined,
  publicDir: path.join(raiz, 'public'),
};
