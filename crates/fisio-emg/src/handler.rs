//! Handler para dispositivo EMG

use fisio_core::{DeviceType, SerialConfig, ConnectionState, DataPoint, FilterParams, CalibrationResult};
use fisio_serial::SerialManager;

/// Handler para procesamiento de señales EMG
pub struct EmgHandler {
    serial: SerialManager,
    state: ConnectionState,
    buffer: Vec<DataPoint>,
    calibration_state: CalibrationState,
    offset_mv: f64,
    is_calibrated: bool,
}

impl EmgHandler {
    pub fn new() -> Self {
        Self {
            serial: SerialManager::new(),
            state: ConnectionState::Disconnected,
            buffer: Vec::with_capacity(1000),
            calibration_state: CalibrationState::NotCalibrated,
            offset_mv: 0.0,
            is_calibrated: false,
        }
    }

    /// Obtener estado de calibración
    pub fn calibration_state(&self) -> &CalibrationState {
        &self.calibration_state
    }

    /// Obtener offset actual
    pub fn get_offset(&self) -> f64 {
        self.offset_mv
    }

    /// Verificar si está calibrado
    pub fn is_calibrated(&self) -> bool {
        self.is_calibrated
    }

    /// Iniciar calibración
    pub fn start_calibration(&mut self, _duration_ms: u32) {
        self.calibration_state = CalibrationState::Calibrating(0.0);
    }

    /// Obtener progreso de calibración
    pub fn get_calibration_progress(&self) -> f32 {
        match self.calibration_state {
            CalibrationState::Calibrating(progress) => progress as f32,
            _ => 0.0,
        }
    }
}

impl Default for EmgHandler {
    fn default() -> Self {
        Self::new()
    }
}

/// Estado de calibración del EMG
#[derive(Debug, Clone, PartialEq)]
pub enum CalibrationState {
    NotCalibrated,
    Calibrating(f64),  // Progreso 0.0 a 1.0
    Calibrated(f64),   // Offset en mV
    Error(String),
}
