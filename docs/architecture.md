# Arquitectura de FisioAccess

## Visión General

FisioAccess es una aplicación multiplataforma para el monitoreo de señales médicas (ECG, EMG, Espirómetro) construida con **Tauri 2.0**, **Rust** y **React/TypeScript**.

## Arquitectura Modular

La aplicación sigue una arquitectura modular que permite:

1. **Desarrollo en paralelo**: Múltiples desarrolladores pueden trabajar en módulos diferentes sin conflictos
2. **Testing aislado**: Cada módulo se puede testear independientemente
3. **Reutilización**: Módulos como `fisio-serial` y `fisio-filters` son compartidos
4. **Mantenibilidad**: Cambios en un módulo no afectan a los demás

## Estructura del Proyecto

```
fisioacces-integrado/
├── crates/                    # Crates Rust (backend modular)
│   ├── fisio-core/           # Tipos, traits y utilidades compartidas
│   ├── fisio-serial/         # Comunicación serial
│   ├── fisio-filters/        # Filtros digitales
│   ├── fisio-ecg/            # Módulo ECG
│   ├── fisio-emg/            # Módulo EMG
│   ├── fisio-spiro/          # Módulo Espirómetro
│   ├── fisio-data/           # Grabación y exportación de datos
│   └── fisio-http/           # Transmisión HTTP/WebSocket
├── packages/                  # Paquetes frontend (módulos React)
│   ├── ui-core/              # Componentes UI compartidos
│   ├── ecg-module/           # Módulo ECG React
│   ├── emg-module/           # Módulo EMG React
│   └── spiro-module/         # Módulo Espirómetro React
├── src/apps/main/             # Aplicación principal React
├── src-tauri/                 # Backend Tauri
└── docs/                      # Documentación
```

## Flujo de Datos

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  ECG Module │  │  EMG Module │  │ Spiro Module │          │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │
│         │                │                │                   │
│         └────────────────┼────────────────┘                   │
│                          │                                    │
│                  ┌───────▼────────┐                           │
│                  │  Tauri IPC     │                           │
│                  └───────┬────────┘                           │
└──────────────────────────┼────────────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────────────┐
│                    Backend (Rust)                              │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                 Tauri Commands                        │   │
│  └────────────────────────────────────────────────────────┘   │
│         │                │                │                    │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐           │
│  │  fisio-ecg  │  │  fisio-emg  │  │ fisio-spiro │           │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘           │
│         │                │                │                    │
│         └────────────────┼────────────────┘                    │
│                          │                                     │
│         ┌────────────────┼────────────────┐                    │
│         │                │                │                    │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐           │
│  │fisio-serial │  │fisio-filters│  │ fisio-data  │           │
│  └─────────────┘  └─────────────┘  └─────────────┘           │
└───────────────────────────────────────────────────────────────┘
                           │
                           ▼
                  ┌────────────────┐
                  │  Hardware      │
                  │  (Serial USB)  │
                  └────────────────┘
```

## Módulos del Backend

### fisio-core

**Propósito:** Tipos, traits y utilidades compartidas

**Componentes principales:**
- `types.rs`: `DataPoint`, `SerialConfig`, `FilterParams`, `ConnectionState`
- `traits.rs`: `SerialDevice`, `Filter`, `DeviceHandler`, `Calibratable`
- `utils.rs`: Funciones de conversión y cálculo

### fisio-serial

**Propósito:** Comunicación serial asíncrona

**Dependencias:** `tokio-serial`, `serialport`

**API principal:**
```rust
pub struct SerialManager {
    // Gestiona conexión serial
}

impl SerialManager {
    pub fn get_available_ports() -> Vec<SerialPortInfo>;
    pub async fn connect(&mut self, config: SerialConfig) -> Result<(), String>;
    pub async fn disconnect(&mut self);
    pub async fn write(&mut self, data: &[u8]) -> Result<(), String>;
}
```

### fisio-filters

**Propósito:** Filtros digitales para procesamiento de señales

**Tipos de filtros:**
- Butterworth (low-pass, high-pass)
- Notch (50/60 Hz)
- Promedio móvil

**API principal:**
```rust
pub trait FilterTrait {
    fn apply(&mut self, value: f64) -> f64;
    fn reset(&mut self);
    fn set_enabled(&mut self, enabled: bool);
}
```

### fisio-ecg

**Propósito:** Procesamiento de señales ECG

**Características:**
- Detección de BPM (picos R)
- Detección de Lead-Off
- Detección de saturación
- Filtros específicos para ECG

### fisio-emg

**Propósito:** Procesamiento de señales EMG

**Características:**
- Conversión ADS1115 (raw → mV → µV)
- Sistema de calibración
- Filtros para EMG
- Grabación de datos

### fisio-spiro

**Propósito:** Procesamiento de espirómetro

**Características:**
- Cálculo de curvas (presión, flujo, volumen)
- Gestión de pruebas
- Exportación de datos

## Módulos del Frontend

### @fisio/ui-core

**Propósito:** Componentes UI compartidos

**Componentes:**
- `Button`: Botón con variantes
- `SerialSelect`: Selector de puertos seriales
- `Card`: Contenedor con header/content
- `Graph`: Gráfico de líneas con Recharts

**Hooks:**
- `useTheme`: Manejo de tema claro/oscuro

### @fisio/ecg-module

**Propósito:** Interfaz de monitor ECG

**Componentes:**
- `ECGMonitor`: Contenedor principal
- `ECGGraph`: Visualización de señal
- `ECGControls`: Panel de controles

**Estado:** Zustand store con datos en tiempo real

### @fisio/emg-module

**Propósito:** Interfaz de monitor EMG

**Componentes:**
- `EMGMonitor`: Contenedor principal
- `EMGGraph`: Visualización de potencial muscular
- `CalibrationPanel`: Panel de calibración

### @fisio/spiro-module

**Propósito:** Interfaz de espirómetro

**Componentes:**
- `SpiroMonitor`: Contenedor principal
- `SpiroGraph`: Curvas de flujo-volumen
- `TestList`: Lista de pruebas guardadas

## Comunicación Tauri IPC

### Comandos Disponibles

```rust
// Compartidos
get_available_ports() -> Vec<PortInfo>

// ECG
ecg_connect(port: String, baud: u32) -> CommandResponse
ecg_disconnect() -> CommandResponse
ecg_send_command(cmd: String) -> CommandResponse

// EMG
emg_connect(port: String, baud: u32) -> CommandResponse
emg_disconnect() -> CommandResponse
emg_start_calibration(duration: u32) -> CommandResponse
emg_stop_calibration() -> (bool, f64, String)

// Espirómetro
spiro_connect(port: String, baud: u32) -> CommandResponse
spiro_disconnect() -> CommandResponse
spiro_calibrate() -> CommandResponse
spiro_start_test() -> CommandResponse
spiro_stop_test() -> CommandResponse
```

## Gestión de Estado

### Frontend (Zustand)

Cada módulo tiene su propio store:

```typescript
interface ECGState {
  device: DeviceState;
  data: DataPoint[];
  bpm: number | null;
  leadOff: boolean;
  saturation: boolean;
  // ... actions
}
```

### Backend (Tauri State)

Estado compartido entre comandos:

```rust
pub struct AppState {
    pub ecg: Arc<Mutex<EcgHandler>>,
    pub emg: Arc<Mutex<EmgHandler>>,
    pub spiro: Arc<Mutex<SpiroHandler>>,
}
```

## Próximos Pasos

1. **Implementar comunicación serial real** en `fisio-serial`
2. **Implementar filtros digitales** en `fisio-filters`
3. **Conectar frontend con backend** vía Tauri IPC
4. **Agregar tests unitarios** para cada crate
5. **Implementar grabación de datos** en `fisio-data`

## Referencias

- [Tauri 2.0 Documentation](https://v2.tauri.app/)
- [Rust Book](https://doc.rust-lang.org/book/)
- [React Documentation](https://react.dev/)
- [Zustand Documentation](https://zustand-demo.pmnd.rs/)
