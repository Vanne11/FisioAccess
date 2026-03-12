//! FisioAccess Core
//! 
//! Tipos, traits y utilidades compartidas para todos los módulos de FisioAccess.

pub mod types;
pub mod traits;
pub mod utils;

// Re-exportar tipos más usados
pub use types::*;
pub use traits::*;
