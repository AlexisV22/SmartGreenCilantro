// SmartGreenAI: Cilantro Crop — ESP32 firmware
// Evolution of sensors_croph_cilantro1_Oscar.ino (Sprint 1) for the ESP32:
//   - same identifiers: GH-01 / AREA-1 / SM-01, SM-02, TMP-01 (US-05)
//   - soil sensors powered only while reading (anti-corrosion idea of Sprint 1)
//   - WiFi + NTP (UTC ISO-8601 recorded_at) + HTTPS POST /api/measurements with the "apikey" header (US-06)
//   - ring buffer of 100 readings with retry/back-off and batch resend after reconnection (US06-T4)
//   - heartbeat every 30 s (FR-11) with the current actuator states
//   - polling GET /api/devices/me/commands every 5 s, pump relay, auto-OFF after the duration,
//     and state report POST /api/actuators/:id/state (US-15)
//
// Board: ESP32 Dev Module. Libraries: WiFi, HTTPClient, WiFiClientSecure (core), ArduinoJson 7, DHT sensor library (optional).
// Copy secrets.h.example to secrets.h and fill in your WiFi, API URL and device API key.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include "secrets.h"

#define USE_DHT22 1   // set to 0 if the DHT22 humidity sensor is not installed
#if USE_DHT22
#include <DHT.h>
#endif

// ---- Identification (US-05) ----
const char* GREENHOUSE_ID    = "GH-01";
const char* AREA_ID          = "AREA-1";
const char* SOIL_SENSOR_ID_1 = "SM-01";
const char* SOIL_SENSOR_ID_2 = "SM-02";
const char* TEMP_SENSOR_ID   = "TMP-01";
const char* HUM_SENSOR_ID    = "HUM-01";
const char* LIGHT_SENSOR_ID  = "LUX-01";
const char* WATER_SENSOR_ID  = "WL-01";
const char* PUMP_ID          = "ACT-PUMP-01";
const char* FIRMWARE         = "esp32-smartgreen-1.0.0";

// ---- Pins (ESP32 ADC1 pins so they keep working with WiFi on) ----
const int SOIL_POWER_PIN = 25;  // switched supply of both soil sensors
const int SOIL1_SIG_PIN  = 34;
const int SOIL2_SIG_PIN  = 35;
const int TEMP_PIN       = 32;  // TMP36 Vout
const int LDR_PIN        = 33;  // LDR voltage divider
const int WATER_PIN      = 36;  // analog water-level probe (VP)
const int DHT_PIN        = 27;
const int PUMP_RELAY_PIN = 26;  // relay module (active HIGH)

// ---- Calibration (measure dry air and a glass of water with your own probes) ----
const int SOIL_RAW_DRY = 3300;   // raw ADC in dry air
const int SOIL_RAW_WET = 1250;   // raw ADC in water
const int WATER_RAW_EMPTY = 200;
const int WATER_RAW_FULL  = 3000;
const float LUX_PER_RAW   = 12.0;  // rough LDR scale; calibrate with a lux meter

// ---- Timing ----
const unsigned long READING_INTERVAL_MS = 60000;
const unsigned long POLL_INTERVAL_MS    = 5000;
const unsigned long HEARTBEAT_MS        = 30000;

#if USE_DHT22
DHT dht(DHT_PIN, DHT22);
#endif

// ---- Ring buffer of readings (US06-T4) ----
struct Reading {
  char sensorId[8];
  float value;
  char unit[5];
  char recordedAt[25];
};
const int BUFFER_SIZE = 100;
Reading buffer[BUFFER_SIZE];
int bufHead = 0;     // index of the oldest reading
int bufCount = 0;
unsigned long retryDelayMs = 0;
unsigned long nextRetryAt = 0;

// ---- Pump state ----
bool pumpOn = false;
unsigned long pumpOffAtMs = 0;

unsigned long lastReading = 0, lastPoll = 0, lastBeat = 0;

// ---------------------------------------------------------------------------
void pushReading(const char* id, float value, const char* unit, const char* ts) {
  int idx;
  if (bufCount == BUFFER_SIZE) {            // full: overwrite the oldest reading
    idx = bufHead;
    bufHead = (bufHead + 1) % BUFFER_SIZE;
  } else {
    idx = (bufHead + bufCount) % BUFFER_SIZE;
    bufCount++;
  }
  strlcpy(buffer[idx].sensorId, id, sizeof(buffer[idx].sensorId));
  buffer[idx].value = value;
  strlcpy(buffer[idx].unit, unit, sizeof(buffer[idx].unit));
  strlcpy(buffer[idx].recordedAt, ts, sizeof(buffer[idx].recordedAt));
}

bool nowIso(char* out, size_t len) {
  struct tm t;
  if (!getLocalTime(&t, 2000)) return false;   // NTP not synchronised yet
  strftime(out, len, "%Y-%m-%dT%H:%M:%SZ", &t);
  return true;
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("[wifi] connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (int i = 0; i < 30 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print('.'); }
  Serial.println(WiFi.status() == WL_CONNECTED ? " OK" : " failed (readings stay in the buffer)");
}

// HTTPS request with the device API key. Returns the HTTP status (<0 on network error).
int apiRequest(const char* method, const String& path, const String& body, String* response) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  WiFiClientSecure client;
#ifdef API_ROOT_CA
  client.setCACert(API_ROOT_CA);
#else
  client.setInsecure();   // development only: provide API_ROOT_CA in secrets.h for production (NFR-09)
#endif
  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(client, String(API_BASE_URL) + path)) return -2;
  http.addHeader("apikey", DEVICE_API_KEY);
  http.addHeader("Content-Type", "application/json");
  int code = http.sendRequest(method, body);
  if (response && code > 0) *response = http.getString();
  http.end();
  return code;
}

// ---------------------------------------------------------------------------
float soilPercent(int raw) {
  float pct = 100.0 * (SOIL_RAW_DRY - raw) / (float)(SOIL_RAW_DRY - SOIL_RAW_WET);
  return constrain(pct, 0, 100);
}

void readSensors() {
  char ts[25];
  if (!nowIso(ts, sizeof(ts))) { Serial.println("[ntp] time not available, reading skipped"); return; }

  // Soil sensors: power them only while reading to avoid electrode corrosion.
  digitalWrite(SOIL_POWER_PIN, HIGH);
  delay(10);
  int raw1 = analogRead(SOIL1_SIG_PIN);
  int raw2 = analogRead(SOIL2_SIG_PIN);
  digitalWrite(SOIL_POWER_PIN, LOW);

  // TMP36: 10 mV/°C with 500 mV offset (ESP32 ADC is 12-bit, 3.3 V).
  float voltage = analogReadMilliVolts(TEMP_PIN) / 1000.0;
  float temperatureC = (voltage - 0.5) * 100.0;

  float lux = analogRead(LDR_PIN) * LUX_PER_RAW;
  float tank = constrain(100.0 * (analogRead(WATER_PIN) - WATER_RAW_EMPTY) / (float)(WATER_RAW_FULL - WATER_RAW_EMPTY), 0, 100);

  pushReading(SOIL_SENSOR_ID_1, soilPercent(raw1), "%", ts);
  pushReading(SOIL_SENSOR_ID_2, soilPercent(raw2), "%", ts);
  pushReading(TEMP_SENSOR_ID, temperatureC, "C", ts);
  pushReading(LIGHT_SENSOR_ID, lux, "lux", ts);
  pushReading(WATER_SENSOR_ID, tank, "%", ts);
#if USE_DHT22
  float hum = dht.readHumidity();
  if (!isnan(hum)) pushReading(HUM_SENSOR_ID, hum, "%", ts);
#endif

  Serial.printf("[read] %s SM-01 %.1f%% SM-02 %.1f%% TMP-01 %.1fC LUX %.0f WL %.1f%% (buffer %d)\n",
                ts, soilPercent(raw1), soilPercent(raw2), temperatureC, lux, tank, bufCount);
}

// Send the whole buffer as one batch (array body). On failure keep it and back off.
void flushBuffer() {
  if (bufCount == 0 || millis() < nextRetryAt) return;

  JsonDocument doc;
  JsonArray arr = doc.to<JsonArray>();
  for (int i = 0; i < bufCount; i++) {
    Reading& r = buffer[(bufHead + i) % BUFFER_SIZE];
    JsonObject o = arr.add<JsonObject>();
    o["sensor_id"] = r.sensorId;
    o["value"] = r.value;
    o["unit"] = r.unit;
    o["recorded_at"] = r.recordedAt;
  }
  String body;
  serializeJson(doc, body);

  unsigned long started = millis();
  String response;
  int code = apiRequest("POST", "/measurements", body, &response);
  if (code == 201) {
    Serial.printf("[send] %d readings delivered in %lu ms\n", bufCount, millis() - started);
    bufHead = 0; bufCount = 0; retryDelayMs = 0; nextRetryAt = 0;
  } else if (code == 400 || code == 401) {
    // Permanent error (bad data or revoked key): drop the batch so it does not block new readings.
    Serial.printf("[send] rejected with HTTP %d: %s\n", code, response.c_str());
    bufHead = 0; bufCount = 0;
  } else {
    retryDelayMs = retryDelayMs ? min(retryDelayMs * 2, 60000UL) : 2000;
    nextRetryAt = millis() + retryDelayMs;
    Serial.printf("[send] failed (%d), %d readings buffered, retry in %lu s\n", code, bufCount, retryDelayMs / 1000);
  }
}

void setPump(bool on, float durationMin) {
  pumpOn = on;
  digitalWrite(PUMP_RELAY_PIN, on ? HIGH : LOW);
  pumpOffAtMs = on && durationMin > 0 ? millis() + (unsigned long)(durationMin * 60000UL) : 0;
  Serial.printf("[pump] %s%s\n", on ? "ON" : "OFF", on && durationMin > 0 ? " (timed)" : "");
}

void reportState(const char* actuatorId, bool on, float durationMin) {
  JsonDocument doc;
  doc["state"] = on ? "ON" : "OFF";
  if (durationMin > 0) doc["duration_min"] = durationMin;
  String body;
  serializeJson(doc, body);
  int code = apiRequest("POST", String("/actuators/") + actuatorId + "/state", body, nullptr);
  Serial.printf("[state] %s %s -> HTTP %d\n", actuatorId, on ? "ON" : "OFF", code);
}

void pollCommands() {
  String response;
  int code = apiRequest("GET", "/devices/me/commands", "", &response);
  if (code != 200) return;
  JsonDocument doc;
  if (deserializeJson(doc, response)) return;
  for (JsonObject cmd : doc["commands"].as<JsonArray>()) {
    const char* actuator = cmd["actuator_id"];
    const char* action = cmd["action"];
    float duration = cmd["duration_min"] | 0.0;
    Serial.printf("[cmd] %s %s %.1f min (source %s)\n", actuator, action, duration, (const char*)(cmd["source"] | ""));
    if (strcmp(actuator, PUMP_ID) == 0) {
      setPump(strcmp(action, "ON") == 0, duration);
      reportState(PUMP_ID, pumpOn, duration);
    }
    // Fan, shade and lighting relays would be handled the same way.
  }
}

void heartbeat() {
  JsonDocument doc;
  doc["firmware"] = FIRMWARE;
  JsonArray acts = doc["actuators"].to<JsonArray>();
  JsonObject pump = acts.add<JsonObject>();
  pump["id"] = PUMP_ID;
  pump["state"] = pumpOn ? "ON" : "OFF";
  String body;
  serializeJson(doc, body);
  apiRequest("POST", "/devices/heartbeat", body, nullptr);
}

// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  pinMode(SOIL_POWER_PIN, OUTPUT);
  pinMode(PUMP_RELAY_PIN, OUTPUT);
  digitalWrite(SOIL_POWER_PIN, LOW);
  digitalWrite(PUMP_RELAY_PIN, LOW);   // pump always starts OFF (safety)
  analogReadResolution(12);
#if USE_DHT22
  dht.begin();
#endif
  connectWifi();
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");  // UTC (NFR-05)
  heartbeat();
  reportState(PUMP_ID, false, 0);
}

void loop() {
  unsigned long now = millis();
  connectWifi();

  // Safety: the pump never runs longer than the commanded duration.
  if (pumpOn && pumpOffAtMs && (long)(now - pumpOffAtMs) >= 0) {
    setPump(false, 0);
    reportState(PUMP_ID, false, 0);
  }

  if (now - lastReading >= READING_INTERVAL_MS || lastReading == 0) { lastReading = now; readSensors(); }
  flushBuffer();
  if (now - lastPoll >= POLL_INTERVAL_MS) { lastPoll = now; pollCommands(); }
  if (now - lastBeat >= HEARTBEAT_MS) { lastBeat = now; heartbeat(); }
  delay(50);
}
