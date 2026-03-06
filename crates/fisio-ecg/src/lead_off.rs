//! Detección de Lead-Off para ECG

use fisio_core::DataPoint;

/// Detector de condición Lead-Off (electrodo desconectado)
pub struct LeadOffDetector {
    threshold: f64,
    consecutive_samples: usize,
}

impl LeadOffDetector {
    pub fn new() -> Self {
        Self {
            threshold: 0.0,  // Valor cercano a 0 indica lead-off
            consecutive_samples: 10,
        }
    }

    /// Verificar si hay condición Lead-Off
    pub fn detect(&self, data: &[DataPoint]) -> bool {
        if data.len() < self.consecutive_samples {
            return false;
        }

        // Verificar si los últimos samples están cerca de 0
        let recent = &data[data.len() - self.consecutive_samples..];
        recent.iter().all(|d| d.value.abs() < self.threshold)
    }
}

impl Default for LeadOffDetector {
    fn default() -> Self {
        Self::new()
    }
}
