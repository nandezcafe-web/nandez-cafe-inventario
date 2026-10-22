import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { recursos } from '../resources.js';

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
export function migrar(db) {
  // Respuestas de servicios externos (pronóstico, climatología, ENSO) para no
  // repetir consultas y poder mostrar el último dato sin conexión.
  db.exec(`CREATE TABLE IF NOT EXISTS cache_externo (
    clave TEXT PRIMARY KEY,
    datos TEXT NOT NULL,
    obtenido_en TEXT NOT NULL
  )`);

  for (const [tabla, rec] of Object.entries(recursos)) {
    const columnas = Object.entries(rec.campos).map(([n, d]) => columnaSql(n, d));
    db.exec(`CREATE TABLE IF NOT EXISTS "${tabla}" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${columnas.join(',\n      ')},
      creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`);

    const existentes = new Set(db.prepare(`PRAGMA table_info("${tabla}")`).all().map((c) => c.name));
    for (const [n, d] of Object.entries(rec.campos)) {
      if (!existentes.has(n)) db.exec(`ALTER TABLE "${tabla}" ADD COLUMN ${columnaSql(n, d)}`);
    }

    for (const [n, d] of Object.entries(rec.campos)) {
      if (d.tipo === 'ref') db.exec(`CREATE INDEX IF NOT EXISTS "ix_${tabla}_${n}" ON "${tabla}"("${n}")`);
    }
    if (rec.campoFecha) {
      db.exec(`CREATE INDEX IF NOT EXISTS "ix_${tabla}_${rec.campoFecha}" ON "${tabla}"("${rec.campoFecha}")`);
    }
    if (rec.unico) {
      const cols = rec.unico.map((c) => `"${c}"`).join(', ');
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "ux_${tabla}" ON "${tabla}"(${cols})`);
    }
  }
}

export function abrirDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  migrar(db);
  return db;
}

export function transaccion(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
