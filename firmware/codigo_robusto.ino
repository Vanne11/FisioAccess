// -----------------------------------------------------------------------------
// Adaptado del código original de Peter Balch
// ESP32-C3 ECG Monitor con filtrado mejorado y salida por puerto serial
// -----------------------------------------------------------------------------

#include <Arduino.h>

// -----------------------------------------------------------------------------
// Definiciones
// -----------------------------------------------------------------------------

// Pin para la entrada ECG
const int ECG_IN = A2; // GPIO2 en ESP32-C3

// Configuración de muestreo
const int SamplePeriod = 5; // mSec

// -----------------------------------------------------------------------------
// Variables Globales
// -----------------------------------------------------------------------------

uint32_t startTime = 0;
bool filterEnabled[4] = {true, false, true, true}; // Activación de filtros [Notch50Hz_Q1, Notch50Hz_Q2, LowPass, Notch60Hz]

// -----------------------------------------------------------------------------
// getADCfast - Lectura rápida del ADC para ESP32
// -----------------------------------------------------------------------------
int getADCfast(void)
{
  // Oversampling 4x: reduce ruido de cuantizacion (~+1 bit resolucion efectiva)
  int sum = 0;
  for (int i = 0; i < 4; i++) {
    sum += analogRead(ECG_IN);
  }
  return sum >> 2;
}

// -----------------------------------------------------------------------------
// Filtros de procesamiento de señal
// -----------------------------------------------------------------------------

// Filtro paso bajo
int FilterLowPass(int ecg)
{
    static int py = 0;
    static int ppy = 0;
    static int ppecg = 0;
    static int pecg = 0;
    int y;
    static int mid = 0;

    const long filt_a0 = 8775;
    const long filt_a1 = 17550;
    const long filt_a2 = 8775;
    const long filt_b1 = -50049;
    const long filt_b2 = 19612;

    if (ecg > mid) 
      mid++; else 
      mid--;
    
    ecg -= mid; // Eliminar offset DC
    y = (filt_a0*ecg + filt_a1*pecg + filt_a2*ppecg - filt_b1*py - filt_b2*ppy) >> 16;
    ppy = py;
    py = y;
    ppecg = pecg;
    pecg = ecg;
    return constrain(y + mid, 0, 4095); // ESP32 usa ADC de 12 bits, por lo que el máximo es 4095
}

// Filtro Notch 50Hz Q=1
int FilterNotch50HzQ1(int ecg)
{
    static int py = 0;
    static int ppy = 0;
    static int ppecg = 0;
    static int pecg = 0;
    int y;
    static int mid = 0;

    const long filt_a0 = 43691; // Q=1
    const long filt_b2 = 21845; // Q=1

    if (ecg > mid) 
      mid++; else 
      mid--;
    
    ecg -= mid; // Eliminar offset DC
    y = (filt_a0*(ecg + ppecg) - filt_b2*ppy) >> 16;
    ppy = py;
    py = y;
    ppecg = pecg;
    pecg = ecg;
    return constrain(y + mid, 0, 4095);
}

// Filtro Notch 50Hz Q=2
int FilterNotch50HzQ2(int ecg)
{
    static int py = 0;
    static int ppy = 0;
    static int ppecg = 0;
    static int pecg = 0;
    int y;
    static int mid = 0;

    const long filt_a0 = 52429; // Q=2
    const long filt_b2 = 39322; // Q=2

    if (ecg > mid) 
      mid--; else 
      mid++;
    
    ecg -= mid; // Eliminar offset DC
    y = (filt_a0*(ecg + ppecg) - filt_b2*ppy) >> 16;
    ppy = py;
    py = y;
    ppecg = pecg;
    pecg = ecg;
    return constrain(y + mid, 0, 4095);
}

// Filtro Notch 60Hz Q=1
int FilterNotch60Hz(int ecg)
{
    static int py = 0;
    static int ppy = 0;
    static int ppecg = 0;
    static int pecg = 0;
    int y;
    static int mid = 0;

    const long filt_a0 = 44415;
    const long filt_a1 = 27450;
    const long filt_b2 = 23294;

    if (ecg > mid) 
      mid++; else 
      mid--;
    
    ecg -= mid; // Eliminar offset DC
    y = (filt_a0*(ecg + ppecg) + filt_a1*(pecg - py) - filt_b2*ppy) >> 16;
    ppy = py;
    py = y;
    ppecg = pecg;
    pecg = ecg;
    return constrain(y + mid, 0, 4095);
}

// Filtro paso alto para eliminar deriva de linea base (punto fijo)
int FilterHighPass(int ecg)
{
    static long py = 0;
    static int pecg = 0;
    long y;

    // alpha = 0.995 en punto fijo Q16: round(0.995 * 65536) = 65209
    const long alpha_q16 = 65209;

    y = (alpha_q16 * (py / 65536L + ecg - pecg));  // Resultado en Q16
    // Normalizar: mantener py en Q16 para precision
    py = y;
    pecg = ecg;

    return constrain((int)(y >> 16) + 2048, 0, 4095);
}

// Filtro promediador para reducir ruido (nuevo)
int FilterAverage(int ecg)
{
    static int buffer[8] = {0};
    static int index = 0;
    long sum = 0;
    
    // Almacenar valor actual en buffer circular
    buffer[index] = ecg;
    index = (index + 1) % 8;
    
    // Calcular promedio
    for (int i = 0; i < 8; i++) {
        sum += buffer[i];
    }
    
    return sum / 8;
}

// Procesado en cascada de todos los filtros seleccionados
int processSignal(int ecg)
{
    // Primer paso: Filtro paso alto para eliminar deriva
    ecg = FilterHighPass(ecg);
    
    // Notch filters para eliminar ruido eléctrico
    if (filterEnabled[0]) ecg = FilterNotch50HzQ1(ecg);
    if (filterEnabled[1]) ecg = FilterNotch50HzQ2(ecg);
    if (filterEnabled[3]) ecg = FilterNotch60Hz(ecg);
    
    // Filtro paso bajo para suavizar
    if (filterEnabled[2]) ecg = FilterLowPass(ecg);
    
    // Promediado final para suavizado
    ecg = FilterAverage(ecg);
    
    return ecg;
}

// Calcula BPM a partir de la señal ECG (version simplificada)
void calcBPM(int ecg)
{
    static uint8_t prevy = 0;
    static uint32_t prevt = 0;
    static int InPeak = 0;
    static int bpm = 60;
    const int threshHi = 200;  // Ajustar según valores de ESP32
    const int threshLo = threshHi - 20;
    uint32_t t;

    if (ecg > prevy)
      prevy++; else
      prevy--;

    if (InPeak > 0) {
        InPeak++;
        if (ecg < prevy+threshLo) {     
            t = millis();
            int b = 60000 / (t-prevt);
            if ((b >= 30) && (b <= 200) && (InPeak < 100/SamplePeriod)) { // Pico debe ser estrecho y BPM razonable
                bpm = (bpm*7+b)/8; // Suavizado
                bpm += constrain(b-bpm,-1,+1);
                
                // Enviar BPM por serial
                Serial.print("BPM: ");
                Serial.println(bpm);
            }
            prevt = t;      
            InPeak = 0;
        }    
    } else {
        if (ecg > prevy+threshHi) 
            InPeak = 1;
    }  
}

// -----------------------------------------------------------------------------
// Configuración
// -----------------------------------------------------------------------------
void setup(void)
{
    Serial.begin(115200);
    delay(1000); // Dar tiempo para inicializar el puerto serial
    Serial.println("ESP32-C3 ECG Monitor");
    Serial.println("Tiempo(ms),ValorECG");
    
    // Configuración para la entrada analógica
    pinMode(ECG_IN, INPUT);
    
    // Registrar tiempo de inicio
    startTime = millis();
}

// -----------------------------------------------------------------------------
// Bucle principal
// -----------------------------------------------------------------------------
void loop(void)
{
    static unsigned long nextTime = 0;  
    unsigned long t = millis();
    
    // Control del periodo de muestreo
    if (t >= nextTime) {
        if (t > nextTime+10)
            nextTime = t; 
        else
            nextTime = nextTime + SamplePeriod;

        // Leer ECG
        int ecg = getADCfast();
        
        // Procesar señal
        int processedEcg = processSignal(ecg);
        
        // Calcular tiempo transcurrido desde inicio
        uint32_t elapsedTime = millis() - startTime;
        
        // Enviar datos por puerto serial: Tiempo,ValorECG
        Serial.print(elapsedTime);
        Serial.print(",");
        Serial.println(processedEcg);
        
        // Calcular BPM
        calcBPM(processedEcg);
    }
    
    // Verificar si hay comandos entrantes para cambiar configuración
    if (Serial.available() > 0) {
        char cmd = Serial.read();
        switch(cmd) {
            case '1': // Toggle filtro Notch50Hz_Q1
                filterEnabled[0] = !filterEnabled[0];
                Serial.print("Filtro Notch50Hz Q1: ");
                Serial.println(filterEnabled[0] ? "ON" : "OFF");
                break;
            case '2': // Toggle filtro Notch50Hz_Q2
                filterEnabled[1] = !filterEnabled[1];
                Serial.print("Filtro Notch50Hz Q2: ");
                Serial.println(filterEnabled[1] ? "ON" : "OFF");
                break;
            case '3': // Toggle filtro LowPass
                filterEnabled[2] = !filterEnabled[2];
                Serial.print("Filtro LowPass: ");
                Serial.println(filterEnabled[2] ? "ON" : "OFF");
                break;
            case '4': // Toggle filtro Notch60Hz
                filterEnabled[3] = !filterEnabled[3];
                Serial.print("Filtro Notch60Hz: ");
                Serial.println(filterEnabled[3] ? "ON" : "OFF");
                break;
            case 'h': // Mostrar ayuda
                Serial.println("\nComandos disponibles:");
                Serial.println("1: Toggle filtro Notch50Hz Q1");
                Serial.println("2: Toggle filtro Notch50Hz Q2");
                Serial.println("3: Toggle filtro LowPass");
                Serial.println("4: Toggle filtro Notch60Hz");
                Serial.println("h: Ayuda");
                break;
        }
    }
}
