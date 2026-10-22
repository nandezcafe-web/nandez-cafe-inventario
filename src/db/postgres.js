import { AsyncLocalStorage } from 'node:async_hooks';

// Adaptador de Postgres con la misma forma que el de SQLite (ver index.js).
// Funciona sobre dos clientes que hablan el mismo SQL:
//   - Supabase, con el paquete `postgres`, en producción.
//   - PGlite, un Postgres real que corre dentro de Node, en las pruebas.

const dentroDeTx = new AsyncLocalStorage();

// El código escribe el SQL con `?` y `LIKE`, como en SQLite. Aquí se traduce a
// `$1, $2…` y a `ILIKE` (en SQLite LIKE no distingue mayúsculas; en Postgres sí,
// y una búsqueda de "castillo" debe encontrar "Castillo"). Lo que está dentro
// de comillas no se toca.
export function traducir(sql) {
  let salida = '';
  let n = 0;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c && sql[j + 1] === c) { j += 2; continue; } // '' escapado
        if (sql[j] === c) break;
        j++;
      }
      salida += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      const fin = sql.indexOf('\n', i);
      const j = fin === -1 ? sql.length : fin;
      salida += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === '?') {
      salida += `$${++n}`;
      i++;
      continue;
    }
    if (/[Ll]/.test(c) && /^like\b/i.test(sql.slice(i, i + 5)) && !/\w/.test(sql[i - 1] ?? '')) {
      salida += 'ILIKE';
      i += 4;
      continue;
    }
    salida += c;
    i++;
  }
  return salida;
}

class Postgres {
  motor = 'postgres';
  #cliente;

  constructor(cliente) {
    this.#cliente = cliente;
  }

  get #actual() {
    return dentroDeTx.getStore() ?? this.#cliente;
  }

  async todos(sql, params = []) {
    return (await this.#actual.consultar(traducir(sql), params)).filas;
  }

  async uno(sql, params = []) {
    return (await this.#actual.consultar(traducir(sql), params)).filas[0];
  }

  async ejecutar(sql, params = []) {
    const r = await this.#actual.consultar(traducir(sql), params);
    // El id de una inserción se pide con RETURNING id y db.uno(): Postgres no
    // tiene un "último id insertado" como SQLite.
    return { cambios: r.cambios, id: r.filas[0]?.id };
  }

  async exec(sql) {
    await this.#actual.exec(sql);
  }

  async transaccion(fn) {
    if (dentroDeTx.getStore()) return fn(this);
    return this.#cliente.transaccion((tx) => dentroDeTx.run(tx, () => fn(this)));
  }

  async columnas(tabla) {
    const filas = await this.todos(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?',
      [tabla],
    );
    return new Set(filas.map((f) => f.column_name));
  }

  async cerrar() {
    await this.#cliente.cerrar();
  }
}

// Decimales y conteos llegan de Postgres como texto ("1.5", "12") para no
// perder precisión. Aquí se convierten a número: sin esto cada suma de costos
// concatenaría texto en vez de sumar.
const NUMERIC = 1700;
const INT8 = 20;

export async function conectarSupabase(url) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, {
    // El "transaction pooler" de Supabase (puerto 6543) no admite sentencias
    // preparadas: con cada petición puede tocar otra conexión.
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {}, // "ya existe la tabla…" de CREATE IF NOT EXISTS no es un problema
    types: {
      numeric: { to: NUMERIC, from: [NUMERIC], serialize: (x) => String(x), parse: (x) => Number(x) },
      bigint: { to: INT8, from: [INT8], serialize: (x) => String(x), parse: (x) => Number(x) },
    },
  });
  const sobre = (s) => ({
    async consultar(texto, params) {
      const r = await s.unsafe(texto, params);
      return { filas: [...r], cambios: r.count ?? 0 };
    },
    async exec(texto) {
      await s.unsafe(texto);
    },
  });
  return new Postgres({
    ...sobre(sql),
    transaccion: (fn) => sql.begin((tx) => fn(sobre(tx))),
    cerrar: () => sql.end({ timeout: 5 }),
  });
}

export async function conectarPglite(ruta) {
  const { PGlite, types } = await import('@electric-sql/pglite');
  const pg = await PGlite.create(ruta === 'memoria' ? undefined : ruta, {
    parsers: { [types.NUMERIC]: (v) => Number(v), [types.INT8]: (v) => Number(v) },
  });
  const sobre = (c) => ({
    async consultar(texto, params) {
      const r = await c.query(texto, params);
      return { filas: r.rows, cambios: r.affectedRows ?? 0 };
    },
    async exec(texto) {
      await c.exec(texto);
    },
  });
  return new Postgres({
    ...sobre(pg),
    transaccion: (fn) => pg.transaction((tx) => fn(sobre(tx))),
    cerrar: () => pg.close(),
  });
}
