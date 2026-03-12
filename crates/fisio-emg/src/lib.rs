//! FisioAccess EMG
//! 
//! Módulo de procesamiento de señales de electromiograma (EMG) con calibración.

pub mod handler;
pub mod calibration;
pub mod converter;

pub use handler::EmgHandler;
pub use calibration::CalibrationState;
