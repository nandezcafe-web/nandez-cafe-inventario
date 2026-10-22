import { sincronizarOpenMeteo } from '../routes/clima.js';
import { calcularPrediccion } from './prediccion.js';

// Sincroniza el clima y recalcula los riesgos de cada finca con coordenadas.
// En el computador lo corre un temporizador cada CLIMA_AUTO_HORAS (server.js);
// en línea, una tarea diaria de Vercel (GET /api/cron/clima), porque allá no
// hay un proceso que siga vivo entre peticiones.
export async function monitorear(db, config, registro = console) {
  const fincas = await db.todos('SELECT id, nombre FROM fincas WHERE latitud IS NOT NULL AND longitud IS NOT NULL');
  const resultados = [];
  for (const f of fincas) {
    try {
      const s = await sincronizarOpenMeteo(db, { fincaId: f.id, dias: 2, timezone: config.timezone, modelos: config.climaModelos });
      const p = await calcularPrediccion(db, f.id, { timezone: config.timezone, modelos: config.climaModelos });
      const altos = p.riesgos.filter((r) => r.nivel === 'alto').map((r) => r.nombre);
      registro.log(`[monitoreo] ${f.nombre}: ${s.horas_guardadas} h de clima; riesgos altos: ${altos.join(', ') || 'ninguno'}`);
      resultados.push({ finca: f.nombre, horas_guardadas: s.horas_guardadas, riesgos_altos: altos });
    } catch (e) {
      registro.warn(`[monitoreo] ${f.nombre}: ${e.message}`);
      resultados.push({ finca: f.nombre, error: e.message });
    }
  }
  return resultados;
}
