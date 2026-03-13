//! Filtro Notch IIR de segundo orden (biquad)

use biquad::{Biquad, Coefficients, DirectForm2Transposed, ToHertz, Type};
use crate::traits::FilterTrait;

/// Filtro Notch para eliminar interferencia de red (50/60 Hz)
pub struct NotchFilter {
    enabled: bool,
    filter: Option<DirectForm2Transposed<f64>>,
}

impl NotchFilter {
    /// Crear filtro notch
    /// - `notch_freq`: frecuencia a eliminar (Hz)
    /// - `q_factor`: factor Q (selectividad)
    /// - `fs`: frecuencia de muestreo (Hz)
    ///
    /// Si notch_freq >= fs/2 (Nyquist), el filtro se desactiva automáticamente.
    pub fn new(notch_freq: f64, q_factor: f64, fs: f64) -> Self {
        let nyquist = fs / 2.0;
        if notch_freq >= nyquist {
            log::warn!(
                "Notch freq ({notch_freq} Hz) >= Nyquist ({nyquist} Hz), filtro desactivado"
            );
            return Self {
                enabled: false,
                filter: None,
            };
        }

        let coeffs = Coefficients::<f64>::from_params(
            Type::Notch,
            fs.hz(),
            notch_freq.hz(),
            q_factor,
        )
        .expect("Parámetros inválidos para filtro notch");

        Self {
            enabled: true,
            filter: Some(DirectForm2Transposed::<f64>::new(coeffs)),
        }
    }
}

impl FilterTrait for NotchFilter {
    fn apply(&mut self, value: f64) -> f64 {
        if !self.enabled {
            return value;
        }
        match &mut self.filter {
            Some(f) => f.run(value),
            None => value,
        }
    }

    fn reset(&mut self) {
        if let Some(f) = &mut self.filter {
            f.reset_state();
        }
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }
}
