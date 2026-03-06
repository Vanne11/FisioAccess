//! FisioAcces HTTP
//! 
//! Módulo de transmisión HTTP y WebSocket para datos médicos.

pub mod sender;
pub mod websocket;

pub use sender::HttpSender;
pub use websocket::WebSocketServer;
