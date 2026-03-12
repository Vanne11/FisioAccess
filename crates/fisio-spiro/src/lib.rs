//! FisioAccess Spirometer
//! 
//! Módulo de procesamiento de espirómetro para pruebas de función pulmonar.

pub mod handler;
pub mod curves;
pub mod test_manager;

pub use handler::SpiroHandler;
pub use test_manager::TestRecord;
