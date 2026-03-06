//! Sistema de calibración para EMG

use fisio_core::CalibrationResult;

/// Estado interno de la calibración
pub struct CalibrationEngine {
    samples: Vec<f64>,
    target_count: usize,
    baseline_offset: f64,
}

impl CalibrationEngine {
    pub fn new(duration_seconds: f64, sample_rate: f64) -> Self {
        Self {
            samples: Vec::new(),
            target_count: (duration_seconds * sample_rate) as usize,
            baseline_offset: 0.0,
        }
    }

    /// Agregar muestra de calibración
    pub fn add_sample(&mut self, value: f64) {
        self.samples.push(value);
    }

    /// Obtener progreso (0.0 a 1.0)
    pub fn get_progress(&self) -> f64 {
        if self.target_count == 0 {
            return 0.0;
        }
        (self.samples.len() as f64 / self.target_count as f64).min(1.0)
    }

    /// Finalizar calibración y calcular offset
    pub fn finish(&mut self) -> CalibrationResult {
        if self.samples.is_empty() {
            return CalibrationResult {
                success: false,
                offset_mv: 0.0,
                message: "No hay muestras para calibrar".to_string(),
            };
        }

        self.baseline_offset = self.samples.iter().sum::<f64>() / self.samples.len() as f64;

        CalibrationResult {
            success: true,
            offset_mv: self.baseline_offset,
            message: format!("Calibración completada. Offset: {:.2} mV", self.baseline_offset),
        }
    }

    /// Verificar si la calibración está completa
    pub fn is_complete(&self) -> bool {
        self.samples.len() >= self.target_count
    }
}
