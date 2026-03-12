//! FisioAccess ECG
//! 
//! Módulo de procesamiento de señales de electrocardiograma (ECG).

pub mod handler;
pub mod bpm_detector;
pub mod lead_off;

pub use handler::EcgHandler;
