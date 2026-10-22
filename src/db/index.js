import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { recursos } from '../resources.js';

// Capa de datos asíncrona. Todo el resto del código habla con la base por esta
// misma forma, sin saber si detrás hay SQLite (local, pruebas) o Postgres
// (Supabase, en línea):
//
//   await db.todos(sql, params)      → filas
//   await db.uno(sql, params)        → una fila o undefined
//   await db.ejecutar(sql, params)   → { cambios, id }
//   await db.exec(sql)               → DDL o varias sentencias
//   await db.transaccion(async () => …)
//
// Los parámetros van con `?`; el adaptador de Postgres los traduce.

// Marca el contexto asíncrono que está dentro de una transacción. Así, una
// consulta hecha desde adentro corre en la transacción en vez de quedarse
// esperando a que termine, que sería esperarse a sí misma.
const dentroDeTx = new AsyncLocalStorage();

class Sqlite {
  motor = 'sqlite';
  #raw;
  #enCurso = null; // promesa de la transacción abierta, si hay una

  constructor(raw) {
    this.#raw = raw;
  }

  // Las sentencias de afuera esperan a que cierre la transacción abierta: con
  // una sola conexión, si no esperaran quedarían metidas dentro de ella.
  async #turno() {
    if (dentroDeTx.getStore() === this) return;
    while (this.#enCurso) await this.#enCurso;
  }

  async todos(sql, params = []) {
    await this.#turno();
    return this.#raw.prepare(sql).all(...params);
  }

  async uno(sql, params = []) {
    await this.#turno();
    return this.#raw.prepare(sql).get(...params);
  }

  async ejecutar(sql, params = []) {
    await this.#turno();
    const r = this.#raw.prepare(sql).run(...params);
    return { cambios: Number(r.changes), id: Number(r.lastInsertRowid) };
  }

  async exec(sql) {
    await this.#turno();
    this.#raw.exec(sql);
  }

  async transaccion(fn) {
    // Anidada: se suma a la que ya está abierta.
    if (dentroDeTx.getStore() === this) return fn(this);
    await this.#turno();

    let liberar;
    this.#enCurso = new Promise((ok) => { liberar = ok; });
    try {
      return await dentroDeTx.run(this, async () => {
        this.#raw.exec('BEGIN');
        try {
          const r = await fn(this);
          this.#raw.exec('COMMIT');
          return r;
        } catch (e) {
          this.#raw.exec('ROLLBACK');
          throw e;
        }
      });
    } finally {
      this.#enCurso = null;
      liberar();
    }
  }

  // Copia consistente de toda la base a un archivo (ver routes/respaldo.js).
  async respaldarEn(destino) {
    await this.#turno();
    this.#raw.prepare('VACUUM INTO ?').run(destino);
  }

  async columnas(tabla) {
    const filas = await this.todos(`PRAGMA table_info("${tabla}")`);
    return new Set(filas.map((c) => c.name));
  }

  async cerrar() {
    this.#raw.close();
  }
}

const TIPO_SQL = {
  texto: 'TEXT', fecha: 'TEXT', fechahora: 'TEXT', opcion: 'TEXT', json: 'TEXT',
  entero: 'INTEGER', ref: 'INTEGER', real: 'REAL',
};

function columnaSql(nombre, def) {
  let sql = `"${nombre}" ${TIPO_SQL[def.tipo]}`;
  if (def.tipo === 'ref') sql += ` REFERENCES "${def.ref}"(id)`;
  return sql;
}

// Crea tablas nuevas y agrega columnas nuevas sin tocar los datos existentes.
// Suficiente mientras el modelo solo crece; renombrar/eliminar columnas requiere
// una migración manual.
export async function migrar(db) {
  // Respuestas de servicios externos (pronóstico, climatología, ENSO) para no
  // repetir consultas y poder mostrar el último dato sin conexión.
  await db.exec(`CREATE TABLE IF NOT EXISTS cache_externo (
    clave TEXT PRIMARY KEY,
    datos TEXT NOT NULL,
    obtenido_en TEXT NOT NULL
  )`);

  for (const [tabla, rec] of Object.entries(recursos)) {
    const columnas = Object.entries(rec.campos).map(([n, d]) => columnaSql(n, d));
    await db.exec(`CREATE TABLE IF NOT EXISTS "${tabla}" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${columnas.join(',\n      ')},
      creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`);

    const existentes = await db.columnas(tabla);
    for (const [n, d] of Object.entries(rec.campos)) {
      if (!existentes.has(n)) await db.exec(`ALTER TABLE "${tabla}" ADD COLUMN ${columnaSql(n, d)}`);
    }

    for (const [n, d] of Object.entries(rec.campos)) {
      if (d.tipo === 'ref') await db.exec(`CREATE INDEX IF NOT EXISTS "ix_${tabla}_${n}" ON "${tabla}"("${n}")`);
    }
    if (rec.campoFecha) {
      await db.exec(`CREATE INDEX IF NOT EXISTS "ix_${tabla}_${rec.campoFecha}" ON "${tabla}"("${rec.campoFecha}")`);
    }
    if (rec.unico) {
      const cols = rec.unico.map((c) => `"${c}"`).join(', ');
      await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "ux_${tabla}" ON "${tabla}"(${cols})`);
    }
  }
}

export async function abrirDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const raw = new DatabaseSync(dbPath);
  raw.exec('PRAGMA foreign_keys = ON');
  if (dbPath !== ':memory:') raw.exec('PRAGMA journal_mode = WAL');
  const db = new Sqlite(raw);
  await migrar(db);
  return db;
}
