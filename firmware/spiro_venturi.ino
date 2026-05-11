#include <Wire.h>
#include <Adafruit_ADS1X15.h>
#include <math.h>

Adafruit_ADS1115 ads;

#define I2C_SDA 6
#define I2C_SCL 7

struct FlowData {
    float flowRate;    // Flujo en L/s
    int direction;     // 1 = dirección positiva, -1 = dirección negativa
};

const int NUM_CALIBRATION_SAMPLES = 200;
const float PRESSURE_THRESHOLD = 0.002;    // Umbral de presión en kPa
const float FLOW_THRESHOLD = 0.1;         // Umbral de flujo en L/s
float calibrationOffset = 0;
float volume = 0;
// Constante corregida para Venturi 28mm/15mm: K = 6.77
const float FLOW_CONSTANT = 6.77;
unsigned long lastMeasurementTime = 0;     // Cambiado a unsigned long
unsigned long resetMeasurementTime = 0;    // Cambiado a unsigned long

void calibrateSensor() {
    const int TOTAL = NUM_CALIBRATION_SAMPLES * 2;
    float sumVoltages = 0;
    float sumSquares = 0;

    Serial.println(F("Iniciando calibración..."));
    Serial.println(F("Asegúrese que no hay flujo de aire"));
    delay(2000);

    for (int i = 0; i < TOTAL; i++) {
        int16_t adc0 = ads.readADC_SingleEnded(0);

        // Verificar lectura válida
        if (adc0 <= 100 || adc0 >= 32667) {
            Serial.println(F("Error: Lectura ADC fuera de rango"));
            i--; // Repetir esta muestra
            continue;
        }

        float volt = ads.computeVolts(adc0);

        if (i < NUM_CALIBRATION_SAMPLES) {
            sumVoltages += volt;
        } else {
            static float mean = sumVoltages / NUM_CALIBRATION_SAMPLES;
            sumSquares += sq(volt - mean);
        }

        if (i % (TOTAL / 20) == 0) {
            Serial.print(F("Calibrando: "));
            Serial.print((i * 100L) / TOTAL);
            Serial.println('%');
        }
        delay(10);
    }

    float meanVoltage = sumVoltages / NUM_CALIBRATION_SAMPLES;
    float stdDev = sqrt(sumSquares / NUM_CALIBRATION_SAMPLES);

    calibrationOffset = meanVoltage - 2.5;

    Serial.print(F("Calibración completada. Offset: "));
    Serial.println(calibrationOffset, 6);
    Serial.print(F("Desviación estándar: "));
    Serial.println(stdDev, 6);
    Serial.println(F("Iniciando mediciones..."));
}

FlowData calculateBidirectionalFlow(float pressureKPA) {
    FlowData result;

    // Aplicar umbral de presión
    if (abs(pressureKPA) < PRESSURE_THRESHOLD) {
        result.flowRate = 0;
        result.direction = 0;
        return result;
    }

    // Determinar dirección
    result.direction = (pressureKPA >= 0) ? 1 : -1;

    // Calcular flujo con ecuación de Venturi corregida
    // Q = K × √(ΔP) donde K = 6.77 para geometría 28mm/15mm
    result.flowRate = result.direction * FLOW_CONSTANT * sqrt(abs(pressureKPA));

    // Aplicar umbral de flujo
    if (abs(result.flowRate) < FLOW_THRESHOLD) {
        result.flowRate = 0;
        result.direction = 0;
    }

    return result;
}

float getPressureKPA(int channel) {
    // Promedio de varias lecturas para reducir ruido
    float sum = 0;
    const int numReadings = 5;
    int validReadings = 0;

    for(int i = 0; i < numReadings; i++) {
        int16_t adc = ads.readADC_SingleEnded(channel);

        // Verificar lectura válida
        if (adc <= 100 || adc >= 32667) {
            continue; // Saltar lectura inválida
        }

        float volt = ads.computeVolts(adc);
        float voltCalibrated = volt - calibrationOffset;

        // Convertir a kPa: (V - 2.5V) / 0.285 V/kPa
        sum += (voltCalibrated - 2.5) / 0.285;
        validReadings++;
        delay(2);
    }

    if (validReadings == 0) {
        Serial.println(F("Error: No se pudieron obtener lecturas válidas"));
        return 0;
    }

    return sum / validReadings;
}

void resetVolume() {
    volume = 0;
    lastMeasurementTime = millis();
    resetMeasurementTime = lastMeasurementTime;
}

void fullReset() {
    volume = 0;
    calibrateSensor();
    lastMeasurementTime = millis();
    resetMeasurementTime = lastMeasurementTime;
}

void setup(void) {
    delay(50);
    Serial.begin(115200);

    Wire.begin(I2C_SDA, I2C_SCL);

    Serial.println("Iniciando sistema de medición con Venturi 28mm/15mm...");
    Serial.println("Comandos disponibles:");
    Serial.println("'r' - Reset completo con nueva calibración");
    Serial.println("'v' - Reset solo del volumen");

    if (!ads.begin()) {
        Serial.println("Error: No se pudo inicializar el ADS1115!");
        while (1);
    }

    ads.setGain(GAIN_ONE);
    fullReset();
}

void loop(void) {
    // Procesar comandos serie
    if (Serial.available() > 0) {
        char command = Serial.read();
        switch(command) {
            case 'r':
            case 'R':
                fullReset();
                return;
            case 'v':
            case 'V':
                resetVolume();
                return;
        }
    }

    unsigned long currentTime = millis();

    // Calcular tiempo transcurrido desde última medición
    float deltaTimeSeconds = (currentTime - lastMeasurementTime) / 1000.0;

    // Obtener presión diferencial
    float pressure_kpa = getPressureKPA(0);

    // Calcular flujo
    FlowData flujo = calculateBidirectionalFlow(pressure_kpa);

    // Integrar volumen solo si hay flujo significativo y tiempo válido
    if (abs(flujo.flowRate) >= FLOW_THRESHOLD && deltaTimeSeconds > 0 && deltaTimeSeconds < 1.0) {
        volume += flujo.flowRate * deltaTimeSeconds;
    }

    // Actualizar tiempo de última medición
    lastMeasurementTime = currentTime;

    // Tiempo relativo desde el reset
    unsigned long relativeTime = currentTime - resetMeasurementTime;

    // Enviar datos
    Serial.print(relativeTime);
    Serial.print(",");
    Serial.print(pressure_kpa, 4);
    Serial.print(",");
    Serial.print(flujo.flowRate, 4);
    Serial.print(",");
    Serial.println(volume, 4);

    delay(10);
}
