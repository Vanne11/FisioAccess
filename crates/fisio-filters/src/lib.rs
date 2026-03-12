//! FisioAccess Filters
//! 
//! Biblioteca de filtros digitales para procesamiento de señales biomédicas.

pub mod traits;
pub mod butterworth;
pub mod notch;
pub mod moving_avg;

pub use traits::FilterTrait;
pub use butterworth::ButterworthFilter;
pub use notch::NotchFilter;
pub use moving_avg::MovingAverageFilter;
