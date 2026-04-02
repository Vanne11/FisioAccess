//! Pipeline de procesamiento EMG optimizado para ADS1115 a 860 SPS
//!
//! Cadena: RAW → mV → Centrar → Notch → Rectificar → Envolvente EMA → mV
//!
//! Diseñado para señal EMG de superficie:
//! - Rango esperado: 0.1 a 5 mV
//! - ADS1115 SingleEnded, ganancia 2/3

use std::time::Instant;
use fisio_filters::{ButterworthFilter, NotchFilter, FilterTrait};
use crate::converter::{self, DEFAULT_OFFSET_MV, SAMPLE_RATE_HZ};

/// Resultado de procesar una muestra: señal filtrada + envolvente
#[derive(Debug, Clone, Copy)]
pub struct EmgSample {
    /// Señal filtrada (centrada, HP, notch, LP) sin rectificar — forma de onda
    pub filtered: f64,
    /// Envolvente suavizada (rectificada + EMA) — amplitud de contracción
    pub envelope: f64,
}

/// Configuración del procesador EMG
pub struct EmgConfig {
    pub sample_rate: f64,
    pub highpass_cutoff: f64,
    pub lowpass_cutoff: f64,
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
            lowpass_cutoff: 450.0,             // 450 Hz: eliminar ruido HF fuera de banda EMG
            notch_freq: 50.0,                  // 50 Hz rechazo de red eléctrica
            notch_q: 30.0,
            envelope_alpha: 0.01,              // EMA ~116ms a 860 SPS: suaviza contracciones
            offset_mv: DEFAULT_OFFSET_MV,      // ~1768 mV (se recalcula al calibrar)
        }
    }
}

/// Muestras a descartar tras arranque/reset para estabilización de filtros IIR
const WARMUP_SAMPLES: usize = 20;

/// Procesador EMG con pipeline: Centrar → HP → Notch → LP → Rectificar → EMA
pub struct EmgProcessor {
    highpass: ButterworthFilter,
    notch: NotchFilter,
    lowpass: ButterworthFilter,
    envelope_alpha: f64,
    envelope: f64,
    offset_mv: f64,
    /// Contador de warmup: muestras restantes a descartar
    warmup_remaining: usize,
    /// Calibración basada en tiempo (no conteo de muestras)
    cal_samples: Vec<f64>,
    cal_duration_secs: f64,
    cal_start: Option<Instant>,
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
            envelope_alpha: config.envelope_alpha,
            envelope: 0.0,
            offset_mv: config.offset_mv,
            warmup_remaining: WARMUP_SAMPLES,
            cal_samples: Vec::new(),
            cal_duration_secs: 0.0,
            cal_start: None,
            calibrating: false,
            calibrated: false,
        }
    }

    /// Procesar una muestra en mV (el firmware envía mV vía computeVolts)
    /// Retorna señal filtrada + envolvente EMG en mV
    /// Las primeras WARMUP_SAMPLES muestras alimentan los filtros pero retornan 0.0
    pub fn process(&mut self, mv: f64) -> EmgSample {
        // Si estamos calibrando, acumular mV crudo (incluso durante warmup)
        if self.calibrating {
            self.cal_samples.push(mv);
            if let Some(start) = self.cal_start {
                if start.elapsed().as_secs_f64() >= self.cal_duration_secs {
                    self.finish_calibration();
                }
            }
        }

        // 1. Centrar: restar offset calibrado (DC removal)
        let centered = converter::center(mv, self.offset_mv);

        // 2. Highpass: eliminar artefactos de movimiento y drift DC residual
        let filtered = self.highpass.apply(centered);

        // 3. Notch: eliminar interferencia de red (50/60 Hz)
        let filtered = self.notch.apply(filtered);

        // 4. Lowpass: eliminar ruido de alta frecuencia fuera de banda EMG
        let filtered = self.lowpass.apply(filtered);

        // Durante warmup: alimentar filtros para que se estabilicen, pero no emitir
        if self.warmup_remaining > 0 {
            self.warmup_remaining -= 1;
            return EmgSample { filtered: 0.0, envelope: 0.0 };
        }

        // 5. Rectificación de onda completa
        let rectified = converter::rectify(filtered);

        // 6. Envolvente EMA: suavizar la señal rectificada
        self.envelope = (self.envelope_alpha * rectified)
            + ((1.0 - self.envelope_alpha) * self.envelope);

        EmgSample { filtered, envelope: self.envelope }
    }

    /// Iniciar calibración basada en tiempo real
    /// `duration_secs`: duración en segundos (típicamente 5)
    pub fn start_calibration(&mut self, duration_secs: f64) {
        self.cal_samples.clear();
        self.cal_samples.reserve(1000);
        self.cal_duration_secs = duration_secs;
        self.cal_start = Some(Instant::now());
        self.calibrating = true;
        self.calibrated = false;
        // Reset filtros, envolvente y warmup
        self.highpass.reset();
        self.notch.reset();
        self.lowpass.reset();
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
        self.cal_start = None;
        self.cal_samples.clear();
    }

    /// Progreso de calibración (0.0 a 1.0) basado en tiempo real
    pub fn calibration_progress(&self) -> f64 {
        if !self.calibrating || self.cal_duration_secs <= 0.0 {
            return if self.calibrated { 1.0 } else { 0.0 };
        }
        if let Some(start) = self.cal_start {
            (start.elapsed().as_secs_f64() / self.cal_duration_secs).min(1.0)
        } else {
            0.0
        }
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
            assert_eq!(result.envelope, 0.0, "Warmup muestra {i} debería ser 0.0, got {}", result.envelope);
            assert_eq!(result.filtered, 0.0, "Warmup filtered {i} debería ser 0.0, got {}", result.filtered);
        }
    }

    #[test]
    fn test_processor_baseline() {
        let mut proc = EmgProcessor::new(EmgConfig::default());
        for _ in 0..1000 {
            proc.process(1768.0);
        }
        let result = proc.process(1768.0);
        assert!(result.envelope.abs() < 0.1, "Baseline debería ser ~0 mV, got {}", result.envelope);
    }

    #[test]
    fn test_calibration() {
        let mut proc = EmgProcessor::new(EmgConfig::default());

        // Calibración de 0.05s (50ms) — suficiente para test
        proc.start_calibration(0.05);
        assert!(proc.is_calibrating());

        // Alimentar muestras hasta que el tiempo pase
        loop {
            proc.process(1768.0);
            if !proc.is_calibrating() { break; }
        }

        assert!(proc.is_calibrated());
        assert!((proc.offset_mv() - 1768.0).abs() < 0.1);
    }

    #[test]
    fn test_envelope_responds_to_signal() {
        let mut proc = EmgProcessor::new(EmgConfig::default());
        for _ in 0..1000 {
            proc.process(1768.0);
        }

        let mut last = EmgSample { filtered: 0.0, envelope: 0.0 };
        for _ in 0..500 {
            last = proc.process(1770.0);
        }
        assert!(last.envelope > 0.01, "Envolvente debería responder a la señal, got {}", last.envelope);
    }
}
