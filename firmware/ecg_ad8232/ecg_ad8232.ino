/**
 * FisioAccess — Firmware ECG con AD8232 + ESP32-C3 Super Mini
 *
 * Pinout:
 *   ESP32-C3          AD8232
 *   ─────────────────────────
 *   GPIO2  (A0)  →  OUTPUT
 *   GPIO6  (SDA) →  LO-
 *   GPIO7  (SCL) →  LO+
 *   3.3V         →  3.3V
 *   GND          →  GND
 *
 * Protocolo serial:
 *   - Baud: 9600
 *   - Formato: un valor numerico por linea (el ADC crudo 0-4095)
 *   - Si los electrodos estan desconectados envia "!" en vez de valor
 *   - El backend de FisioAccess parsea la ultima columna numerica de cada linea
 *     y genera el timestamp del lado del PC, asi que NO enviamos timestamp
 *
 * El ESP32-C3 tiene ADC de 12 bits (0-4095), Vref 3.3V.
 * La app autodetecta ADC 12-bit y convierte a mV con la calibracion configurada.
 *
 * Frecuencia de muestreo: ~250 Hz (4 ms entre muestras).
 * Ajustable con SAMPLE_INTERVAL_US.
 */

// ── Pines ──────────────────────────────────────────────────
const int PIN_ECG_OUTPUT = 2;   // Salida analogica del AD8232
const int PIN_LO_MINUS   = 6;   // Leads-off detection LO-
const int PIN_LO_PLUS    = 7;   // Leads-off detection LO+

// ── Configuracion ──────────────────────────────────────────
const unsigned long SAMPLE_INTERVAL_US = 4000;  // 4 ms → 250 Hz
const unsigned long BAUD_RATE = 9600;

// ── Variables ──────────────────────────────────────────────
unsigned long lastSampleTime = 0;

void setup() {
  Serial.begin(BAUD_RATE);

  // Leads-off detection: entradas con pullup
  pinMode(PIN_LO_MINUS, INPUT);
  pinMode(PIN_LO_PLUS,  INPUT);

  // ADC: resolucion 12 bits (por defecto en ESP32-C3)
  analogReadResolution(12);

  // Esperar a que el serial este listo
  while (!Serial) {
    delay(10);
  }
}

void loop() {
  unsigned long now = micros();

  // Control de frecuencia de muestreo
  if (now - lastSampleTime < SAMPLE_INTERVAL_US) {
    return;
  }
  lastSampleTime = now;

  // Verificar leads-off: si alguno de los electrodos esta desconectado
  bool leadsOff = (digitalRead(PIN_LO_PLUS) == HIGH) ||
                  (digitalRead(PIN_LO_MINUS) == HIGH);

  if (leadsOff) {
    // Indicar electrodos desconectados (el backend ignora lineas no numericas)
    Serial.println("!");
  } else {
    // Leer valor analogico (0-4095 para ADC 12 bits)
    int value = analogRead(PIN_ECG_OUTPUT);
    Serial.println(value);
  }
}
