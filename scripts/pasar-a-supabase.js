// Pasa todo lo registrado en la base local (SQLite) a Supabase.
//
//   node --env-file=.env scripts/pasar-a-supabase.js              → mira y dice qué haría
//   node --env-file=.env scripts/pasar-a-supabase.js --reemplazar → lo hace
//
// Toma el origen de DB_PATH (data/cafe.db) y el destino de DATABASE_URL.
//
// Barandas, porque esto escribe en la base en línea:
//   - Nunca pisa datos del negocio: si Supabase ya tiene lotes, procesos,
//     ventas, gastos o cualquier registro hecho por alguien, se detiene.
//   - Lo único que acepta reemplazar es lo que el sistema siembra solo al
//     arrancar (la finca, sus lotes, las ideas, el clima descargado), y solo
//     con --reemplazar.
//   - Copia todo en una transacción: o pasa completo o no pasa nada.
//   - Conserva los ids, para que las referencias entre tablas sigan apuntando
//     a lo mismo, y deja los contadores listos para el siguiente registro.
//   - Al final compara tabla por tabla con el origen.
import { config } from '../src/config.js';
import { abrirDb } from '../src/db/index.js';
import { recursos } from '../src/resources.js';

const reemplazar = process.argv.includes('--reemplazar');
const destinoUrl = process.env.DESTINO || config.databaseUrl; // DESTINO solo para probar con PGlite

if (!destinoUrl) {
  console.error('Falta DATABASE_URL en .env: es la cadena de conexión de Supabase (ver DESPLIEGUE.md).');
  process.exit(1);
}

// Lo que el sistema crea solo al arrancar. Todo lo demás lo registró alguien.
const DE_ARRANQUE = new Set(['fincas', 'lotes', 'oportunidades', 'plan_labores', 'clima', 'cache_externo']);
const TABLAS = ['cache_externo', ...Object.keys(recursos)];

const nombreDestino = /^postgres/.test(destinoUrl) ? `Supabase (${new URL(destinoUrl).hostname})` : destinoUrl;
console.log(`Origen:  ${config.dbPath}`);
console.log(`Destino: ${nombreDestino}\n`);

const origen = await abrirDb(config.dbPath);
const destino = await abrirDb(destinoUrl);

const contar = async (db) => Object.fromEntries(await Promise.all(
  TABLAS.map(async (t) => [t, Number((await db.uno(`SELECT COUNT(*) AS n FROM "${t}"`)).n)]),
));

const enOrigen = await contar(origen);
const enDestino = await contar(destino);

console.log(`${'tabla'.padEnd(16)} ${'local'.padStart(6)} ${'en línea'.padStart(9)}`);
for (const t of TABLAS) {
  if (enOrigen[t] || enDestino[t]) console.log(`${t.padEnd(16)} ${String(enOrigen[t]).padStart(6)} ${String(enDestino[t]).padStart(9)}`);
}
console.log();

const registradoEnLinea = TABLAS.filter((t) => !DE_ARRANQUE.has(t) && enDestino[t] > 0);
if (registradoEnLinea.length) {
  console.error(`Supabase ya tiene registros hechos por alguien en: ${registradoEnLinea.join(', ')}.`);
  console.error('No se reemplaza nada: se perderían. Si de verdad hay que pisarlos, bórrelos primero a mano.');
  await cerrarTodo();
  process.exit(1);
}

const hayAlgo = Object.values(enDestino).some((n) => n > 0);
if (hayAlgo && !reemplazar) {
  console.log('Supabase solo tiene lo que el sistema siembra al arrancar. Para cambiarlo por los datos');
  console.log('locales, vuelva a correr con --reemplazar.');
  await cerrarTodo();
  process.exit(0);
}
if (!hayAlgo && !reemplazar) {
  console.log('Supabase está vacío. Para pasar los datos locales, vuelva a correr con --reemplazar.');
  await cerrarTodo();
  process.exit(0);
}

const inicio = Date.now();
await destino.transaccion(async () => {
  await destino.exec(`TRUNCATE ${TABLAS.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
  // En el orden de resources.js: cada tabla va después de las que referencia.
  for (const t of TABLAS) {
    const filas = await origen.todos(`SELECT * FROM "${t}"`);
    if (!filas.length) continue;
    const cols = Object.keys(filas[0]);
    const insertar = `INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    for (const f of filas) await destino.ejecutar(insertar, cols.map((c) => f[c]));
    process.stdout.write(`  ${t}: ${filas.length}\n`);
  }
  // Los ids se conservaron, así que el contador de cada tabla tiene que
  // seguir después del mayor; si no, el próximo registro chocaría.
  for (const t of Object.keys(recursos)) {
    await destino.exec(
      `SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), COALESCE((SELECT MAX(id) FROM "${t}"), 0) + 1, false)`,
    );
  }
});

const despues = await contar(destino);
const distintas = TABLAS.filter((t) => despues[t] !== enOrigen[t]);
console.log(`\nCopiado en ${((Date.now() - inicio) / 1000).toFixed(1)} s.`);
if (distintas.length) {
  console.error(`OJO: no coinciden ${distintas.map((t) => `${t} (local ${enOrigen[t]}, en línea ${despues[t]})`).join(', ')}.`);
  await cerrarTodo();
  process.exit(1);
}
console.log(`Verificado: las ${TABLAS.length} tablas tienen los mismos registros en línea que en local.`);
await cerrarTodo();

async function cerrarTodo() {
  await origen.cerrar();
  await destino.cerrar();
}
