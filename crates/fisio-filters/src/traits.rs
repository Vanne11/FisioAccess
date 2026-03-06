//! Trait para filtros

pub trait FilterTrait {
    /// Aplicar filtro a un valor
    fn apply(&mut self, value: f64) -> f64;
    
    /// Resetear el estado del filtro
    fn reset(&mut self);
    
    /// Habilitar/deshabilitar filtro
    fn set_enabled(&mut self, enabled: bool);
    
    /// Verificar si está habilitado
    fn is_enabled(&self) -> bool;
}
