// C++ code
// Lectura de 2 sensores de humedad de suelo + 1 sensor de temperatura (TMP36)
// Sprint 1 - SmartGreenAI: Cilantro Crop
// Cumple US-03 (temperatura, parcial), US-04 (humedad de suelo) y US-05 (trazabilidad por ID)

// ---- Identificación de invernadero / área (US-05) ----
const char* GREENHOUSE_ID = "GH-01";
const char* AREA_ID       = "AREA-1";

// ---- Identificación única de cada sensor (US-05) ----
const char* SOIL_SENSOR_ID_1 = "SM-01";   // Soil Moisture sensor 1
const char* SOIL_SENSOR_ID_2 = "SM-02";   // Soil Moisture sensor 2
const char* TEMP_SENSOR_ID   = "TMP-01";  // TMP36 temperature sensor

// ---- Pines ----
const int SOIL_POWER_PIN = A0;  // Alimentación compartida de ambos sensores de humedad
const int SOIL1_SIG_PIN  = A1;  // Señal del sensor de humedad 1
const int TEMP_PIN       = A2;  // Vout del TMP36
const int SOIL2_SIG_PIN  = A3;  // Señal del sensor de humedad 2

int moisture1 = 0;
int moisture2 = 0;
float voltage = 0;
float temperatureC = 0;

// Envía una lectura en formato trazable: invernadero, área, sensor, tipo, valor, unidad, timestamp(ms)
void printReading(const char* sensorId, const char* type, float value, const char* unit) {
  Serial.print("{");
  Serial.print("\"greenhouse_id\":\""); Serial.print(GREENHOUSE_ID); Serial.print("\",");
  Serial.print("\"area_id\":\"");       Serial.print(AREA_ID);       Serial.print("\",");
  Serial.print("\"sensor_id\":\"");     Serial.print(sensorId);      Serial.print("\",");
  Serial.print("\"type\":\"");          Serial.print(type);          Serial.print("\",");
  Serial.print("\"value\":");           Serial.print(value);         Serial.print(",");
  Serial.print("\"unit\":\"");          Serial.print(unit);          Serial.print("\",");
  Serial.print("\"timestamp_ms\":");    Serial.print(millis());
  Serial.println("}");
}

void setup()
{
  pinMode(SOIL_POWER_PIN, OUTPUT);
  pinMode(SOIL1_SIG_PIN, INPUT);
  pinMode(SOIL2_SIG_PIN, INPUT);
  pinMode(TEMP_PIN, INPUT);

  Serial.begin(9600);
}

void loop()
{
  // ---- Sensores de humedad (alimentación compartida) ----
  digitalWrite(SOIL_POWER_PIN, HIGH);
  delay(10);
  moisture1 = analogRead(SOIL1_SIG_PIN);
  moisture2 = analogRead(SOIL2_SIG_PIN);
  digitalWrite(SOIL_POWER_PIN, LOW);   // Apaga los sensores para evitar corrosión

  // ---- Sensor de temperatura TMP36 ----
  int tempLectura = analogRead(TEMP_PIN);
  voltage = tempLectura * (5.0 / 1023.0);
  temperatureC = (voltage - 0.5) * 100.0;

  // ---- Mostrar datos por el Monitor Serial (formato trazable, US-05) ----
  printReading(SOIL_SENSOR_ID_1, "soil_moisture", moisture1, "raw");
  printReading(SOIL_SENSOR_ID_2, "soil_moisture", moisture2, "raw");
  printReading(TEMP_SENSOR_ID, "temperature", temperatureC, "C");

  delay(500);
}
