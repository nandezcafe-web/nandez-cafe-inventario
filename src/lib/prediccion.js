import { obtenerDiario, obtenerEnso, guardarCache } from './fuentesClima.js';
import { evaluarRiesgos, separarDias, ventanasLabores } from './agroclima.js';
import { noEncontrado } from './errores.js';

export const AVISO_PREDICCION =
  'Pronóstico de modelo meteorológico para las coordenadas de la finca y reglas agronómicas generales. '
  + 'Sirve para prevenir y priorizar la vigilancia, no reemplaza la revisión en campo ni al agrónomo.';

export function hoyEn(timezone) {
  return new Date().toLocaleDateString('sv-SE', { timeZone: timezone });
}

export async function calcularPrediccion(db, fincaId, { timezone, modelos, fetchImpl = fetch, hoy = hoyEn(timezone) }) {
  const finca = db.prepare('SELECT * FROM fincas WHERE id = ?').get(fincaId);
  if (!finca) throw noEncontrado('Finca');

  const diario = await obtenerDiario(db, finca, { timezone, modelos, fetchImpl });
  // ENSO es complementario: si falla, se sigue sin él.
  let enso = null;
  try {
    enso = await obtenerEnso(db, { fetchImpl });
  } catch {
    enso = null;
  }

  const { historial, pronostico } = separarDias(diario.datos.dias, hoy);
  const lotes = db.prepare('SELECT * FROM lotes WHERE finca_id = ?').all(fincaId);
  const floraciones = db.prepare(
    'SELECT f.* FROM floraciones f JOIN lotes l ON l.id = f.lote_id WHERE l.finca_id = ? ORDER BY f.fecha',
  ).all(fincaId);

  const riesgos = evaluarRiesgos({ historial, pronostico, lotes, floraciones, enso: enso?.datos.actual ?? null, hoy });
  const suma = (xs, k) => Math.round(xs.reduce((s, d) => s + (d[k] ?? 0), 0) * 10) / 10;

  const resultado = {
    hoy,
    ubicacion: {
      finca: finca.nombre, latitud: finca.latitud, longitud: finca.longitud,
      altitud_registrada_m: finca.altitud_msnm, elevacion_modelo_m: diario.datos.elevacion_modelo_m,
    },
    resumen: {
      lluvia_ultimos_30d_mm: suma(historial, 'lluvia_mm'),
      lluvia_ultimos_7d_mm: suma(historial.slice(-7), 'lluvia_mm'),
      lluvia_proximos_7d_mm: suma(pronostico.slice(0, 7), 'lluvia_mm'),
      lluvia_proximos_16d_mm: suma(pronostico, 'lluvia_mm'),
      dias_con_lluvia_proximos_7d: pronostico.slice(0, 7).filter((d) => d.lluvia_mm >= 1).length,
    },
    riesgos,
    pronostico,
    historial,
    ventanas: ventanasLabores(historial, pronostico),
    enso: enso?.datos ?? null,
    fuentes: {
      pronostico: {
        nombre: 'Open-Meteo', modelos: diario.datos.modelos, combinacion: 'mediana entre modelos',
        obtenido_en: diario.obtenido_en, desactualizado: diario.desactualizado,
      },
      enso: enso ? { nombre: enso.datos.fuente, obtenido_en: enso.obtenido_en, desactualizado: enso.desactualizado } : null,
    },
    aviso: AVISO_PREDICCION,
  };

  // Último cálculo guardado: el resumen lo muestra sin volver a consultar internet.
  guardarCache(db, `riesgos:finca:${fincaId}`, { hoy, riesgos, fuentes: resultado.fuentes });
  return resultado;
}
