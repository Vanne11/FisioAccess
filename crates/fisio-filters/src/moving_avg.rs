//! Filtro de promedio móvil

use crate::traits::FilterTrait;
use std::collections::VecDeque;

/// Filtro de promedio móvil
pub struct MovingAverageFilter {
    enabled: bool,
    window_size: usize,
    buffer: VecDeque<f64>,
    sum: f64,
}

impl MovingAverageFilter {
    pub fn new(window_size: usize) -> Self {
        Self {
            enabled: true,
            window_size,
            buffer: VecDeque::with_capacity(window_size),
            sum: 0.0,
        }
    }
}

impl FilterTrait for MovingAverageFilter {
    fn apply(&mut self, value: f64) -> f64 {
        if !self.enabled {
            return value;
        }

        if self.buffer.len() >= self.window_size {
            if let Some(old) = self.buffer.pop_front() {
                self.sum -= old;
            }
        }

        self.buffer.push_back(value);
        self.sum += value;

        self.sum / self.buffer.len() as f64
    }

    fn reset(&mut self) {
        self.buffer.clear();
        self.sum = 0.0;
    }

    fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    fn is_enabled(&self) -> bool {
        self.enabled
    }
}
