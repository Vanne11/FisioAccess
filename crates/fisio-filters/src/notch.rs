//! Filtro Notch (elimina frecuencia específica)

use crate::traits::FilterTrait;

/// Filtro Notch para eliminar interferencia de red (50/60 Hz)
pub struct NotchFilter {
    enabled: bool,
    notch_freq: f64,
    q_factor: f64,
    state: Vec<f64>,
}

impl NotchFilter {
    pub fn new(notch_freq: f64, q_factor: f64) -> Self {
        Self {
            enabled: true,
            notch_freq,
            q_factor,
            state: vec![0.0; 4],
        }
    }
}

impl FilterTrait for NotchFilter {
    fn apply(&mut self, value: f64) -> f64 {
        if !self.enabled {
            return value;
        }
        // TODO: Implementar filtrado notch real
        value
    }

    fn reset(&mut self) {
        self.state.fill(0.0);
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }
}
