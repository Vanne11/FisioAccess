/**
 * FisioAccess — Firmware ECG con AD8232 + ESP32-C3 Super Mini
 *
 * Pinout:
 *   ESP32-C3          AD8232
 *   ─────────────────────────
 *   GPIO2  (A0)  →  OUTPUT
 *   GPIO6        →  LO-
 *   GPIO7        →  LO+
 *   3.3V         →  3.3V
 *   GND          →  GND
 *
 * Protocolo serial:
 *   - Baud: 115200
 *   - Formato: un valor numerico por linea (filtrado, 0-4095)
 *   - Si los electrodos estan desconectados envia "!" en vez de valor
 *   - El backend de FisioAccess parsea la ultima columna numerica de cada linea
 *     y genera el timestamp del lado del PC, asi que NO enviamos timestamp
 *
 * Filtro: media movil de 5 muestras (suavizado de ruido de alta frecuencia).
 * Frecuencia de muestreo: 250 Hz (4 ms entre muestras).
 */

const int PIN_ECG_OUTPUT = 2;
const int PIN_LO_MINUS   = 6;
const int PIN_LO_PLUS    = 7;

const unsigned long SAMPLE_INTERVAL_US = 4000; // 250 Hz
const unsigned long BAUD_RATE = 115200;

// --- Variables para el Filtro ---
const int WINDOW_SIZE = 5;    // Tamaño de la ventana de promedio
int readings[WINDOW_SIZE];
int readIndex = 0;
long total = 0;
int average = 0;

unsigned long lastSampleTime = 0;

void setup() {
  Serial.begin(BAUD_RATE);
  pinMode(PIN_LO_MINUS, INPUT);
  pinMode(PIN_LO_PLUS,  INPUT);
  analogReadResolution(12);

  // Inicializar array de filtro
  for (int i = 0; i < WINDOW_SIZE; i++) readings[i] = 0;
}

void loop() {
  unsigned long now = micros();

  if (now - lastSampleTime < SAMPLE_INTERVAL_US) return;
  lastSampleTime = now;

  // Verificación de cables sueltos
  if (digitalRead(PIN_LO_PLUS) == HIGH || digitalRead(PIN_LO_MINUS) == HIGH) {
    Serial.println("!");
  } else {
    // 1. Lectura cruda
    int rawValue = analogRead(PIN_ECG_OUTPUT);

    // 2. Filtro de Media Móvil (Suavizado)
    total = total - readings[readIndex];
    readings[readIndex] = rawValue;
    total = total + readings[readIndex];
    readIndex = (readIndex + 1) % WINDOW_SIZE;
    average = total / WINDOW_SIZE;

    // 3. Enviar valor filtrado
    Serial.println(average);
  }
}
