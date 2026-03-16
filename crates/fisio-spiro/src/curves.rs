//! Cálculo de curvas para espirómetro

/// Curvas de prueba de espirómetro
#[derive(Debug, Clone, Default)]
pub struct SpiroCurves {
    /// Tiempo en milisegundos
    pub time: Vec<f64>,
    /// Presión en kPa
    pub pressure: Vec<f64>,
    /// Flujo en L/s
    pub flow: Vec<f64>,
    /// Volumen en litros
    pub volume: Vec<f64>,
}

impl SpiroCurves {
    pub fn new() -> Self {
        Self::default()
    }

    /// Agregar punto de datos
    pub fn add_point(&mut self, time_ms: f64, pressure_kpa: f64) {
        self.time.push(time_ms);
        self.pressure.push(pressure_kpa);
        
        // TODO: Calcular flujo y volumen a partir de la presión
        self.flow.push(0.0);
        self.volume.push(0.0);
    }

    /// Limpiar todas las curvas
    pub fn clear(&mut self) {
        self.time.clear();
        self.pressure.clear();
        self.flow.clear();
        self.volume.clear();
    }

    /// Obtener número de puntos
    pub fn len(&self) -> usize {
        self.time.len()
    }

    /// Verificar si está vacío
    pub fn is_empty(&self) -> bool {
        self.time.is_empty()
    }
}
