//! Pipeline de procesamiento EMG optimizado para ADS1115 a 860 SPS
//!
//! Cadena: RAW → mV → Centrar → Notch → Rectificar → Envolvente EMA → mV
//!
//! Diseñado para señal EMG de superficie:
//! - Rango esperado: 0.1 a 5 mV
//! - ADS1115 SingleEnded, ganancia 2/3

use fisio_filters::{ButterworthFilter, NotchFilter, FilterTrait};
use crate::converter::{self, DEFAULT_OFFSET_MV, SAMPLE_RATE_HZ};

/// Configuración del procesador EMG
pub struct EmgConfig {
    pub sample_rate: f64,
    pub highpass_cutoff: f64,
    pub notch_freq: f64,
    pub notch_q: f64,
    pub envelope_alpha: f64,
    pub offset_mv: f64,
}

impl Default for EmgConfig {
    fn default() -> Self {
        Self {
            sample_rate: SAMPLE_RATE_HZ,      // 860 Hz (ADS1115 máx)
            highpass_cutoff: 20.0,             // 20 Hz: eliminar artefactos de movimiento
            notch_freq: 50.0,                  // 50 Hz rechazo de red eléctrica
            notch_q: 30.0,
            envelope_alpha: 0.1,               // EMA rápida para envolvente
            offset_mv: DEFAULT_OFFSET_MV,      // ~1768 mV (se recalcula al calibrar)
        }
    }
}

/// Muestras a descartar tras arranque/reset para estabilización de filtros IIR
const WARMUP_SAMPLES: usize = 20;

/// Procesador EMG con pipeline: Centrar → HP → Notch → Rectificar → EMA
pub struct EmgProcessor {
    highpass: ButterworthFilter,
    notch: NotchFilter,
    envelope_alpha: f64,
    envelope: f64,
    offset_mv: f64,
    /// Contador de warmup: muestras restantes a descartar
    warmup_remaining: usize,
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
            envelope_alpha: config.envelope_alpha,
            envelope: 0.0,
            offset_mv: config.offset_mv,
            warmup_remaining: WARMUP_SAMPLES,
            cal_samples: Vec::new(),
            cal_target: 0,
            calibrating: false,
            calibrated: false,
        }
    }

    /// Procesar una muestra en mV (el firmware envía mV vía computeVolts)
    /// Retorna la envolvente EMG en mV (rectificada + suavizada)
    /// Las primeras WARMUP_SAMPLES muestras alimentan los filtros pero retornan 0.0
    pub fn process(&mut self, mv: f64) -> f64 {
        // Si estamos calibrando, acumular mV crudo (incluso durante warmup)
        if self.calibrating {
            self.cal_samples.push(mv);
            if self.cal_samples.len() >= self.cal_target {
                self.finish_calibration();
            }
        }

        // 1. Centrar: restar offset calibrado (DC removal)
        let centered = converter::center(mv, self.offset_mv);

        // 2. Highpass: eliminar artefactos de movimiento y drift DC residual
        let filtered = self.highpass.apply(centered);

        // 3. Notch: eliminar interferencia de red (50/60 Hz)
        let filtered = self.notch.apply(filtered);

        // Durante warmup: alimentar filtros para que se estabilicen, pero no emitir
        if self.warmup_remaining > 0 {
            self.warmup_remaining -= 1;
            return 0.0;
        }

        // 4. Rectificación de onda completa
        let rectified = converter::rectify(filtered);

        // 5. Envolvente EMA: suavizar la señal rectificada
        self.envelope = (self.envelope_alpha * rectified)
            + ((1.0 - self.envelope_alpha) * self.envelope);

        self.envelope
    }

    /// Procesar muestra mV y retornar señal centrada+filtrada (sin rectificar ni envolvente)
    /// Útil para visualización de la forma de onda
    pub fn process_raw(&mut self, mv: f64) -> f64 {
        let centered = converter::center(mv, self.offset_mv);
        let filtered = self.highpass.apply(centered);
        self.notch.apply(filtered)
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
        // Reset filtros, envolvente y warmup
        self.highpass.reset();
        self.notch.reset();
        self.envelope = 0.0;
        self.warmup_remaining = WARMUP_SAMPLES;
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

    pub fn set_notch_enabled(&mut self, enabled: bool) {
        self.notch.set_enabled(enabled);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_warmup_suppresses_output() {
        let mut proc = EmgProcessor::new(EmgConfig::default());
        for i in 0..WARMUP_SAMPLES {
            let result = proc.process(1768.0);
            assert_eq!(result, 0.0, "Warmup muestra {i} debería ser 0.0, got {result}");
        }
    }

    #[test]
    fn test_processor_baseline() {
        let mut proc = EmgProcessor::new(EmgConfig::default());
        for _ in 0..1000 {
            proc.process(1768.0);
        }
        let result = proc.process(1768.0);
        assert!(result.abs() < 0.1, "Baseline debería ser ~0 mV, got {result}");
    }

    #[test]
    fn test_calibration() {
        let mut config = EmgConfig::default();
        config.sample_rate = 860.0;
        let mut proc = EmgProcessor::new(config);

        proc.start_calibration(1.0);
        assert!(proc.is_calibrating());

        for _ in 0..860 {
            proc.process(1768.0);
        }

        assert!(proc.is_calibrated());
        assert!(!proc.is_calibrating());
        assert!((proc.offset_mv() - 1768.0).abs() < 0.1);
    }

    #[test]
    fn test_envelope_responds_to_signal() {
        let mut proc = EmgProcessor::new(EmgConfig::default());
        for _ in 0..1000 {
            proc.process(1768.0);
        }

        let mut last = 0.0;
        for _ in 0..100 {
            last = proc.process(1770.0);
        }
        assert!(last > 0.01, "Envolvente debería responder a la señal, got {last}");
    }
}
