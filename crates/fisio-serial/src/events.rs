//! Eventos de comunicación serial

use fisio_core::ConnectionState;

/// Eventos que puede emitir el módulo serial
#[derive(Debug, Clone)]
pub enum SerialEvent {
    /// Cambio en el estado de conexión
    ConnectionChanged(ConnectionState),
    /// Datos recibidos (raw bytes)
    DataReceived(Vec<u8>),
    /// Error en la comunicación
    Error(String),
    /// Comando enviado
    CommandSent(String),
}
