# User manual — SmartGreenAI: Cilantro Crop

SmartGreenAI watches your cilantro greenhouse day and night. It tells you when something needs attention,
and it suggests when to irrigate and why. **You always make the final decision.**

Open the address your administrator gave you (for example `https://smartgreen.example.com`) in any browser,
on a computer, tablet or phone.

## 1. Signing in

1. Type your **email or username** and your **password**, then press **Sign in**.
2. You land on your home page:
   - Agricultural user (producer) → **Dashboard**
   - Administrator → **Overview & connectivity**
   - Super administrator → **Availability**
3. If the message *"Invalid credentials."* appears, check your data and try again. For your
   security, the system never says which of the two was wrong.
4. Sessions end automatically after 8 hours. To leave earlier, press **Logout** (top right).

## 2. Reading the colours

Every status shows a **colour, an icon and a word**, so it is clear even when printed in black and white:

| Badge | Meaning |
|---|---|
| ✔ green *In range* | the variable is inside the optimal range for cilantro |
| ⚠ orange *Below range / Above range* | outside the range, check the alerts |
| ✖ red *Critical* / *Offline* | action needed, or a device stopped communicating |
| ⚡ red *Anomaly* | the reading looks wrong (sensor fault, impossible jump) |
| ⌛ grey *Stale data* | no new reading in the last 10 minutes |

Optimal ranges for cilantro: air 15–25 °C, humidity 50–70 %, soil moisture 60–80 %, light 10 000–40 000 lux,
CO₂ 400–1 000 ppm, water tank above 20 %, soil pH 6.2–6.8.

## 3. Producer

### Dashboard

- **Banner**: green when all is well; orange or red when there are active alerts. Press *Review alerts* to go to them.
- **Summary**: overall status, variables out of range, active alerts, and the time of the last reading.
- **Sensor cards**: the current value of each sensor, with its status and the time of the reading.
- **Actuators & irrigation control**: the pump, fan, shade and lights, with their state (ON / OFF / OFFLINE)
  and the **water tank** level beside the pump.
- **AI recommendations**: see section 3.3.
- **Historical data**: choose a variable and a period (24 h, 7 days, 30 days). The green band is the optimal range,
  and red ✖ marks show anomalous readings.
- **Active alerts**: press **Acknowledge** to show the team you have seen an alert. It resolves itself when
  the value returns to its range.
- **Device connectivity**: *Online* when the greenhouse node sent data in the last 5 minutes.

The page refreshes every 30 seconds. You can also press **⟳ Refresh**.

### 3.1 Irrigating by hand

1. Under *Operation mode*, press **✋ Manual** and confirm. (In **⚙ Automatic** mode the system irrigates by itself.)
2. Press **▶ Start irrigation**, choose the minutes (never more than the maximum your administrator set), and confirm.
3. The pump turns on within about 5 seconds, and its state changes to **ON**.
4. It turns off by itself when the time is over. Press **■ Stop** to stop it earlier.

If the device is offline, the buttons are disabled: check the power and the WiFi of the greenhouse node.

### 3.2 Automatic irrigation

In **Automatic** mode the system irrigates when the soil moisture stays under 60 % for two readings in a row,
up to the target moisture (65 %) or the maximum time. For safety it does **not** irrigate when:

- the last irrigation was less than 30 minutes ago (the water is still soaking in);
- the water tank is below 20 % (you receive a *LOW_WATER* alert — refill the tank);
- the soil sensors have not reported for 5 minutes.

The yellow note under the mode selector tells you what the automatic system is doing and why.

### 3.3 AI recommendations

Each card shows:

1. **Recommendation** — what to do (Irrigate, Wait, Check sensor, Check water, Ventilate).
2. **Reason** — why, in plain words, with the values that led to it.
3. **Relevant measurements** — the readings used, with their optimal ranges.
4. **Confidence** — High, Medium or Low, depending on how complete and consistent the data is.
5. **Timestamp** — when it was generated.

Press **Why?** to see how much each factor contributed. Then press **✔ Accept** (for an irrigation, the pump
starts for the recommended minutes) or **✖ Reject**, optionally writing a reason. You can decide only once
per recommendation. Past recommendations and decisions are listed under **AI recommendations** in the menu.

### 3.4 Other pages

- **Alert history**: filter by status, severity, sensor and dates. Press **⬇ Export CSV** to open it in Excel.
- **Irrigation history**: every activation with who or what started it (Manual, Automatic, AI) and minutes per day.
- **Historical analysis**: daily minimum/average/maximum, the % of time inside the optimal range, and trends
  (↑ rising, ↓ falling, → stable) with an estimate of when a limit will be reached.
- **Crop observations**: write notes about the crop (pests, leaf colour, harvest…).

## 4. Administrator

| Page | What you can do |
|---|---|
| Overview & connectivity | statistics, measurements per day, devices online/offline, run the AI analysis now |
| Producers & users | create producers, edit them, **Deactivate** / **Activate** (accounts are never deleted) |
| Greenhouses, areas & crops | create greenhouses and areas, switch an area's mode, edit crop types; **Apply to area** configures all thresholds from the crop |
| IoT devices, sensors & actuators | register hardware. **The device API key is shown only once**: copy it into the device firmware. *Rotate key* replaces a lost key |
| Sensor thresholds | one row per variable: **Edit** → change min/max → **Save**. Values outside the sensor's physical range are rejected with a message |
| Alert & severity parameters | limits for LOW/MEDIUM/HIGH severity and for anomaly detection |
| Irrigation & automation | target moisture, maximum duration, cooldown, readings required, minimum tank level; rules for fan, shade and lights |
| AI configuration | weights of each factor, score needed to recommend irrigation, schedule, optional language model |
| Notification settings | what is notified and from which severity |
| System & activity logs | who changed what and when (user activity), and technical events (system log) |

## 5. Super administrator

Everything the administrator can do, for all organizations, plus:

- **Availability**: API and database status, uptime, devices online.
- **Administrators**: create, edit and deactivate administrators of each organization.
- **Roles & permissions**: tick permissions per role and press **Save** on the role's column.
- **Organizations**: tenants of the platform.
- **Global & security parameters**: session length, password policy, login attempts and all system parameters.
- **Integrations**: connections with external services (webhooks, email, weather).

## 6. Troubleshooting

| Problem | What to do |
|---|---|
| "Your session has ended" | sign in again (sessions last 8 hours) |
| A device shows **Offline** | check the node's power and WiFi; readings taken while offline are sent when it reconnects |
| The pump buttons are disabled | the area is in Automatic mode, or the device is offline |
| The AI says **Check sensor** | the two soil probes disagree or sent impossible values: check that they are buried and connected |
| The AI says **Check water** | refill the water tank |
| "You do not have permission to open that page" | the page belongs to another role; ask your administrator |
