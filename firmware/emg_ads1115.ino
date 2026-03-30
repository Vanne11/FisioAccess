// -----------------------------------------------------------------------------
// EMG con ADS1115 + ESP32-C3 (USB Serial)
// 860 SPS, envío de mV reales en formato CSV
// -----------------------------------------------------------------------------
//
// HARDWARE:
//   - ADS1115 VDD = 3.3V
//   - Señal EMG en canal A3
//   - I2C: SDA=GPIO6, SCL=GPIO7
//   - ADDR del ADS1115 a GND (0x48)
//
// ARDUINO IDE → Tools:
//   Board:           ESP32C3 Dev Module
//   USB CDC On Boot: Enabled
// -----------------------------------------------------------------------------

#include <Wire.h>
#include <Adafruit_ADS1X15.h>

#define SDA_PIN 6
#define SCL_PIN 7
#define EMG_CHANNEL 3
#define WARMUP_SAMPLES 20

Adafruit_ADS1115 ads;

void setup()
{
    Serial.begin(115200);
    delay(2000); // Espera fija — NO usar while(!Serial) en ESP32-C3

    Wire.begin(SDA_PIN, SCL_PIN);

    if (!ads.begin()) {
        Serial.println("ERROR: ADS1115 no encontrado");
        while (1) { delay(1000); }
    }

    ads.setGain(GAIN_ONE);              // ±4.096V, 0.125 mV/bit
    ads.setDataRate(RATE_ADS1115_860SPS); // Máximo: 860 muestras/s

    for (uint16_t i = 0; i < WARMUP_SAMPLES; i++) {
        ads.readADC_SingleEnded(EMG_CHANNEL);
    }

    Serial.println("EMG_READY");
}

void loop()
{
    static uint32_t startTime = millis();

    int16_t adc = ads.readADC_SingleEnded(EMG_CHANNEL);
    if (adc < 0) return;

    float mv = ads.computeVolts(adc) * 1000.0f;

    Serial.print(millis() - startTime);
    Serial.print(',');
    Serial.print(adc);
    Serial.print(',');
    Serial.println(mv, 4);
}
