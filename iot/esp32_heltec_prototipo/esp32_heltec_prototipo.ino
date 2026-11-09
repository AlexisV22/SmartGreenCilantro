// SmartGreenAI: Cilantro Crop - Nodo IoT del prototipo con envio a la nube + riego
// Placa: Heltec WiFi Kit 32 (V3)
//
// CONEXIONES (montaje real del prototipo)
//   Humedad de suelo : VCC -> 3V3 | GND -> GND | AO   -> pin 2
//   LDR (modulo)     : izquierdo (senal) -> pin 3 | centro -> GND | derecho -> 3V3
//   DHT11            : VCC -> 3V3 | GND -> GND | DATA -> pin 4
//   Servomotor (llave): senal -> GPIO 5 | alimentacion segun el servo | GND comun
//   Modulo rele (bomba): IN -> GPIO 6 | VCC -> alimentacion compatible | GND -> GND
//   Bomba/motor: alimentacion externa a traves de los contactos COM/NO del rele
//   LED verde (abierto): pin 42 -> resistencia 220 ohm -> LED (+) ; LED (-) -> GND
//   LED rojo (cerrado) : pin 45 -> resistencia 220 ohm -> LED (+) ; LED (-) -> GND
//   LEDs de actuadores (provisionales, cada uno con resistencia 220 ohm a GND):
//     ACT-PUMP-01  (bomba)       -> pin 7
//     ACT-FAN-01   (ventilador)  -> pin 19
//     ACT-SHADE-01 (sombra)      -> pin 20
//     ACT-LIGHT-01 (luz)         -> pin 26  (no usar 21: es el RST de la OLED en la V3)
//   * Todos los GND deben estar unidos (placa, servo, rele, LEDs y sensores).
//
// RIEGO (servo de la llave, rele y LED de la bomba siguen las mismas ordenes)
//   1) Comandos de la plataforma (tienen prioridad). Cada 5 s se consulta GET /api/devices/me/commands:
//        ON  -> llave ABIERTA durante la duracion elegida; al terminar se cierra sola.
//        OFF -> llave CERRADA y el riego local queda en pausa PAUSA_LOCAL_MS (para que no se reabra solo).
//   2) Riego local por humedad de suelo, con histeresis, cuando no hay un comando en curso:
//        Suelo < UMBRAL_ABRIR  (60 %) -> llave ABIERTA, rele ON, LED verde ON, rojo OFF
//        Suelo >= UMBRAL_CERRAR (75 %) -> llave CERRADA, rele OFF, LED rojo ON, verde OFF
//        Entre 60 % y 75 % se mantiene el estado anterior.
//   Todo cambio se confirma con POST /api/actuators/ACT-PUMP-01/state (marca el comando EXECUTED
//   y queda en la bitacora de riego).
//
// VENTILADOR, SOMBRA Y LUZ (LEDs): solo obedecen comandos de la plataforma (manuales o automatizacion).
//   ON enciende el LED (si trae duracion se apaga solo al cumplirla), OFF lo apaga, y cada cambio se
//   confirma con POST /api/actuators/<ID>/state.
//
// Cada 30 s se manda un heartbeat con el estado de los 4 actuadores (si no, la plataforma los ve OFFLINE).
// Cada 2 s: lee los sensores, decide el riego y actualiza OLED y Monitor Serie.
// Cada 60 s: obtiene hora UTC (NTP) y envia SM-01, TMP-01, HUM-01 y LUX-01 a POST /api/measurements.
// La LDR no mide lux reales: el % de luz se convierte a lux aproximados con LUZ_LUX_MAX.
//
// WiFi, URL y API key van en secrets.h (copia secrets.h.example).
// Librerias: DHT sensor library (Adafruit) + Adafruit Unified Sensor + ESP32Servo + ArduinoJson (7.x)

#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>
#include <ESP32Servo.h>
#include <ArduinoJson.h>
#include "HT_SSD1306Wire.h"
#include "DHT.h"
#include "secrets.h"

const unsigned long SEND_INTERVAL_MS = 60000;   // envio a la nube cada 60 s
const unsigned long POLL_INTERVAL_MS = 5000;    // consulta de comandos (la API los expira a los 60 s)
const unsigned long HEARTBEAT_MS     = 30000;   // el dashboard muestra el dispositivo conectado
const unsigned long PAUSA_LOCAL_MS   = 600000;  // 10 min sin riego local tras un OFF de la plataforma
const uint16_t HTTP_TIMEOUT_MS = 15000;         // Vercel puede tardar unos segundos en "despertar"

#define PIN_SUELO 2
#define PIN_LUZ   3
#define PIN_DHT   4

// ---------- Riego ----------
#define PIN_SERVO     5    // servo de la llave
#define PIN_RELE      6    // IN del modulo rele de la bomba
#define PIN_LED_VERDE 42   // llave abierta
#define PIN_LED_ROJO  45   // llave cerrada
#define PIN_LED_BOMBA 7    // LED del actuador ACT-PUMP-01
const bool RELE_ACTIVO_BAJO = false;  // false: activa con HIGH; true: activa con LOW

const char* PUMP_ID = "ACT-PUMP-01";  // actuador de la plataforma que representa el riego

// ---------- Actuadores con LED ----------
struct ActuadorLed {
  const char* id;
  int pin;
  bool encendido;
  unsigned long apagarMs;   // != 0: ON con duracion, se apaga a esta hora
};

ActuadorLed actuadores[] = {
  {"ACT-FAN-01",   19, false, 0},   // ventilador
  {"ACT-SHADE-01", 20, false, 0},   // sombra
  {"ACT-LIGHT-01", 26, false, 0},   // luz auxiliar
};
const int NUM_ACTUADORES = sizeof(actuadores) / sizeof(actuadores[0]);

const float UMBRAL_ABRIR  = 60.0f;   // % humedad de suelo: por debajo se abre la llave
const float UMBRAL_CERRAR = 75.0f;   // % humedad de suelo: desde aqui se cierra la llave
const int ANGULO_CERRADO = 0;        // grados del servo con la llave cerrada
const int ANGULO_ABIERTO = 90;       // grados del servo con la llave abierta

Servo servoLlave;
bool riegoActivo = false;
unsigned long cierreProgramadoMs = 0;  // != 0: riego ordenado por la plataforma, se cierra a esta hora
unsigned long pausaLocalHastaMs = 0;   // != 0: riego local en pausa hasta esta hora

// -1 = sensor de suelo alimentado directo a 3V3 (cableado actual).
// Para reducir la corrosion del HW-080: conecta su VCC a un GPIO libre (ej. 1) y pon aqui ese numero.
#define PIN_SUELO_PWR -1

// Calibracion suelo: reemplaza con TUS valores
const int SUELO_SECO   = 3200;   // sensor al aire
const int SUELO_MOJADO = 1400;   // sensor en agua

// Calibracion luz: valores provisionales, vuelve a medir en la ESP32
const int LUZ_OSCURO = 150;      // sensor tapado
const int LUZ_CLARO  = 3500;     // luz muy fuerte
const float LUZ_LUX_MAX = 40000.0f;  // lux aproximados que se reportan con la luz al 100 %

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

// Peticion a la API con la API key del dispositivo; deja la respuesta en 'respuesta'.
int apiRequest(const char* metodo, const String &ruta, const String &body, String &respuesta) {
  WiFiClientSecure secureClient;
  WiFiClient plainClient;
  HTTPClient http;
  String url = String(API_BASE_URL) + ruta;

  if (url.startsWith("https")) {
    secureClient.setInsecure();     // para pruebas; en produccion carga el certificado
    http.begin(secureClient, url);
  } else {
    http.begin(plainClient, url);
  }
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", DEVICE_API_KEY);

  int code = strcmp(metodo, "GET") == 0 ? http.GET() : http.POST(body);
  if (code > 0) respuesta = http.getString();
  http.end();
  return code;
}

void agregarLectura(String &body, const char* id, float valor, const char* unidad, const String &ts) {
  if (body.length() > 1) body += ",";
  body += "{\"sensor_id\":\"" + String(id) + "\",\"value\":" + String(valor, 1) +
          ",\"unit\":\"" + unidad + "\",\"recorded_at\":\"" + ts + "\"}";
}

// Devuelve el texto de estado que se muestra en la OLED.
const char* enviarANube(float suelo, float temp, float hum, bool dhtOk, int luzPct) {
  conectarWifi();
  if (WiFi.status() != WL_CONNECTED) return "Sin WiFi";
  if (!horaOk() && !sincronizarHora()) return "Sin hora NTP";

  String ts = ahoraISO();
  String body = "[";
  agregarLectura(body, "SM-01", suelo, "%", ts);
  agregarLectura(body, "LUX-01", luzPct * LUZ_LUX_MAX / 100.0f, "lux", ts);
  if (dhtOk) {
    agregarLectura(body, "TMP-01", temp, "C", ts);
    agregarLectura(body, "HUM-01", hum, "%", ts);
  }
  body += "]";

  String respuesta;
  int code = apiRequest("POST", "/measurements", body, respuesta);
  if (code > 0) Serial.println(respuesta);
  Serial.printf("HTTP %d\n", code);

  if (code == 401) return "API key invalida";
  if (code != 201) return "Error envio";
  // Un lote responde 201 aunque rechace filas; "rejected":0 confirma que se guardaron todas.
  return (respuesta.indexOf("\"rejected\":0") >= 0) ? "Enviado OK" : "Lecturas rechazadas";
}

// Confirma el estado de un actuador a la plataforma (comando EXECUTED + evento en la bitacora).
void reportarEstado(const char* id, bool encendido, float duracionMin) {
  if (WiFi.status() != WL_CONNECTED) return;
  String body = String("{\"state\":\"") + (encendido ? "ON" : "OFF") + "\"";
  if (duracionMin > 0) body += ",\"duration_min\":" + String(duracionMin, 1);
  body += "}";
  String respuesta;
  int code = apiRequest("POST", String("/actuators/") + id + "/state", body, respuesta);
  Serial.printf(">> Estado %s %s reportado: HTTP %d\n", id, encendido ? "ON" : "OFF", code);
}

// ---------- Riego ----------
void releBomba(bool encendido) {
  if (RELE_ACTIVO_BAJO) {
    if (encendido) {
      pinMode(PIN_RELE, OUTPUT);
      digitalWrite(PIN_RELE, LOW);
    } else {
      // Alta impedancia al apagar; el modulo debe tener una polarizacion adecuada.
      pinMode(PIN_RELE, INPUT);
    }
  } else {
    pinMode(PIN_RELE, OUTPUT);
    digitalWrite(PIN_RELE, encendido ? HIGH : LOW);
  }
}

void aplicarRiego(bool abierto) {
  riegoActivo = abierto;
  servoLlave.write(abierto ? ANGULO_ABIERTO : ANGULO_CERRADO);
  releBomba(abierto);
  digitalWrite(PIN_LED_BOMBA, abierto ? HIGH : LOW);
  digitalWrite(PIN_LED_VERDE, abierto ? HIGH : LOW);
  digitalWrite(PIN_LED_ROJO,  abierto ? LOW  : HIGH);
}

// Decide con histeresis segun el % de humedad de suelo (solo sin comando de la plataforma en curso).
void actualizarRiego(float sueloPct) {
  if (cierreProgramadoMs) return;
  if (pausaLocalHastaMs) {
    if ((long)(millis() - pausaLocalHastaMs) < 0) return;
    pausaLocalHastaMs = 0;
  }
  if (!riegoActivo && sueloPct < UMBRAL_ABRIR) {
    aplicarRiego(true);
    Serial.println(">> RIEGO local: llave ABIERTA");
    reportarEstado(PUMP_ID, true, 0);
  } else if (riegoActivo && sueloPct >= UMBRAL_CERRAR) {
    aplicarRiego(false);
    Serial.println(">> RIEGO local: llave CERRADA");
    reportarEstado(PUMP_ID, false, 0);
  }
}

void ejecutarComando(bool abrir, float duracionMin) {
  aplicarRiego(abrir);
  if (abrir) {
    // La plataforma siempre manda duracion; sin ella se usa 1 min para no dejar la llave abierta.
    if (duracionMin <= 0) duracionMin = 1;
    cierreProgramadoMs = millis() + (unsigned long)(duracionMin * 60000.0f);
    if (cierreProgramadoMs == 0) cierreProgramadoMs = 1;
    pausaLocalHastaMs = 0;
  } else {
    cierreProgramadoMs = 0;
    pausaLocalHastaMs = millis() + PAUSA_LOCAL_MS;
    if (pausaLocalHastaMs == 0) pausaLocalHastaMs = 1;
  }
  Serial.printf(">> RIEGO plataforma: llave %s\n", abrir ? "ABIERTA" : "CERRADA");
  reportarEstado(PUMP_ID, abrir, abrir ? duracionMin : 0);
}

// ---------- Ventilador, sombra y luz ----------
void aplicarActuador(ActuadorLed &a, bool encendido) {
  a.encendido = encendido;
  digitalWrite(a.pin, encendido ? HIGH : LOW);
}

void ejecutarComandoActuador(ActuadorLed &a, bool encender, float duracionMin) {
  aplicarActuador(a, encender);
  a.apagarMs = 0;
  if (encender && duracionMin > 0) {
    a.apagarMs = millis() + (unsigned long)(duracionMin * 60000.0f);
    if (a.apagarMs == 0) a.apagarMs = 1;
  }
  Serial.printf(">> %s %s (plataforma)\n", a.id, encender ? "ENCENDIDO" : "APAGADO");
  reportarEstado(a.id, encender, encender ? duracionMin : 0);
}

void consultarComandos() {
  if (WiFi.status() != WL_CONNECTED) return;
  String respuesta;
  int code = apiRequest("GET", "/devices/me/commands", "", respuesta);
  if (code != 200) {
    Serial.printf(">> Comandos: HTTP %d\n", code);
    return;
  }
  JsonDocument doc;
  if (deserializeJson(doc, respuesta)) return;
  for (JsonObject cmd : doc["commands"].as<JsonArray>()) {
    const char* actuador = cmd["actuator_id"] | "";
    const char* accion = cmd["action"] | "";
    // duration_min puede llegar como numero, como texto ("5.00") o null
    JsonVariant d = cmd["duration_min"];
    float duracion = d.is<const char*>() ? atof(d.as<const char*>()) : (d | 0.0f);
    bool encender = strcmp(accion, "ON") == 0;
    Serial.printf(">> Comando %s %s %.1f min (origen %s)\n", actuador, accion, duracion,
                  (const char*)(cmd["source"] | ""));
    if (strcmp(actuador, PUMP_ID) == 0) {
      ejecutarComando(encender, duracion);
      continue;
    }
    for (int i = 0; i < NUM_ACTUADORES; i++) {
      if (strcmp(actuador, actuadores[i].id) == 0) ejecutarComandoActuador(actuadores[i], encender, duracion);
    }
  }
}

// El heartbeat lleva el estado de todos los actuadores para que la plataforma no los marque OFFLINE.
void heartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  String body = String("{\"firmware\":\"heltec-prototipo-1.2\",\"actuators\":[{\"id\":\"") +
                PUMP_ID + "\",\"state\":\"" + (riegoActivo ? "ON" : "OFF") + "\"}";
  for (int i = 0; i < NUM_ACTUADORES; i++) {
    body += String(",{\"id\":\"") + actuadores[i].id + "\",\"state\":\"" +
            (actuadores[i].encendido ? "ON" : "OFF") + "\"}";
  }
  body += "]}";
  String respuesta;
  int code = apiRequest("POST", "/devices/heartbeat", body, respuesta);
  Serial.printf(">> Heartbeat: HTTP %d\n", code);
}

// Cierres programados, comandos y heartbeat; se llama tambien durante la espera del loop.
void atenderPlataforma() {
  static unsigned long ultimoPoll = 0, ultimoBeat = 0;
  unsigned long ahora = millis();

  // Seguridad: el riego ordenado nunca dura mas que la duracion elegida.
  if (cierreProgramadoMs && (long)(ahora - cierreProgramadoMs) >= 0) {
    cierreProgramadoMs = 0;
    aplicarRiego(false);
    Serial.println(">> RIEGO plataforma: duracion cumplida, llave CERRADA");
    reportarEstado(PUMP_ID, false, 0);
  }
  for (int i = 0; i < NUM_ACTUADORES; i++) {
    ActuadorLed &a = actuadores[i];
    if (a.apagarMs && (long)(ahora - a.apagarMs) >= 0) {
      a.apagarMs = 0;
      aplicarActuador(a, false);
      Serial.printf(">> %s: duracion cumplida, APAGADO\n", a.id);
      reportarEstado(a.id, false, 0);
    }
  }
  if (ahora - ultimoPoll >= POLL_INTERVAL_MS) { ultimoPoll = ahora; consultarComandos(); }
  if (ahora - ultimoBeat >= HEARTBEAT_MS)     { ultimoBeat = ahora; heartbeat(); }
}

// ---------- Programa ----------
void setup() {
  releBomba(false);  // intenta mantener la bomba apagada desde el inicio
  Serial.begin(115200);
  analogReadResolution(12);                      // 0 a 4095
  analogSetPinAttenuation(PIN_SUELO, ADC_11db);
  analogSetPinAttenuation(PIN_LUZ, ADC_11db);

  if (PIN_SUELO_PWR >= 0) { pinMode(PIN_SUELO_PWR, OUTPUT); digitalWrite(PIN_SUELO_PWR, LOW); }

  // Riego: inicializa LEDs y servo con la llave cerrada (LED rojo).
  pinMode(PIN_LED_VERDE, OUTPUT);
  pinMode(PIN_LED_ROJO, OUTPUT);
  pinMode(PIN_LED_BOMBA, OUTPUT);
  servoLlave.setPeriodHertz(50);
  servoLlave.attach(PIN_SERVO, 500, 2400);
  aplicarRiego(false);

  // Ventilador, sombra y luz arrancan apagados.
  for (int i = 0; i < NUM_ACTUADORES; i++) {
    pinMode(actuadores[i].pin, OUTPUT);
    aplicarActuador(actuadores[i], false);
  }

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
  heartbeat();                                   // tras un reinicio la plataforma ve todo apagado
  reportarEstado(PUMP_ID, false, 0);
}

void loop() {
  static unsigned long ultimoEnvio = 0;
  static bool primero = true;
  static const char* estado = "Sin enviar";

  // Suelo
  int sueloCrudo = leerSuelo();
  float sueloPct = (float)(SUELO_SECO - sueloCrudo) * 100.0f / (float)(SUELO_SECO - SUELO_MOJADO);
  sueloPct = constrain(sueloPct, 0.0f, 100.0f);

  // Riego local segun humedad de suelo
  actualizarRiego(sueloPct);

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
    estado = enviarANube(sueloPct, temp, hum, dhtOk, luzPct);
  }

  const char* modo = cierreProgramadoMs ? "plataforma" : (pausaLocalHastaMs ? "pausa" : "local");

  // Monitor Serie
  Serial.printf("Suelo: crudo=%d  %.0f%% | Luz: crudo=%d  %d%% | ",
                sueloCrudo, sueloPct, luzCrudo, luzPct);
  if (dhtOk) Serial.printf("Temp: %.1f C  Hum aire: %.0f%%", temp, hum);
  else       Serial.print("DHT11: error de lectura");
  Serial.printf(" | Riego: %s (%s) | Vent:%s Sombra:%s Luz:%s | %s\n",
                riegoActivo ? "ABIERTO" : "CERRADO", modo,
                actuadores[0].encendido ? "ON" : "OFF", actuadores[1].encendido ? "ON" : "OFF",
                actuadores[2].encendido ? "ON" : "OFF", estado);

  // OLED
  display.clear();
  display.setTextAlignment(TEXT_ALIGN_LEFT);
  display.setFont(ArialMT_Plain_10);
  display.drawString(0, 0,  "Suelo: " + String(sueloPct, 0) + " %  (" + String(sueloCrudo) + ")");
  display.drawString(0, 13, "Luz:   " + String(luzPct) + " %  (" + String(luzCrudo) + ")");
  if (dhtOk) {
    display.drawString(0, 26, "T: " + String(temp, 1) + " C   H: " + String(hum, 0) + " %");
  } else {
    display.drawString(0, 26, "DHT11: error");
  }
  display.drawString(0, 39, String("Riego: ") + (riegoActivo ? "ABIERTO" : "CERRADO") + " (" + modo + ")");
  display.drawString(0, 52, estado);
  display.display();

  // Espera de 2 s sin dejar de atender a la plataforma
  unsigned long t0 = millis();
  do { atenderPlataforma(); delay(50); } while (millis() - t0 < 2000);
}
