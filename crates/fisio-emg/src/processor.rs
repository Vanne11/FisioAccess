//! Pipeline de procesamiento EMG
//!
//! Cadena: RAW → mV → Highpass → Notch → Lowpass → Moving Avg → µV

use fisio_filters::{ButterworthFilter, NotchFilter, MovingAverageFilter, FilterTrait};
use crate::converter::{self, DEFAULT_OFFSET_MV, SAMPLE_RATE_HZ};

/// Configuración del procesador EMG
pub struct EmgConfig {
    pub sample_rate: f64,
    pub lowpass_cutoff: f64,
    pub highpass_cutoff: f64,
    pub notch_freq: f64,
    pub notch_q: f64,
    pub moving_avg_window: usize,
    pub offset_mv: f64,
}

impl Default for EmgConfig {
    fn default() -> Self {
        Self {
            sample_rate: SAMPLE_RATE_HZ,
            lowpass_cutoff: 30.0,
            highpass_cutoff: 0.5,
            notch_freq: 50.0,
            notch_q: 30.0,
            moving_avg_window: 10,
            offset_mv: DEFAULT_OFFSET_MV,
        }
    }
}

/// Procesador EMG con cadena de filtros IIR
pub struct EmgProcessor {
    highpass: ButterworthFilter,
    notch: NotchFilter,
    lowpass: ButterworthFilter,
    moving_avg: MovingAverageFilter,
    offset_mv: f64,
    /// Muestras acumuladas para calibración
    cal_samples: Vec<f64>,
    cal_target: usize,
    calibrating: bool,
    calibrated: bool,
}

impl EmgProcessor {
    pub fn new(config: EmgConfig) -> Self {
        let fs = config.sample_rate;
        Self {
            highpass: ButterworthFilter::highpass(config.highpass_cutoff, fs),
            notch: NotchFilter::new(config.notch_freq, config.notch_q, fs),
            lowpass: ButterworthFilter::lowpass(config.lowpass_cutoff, fs),
            moving_avg: MovingAverageFilter::new(config.moving_avg_window),
            offset_mv: config.offset_mv,
            cal_samples: Vec::new(),
            cal_target: 0,
            calibrating: false,
            calibrated: false,
        }
    }

    /// Procesar una muestra RAW del ADS1115
    /// Retorna el potencial muscular en µV
    pub fn process(&mut self, raw_value: f64) -> f64 {
        // RAW → mV
        let mv = converter::raw_to_mv(raw_value);

        // Si estamos calibrando, acumular mV crudo
        if self.calibrating {
            self.cal_samples.push(mv);
            if self.cal_samples.len() >= self.cal_target {
                self.finish_calibration();
            }
        }

        // Restar offset para centrar la señal en 0
        let centered = mv - self.offset_mv;

        // Cadena de filtros sobre señal centrada (mV)
        let filtered = self.highpass.apply(centered);
        let filtered = self.notch.apply(filtered);
        let filtered = self.lowpass.apply(filtered);
        let filtered = self.moving_avg.apply(filtered);

        // mV centrada → µV: (filtered / gain) * 1000
        (filtered / converter::DEFAULT_SYSTEM_GAIN) * 1000.0
    }

    /// Iniciar calibración (acumular muestras para calcular offset)
    /// `duration_secs`: duración en segundos (típicamente 5)
    pub fn start_calibration(&mut self, duration_secs: f64) {
        let target = (duration_secs * SAMPLE_RATE_HZ) as usize;
        self.cal_samples.clear();
        self.cal_samples.reserve(target);
        self.cal_target = target;
        self.calibrating = true;
        self.calibrated = false;
        // Reset filtros para empezar limpio
        self.highpass.reset();
        self.notch.reset();
        self.lowpass.reset();
        self.moving_avg.reset();
    }

    fn finish_calibration(&mut self) {
        if !self.cal_samples.is_empty() {
            let sum: f64 = self.cal_samples.iter().sum();
            self.offset_mv = sum / self.cal_samples.len() as f64;
            log::info!("EMG calibrado: offset = {:.2} mV ({} muestras)",
                self.offset_mv, self.cal_samples.len());
        }
        self.calibrating = false;
        self.calibrated = true;
        self.cal_samples.clear();
    }

    /// Progreso de calibración (0.0 a 1.0)
    pub fn calibration_progress(&self) -> f64 {
        if !self.calibrating || self.cal_target == 0 {
            return if self.calibrated { 1.0 } else { 0.0 };
        }
        (self.cal_samples.len() as f64 / self.cal_target as f64).min(1.0)
    }

    pub fn is_calibrating(&self) -> bool {
        self.calibrating
    }

    pub fn is_calibrated(&self) -> bool {
        self.calibrated
    }

    pub fn offset_mv(&self) -> f64 {
        self.offset_mv
    }

    /// Habilitar/deshabilitar filtros individuales
    pub fn set_highpass_enabled(&mut self, enabled: bool) {
        self.highpass.set_enabled(enabled);
    }

    pub fn set_lowpass_enabled(&mut self, enabled: bool) {
        self.lowpass.set_enabled(enabled);
    }

    pub fn set_notch_enabled(&mut self, enabled: bool) {
        self.notch.set_enabled(enabled);
    }

    pub fn set_moving_avg_enabled(&mut self, enabled: bool) {
        self.moving_avg.set_enabled(enabled);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_processor_baseline() {
        let mut proc = EmgProcessor::new(EmgConfig::default());
        // Valor en reposo: raw ~3552 → ~666 mV → ~0 µV
        // Primeras muestras son inestables por los filtros, alimentar varias
        for _ in 0..100 {
            proc.process(3552.0);
        }
        let result = proc.process(3552.0);
        assert!(result.abs() < 5.0, "Baseline debería ser ~0 µV, got {result}");
    }

    #[test]
    fn test_calibration() {
        let mut config = EmgConfig::default();
        config.sample_rate = 100.0;
        let mut proc = EmgProcessor::new(config);

        proc.start_calibration(1.0); // 1 segundo = 100 muestras
        assert!(proc.is_calibrating());

        // Alimentar 100 muestras con raw=3500 → 656.25 mV
        for _ in 0..100 {
            proc.process(3500.0);
        }

        assert!(proc.is_calibrated());
        assert!(!proc.is_calibrating());
        assert!((proc.offset_mv() - 656.25).abs() < 0.1);
    }
}
