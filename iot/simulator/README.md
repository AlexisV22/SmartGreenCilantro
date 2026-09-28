# SmartGreenAI IoT simulator

Node.js program (no dependencies, Node 20+) that behaves exactly like the ESP32 node `dev-node-01`:
same API key header, same payloads, same buffer/retry, command polling and state reports.

```bash
npm run simulate                                   # normal scenario, one cycle every 60 s
node iot/simulator/simulator.js --interval 5 --speed 60 --scenario acceptance
```

| Option | Default | Meaning |
|---|---|---|
| `--url` | `$API_BASE_URL` or `http://localhost:3000/api` | API base URL |
| `--key` | `$DEVICE_API_KEY` | device API key (`apikey` header) |
| `--interval <s>` | 60 | seconds between reading cycles (8 sensors per cycle) |
| `--speed <x>` | 1 | time acceleration of the greenhouse physics (60 = 1 simulated minute per second) |
| `--scenario <name>` | normal | see below |
| `--count <n>` | — | stop after n cycles and print the delivery report (success rate, average delay) — US06-T5 |
| `--offline-seconds <s>` | 0 | simulate a network outage after the first cycle; readings are buffered and resent as one batch — US06-T4 |
| `--poll <s>` | 5 | command polling period |
| `--csv <file>` | — | append every cycle to a CSV file for charts (US16-T5) |
| `--quiet` | — | only the final report |

## Scenarios

| Scenario | What it produces |
|---|---|
| `normal` | values inside the cilantro thresholds |
| `dry` | soil moisture starts at 55 % and dries twice as fast → LOW alert, automatic irrigation, AI IRRIGATE |
| `hot` | 30 °C and 45 % humidity → HIGH temperature alert, fan automation, AI VENTILATE/IRRIGATE |
| `wet` | soil moisture 86 % → HIGH alert, AI WAIT |
| `spike` | every 10th reading the temperature jumps +15 °C → SUDDEN_JUMP anomaly |
| `flatline` | SM-01 always sends the same value → FLATLINE anomaly after 30 min |
| `disconnect` | stops transmitting after 3 cycles → DEVICE_OFFLINE alert after 5 min |
| `low-tank` | water tank 12 % → irrigation blocked, LOW_WATER alert, AI CHECK_WATER |
| `outlier` | SM-02 sends 150 % every 8th reading → OUT_OF_RANGE anomaly |
| `acceptance` | section 24 of the project: soil 56 %, 29 °C → alert, AI recommends irrigation, accepted command raises the moisture |

## Closed loop

While `ACT-PUMP-01` is ON the soil moisture rises 1.1 %/min and the tank drops 0.1 %/min; otherwise the soil
loses water by evaporation that grows with temperature and dry air. With `--speed 60 --csv loop.csv` you can plot
the moisture curve of an automatic irrigation cycle (target, maximum duration and cooldown).

## Sample delivery report

```
=== Delivery report (US06-T5) ===
cycles: 6 · readings generated: 48 · accepted by the API: 48 · rejected: 0
success rate: 100.0 % · average round-trip: 118 ms · max: 217 ms
failed attempts: 2 · readings that went through the buffer: 32 · dropped (buffer full): 0 · still buffered: 0
```
