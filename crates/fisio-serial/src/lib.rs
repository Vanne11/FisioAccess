//! FisioAccess Serial
//! 
//! Módulo de comunicación serial para dispositivos médicos.

pub mod manager;
pub mod port;
pub mod events;

pub use manager::SerialManager;
pub use port::SerialPortInfo;
pub use events::SerialEvent;
