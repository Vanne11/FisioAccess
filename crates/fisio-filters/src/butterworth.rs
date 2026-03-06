//! Filtro Butterworth

use crate::traits::FilterTrait;

/// Filtro Butterworth de segundo orden
pub struct ButterworthFilter {
    enabled: bool,
    coefficients: Vec<f64>,
    state: Vec<f64>,
}

impl ButterworthFilter {
    /// Crear filtro low-pass
    pub fn lowpass(order: usize, cutoff: f64, fs: f64) -> Self {
        // TODO: Implementar cálculo de coeficientes
        Self {
            enabled: true,
            coefficients: vec![1.0; order],
            state: vec![0.0; order],
        }
    }

    /// Crear filtro high-pass
    pub fn highpass(order: usize, cutoff: f64, fs: f64) -> Self {
        Self::lowpass(order, cutoff, fs)
    }
}

impl FilterTrait for ButterworthFilter {
    fn apply(&mut self, value: f64) -> f64 {
        if !self.enabled {
            return value;
        }
        // TODO: Implementar filtrado real
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
