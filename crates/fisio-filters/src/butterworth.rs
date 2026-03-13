//! Filtro Butterworth IIR de segundo orden (biquad)

use biquad::{Biquad, Coefficients, DirectForm2Transposed, ToHertz, Type, Q_BUTTERWORTH_F64};
use crate::traits::FilterTrait;

/// Filtro Butterworth de segundo orden usando biquad
pub struct ButterworthFilter {
    enabled: bool,
    filter: DirectForm2Transposed<f64>,
}

impl ButterworthFilter {
    /// Crear filtro low-pass Butterworth
    /// - `cutoff`: frecuencia de corte en Hz
    /// - `fs`: frecuencia de muestreo en Hz
    pub fn lowpass(cutoff: f64, fs: f64) -> Self {
        let coeffs = Coefficients::<f64>::from_params(
            Type::LowPass,
            fs.hz(),
            cutoff.hz(),
            Q_BUTTERWORTH_F64,
        )
        .expect("Parámetros inválidos para filtro lowpass");

        Self {
            enabled: true,
            filter: DirectForm2Transposed::<f64>::new(coeffs),
        }
    }

    /// Crear filtro high-pass Butterworth
    /// - `cutoff`: frecuencia de corte en Hz
    /// - `fs`: frecuencia de muestreo en Hz
    pub fn highpass(cutoff: f64, fs: f64) -> Self {
        let coeffs = Coefficients::<f64>::from_params(
            Type::HighPass,
            fs.hz(),
            cutoff.hz(),
            Q_BUTTERWORTH_F64,
        )
        .expect("Parámetros inválidos para filtro highpass");

        Self {
            enabled: true,
            filter: DirectForm2Transposed::<f64>::new(coeffs),
        }
    }
}

impl FilterTrait for ButterworthFilter {
    fn apply(&mut self, value: f64) -> f64 {
        if !self.enabled {
            return value;
        }
        self.filter.run(value)
    }

    fn reset(&mut self) {
        self.filter.reset_state();
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }
}
