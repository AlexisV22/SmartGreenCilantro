// SmartGreenAI: Cilantro Crop - Nodo IoT del prototipo con envio a la nube
// Placa: Heltec WiFi Kit 32 (V3)
//
// CONEXIONES (montaje real del prototipo)
//   Humedad de suelo : VCC -> 3V3 | GND -> GND | AO   -> pin 2
//   LDR (modulo)     : izquierdo (senal) -> pin 3 | centro -> GND | derecho -> 3V3
//   DHT11            : VCC -> 3V3 | GND -> GND | DATA -> pin 5
//
// Cada 2 s: lee los sensores y actualiza OLED y Monitor Serie.
// Cada 60 s: obtiene hora UTC (NTP) y envia SM-01, TMP-01 y HUM-01 a POST /api/measurements.
// La luz se muestra pero NO se envia (es relativa; la API espera lux).
//
// WiFi, URL y API key van en secrets.h (copia secrets.h.example).
// Librerias: DHT sensor library (Adafruit) + Adafruit Unified Sensor

#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>
#include "HT_SSD1306Wire.h"
#include "DHT.h"
#include "secrets.h"

const char* API_URL = API_BASE_URL "/measurements";
const unsigned long SEND_INTERVAL_MS = 60000;   // envio a la nube cada 60 s
const uint16_t HTTP_TIMEOUT_MS = 15000;         // Vercel puede tardar unos segundos en "despertar"

#define PIN_SUELO 2
#define PIN_LUZ   3
#define PIN_DHT   5

// -1 = sensor de suelo alimentado directo a 3V3 (cableado actual).
// Para reducir la corrosion del HW-080: conecta su VCC a un GPIO libre (ej. 6) y pon aqui ese numero.
#define PIN_SUELO_PWR -1

// Calibracion suelo: reemplaza con TUS valores
const int SUELO_SECO   = 3200;   // sensor al aire
const int SUELO_MOJADO = 1400;   // sensor en agua

// Calibracion luz: valores provisionales, vuelve a medir en la ESP32
const int LUZ_OSCURO = 150;      // sensor tapado
const int LUZ_CLARO  = 3500;     // luz muy fuerte

DHT dht(PIN_DHT, DHT11);

static SSD1306Wire display(0x3c, 500000, SDA_OLED, SCL_OLED, GEOMETRY_128_64, RST_OLED);

void VextON(void) {
  pinMode(Vext, OUTPUT);
  digitalWrite(Vext, LOW);
}

int leerPromedio(int pin, int muestras = 16) {
  long suma = 0;
  for (int i = 0; i < muestras; i++) {
    suma += analogRead(pin);
    delay(5);
  }
  return suma / muestras;
}

int leerSuelo() {
  if (PIN_SUELO_PWR >= 0) { digitalWrite(PIN_SUELO_PWR, HIGH); delay(100); }
  int v = leerPromedio(PIN_SUELO);
  if (PIN_SUELO_PWR >= 0) digitalWrite(PIN_SUELO_PWR, LOW);
  return v;
}

// ---------- WiFi / NTP / API ----------
bool horaOk() { return time(nullptr) >= 1700000000; }

void conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) delay(250);
}

bool sincronizarHora() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");   // UTC
  unsigned long t0 = millis();
  while (!horaOk() && millis() - t0 < 10000) delay(250);
  return horaOk();
}

String ahoraISO() {
  time_t t = time(nullptr);
  struct tm tmv;
  gmtime_r(&t, &tmv);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmv);
  return String(buf);
}

// Envia el JSON y deja la respuesta del servidor en 'respuesta'.
int postJson(const String &body, String &respuesta) {
  WiFiClientSecure secureClient;
  WiFiClient plainClient;
  HTTPClient http;

  if (String(API_URL).startsWith("https")) {
    secureClient.setInsecure();     // para pruebas; en produccion carga el certificado
    http.begin(secureClient, API_URL);
  } else {
    http.begin(plainClient, API_URL);
  }
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", DEVICE_API_KEY);

  int code = http.POST(body);
  if (code > 0) {
    respuesta = http.getString();
    Serial.println(respuesta);
  }
  http.end();
  return code;
}

void agregarLectura(String &body, const char* id, float valor, const char* unidad, const String &ts) {
  if (body.length() > 1) body += ",";
  body += "{\"sensor_id\":\"" + String(id) + "\",\"value\":" + String(valor, 1) +
          ",\"unit\":\"" + unidad + "\",\"recorded_at\":\"" + ts + "\"}";
}

// Devuelve el texto de estado que se muestra en la OLED.
const char* enviarANube(float suelo, float temp, float hum, bool dhtOk) {
  conectarWifi();
  if (WiFi.status() != WL_CONNECTED) return "Sin WiFi";
  if (!horaOk() && !sincronizarHora()) return "Sin hora NTP";

  String ts = ahoraISO();
  String body = "[";
  agregarLectura(body, "SM-01", suelo, "%", ts);
  if (dhtOk) {
    agregarLectura(body, "TMP-01", temp, "C", ts);
    agregarLectura(body, "HUM-01", hum, "%", ts);
  }
  body += "]";

  String respuesta;
  int code = postJson(body, respuesta);
  Serial.printf("HTTP %d\n", code);

  if (code == 401) return "API key invalida";
  if (code != 201) return "Error envio";
  // Un lote responde 201 aunque rechace filas; "rejected":0 confirma que se guardaron todas.
  return (respuesta.indexOf("\"rejected\":0") >= 0) ? "Enviado OK" : "Lecturas rechazadas";
}

// ---------- Programa ----------
void setup() {
  Serial.begin(115200);
  analogReadResolution(12);                      // 0 a 4095
  analogSetPinAttenuation(PIN_SUELO, ADC_11db);
  analogSetPinAttenuation(PIN_LUZ, ADC_11db);

  if (PIN_SUELO_PWR >= 0) { pinMode(PIN_SUELO_PWR, OUTPUT); digitalWrite(PIN_SUELO_PWR, LOW); }

  dht.begin();

  VextON();
  delay(100);
  display.init();
  display.setFont(ArialMT_Plain_10);

  display.clear();
  display.drawString(0, 0, "Conectando WiFi...");
  display.display();
  conectarWifi();
  sincronizarHora();
}

void loop() {
  static unsigned long ultimoEnvio = 0;
  static bool primero = true;
  static const char* estado = "Sin enviar";

  // Suelo
  int sueloCrudo = leerSuelo();
  float sueloPct = (float)(SUELO_SECO - sueloCrudo) * 100.0f / (float)(SUELO_SECO - SUELO_MOJADO);
  sueloPct = constrain(sueloPct, 0.0f, 100.0f);

  // Luz
  int luzCrudo = leerPromedio(PIN_LUZ);
  int luzPct = constrain(map(luzCrudo, LUZ_OSCURO, LUZ_CLARO, 0, 100), 0, 100);

  // DHT11
  float temp = dht.readTemperature();   // grados C
  float hum  = dht.readHumidity();      // %
  bool dhtOk = !(isnan(temp) || isnan(hum));

  // Envio a la nube cada SEND_INTERVAL_MS
  if (primero || millis() - ultimoEnvio >= SEND_INTERVAL_MS) {
    primero = false;
    ultimoEnvio = millis();
    estado = enviarANube(sueloPct, temp, hum, dhtOk);
  }

  // Monitor Serie
  Serial.printf("Suelo: crudo=%d  %.0f%% | Luz: crudo=%d  %d%% | ",
                sueloCrudo, sueloPct, luzCrudo, luzPct);
  if (dhtOk) Serial.printf("Temp: %.1f C  Hum aire: %.0f%%", temp, hum);
  else       Serial.print("DHT11: error de lectura");
  Serial.printf(" | %s\n", estado);

  // OLED
  display.clear();
  display.setTextAlignment(TEXT_ALIGN_LEFT);
  display.setFont(ArialMT_Plain_10);
  display.drawString(0, 0,  "Suelo: " + String(sueloPct, 0) + " %  (" + String(sueloCrudo) + ")");
  display.drawString(0, 13, "Luz:   " + String(luzPct) + " %  (" + String(luzCrudo) + ")");
  if (dhtOk) {
    display.drawString(0, 26, "Temp:  " + String(temp, 1) + " C");
    display.drawString(0, 39, "Hum aire: " + String(hum, 0) + " %");
  } else {
    display.drawString(0, 26, "DHT11: error");
  }
  display.drawString(0, 52, estado);
  display.display();

  delay(2000);
}
