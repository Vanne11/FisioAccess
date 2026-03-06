//! Gestión de pruebas de espirómetro

use chrono::{DateTime, Utc};

/// Registro de una prueba de espirómetro
#[derive(Debug, Clone)]
pub struct TestRecord {
    /// ID único de la prueba
    pub id: u32,
    /// Nombre de la prueba
    pub name: String,
    /// Timestamp de creación
    pub created_at: DateTime<Utc>,
    /// Duración en milisegundos
    pub duration_ms: f64,
    /// Ruta al archivo de datos (si está guardada)
    pub file_path: Option<String>,
}

impl TestRecord {
    pub fn new(id: u32, name: &str) -> Self {
        Self {
            id,
            name: name.to_string(),
            created_at: Utc::now(),
            duration_ms: 0.0,
            file_path: None,
        }
    }
}

/// Gestor de pruebas de espirómetro
pub struct TestManager {
    tests: Vec<TestRecord>,
    next_id: u32,
}

impl TestManager {
    pub fn new() -> Self {
        Self {
            tests: Vec::new(),
            next_id: 1,
        }
    }

    /// Crear nueva prueba
    pub fn create_test(&mut self, name: &str) -> TestRecord {
        let test = TestRecord::new(self.next_id, name);
        self.next_id += 1;
        self.tests.push(test.clone());
        test
    }

    /// Obtener prueba por ID
    pub fn get_test(&self, id: u32) -> Option<&TestRecord> {
        self.tests.iter().find(|t| t.id == id)
    }

    /// Eliminar prueba por ID
    pub fn delete_test(&mut self, id: u32) -> bool {
        if let Some(pos) = self.tests.iter().position(|t| t.id == id) {
            self.tests.remove(pos);
            true
        } else {
            false
        }
    }

    /// Obtener todas las pruebas
    pub fn get_all_tests(&self) -> &[TestRecord] {
        &self.tests
    }

    /// Contar pruebas
    pub fn count(&self) -> usize {
        self.tests.len()
    }
}

impl Default for TestManager {
    fn default() -> Self {
        Self::new()
    }
}
