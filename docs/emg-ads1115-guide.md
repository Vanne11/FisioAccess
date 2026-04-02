# Guia EMG con ADS1115 + ESP32-C3

Documentacion tecnica para replicar el modulo de electromiografia de FisioAccess usando un ADC externo ADS1115 conectado via I2C a un ESP32-C3 con comunicacion USB Serial.

---

## 1. Hardware requerido

| Componente | Especificacion |
|---|---|
| Microcontrolador | ESP32-C3 (USB nativo) |
| ADC externo | ADS1115 (16-bit, I2C) |
| Electrodos | 3 electrodos EMG de superficie (activo, referencia, tierra) |
| Conexion | USB directo al PC (sin adaptador UART) |

### Conexion I2C

```
ESP32-C3          ADS1115
--------          -------
GPIO6 (SDA) ----> SDA
GPIO7 (SCL) ----> SCL
3.3V        ----> VDD      ⚠ DEBE ser 3.3V, NO 5V
GND         ----> GND
                  ADDR ----> GND (dirección 0x48)

ADS1115 canal 3 (A3) <---- Señal EMG
```

> **Nota**: Los pines SDA/SCL se configuran en `Wire.begin(6, 7)`. Ajustar segun tu placa.

---

## 2. Firmware

**Archivo**: `firmware/emg_ads1115.ino`

### Configuracion critica

```cpp
Serial.begin(115200);                 // USB a 115200 — necesario para 860 SPS
delay(2000);                          // Espera fija — NO usar while(!Serial) en ESP32-C3
ads.setGain(GAIN_ONE);                // ±4.096V, resolucion 0.125 mV/bit
ads.setDataRate(RATE_ADS1115_860SPS); // Maximo data rate del ADS1115
```

> **IMPORTANTE para ESP32-C3**: Nunca usar `while(!Serial)` — puede bloquear
> indefinidamente. Usar `delay(2000)` en su lugar.

### Arduino IDE → Tools

```
Board:           ESP32C3 Dev Module
USB CDC On Boot: Enabled
```

### Por que 860 SPS

La señal EMG de superficie tiene componentes frecuenciales hasta ~500 Hz. Segun Nyquist, necesitamos al menos 1000 Hz para capturar correctamente. El ADS1115 a 860 SPS es el maximo posible con este ADC — suficiente para EMG clinico basico, aunque marginal para analisis espectral avanzado.

### Formato de salida Serial

```
timestamp_ms,adc_raw,mv
```

Ejemplo:
```
152,14145,1768.1250
153,14140,1767.5000
154,14152,1769.0000
```

- `timestamp_ms`: milisegundos desde inicio
- `adc_raw`: valor entero del ADC (0 a ~32767 en SingleEnded)
- `mv`: milivoltios reales calculados con `ads.computeVolts(adc) * 1000.0`

### Principios del firmware

1. **Sin delays en loop**: `readADC_SingleEnded()` bloquea ~1.16ms (1/860) esperando la conversion — eso es el temporizador natural.
2. **Sin filtros en firmware**: todo el procesamiento se hace en software (Rust backend).
3. **Conversion a mV en firmware**: se envia el valor real en milivoltios via `computeVolts()`, haciendo el backend independiente de la ganancia del ADC.
4. **Warmup en arranque**: las primeras 20 lecturas se descartan para que el ADC se estabilice.
5. **Validacion**: lecturas negativas se descartan como muestras corruptas.

### Dependencias Arduino

```
Adafruit ADS1X15   (Adafruit_ADS1X15.h)
Wire               (incluida en ESP32 core)
```

---

## 3. Pipeline de procesamiento (Backend Rust)

**Archivos clave**:
- `crates/fisio-emg/src/converter.rs` — Utilidades de conversion
- `crates/fisio-emg/src/processor.rs` — Pipeline de señal

### Diagrama del pipeline

> El firmware envía mV directos vía `computeVolts()`. El procesador recibe mV,
> NO raw counts. El backend tambien acepta raw counts (valor unico sin comas)
> y los convierte automaticamente.

```
ADS1115 (860 SPS, GAIN_ONE)
      │
      ▼ Firmware: ads.computeVolts(adc) × 1000
 mV directo (independiente de ganancia)
      │
      ▼ Parser auto-detecta formato (CSV → mV, valor unico → raw × 0.125)
      │
      ▼ mV - offset_calibrado          ← DC Removal (ANTES de cualquier RMS)
 Señal centrada (0 = reposo)
      │
      ▼ Butterworth HP 20Hz
 Sin artefactos de movimiento
      │
      ▼ Notch 50Hz Q=30
 Sin interferencia de red
      │
      ▼ Butterworth LP 450Hz
 Sin ruido de alta frecuencia fuera de banda EMG
      │
      ▼ Warmup: 20 muestras alimentan filtros, retornan 0.0
      │
      ├──────────────────────────┐
      │                          │
      ▼ filtered (mV)           ▼ abs()
 Forma de onda           Rectificacion onda completa
 (señal bipolar)               │
      │                         ▼ EMA (α = 0.01)
      │                    Envolvente suavizada (mV)
      │                          │
      ▼                          ▼
 Frontend recibe ambos: { filtered, envelope }
```

El procesador retorna un `EmgSample` con dos campos:
- **`filtered`**: señal filtrada sin rectificar (forma de onda bipolar, oscila +/-)
- **`envelope`**: envolvente suavizada (siempre >= 0, representa amplitud de contraccion)

### 3.1 Constantes

```rust
// converter.rs
pub const ADS_RESOLUTION_MV: f64 = 0.125;   // mV/bit (GAIN_ONE) — solo para fallback raw→mV
pub const DEFAULT_OFFSET_MV: f64 = 1768.0;  // ~14143 counts × 0.125 — se recalcula al calibrar
pub const SAMPLE_RATE_HZ: f64 = 860.0;      // Data rate maximo
```

`ADS_RESOLUTION_MV` solo se usa cuando el firmware envia raw counts sin conversion.
Con el firmware CSV, el procesador recibe mV directamente.

**Ganancias de referencia**:

| Ganancia | Rango | Resolucion | Uso |
|---|---|---|---|
| GAIN_TWOTHIRDS | ±6.144V | 0.1875 mV/bit | Default de la libreria |
| GAIN_ONE | ±4.096V | 0.125 mV/bit | VDD=3.3V (recomendado) |
| GAIN_TWO | ±2.048V | 0.0625 mV/bit | Mayor resolucion |

### 3.2 Centrado de señal

```rust
pub fn center(voltage_mv: f64, offset_mv: f64) -> f64 {
    voltage_mv - offset_mv
}
```

El offset se determina por calibracion (promedio de N segundos en reposo). Sin calibrar, se usa 1768 mV como valor por defecto.

### 3.3 Filtros

| Filtro | Tipo | Frecuencia | Proposito |
|---|---|---|---|
| Highpass | Butterworth 2do orden | 20 Hz | Eliminar artefactos de movimiento y drift DC |
| Notch | Biquad | 50 Hz, Q=30 | Rechazar interferencia de red electrica |
| Lowpass | Butterworth 2do orden | 450 Hz | Eliminar ruido HF fuera de la banda EMG util (20-450 Hz) |

El lowpass a 450 Hz es critico para reducir ruido visible en el grafico. Sin el, el ruido de alta frecuencia cercano a Nyquist (430 Hz) pasa completo y domina la visualizacion, haciendo que las contracciones no se distingan.

### 3.4 Rectificacion

```rust
pub fn rectify(centered_mv: f64) -> f64 {
    centered_mv.abs()
}
```

La señal EMG es bipolar (oscila alrededor de 0). La rectificacion de onda completa convierte todas las deflexiones a positivas, preparando la señal para la envolvente.

### 3.5 Envolvente EMA (Exponential Moving Average)

```rust
self.envelope = (alpha * rectified) + ((1.0 - alpha) * self.envelope);
```

- **alpha = 0.01** (actual): constante de ~100 muestras (~116 ms a 860 SPS), cutoff ~1.4 Hz. Suaviza el ruido y muestra las contracciones como "bultos" claros sobre una linea base limpia.
- **alpha = 0.1**: demasiado rapido a 860 SPS (~12 ms). La envolvente sigue el ruido sample-a-sample y las contracciones no se distinguen del ruido de fondo.

La eleccion de alpha=0.01 es el resultado de calibrar para que contracciones de 0.5-5 segundos se visualicen como picos claros sin que el ruido de fondo domine.

### 3.6 Warmup (estabilizacion de filtros)

Los filtros IIR tienen un transitorio al arranque. El procesador descarta las primeras 20 muestras (~23ms a 860 SPS): se pasan por los filtros para estabilizarlos, pero retornan 0.0.

El warmup se reinicia al crear un nuevo `EmgProcessor` o al iniciar calibracion.

---

## 4. Calibracion

### Proceso

1. El usuario conecta el dispositivo y coloca electrodos
2. Se inicia calibracion (boton en UI, tipicamente 5 segundos)
3. El paciente debe estar **en reposo completo** (musculo relajado)
4. El backend acumula muestras en mV durante la duracion
5. El offset se calcula como el **promedio** de todas las muestras
6. Todas las muestras futuras se centran restando este offset

### Eventos Tauri emitidos

| Evento | Payload | Cuando |
|---|---|---|
| `emg-calibration-progress` | `f64` (0.0 a 1.0) | Cada muestra durante calibracion |
| `emg-calibration-done` | `CalibrationStatus` | Al completar calibracion |

---

## 5. Comunicacion Serial (Tauri backend)

**Archivo**: `src-tauri/src/state.rs`

### Flujo de datos

```
USB Serial (115200 baud)
      │
      ▼ BufReader 64KB — no pierde paquetes a 860 SPS
      ▼ read_line()
 Linea de texto
      │
      ▼ Ignorar headers (lineas que no empiezan con digito)
      │
      ▼ Auto-detectar formato:
        - Con comas → CSV, tomar ultimo campo (mV)
        - Sin comas → raw counts × 0.125 = mV
      │
      ▼ EmgProcessor::process(mv)
 EmgSample { filtered, envelope }
      │
      ▼ app.emit("serial-data", point)
 Frontend recibe { timestamp_ms, filtered, envelope }
```

El evento `serial-data` incluye ambos campos:
- `filtered`: forma de onda filtrada (bipolar, puede ser negativa)
- `envelope`: envolvente suavizada (siempre >= 0)

Para modulos que no usan el pipeline EMG (ECG, Spiro), `filtered` contiene el valor mV crudo y `envelope` su valor absoluto.

### Conexion desde frontend

```typescript
const EMG_BAUD_RATE = 115200;

await invoke("serial_connect", {
  port: selectedPort,
  baudRate: EMG_BAUD_RATE,
  mode: "emg"  // Activa el EmgProcessor en el backend
});
```

---

## 6. Frontend (React/TypeScript)

### Unidades: todo en mV

La salida del procesador es **milivoltios (mV)**. Todos los componentes trabajan en mV:

| Componente | Archivo | Funcion |
|---|---|---|
| EMGCanvas | `src/components/shared/EMGCanvas.tsx` | Grafico en tiempo real con doble traza |
| VUMeter | `src/components/shared/VUMeter.tsx` | Barra vertical de nivel RMS |
| PhaseComparison | `src/components/shared/PhaseComparison.tsx` | Comparacion entre fases |
| ReportPreview | `src/components/shared/ReportPreview.tsx` | Reporte exportable |

### Visualizacion de doble traza

El grafico EMG muestra dos señales superpuestas:

1. **Forma de onda filtrada** (`filtered`): traza principal en color ambar. Muestra las oscilaciones bipolares (+/-) de la actividad muscular. Permite ver la morfologia de la señal EMG.

2. **Envolvente** (`envelope`): traza superpuesta en purpura (gruesa). Muestra la amplitud suavizada de la contraccion. Sube cuando hay contraccion y baja en reposo. Se dibuja tambien espejada en negativo con opacidad reducida para dar contexto visual simetrico.

La traza RMS (opcional, activable) se dibuja en azul claro punteado como referencia adicional.

### Escalas de visualizacion

```typescript
export const SCALE_PRESETS = [0.5, 1, 2, 5] as const; // ±mV
```

### Umbrales VU Meter

```typescript
export const DEFAULT_THRESHOLDS: VUThresholds = {
  reposo: 0.05,  // mV RMS — zona verde
  leve: 0.5,     // mV RMS — zona amarilla
  mvc: 5.0,      // mV RMS — zona roja (maximo)
};
```

### Rango esperado de señal EMG

| Estado | Rango tipico (mV) |
|---|---|
| Reposo | 0 - 0.05 |
| Contraccion leve | 0.1 - 0.5 |
| Contraccion moderada | 0.5 - 2.0 |
| Contraccion maxima (MVC) | 1.0 - 5.0 |

---

## 7. Configuracion ADC (panel UI)

| Parametro | Default | Descripcion |
|---|---|---|
| Vref | 0.125 mV/LSB | Resolucion del ADS1115 con GAIN_ONE |
| Resolucion | 16 bits | Bits del ADC |
| Offset | 1768 mV | Valor DC en reposo (se actualiza con calibracion) |

---

## 8. Metricas clinicas EMG

### RMS (Root Mean Square — Valor eficaz)

Representa la **potencia promedio** de la contraccion muscular. Es el dato mas usado en EMG clinico para cuantificar fuerza.

```
RMS = √(suma de valores² / cantidad de muestras)
```

| Estado del musculo | RMS tipico |
|---|---|
| Relajado | ≈ 0 mV |
| Contraccion leve | sube moderadamente |
| Contraccion maxima | valor mas alto |

**Uso clinico**: comparar intensidad de contraccion entre fases, entre musculos, o entre sesiones de rehabilitacion.

### P-P (Peak to Peak — Pico a pico)

Es la **diferencia entre el punto mas alto y el mas bajo** de la señal en una fase.

```
P-P = valor maximo - valor minimo
```

Un P-P grande indica que el musculo genero una deflexion fuerte. Es util para detectar activaciones bruscas o espasmos.

**Uso clinico**: detectar picos de activacion involuntaria, espasmos, o evaluar la amplitud de respuesta muscular.

### %MVC (Porcentaje de Contraccion Voluntaria Maxima)

Compara cualquier contraccion contra la **fuerza maxima que el paciente puede hacer**. Normaliza los datos para poder comparar entre pacientes.

```
%MVC = (RMS de la fase / RMS de la fase MVC) × 100
```

Ejemplo:
- Fase MVC (maxima fuerza): RMS = 2.0 mV
- Fase contraccion leve: RMS = 0.4 mV
- %MVC = (0.4 / 2.0) × 100 = **20%**

Esto significa que la contraccion leve uso el 20% de la capacidad maxima del musculo.

**Uso clinico**: es la metrica mas importante en rehabilitacion porque un 30% MVC significa lo mismo en alguien fuerte que en alguien debil. Permite evaluar progreso entre sesiones.

### Resumen de metricas

| Metrica | Que muestra | Cuando usarla |
|---|---|---|
| **RMS** | Intensidad promedio de contraccion | Comparar fuerza entre fases |
| **P-P** | Amplitud maxima de la señal | Detectar picos, espasmos |
| **%MVC** | Esfuerzo relativo al maximo del paciente | Rehabilitacion, evaluar progreso |

---

## 9. VU Meter (indicador de nivel)

El VU Meter es la barra vertical de colores que muestra la intensidad de contraccion en tiempo real. Tiene tres zonas basadas en umbrales RMS:

| Zona | Color | Umbral default | Significado |
|---|---|---|---|
| Reposo | Verde | < 0.05 mV | Musculo relajado |
| Leve | Amarillo | 0.05 - 0.5 mV | Contraccion leve |
| MVC | Rojo | > 0.5 mV | Contraccion fuerte/maxima |

Estos umbrales son defaults. Se ajustan automaticamente si se usa la calibracion VU de 3 pasos (reposo → leve → MVC) que mide los umbrales reales del paciente.

---

## 10. Protocolo de prueba EMG

El `ProtocolRunner` ejecuta una secuencia automatizada:

1. **Reposo** (5s): musculo relajado, establece baseline
2. **Contraccion leve** (5s): fuerza minima sostenida
3. **Contraccion maxima / MVC** (3s): fuerza maxima voluntaria

Cada fase genera marcadores en el grafico y calcula estadisticas (RMS, P-P, %MVC, frecuencia mediana).

---

## 11. Estructura de archivos

```
FisioAccess/
├── firmware/
│   ├── emg_ads1115.ino          # Firmware EMG (ADS1115 + ESP32-C3)
│   └── codigo_robusto.ino       # Firmware ECG (ADC interno)
├── crates/fisio-emg/src/
│   ├── converter.rs             # Constantes ADS1115 y conversion a mV
│   ├── processor.rs             # Pipeline: centrar → HP → notch → LP → rect → EMA (retorna EmgSample)
│   ├── calibration.rs           # Motor de calibracion
│   ├── handler.rs               # Handler de dispositivo
│   └── lib.rs                   # Exports del crate
├── crates/fisio-filters/src/
│   ├── butterworth.rs           # Filtros Butterworth (HP/LP)
│   ├── notch.rs                 # Filtro notch (50/60 Hz)
│   ├── moving_avg.rs            # Media movil
│   └── traits.rs                # FilterTrait
├── src-tauri/src/
│   ├── state.rs                 # SerialManager + EmgProcessor (emite filtered + envelope)
│   ├── commands.rs              # Comandos Tauri IPC
│   └── lib.rs                   # Setup de la app
├── src/
│   ├── pages/EMGMonitor.tsx     # Pagina principal EMG
│   └── components/shared/
│       ├── EMGCanvas.tsx         # Visualizacion de señal (doble traza: filtered + envelope)
│       ├── VUMeter.tsx           # Indicador de nivel
│       ├── PhaseComparison.tsx   # Comparacion de fases
│       ├── ProtocolRunner.tsx    # Ejecucion de protocolos
│       └── ReportPreview.tsx     # Generacion de reportes
```

---

## 12. Checklist para replicar

- [ ] Montar hardware: ESP32-C3 + ADS1115 via I2C + electrodos
- [ ] Arduino IDE: Board=ESP32C3, USB CDC On Boot=Enabled
- [ ] Cargar `firmware/emg_ads1115.ino` (requiere libreria Adafruit ADS1X15)
- [ ] Verificar con monitor serial a 115200 que llegan lineas CSV
- [ ] Verificar que los valores raw en reposo estan alrededor de 14000-14200
- [ ] Cerrar monitor serial (no puede compartir puerto con FisioAccess)
- [ ] Abrir FisioAccess, seleccionar puerto, Conectar, **Play**
- [ ] Ejecutar calibracion (5s en reposo)
- [ ] Ejecutar protocolo (reposo → leve → MVC)
- [ ] Verificar que la envolvente responde a contracciones musculares
- [ ] Exportar reporte con valores en mV
