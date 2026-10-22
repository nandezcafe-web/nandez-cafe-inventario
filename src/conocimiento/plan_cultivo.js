// Plantillas de plan de cultivo por etapa del lote.
// Son un PUNTO DE PARTIDA editable: las dosis y productos los define el agrónomo
// según el análisis de suelo; las frecuencias deben ajustarse a la finca.
// La fertilización de producción conviene ubicarla al inicio de las temporadas de
// lluvia (ver Climatología de la ubicación).

export const PLANTILLAS = {
  levante: [
    { tipo: 'monitoreo_plagas', titulo: 'Monitoreo fitosanitario (roya, minador, cochinillas, llagas)', cada: 15, inicio: 0, prioridad: 'alta' },
    { tipo: 'resiembra', titulo: 'Revisar plantas muertas o débiles y resembrar', cada: 90, inicio: 30, prioridad: 'media' },
    { tipo: 'control_arvenses', titulo: 'Plateo y manejo integrado de arvenses (conservar coberturas nobles)', cada: 60, inicio: 7, prioridad: 'media' },
    { tipo: 'fertilizacion', titulo: 'Fertilización de levante según análisis de suelo (dosis: agrónomo)', cada: 90, inicio: 14, prioridad: 'alta' },
    { tipo: 'vuelo_dron', titulo: 'Vuelo de dron con protocolo fijo', cada: 30, inicio: 3, prioridad: 'baja' },
    { tipo: 'muestreo', titulo: 'Muestreo de suelo para análisis de laboratorio', cada: 365, inicio: 60, prioridad: 'media' },
  ],
  produccion: [
    { tipo: 'monitoreo_plagas', titulo: 'Muestreo de roya y broca por lote', cada: 30, inicio: 0, prioridad: 'alta' },
    { tipo: 'registro_floracion', titulo: 'Recorrido para registrar floraciones', cada: 15, inicio: 0, prioridad: 'alta' },
    { tipo: 'fertilizacion', titulo: 'Fertilización de producción según análisis (al inicio de lluvias)', cada: 180, inicio: 14, prioridad: 'alta' },
    { tipo: 'control_arvenses', titulo: 'Manejo integrado de arvenses', cada: 90, inicio: 7, prioridad: 'media' },
    { tipo: 'vuelo_dron', titulo: 'Vuelo de dron con protocolo fijo (y en floración)', cada: 30, inicio: 3, prioridad: 'media' },
    { tipo: 'muestreo', titulo: 'Muestreo de suelo para análisis de laboratorio', cada: 365, inicio: 60, prioridad: 'media' },
    { tipo: 'poda', titulo: 'Evaluar poda / zoqueo / renovación del lote', cada: 365, inicio: 120, prioridad: 'baja' },
  ],
  renovacion: [
    { tipo: 'monitoreo_plagas', titulo: 'Monitoreo fitosanitario de rebrotes', cada: 30, inicio: 0, prioridad: 'media' },
    { tipo: 'control_arvenses', titulo: 'Manejo de arvenses', cada: 60, inicio: 7, prioridad: 'media' },
    { tipo: 'fertilizacion', titulo: 'Fertilización de renovación según análisis', cada: 120, inicio: 30, prioridad: 'alta' },
  ],
  vivero: [
    { tipo: 'monitoreo_plagas', titulo: 'Revisión de vivero (mal de talluelo, cochinillas)', cada: 7, inicio: 0, prioridad: 'alta' },
    { tipo: 'riego', titulo: 'Revisión de humedad y riego de vivero', cada: 2, inicio: 0, prioridad: 'alta' },
  ],
};
