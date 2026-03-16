//! Manejo de puertos seriales

/// Información de un puerto serial
#[derive(Debug, Clone)]
pub struct SerialPortInfo {
    pub name: String,
    pub port_type: String,
}

impl SerialPortInfo {
    /// Obtener lista de puertos disponibles filtrando los del sistema
    pub fn list_available() -> Vec<Self> {
        match serialport::available_ports() {
            Ok(ports) => ports
                .into_iter()
                .filter_map(|p| {
                    // Filtrar puertos del sistema que no son USB/Bluetooth
                    let name = &p.port_name;
                    if name.starts_with("/dev/ttyS") || name.starts_with("COM1") {
                        return None;
                    }
                    Some(Self {
                        name: p.port_name,
                        port_type: format!("{:?}", p.port_type),
                    })
                })
                .collect(),
            Err(_) => vec![],
        }
    }
}
