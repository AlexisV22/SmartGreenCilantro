# PROMPT 2 — Generate the evidence of every task (Sprint 2, 3 and 4)

> Run this prompt in Claude Code **after Prompt 1 finished** and the platform works (tests and acceptance script passing).
> Copy the Scrum documents of this package (folders Sprint 2, Sprint 3 and Sprint 4) into `docs/scrum/` of the repository before running it.
> Copy everything below this line.

---

You are Team 3 (UPAEP, Agile Project Management) and you must produce the **evidence that proves every completion condition** of every task of Sprints 2, 3 and 4 of **SmartGreenAI: Cilantro Crop**. The platform already exists in this repository (built from Prompt 1). The Planning documents are in `docs/scrum/Sprint N/Sprint_N_Planning_SmartGreenAI_Cilantro.docx` and the Review & Delivery documents already reference the evidence file names listed below, so **the names must match exactly**.

## Golden rules

1. **Real evidence only.** Every screenshot, log, query result, Postman result, test result, chart and video must come from actually running this system (with the simulator when hardware is not available — this was agreed by the team and is allowed by general task 10 of the project document). Never invent outputs, never edit numbers by hand. If a condition cannot be proven because something is broken, **fix the code first**, rerun, then capture the evidence.
2. **One evidence document per task** named exactly as in the catalog (`<TaskID>_<Task_Name>.docx`) inside `evidence/Sprint N/Evidence/<User Story>/`. Supporting raw files go in the same folder named `<TaskID>_<Task_Name>_<n>.<ext>` (png, txt, log, json, csv, sql, webm/mp4).
3. **Every completion condition gets its own proof** inside the document, marked ✓, in the same order as the planning. The last condition (Evidence) must point to the embedded proof and the attached files.
4. Language of the documents: **English**. Style: same as the team documents (Arial, maroon `#9E1B32` headers, light-pink key cells `#F6E8EA`), Letter size.
99 evidence documents in total.

## 1. Prepare the environment

- Start PostgreSQL (docker compose), load `database/schema.sql` and `database/seed.sql` on a **clean** database (capture the output: it is evidence for US07-T2), run `seed:history`, start the server and the simulator.
- Install what you need: `playwright` (chromium) for screenshots and video, `newman` for the Postman run, `@mermaid-js/mermaid-cli` for diagrams, `python-docx` (or the `docx` npm package) to build the documents, `matplotlib` for charts.
- Create `tools/evidence/` with reusable scripts:
  - `capture.js` (Playwright): logs in with the right role, navigates, performs actions and saves full-page screenshots (1440×900, plus a 390×844 phone view when the task mentions phone/responsive). Record **video** for SPR-T1 of every sprint and for US28-T5.
  - `api.js`: runs HTTP requests and saves request + status + response as pretty JSON/text (hide tokens and keys: show only the first 6 characters).
  - `sql.js`: runs queries and saves the result as CSV and as a table image or docx table (e.g. hashed password column, measurements with sensor_id/recorded_at/received_at, alerts, events, anomalies).
  - `diagrams/`: Mermaid sources for ER diagram, IoT-to-cloud data flow, command sequence diagram, irrigation rule flowchart, architecture; rendered to PNG.
  - `build_docs.py` (or .js): builds every evidence .docx from a JSON manifest.
  - `check_evidence.js`: verifies that **every file of the catalog exists**, is not empty, and that each document contains all its conditions; prints a final report.
- Use the dates of the catalog as the "Completed on" date of each document (the capture timestamp can be the real one).

## 2. Structure of every evidence document

1. Header block: "[ Insert official UPAEP logo ]", "UPAEP · Decanato de Ingenierías", title `EVIDENCE — <TaskID>`, task title, "SmartGreenAI: Cilantro Crop".
2. **Task information** table: Task ID, User Story (ID + title), Sprint, Week, Responsible, Peer reviewer, Planned/actual hours, Completed on, Status: Done.
3. **Task description** (from the planning).
4. **Completion conditions** — for each condition: the condition text with ✓, a one-paragraph explanation of how it was verified, and the proof (embedded screenshot with caption `Figure <TaskID>-<n>`, code excerpt ≤ 30 lines with file path, JSON response, SQL result table, test table or diagram).
5. For test tasks: a **test case table** (ID, case, steps, input, expected, actual, result PASS/FAIL) built from real executions; totals at the end.
6. **Attached files** list with the exact file names.
7. **Traceability**: related FR/NFR, source files and automated tests (from `docs/TRACEABILITY.md`).
8. **Sign-off** table: Responsible, Peer reviewer, Product Owner acceptance (Alexis Enrique Valle Parra) with the date. For tasks whose condition is "approved by the PO/team", reference the Monday meeting where it was approved (Daily Meeting documents in `docs/scrum`).

## 3. How to prove each kind of task

- **Design / Define tasks:** the design document itself inside the evidence (tables of fields, rules, parameters, examples) + the rendered diagram + the implemented result that shows it was used (e.g. the real table in the DB).
- **Implement tasks:** code excerpt, the API call or DB query that proves the behaviour, and a screenshot when there is UI. Include negative cases when the conditions mention rejection, 401/403/400/409 or validation.
- **Build screen tasks:** Playwright screenshots of the real screen in each relevant state (empty, filled, success message, error message, before/after).
- **Test tasks:** execute the cases for real (Jest, Postman/newman, simulator scenarios, Playwright), save logs, and build the test case table. Specific targets: US06-T5 at least 100 readings with success rate ≥ 95 % and average delay; US07-T5 at least 50 records; US13-T3 at least 20 alerts; US12-T3 boundaries 9/10/11/24/25/26 %; US16-T5 chart of soil moisture vs pump state from the closed-loop simulator (≥ 2 simulated hours); US19-T4 false-positive rate on 24 h of normal data; US18-T5 comparison with a spreadsheet (generate the .xlsx with the manual calculation); US20-T6 ten scenarios with agreement ≥ 90 %; US27-T5 dashboard load time with 30 days of data (target ≈ 3 s) and phone view; US28-T2 coverage report; US28-T3 executed matrix FR-01..FR-30; US28-T4 NFR-01..NFR-09 report; US28-T5 the 15 steps of section 24 with video.
- **Sprint-level tasks:** SPR-T1 integration video + step screenshots + list of defects found (from the git history/issues or the tests you had to fix); SPR-T2/SPR-T4 an evidence index of the sprint (table of all evidence files with status) and the demo script; Sprint 4 SPR-T2 **User manual** (full manual for the three roles with real screenshots, name `Sprint4_SPR-T2_User_Manual.docx`) and SPR-T3 **Technical documentation** (architecture, database, API, IoT firmware and simulator, AI component, deployment, name `Sprint4_SPR-T3_Technical_Documentation.docx`); SPR-T4 also a short final presentation outline (`Sprint4_SPR-T4_Final_Presentation_Outline.md`).

## 4. Per-sprint index

For each sprint create `evidence/Sprint N/Evidence/EVIDENCE_INDEX_Sprint_N.docx` (and a .md copy): table with Task ID, task, responsible, evidence file, attached files count, status. Finally run `check_evidence.js` and show me the report. Nothing may be missing.

## 5. Task catalog (names and conditions to prove)

### Sprint 2 (September 21, 2026 – October 9, 2026) — folder `evidence/Sprint 2/Evidence/`

#### US-01-C — Complete secure login and role-based access  →  subfolder `US-01-C/`

- **US01C-T1 — Connect the login form to the authentication service** | File: `US01C-T1_Connect_Login_Form_Authentication_Service.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: September 25, 2026
  - What: Connect the existing login screen to the backend. Passwords must be stored hashed (e.g., bcrypt) and a successful login must create a session or token (e.g., JWT) with an expiration time.
  - Conditions: (1) Login form sends credentials to the backend and receives a session/token. (2) Passwords are stored hashed (no plain text in the DB). (3) Session/token expires after the defined time. (4) Evidence: Login works end-to-end with a real user from the database; screenshot of successful login and of the hashed password in the DB.

- **US01C-T2 — Implement role-based access (RBAC) and redirection** | File: `US01C-T2_Implement_Role-Based_Access_RBAC_Redirection.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: September 25, 2026
  - What: Define the roles Administrator and Producer. Add route guards in the web app and a role check on the backend so each role is redirected to its own home page and cannot open pages or endpoints of the other role.
  - Conditions: (1) Roles Administrator and Producer exist in the DB and are assigned to test users. (2) Each role is redirected to its own home page after login. (3) Backend returns 403 when a role calls an endpoint it is not allowed to use. (4) Evidence: Each role lands on its correct page; restricted routes return 403 / redirect to login.

- **US01C-T3 — Build and run the permission matrix test** | File: `US01C-T3_Build_Run_Permission_Matrix_Test.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: September 25, 2026
  - What: Create a matrix of Role x Page/Endpoint (allowed / denied) covering login, thresholds, devices, dashboard and actuator status, and execute every case.
  - Conditions: (1) Matrix covers every page/endpoint of Sprint 2 for both roles. (2) Every case was executed and has a pass/fail result. (3) Failed cases were fixed or reported on the board. (4) Evidence: Completed permission matrix with pass/fail result for every case.

- **US01C-T4 — Test invalid credentials and unauthorized access** | File: `US01C-T4_Test_Invalid_Credentials_Unauthorized_Access.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: September 25, 2026
  - What: Test wrong password, non-existent user, empty fields, expired session and typing a restricted URL directly without logging in. Error messages must not reveal whether the user exists.
  - Conditions: (1) Wrong password, unknown user, empty fields, expired session and direct URL cases were executed. (2) All attempts are rejected with a generic error message. (3) Screenshots saved in the evidence folder. (4) Evidence: Negative test cases documented with screenshots; all attempts are rejected.

#### US-06 — Transmit IoT measurements to the cloud  →  subfolder `US-06/`

- **US06-T1 — Design the IoT-to-cloud data flow and message format** | File: `US06-T1_Design_IoT-To-Cloud_Data_Flow_Message.docx` | Responsible: Vicente Rocha Alfaro | Reviewer: Oscar Abraham Talavera Nava | Hours: 3 | Completed: September 25, 2026
  - What: Draw the flow: sensor, microcontroller, protocol (MQTT or HTTPS), cloud ingestion endpoint, database. Define the JSON payload (device_id, sensor_id, value, unit, timestamp in UTC) and the sending interval (e.g., every 60 s). Validate the payload with Carlos (US-08).
  - Conditions: (1) Flow diagram shows every component from sensor to database. (2) JSON payload defines device_id, sensor_id, value, unit and UTC timestamp. (3) Payload and sending interval approved by Carlos (US-08) and the team. (4) Evidence: Flow diagram and payload example approved by the team.

- **US06-T2 — Configure the cloud service and device authentication** | File: `US06-T2_Configure_Cloud_Service_Device_Authentication.docx` | Responsible: Vicente Rocha Alfaro | Reviewer: Oscar Abraham Talavera Nava | Hours: 2 | Completed: September 25, 2026
  - What: Set up the cloud service or broker that receives the data, create credentials for each device (token or API key) and document the configuration steps so another member can reproduce them.
  - Conditions: (1) Cloud service/broker is running and reachable. (2) Each test device has its own token or API key. (3) Configuration steps are documented so another member can repeat them. (4) Evidence: Cloud service running; configuration document with screenshots.

- **US06-T3 — Implement measurement sending from the device (or simulator)** | File: `US06-T3_Implement_Measurement_Sending_Device_Simulator.docx` | Responsible: Vicente Rocha Alfaro | Reviewer: Oscar Abraham Talavera Nava | Hours: 3 | Completed: October 2, 2026
  - What: Program the microcontroller to read the sensors and publish the payload at the defined interval. Create a simulator script that sends realistic cilantro values for testing when hardware is not connected.
  - Conditions: (1) Device or simulator sends readings at the defined interval. (2) Messages follow the approved payload format. (3) Simulator script is in the repository with instructions to run it. (4) Evidence: Measurements arrive in the cloud from the device or simulator; log of received messages.

- **US06-T4 — Handle connection failures** | File: `US06-T4_Handle_Connection_Failures.docx` | Responsible: Vicente Rocha Alfaro | Reviewer: Oscar Abraham Talavera Nava | Hours: 2 | Completed: October 2, 2026
  - What: Add retries when the network or server fails, a small local buffer so readings are not lost during short disconnections, and error logging on the device side.
  - Conditions: (1) Device retries sending when the connection fails. (2) Readings taken while offline are delivered after reconnecting. (3) Errors are written to a log. (4) Evidence: Test where the connection is cut and restored: buffered readings are delivered.

- **US06-T5 — End-to-end transmission test** | File: `US06-T5_End-To-End_Transmission_Test.docx` | Responsible: Vicente Rocha Alfaro | Reviewer: Oscar Abraham Talavera Nava | Hours: 3 | Completed: October 8, 2026
  - What: Send at least 100 readings and verify that at least 95% arrive correctly in the database with the right sensor ID and timestamp. Record the average delay between reading and storage.
  - Conditions: (1) At least 100 readings were sent in the test run. (2) At least 95% arrived in the DB with correct sensor ID and timestamp. (3) Report includes success rate, average delay and logs/screenshots. (4) Evidence: Test report with success rate, delay and screenshots / logs.

#### US-07 — Store measurements with sensor IDs and timestamps  →  subfolder `US-07/`

- **US07-T1 — Design the measurement data model** | File: `US07-T1_Design_Measurement_Data_Model.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 2 | Completed: September 25, 2026
  - What: Create the entity-relationship diagram for devices, sensors and measurements. Measurement fields: id, sensor_id (FK), value, unit, recorded_at (UTC, from the device) and received_at (UTC, from the server).
  - Conditions: (1) ER diagram includes devices, sensors and measurements with their relationships. (2) Measurement fields include sensor_id, value, unit, recorded_at and received_at (UTC). (3) Diagram reviewed and approved by Carlos and Alexis. (4) Evidence: ER diagram reviewed with Carlos and Alexis.

- **US07-T2 — Create the database schema** | File: `US07-T2_Create_Database_Schema.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 2 | Completed: September 25, 2026
  - What: Write the scripts or migrations that create the tables, foreign keys and an index on (sensor_id, recorded_at) so history queries are fast.
  - Conditions: (1) Tables, foreign keys and index (sensor_id, recorded_at) are created in the shared DB. (2) Scripts/migrations run without errors on a clean database. (3) Scripts committed to the repository. (4) Evidence: Schema created in the shared database; migration scripts committed to the repository.

- **US07-T3 — Implement the storage service** | File: `US07-T3_Implement_Storage_Service.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 1 | Completed: October 2, 2026
  - What: Implement the function used by the API to save a measurement: validate that the sensor exists and is active, that the value is numeric and the timestamp is valid; reject invalid data with a clear error.
  - Conditions: (1) Valid measurements are saved correctly. (2) Measurements with unknown/inactive sensor, non-numeric value or invalid timestamp are rejected. (3) Rejections return a clear error and are logged. (4) Evidence: Valid measurements are saved; invalid ones are rejected and logged.

- **US07-T4 — Implement history queries** | File: `US07-T4_Implement_History_Queries.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 1 | Completed: October 2, 2026
  - What: Implement queries to get measurements by sensor and by date/time range, and the latest value per sensor (needed by the dashboard).
  - Conditions: (1) Query by sensor returns only that sensor's measurements. (2) Query by date/time range returns correct results. (3) Latest-value-per-sensor query works for the dashboard. (4) Evidence: Queries return correct results with sample data.

- **US07-T5 — Test storage and retrieval** | File: `US07-T5_Test_Storage_Retrieval.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 2 | Completed: October 8, 2026
  - What: Test inserting valid and invalid data, and querying by sensor and time range with at least 50 sample records.
  - Conditions: (1) At least 50 sample records were used. (2) Valid and invalid insert cases executed. (3) Query results and screenshots saved as evidence. (4) Evidence: Test evidence with query results and screenshots.

#### US-08 — Provide APIs for IoT devices and web application  →  subfolder `US-08/`

- **US08-T1 — Write the API specification** | File: `US08-T1_API_Specification_SmartGreenAI.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 3 | Completed: September 25, 2026
  - What: Document every endpoint with method, URL, request/response example and who can use it. Minimum set: POST /measurements, GET /sensors/{id}/measurements, GET/PUT /thresholds, GET /actuators/status, POST/GET/PUT /devices, POST /auth/login. Use OpenAPI/Swagger or a table.
  - NOTE: this file already exists (API specification written by Carlos, in docs/). Do NOT overwrite it: copy it to the evidence folder, verify that the implemented API matches it and, if something differs, add an appendix document named US08-T1_API_Specification_SmartGreenAI_Verification.docx.
  - Conditions: (1) All Sprint 2 endpoints documented with method, URL, request/response example and allowed role. (2) Specification shared with the team by mid-Week 1. (3) Owners of US-06, US-10, US-14 and US-25 confirmed it covers their needs. (4) Evidence: API specification shared with the team.

- **US08-T2 — Set up the API project and security layer** | File: `US08-T2_Set_Up_API_Project_Security.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 2 | Completed: September 25, 2026
  - What: Create the API structure, database connection and two authentication mechanisms: device token for IoT devices and user session/token with role for the web app (from US-01-C).
  - Conditions: (1) API project runs and connects to the database. (2) Device token and user session/token authentication both work. (3) Requests without authentication return 401. (4) Evidence: API runs locally/cloud; unauthenticated requests return 401.

- **US08-T3 — Implement measurement endpoints** | File: `US08-T3_Implement_Measurement_Endpoints.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 2 | Completed: October 2, 2026
  - What: Implement POST /measurements (used by devices, calls US-07 storage) and GET /sensors/{id}/measurements with from/to filters (used by the web app).
  - Conditions: (1) POST /measurements stores data through the US-07 storage service. (2) GET /sensors/{id}/measurements supports from/to filters. (3) Both endpoints tested successfully in Postman. (4) Evidence: Endpoints work with Postman; data is stored and returned correctly.

- **US08-T4 — Implement web application endpoints** | File: `US08-T4_Implement_Web_Application_Endpoints.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 2 | Completed: October 2, 2026
  - What: Implement the endpoints needed by thresholds (US-10), actuator status (US-14) and device registry (US-25), applying role restrictions.
  - Conditions: (1) Endpoints for thresholds, actuator status and devices are implemented. (2) Role restrictions are applied to each endpoint. (3) Each owner (Jorge, Oscar, Alexis) confirmed their endpoint works. (4) Evidence: Endpoints available and tested by the owners of US-10, US-14 and US-25.

- **US08-T5 — Standardize validation and error responses** | File: `US08-T5_Standardize_Validation_Error_Responses.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: October 2, 2026
  - What: Use the same response format for all endpoints and correct HTTP codes: 400 invalid data, 401 not authenticated, 403 not allowed, 404 not found, 500 server error.
  - Conditions: (1) All endpoints use the same response format. (2) Correct HTTP codes are returned (400, 401, 403, 404, 500). (3) Error format is documented in the API specification. (4) Evidence: Error responses follow the documented format.

- **US08-T6 — API test collection** | File: `US08-T6_API_Test_Collection.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 3 | Completed: October 8, 2026
  - What: Create a Postman collection with success and error cases for every endpoint and run it completely.
  - Conditions: (1) Postman collection has success and error cases for every endpoint. (2) Full collection run completed without unexpected failures. (3) Collection export and run results saved as evidence. (4) Evidence: Exported Postman collection and run results.

#### US-10 — Configure sensor thresholds  →  subfolder `US-10/`

- **US10-T1 — Define the threshold data model and default values** | File: `US10-T1_Define_Threshold_Data_Model_Default.docx` | Responsible: Jorge Velez Delgado | Reviewer: Alexis Enrique Valle Parra | Hours: 2 | Completed: September 25, 2026
  - What: Define the fields: sensor type, minimum, maximum, unit, updated_by, updated_at. Propose default values for cilantro to be validated with the Product Owner (reference: air temperature 15-25 C, relative humidity 50-70%, soil moisture 60-80%).
  - Conditions: (1) Threshold fields defined (sensor type, min, max, unit, updated_by, updated_at). (2) Default cilantro values proposed. (3) Default values approved by the Product Owner. (4) Evidence: Threshold table defined and default values approved by the PO.

- **US10-T2 — Design the threshold configuration screen** | File: `US10-T2_Design_Threshold_Configuration_Screen.docx` | Responsible: Jorge Velez Delgado | Reviewer: Alexis Enrique Valle Parra | Hours: 3 | Completed: September 25, 2026
  - What: Create a prototype of the screen: one row per variable with its current min/max, unit, edit button and save/cancel actions.
  - Conditions: (1) Prototype shows one row per variable with min, max and unit. (2) Edit, save and cancel actions are included. (3) Prototype reviewed by the team. (4) Evidence: Screen prototype (Figma or similar) reviewed by the team.

- **US10-T3 — Implement create/update logic with validation** | File: `US10-T3_Implement_Create_Update_Logic_Validation.docx` | Responsible: Jorge Velez Delgado | Reviewer: Alexis Enrique Valle Parra | Hours: 3 | Completed: October 2, 2026
  - What: Implement saving new thresholds and updating existing ones. Rules: min must be lower than max, values must be within the physical range of the sensor, and only Administrators can save.
  - Conditions: (1) New thresholds can be created and existing ones updated. (2) Rules enforced: min < max, values within sensor range, Administrator only. (3) Changes are stored with user and date. (4) Evidence: Thresholds are saved in the database with user and date of change.

- **US10-T4 — Connect the screen to the API** | File: `US10-T4_Connect_Screen_API.docx` | Responsible: Jorge Velez Delgado | Reviewer: Alexis Enrique Valle Parra | Hours: 2 | Completed: October 2, 2026
  - What: Connect the screen to GET/PUT /thresholds, show confirmation and error messages to the user.
  - Conditions: (1) Screen loads current values from GET /thresholds. (2) Saving calls PUT /thresholds and the DB is updated. (3) Success and error messages are shown to the user. (4) Evidence: Changes made on the screen are reflected in the database.

- **US10-T5 — Test threshold configuration** | File: `US10-T5_Test_Threshold_Configuration.docx` | Responsible: Jorge Velez Delgado | Reviewer: Alexis Enrique Valle Parra | Hours: 2 | Completed: October 8, 2026
  - What: Test create, edit, invalid values (min greater than max, empty, text) and access by a Producer user (must be denied).
  - Conditions: (1) Create, edit and invalid-value cases executed. (2) Producer user cannot modify thresholds. (3) Results and screenshots saved as evidence. (4) Evidence: Test cases with results and screenshots.

#### US-14 — View actuator status  →  subfolder `US-14/`

- **US14-T1 — Define actuator states and data** | File: `US14-T1_Define_Actuator_States_Data.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 1 | Completed: September 25, 2026
  - What: Define the possible states (ON, OFF, OFFLINE) and the stored data: actuator_id, type (irrigation pump, fan, lights), current state and last update time.
  - Conditions: (1) States ON, OFF and OFFLINE defined. (2) Stored fields defined: actuator_id, type, state, last update. (3) Definition shared with Carlos (US-08) and Alexis (US-25). (4) Evidence: State list and data fields documented.

- **US14-T2 — Implement the current-status query** | File: `US14-T2_Implement_Current-Status_Query.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 1 | Completed: October 2, 2026
  - What: Implement the query that returns the last known state of every actuator and connect it to the endpoint provided by Carlos (US-08).
  - Conditions: (1) Query returns the last known state of every registered actuator. (2) Query is connected to GET /actuators/status. (3) Endpoint tested with sample data. (4) Evidence: Endpoint returns the status of all registered actuators.

- **US14-T3 — Build the actuator status panel** | File: `US14-T3_Build_Actuator_Status_Panel.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 2 | Completed: October 2, 2026
  - What: Add a panel to the dashboard with one card per actuator showing name, type, state (with color and text, not only color) and last update. The panel refreshes automatically (e.g., every 30 s).
  - Conditions: (1) Dashboard shows one card per actuator with name, type, state and last update. (2) State is shown with color and text. (3) Panel refreshes automatically at the defined interval. (4) Evidence: Panel visible in the dashboard with real or simulated data.

- **US14-T4 — Test actuator status visualization** | File: `US14-T4_Test_Actuator_Status_Visualization.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 1 | Completed: October 8, 2026
  - What: Change an actuator state in the database and verify it appears on the panel; verify that an actuator without updates is shown as OFFLINE and that only logged-in users can see the panel.
  - Conditions: (1) State change in the DB appears on the panel. (2) Actuator without recent updates appears as OFFLINE. (3) Only logged-in users can see the panel; screenshots saved. (4) Evidence: Test evidence with before/after screenshots.

#### US-25 — Register IoT devices, sensors and actuators  →  subfolder `US-25/`

- **US25-T1 — Define the device registry model** | File: `US25-T1_Define_Device_Registry_Model.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: September 29, 2026
  - What: Together with Oscar (US-07), define the fields: device (id, name, greenhouse zone, status), sensor (id, device_id, type, unit), actuator (id, device_id, type).
  - Conditions: (1) Fields for device, sensor and actuator defined. (2) Fields included in the shared ER diagram with Oscar. (3) Every sensor/actuator is linked to a device. (4) Evidence: Fields included in the shared ER diagram.

- **US25-T2 — Design the registration screens** | File: `US25-T2_Design_Registration_Screens.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: October 2, 2026
  - What: Prototype the screens: device list, form to register a device and add its sensors and actuators.
  - Conditions: (1) Prototype includes device list and registration form. (2) Form allows adding sensors and actuators to a device. (3) Prototype reviewed by the team. (4) Evidence: Screen prototype reviewed by the team.

- **US25-T3 — Implement register, edit and deactivate** | File: `US25-T3_Implement_Register_Edit_Deactivate.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 3 | Completed: October 2, 2026
  - What: Implement the logic for registering, editing and deactivating (not deleting) devices, sensors and actuators, with unique IDs and Administrator-only access.
  - Conditions: (1) Devices, sensors and actuators can be registered, edited and deactivated. (2) IDs are unique and records are deactivated, not deleted. (3) Only Administrators can perform these actions. (4) Evidence: Records are created, edited and deactivated correctly.

- **US25-T4 — Generate device credentials** | File: `US25-T4_Generate_Device_Credentials.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: October 2, 2026
  - What: When a device is registered, generate the token/ID that the device will use to send data (US-06).
  - Conditions: (1) A token/ID is generated when a device is registered. (2) The token works when sending data (US-06). (3) Deactivated devices' tokens are rejected. (4) Evidence: New device receives a token that works in the transmission test.

- **US25-T5 — Test the registration flow** | File: `US25-T5_Test_Registration_Flow.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 2 | Completed: October 8, 2026
  - What: Register a device with its sensors and actuators, send data with its token, then deactivate it and verify that its data is rejected.
  - Conditions: (1) Full flow executed: register, send data with token, deactivate, data rejected. (2) All steps passed. (3) Screenshots saved as evidence. (4) Evidence: Test evidence with screenshots.

#### Sprint-level tasks  →  subfolder `Sprint/`

- **SPR-T1 — End-to-end integration test** | File: `Sprint2_SPR-T1_End-To-End_Integration_Test.docx` | Responsible: Whole team (facilitated by Jorge) | Hours: 10 | Completed: October 8, 2026
  - What: Run the complete flow with the whole team: registered sensor, cloud transmission, storage, API, threshold screen and actuator panel. Record a short video or screenshots of every step.
  - Conditions: (1) Complete flow executed from registered sensor to actuator panel. (2) Every team member participated with their part working. (3) Video/screenshots saved and defects registered on the board. (4) Evidence: Integration video / screenshots and list of defects found.

- **SPR-T2 — Sprint Review preparation and evidence compilation** | File: `Sprint2_SPR-T2_Sprint_Review_Preparation_Evidence_Compilation.docx` | Responsible: Jorge Velez Delgado + Alexis Enrique Valle Parra | Hours: 2 | Completed: October 8, 2026
  - What: Collect the evidence of every task in one folder, update the board, prepare the demo script and the Sprint 2 summary for the Review.
  - Conditions: (1) Evidence of every task is in the Sprint 2 folder. (2) Board and burndown are updated. (3) Demo script ready before the Sprint Review. (4) Evidence: Evidence folder and demo script ready before the Review.

### Sprint 3 (October 12, 2026 – October 30, 2026) — folder `evidence/Sprint 3/Evidence/`

#### US-11 — Receive threshold alerts  →  subfolder `US-11/`

- **US11-T1 — Design the alert engine and alert data model** | File: `US11-T1_Design_Alert_Engine_Alert_Data.docx` | Responsible: Jorge Velez Delgado | Reviewer: Alexis Enrique Valle Parra | Hours: 1 | Completed: October 16, 2026
  - What: Define the alerts table (id, sensor_id, threshold_id, type LOW/HIGH, value, severity, status OPEN/ACKNOWLEDGED/RESOLVED, created_at, resolved_at) and the rules: below min creates a LOW alert, above max creates a HIGH alert, only one open alert per sensor and type, automatic resolution when the value returns to range.
  - Conditions: (1) Alert fields defined and added to the shared ER diagram. (2) LOW/HIGH, de-duplication and auto-resolve rules documented. (3) Design reviewed by Carlos (US-12, US-13). (4) Evidence: Alert data model and rule description reviewed by the team.

- **US11-T2 — Implement alert evaluation on measurement ingestion** | File: `US11-T2_Implement_Alert_Evaluation_Measurement_Ingestion.docx` | Responsible: Jorge Velez Delgado | Reviewer: Alexis Enrique Valle Parra | Hours: 2 | Completed: October 23, 2026
  - What: After POST /measurements stores a value, compare it with the threshold of the sensor type, create an alert or resolve the open one. The evaluation must not slow down the ingestion endpoint.
  - Conditions: (1) An out-of-range measurement creates an OPEN alert. (2) Repeated out-of-range values do not create duplicates. (3) Returning to range resolves the alert and fills resolved_at. (4) Evidence: Database records and logs showing an alert created and resolved from simulator values.

- **US11-T3 — Show active alerts to the producer** | File: `US11-T3_Show_Active_Alerts_Producer.docx` | Responsible: Jorge Velez Delgado | Reviewer: Alexis Enrique Valle Parra | Hours: 1 | Completed: October 23, 2026
  - What: Add an alerts panel and a top banner to the dashboard showing sensor, value, threshold and time in plain language. The panel refreshes every 30 s and the producer can acknowledge an alert.
  - Conditions: (1) Active alerts appear within 30 s of the measurement. (2) The producer can acknowledge an alert. (3) The message can be understood by a non-technical user. (4) Evidence: Screenshots of the dashboard with an active alert and with the alert acknowledged.

- **US11-T4 — Test alert generation** | File: `US11-T4_Test_Alert_Generation.docx` | Responsible: Jorge Velez Delgado | Reviewer: Alexis Enrique Valle Parra | Hours: 1 | Completed: October 29, 2026
  - What: Execute the cases: value below min, value above max, value in range, repeated out-of-range values (no duplicate) and return to range (resolved).
  - Conditions: (1) The five cases were executed. (2) Every case has a pass/fail result. (3) Defects were fixed or registered on the board. (4) Evidence: Test case table with results and screenshots.

#### US-12 — Classify alerts by severity  →  subfolder `US-12/`

- **US12-T1 — Define severity classification rules** | File: `US12-T1_Define_Severity_Classification_Rules.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: October 16, 2026
  - What: Define severity from the deviation outside the threshold as a percentage of the optimal range: Low up to 10%, Medium from 10% to 25%, High above 25%. Prepare one example per variable and validate the percentages with the Product Owner.
  - Conditions: (1) Deviation formula documented. (2) Percentages approved by the Product Owner. (3) One example per variable included. (4) Evidence: Severity rules table approved by the PO.

- **US12-T2 — Implement severity classification and display** | File: `US12-T2_Implement_Severity_Classification_Display.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: October 23, 2026
  - What: Calculate the severity when the alert is created and upgrade it if the deviation grows while the alert is open. Show a badge with color, icon and text in the alerts panel.
  - Conditions: (1) Every new alert has a severity. (2) Severity is upgraded when the deviation grows. (3) The badge shows color and text. (4) Evidence: Screenshot showing alerts with the three severity levels.

- **US12-T3 — Test severity classification** | File: `US12-T3_Test_Severity_Classification.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: October 29, 2026
  - What: Test boundary values for each level (9%, 10%, 11%, 24%, 25%, 26%) with simulator values for soil moisture and temperature.
  - Conditions: (1) Boundary values of every level were tested. (2) All cases passed or defects were registered. (3) Results saved in the evidence folder. (4) Evidence: Test table with boundary cases and results.

#### US-13 — View alert history  →  subfolder `US-13/`

- **US13-T1 — Implement the alert history endpoint** | File: `US13-T1_Implement_Alert_History_Endpoint.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: October 16, 2026
  - What: Implement GET /alerts with filters status, severity, sensor_id, from and to, newest first and paginated (limit/offset). Producer, Administrator and Super Administrator can read it.
  - Conditions: (1) All filters work individually and combined. (2) Results are ordered newest first. (3) Pagination works. (4) Evidence: Postman results for filtered queries.

- **US13-T2 — Build the alert history screen** | File: `US13-T2_Build_Alert_History_Screen.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: October 23, 2026
  - What: Create the history screen with a table (date, sensor, variable, value, severity, status, resolved at), filters and a CSV export button.
  - Conditions: (1) The table shows all required columns. (2) Filters update the table. (3) CSV export downloads the filtered rows. (4) Evidence: Screenshot of the history with filters applied and the exported CSV.

- **US13-T3 — Test alert history** | File: `US13-T3_Test_Alert_History.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: October 29, 2026
  - What: Generate at least 20 alerts with the simulator and verify order, filters, export and access for each role.
  - Conditions: (1) At least 20 alerts were used. (2) Order, filters and export verified. (3) Access verified for every role. (4) Evidence: Test table with results and screenshots.

#### US-15 — Manually activate or deactivate irrigation  →  subfolder `US-15/`

- **US15-T1 — Design the actuator command flow** | File: `US15-T1_Design_Actuator_Command_Flow.docx` | Responsible: Vicente Rocha Alfaro | Reviewer: Oscar Abraham Talavera Nava | Hours: 1 | Completed: October 16, 2026
  - What: Draw the sequence diagram: web app → API → command queue → device polls pending commands → executes → reports the new state. Define the command states PENDING, SENT, EXECUTED, FAILED and EXPIRED.
  - Conditions: (1) Sequence diagram created. (2) Command states defined. (3) Flow agreed with Oscar (US-16) and Carlos (US-17). (4) Evidence: Sequence diagram approved by the team.

- **US15-T2 — Implement the actuator command endpoint** | File: `US15-T2_Implement_Actuator_Command_Endpoint.docx` | Responsible: Vicente Rocha Alfaro | Reviewer: Oscar Abraham Talavera Nava | Hours: 2 | Completed: October 16, 2026
  - What: Implement POST /actuators/{id}/command with action ON/OFF and duration in minutes. Validate the maximum duration, that the actuator is active and that the area is in MANUAL mode. Only Producer and Administrator can send commands.
  - Conditions: (1) Valid commands are stored as PENDING. (2) Invalid commands are rejected with 400. (3) Unauthenticated/unauthorized requests return 401/403. (4) Evidence: Postman success and error cases.

- **US15-T3 — Execute commands on the device or simulator** | File: `US15-T3_Execute_Commands_Device_Simulator.docx` | Responsible: Vicente Rocha Alfaro | Reviewer: Oscar Abraham Talavera Nava | Hours: 3 | Completed: October 23, 2026
  - What: The device polls the pending commands every 5 s, switches the relay (or the simulated pump), reports the new state and turns the pump OFF automatically when the duration ends.
  - Conditions: (1) The state changes within 10 s of the command. (2) The pump turns OFF automatically after the duration. (3) The command is marked EXECUTED. (4) Evidence: Device/simulator log and actuator panel change.

- **US15-T4 — Build irrigation control and mode selector** | File: `US15-T4_Build_Irrigation_Control_Mode_Selector.docx` | Responsible: Vicente Rocha Alfaro | Reviewer: Oscar Abraham Talavera Nava | Hours: 2 | Completed: October 23, 2026
  - What: Add ON/OFF buttons with confirmation and duration selector, and a MANUAL/AUTOMATIC mode switch per area. Buttons are disabled in AUTOMATIC mode.
  - Conditions: (1) Buttons ask for confirmation. (2) The mode switch is saved in the database. (3) The panel shows the new state. (4) Evidence: Screenshots before and after activating irrigation.

- **US15-T5 — Test manual irrigation** | File: `US15-T5_Test_Manual_Irrigation.docx` | Responsible: Vicente Rocha Alfaro | Reviewer: Oscar Abraham Talavera Nava | Hours: 1 | Completed: October 29, 2026
  - What: Test ON, OFF, duration expiry, unauthorized user and offline device (command must expire).
  - Conditions: (1) All five cases executed. (2) Every case has a pass/fail result. (3) Screenshots saved. (4) Evidence: Test table with results and screenshots.

#### US-16 — Automatic irrigation according to predefined conditions  →  subfolder `US-16/`

- **US16-T1 — Define automatic irrigation rules** | File: `US16-T1_Define_Automatic_Irrigation_Rules.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 2 | Completed: October 16, 2026
  - What: Rule: in AUTOMATIC mode, if the average soil moisture of the area is below the minimum threshold for 2 consecutive readings, turn the pump ON until the target is reached or the maximum duration ends; then wait for the cooldown. Default values: target 65%, maximum 10 min, cooldown 30 min.
  - Conditions: (1) Rule document with parameters and default values. (2) Flowchart of the rule. (3) Approved by the Product Owner. (4) Evidence: Rule document and flowchart approved by the PO.

- **US16-T2 — Build the irrigation parameters screen** | File: `US16-T2_Build_Irrigation_Parameters_Screen.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 2 | Completed: October 16, 2026
  - What: Create GET/PUT /irrigation/config and the administrator screen for target moisture, maximum duration, cooldown, consecutive readings, minimum tank level and enable/disable per area.
  - Conditions: (1) The screen saves the parameters through the API. (2) Invalid values are rejected. (3) Only administrators can modify them. (4) Evidence: Screenshot of the screen and the saved values in the database.

- **US16-T3 — Implement the automatic irrigation engine** | File: `US16-T3_Implement_Automatic_Irrigation_Engine.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 4 | Completed: October 23, 2026
  - What: A scheduled job every 30 s evaluates the areas in AUTOMATIC mode, creates commands through the US-15 flow with source AUTOMATIC, stops at the target and records every event with US-17.
  - Conditions: (1) The pump turns ON automatically when the condition is met. (2) The pump turns OFF at the target or at the maximum duration. (3) Events are recorded with source AUTOMATIC. (4) Evidence: Engine log and actuator event records.

- **US16-T4 — Implement irrigation safety conditions** | File: `US16-T4_Implement_Irrigation_Safety_Conditions.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 2 | Completed: October 23, 2026
  - What: Block automatic irrigation during cooldown, when the water tank is below the minimum level (creates an alert) and when the soil sensor has not sent data for 5 minutes.
  - Conditions: (1) Cooldown is respected. (2) Low tank blocks irrigation and generates an alert. (3) Stale sensor data blocks irrigation. (4) Evidence: Log and screenshots of every blocked case.

- **US16-T5 — Run the closed-loop irrigation simulation** | File: `US16-T5_Run_Closed-Loop_Irrigation_Simulation.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 2 | Completed: October 29, 2026
  - What: Extend the simulator so soil moisture rises while the pump is ON and falls by evaporation, run an accelerated 2-hour scenario and plot soil moisture against pump state.
  - Conditions: (1) Simulator reacts to the pump state. (2) Scenario run for at least 2 simulated hours. (3) Chart generated. (4) Evidence: Chart of soil moisture vs pump state and simulator log.

- **US16-T6 — Test automatic irrigation** | File: `US16-T6_Test_Automatic_Irrigation.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 2 | Completed: October 29, 2026
  - What: Test: trigger, stop at target, stop at maximum duration, cooldown, low tank, stale sensor and MANUAL mode ignored by the engine.
  - Conditions: (1) All seven cases executed. (2) Every case has a pass/fail result. (3) Defects fixed or registered. (4) Evidence: Test table with results, logs and screenshots.

#### US-17 — Record actuator activation events  →  subfolder `US-17/`

- **US17-T1 — Implement the actuator event log** | File: `US17-T1_Implement_Actuator_Event_Log.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: October 16, 2026
  - What: Create the actuator_events table (actuator_id, action ON/OFF, source MANUAL/AUTOMATIC/AI, user_id, reason, duration, created_at) and a recordEvent function used by US-15 and US-16.
  - Conditions: (1) Table created in the database. (2) recordEvent shared with Vicente and Oscar. (3) Every state change calls recordEvent. (4) Evidence: Schema and sample event records.

- **US17-T2 — Build the irrigation history screen** | File: `US17-T2_Build_Irrigation_History_Screen.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: October 23, 2026
  - What: List events with filters by actuator and date and show total irrigation minutes per day.
  - Conditions: (1) Events listed newest first. (2) Filters work. (3) Daily irrigation minutes shown. (4) Evidence: Screenshot of the irrigation history.

- **US17-T3 — Test event recording** | File: `US17-T3_Test_Event_Recording.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: October 29, 2026
  - What: Verify that manual and automatic activations produce events with the correct source, user and duration.
  - Conditions: (1) Manual activation recorded correctly. (2) Automatic activation recorded correctly. (3) Database query matches the screen. (4) Evidence: Test table and database query screenshot.

#### US-19 — Identify unusual environmental measurements  →  subfolder `US-19/`

- **US19-T1 — Define anomaly detection methods** | File: `US19-T1_Define_Anomaly_Detection_Methods.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 2 | Completed: October 16, 2026
  - What: Define five methods with parameters: out of physical range, sudden jump between consecutive readings, statistical outlier (z-score > 3 over the last 24 h), missing data (no reading for 5 min) and flatline (same value for 30 min).
  - Conditions: (1) Methods and parameters documented. (2) One example per method. (3) Approved by the team. (4) Evidence: Anomaly methods document with examples.

- **US19-T2 — Implement the anomaly detection service** | File: `US19-T2_Implement_Anomaly_Detection_Service.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 3 | Completed: October 23, 2026
  - What: Run the checks on ingestion and in a periodic job; store anomalies (sensor, type, value, score, detected_at) and flag the measurement.
  - Conditions: (1) All five methods implemented. (2) Anomalies stored without duplicates. (3) Flagged measurements marked in the database. (4) Evidence: Anomaly records produced by injected values.

- **US19-T3 — Display anomalies to the producer** | File: `US19-T3_Display_Anomalies_Producer.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: October 23, 2026
  - What: Show an anomaly badge on the sensor card and a list of recent anomalies with a short explanation in plain language.
  - Conditions: (1) Badge visible on the affected sensor. (2) Anomaly list shows type and explanation. (3) Text understandable by a non-technical user. (4) Evidence: Screenshot of the dashboard with anomalies.

- **US19-T4 — Test anomaly detection** | File: `US19-T4_Test_Anomaly_Detection.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 2 | Completed: October 29, 2026
  - What: Inject a spike, an out-of-range value, a flatline, a disconnection and an outlier; also run 24 h of normal data to measure false positives.
  - Conditions: (1) Every anomaly type detected. (2) False-positive rate on normal data reported. (3) Results and screenshots saved. (4) Evidence: Test report with detection results.

#### Sprint-level tasks  →  subfolder `Sprint/`

- **SPR-T1 — End-to-end integration test** | File: `Sprint3_SPR-T1_End-To-End_Integration_Test.docx` | Responsible: Whole team (facilitated by Jorge) | Completed: October 29, 2026
  - What: Run the flow with the whole team: low soil moisture from the simulator, alert with severity, alert history, automatic irrigation, event log, manual irrigation and anomaly detection. Record a short video or screenshots of every step.
  - Conditions: (1) Complete flow executed from low-moisture reading to recorded irrigation event. (2) Every team member participated with their part working. (3) Video/screenshots saved and defects registered on the board. (4) Evidence: Integration video / screenshots and list of defects found.

- **SPR-T2 — Sprint Review preparation and evidence compilation** | File: `Sprint3_SPR-T2_Sprint_Review_Preparation_Evidence_Compilation.docx` | Responsible: Jorge Velez Delgado + Alexis Enrique Valle Parra | Completed: October 29, 2026
  - What: Check that every task has its evidence file, update the board and burndown, prepare the demo script and the Sprint 3 summary for the Review.
  - Conditions: (1) Evidence of every task is in the Sprint 3 folder. (2) Board and burndown are updated. (3) Demo script ready before the Sprint Review. (4) Evidence: Evidence folder and demo script ready before the Review.

### Sprint 4 (November 2, 2026 – November 20, 2026) — folder `evidence/Sprint 4/Evidence/`

#### US-18 — Analyze historical sensor information  →  subfolder `US-18/`

- **US18-T1 — Define historical analysis metrics** | File: `US18-T1_Define_Historical_Analysis_Metrics.docx` | Responsible: Vicente Rocha Alfaro | Reviewer: Oscar Abraham Talavera Nava | Hours: 1 | Completed: November 6, 2026
  - What: Define the metrics: daily minimum, average and maximum per variable, percentage of time inside the optimal range, trend slope per day over 24 h and 7 days, and irrigation minutes per day.
  - Conditions: (1) Metrics and formulas documented. (2) Time windows defined. (3) Approved by the Product Owner. (4) Evidence: Metrics document approved by the PO.

- **US18-T2 — Implement the historical aggregation service** | File: `US18-T2_Implement_Historical_Aggregation_Service.docx` | Responsible: Vicente Rocha Alfaro | Reviewer: Oscar Abraham Talavera Nava | Hours: 3 | Completed: November 6, 2026
  - What: Implement the aggregation queries and GET /analysis/summary?area_id&from&to, excluding measurements flagged as anomalies.
  - Conditions: (1) Endpoint returns every defined metric. (2) Flagged measurements are excluded. (3) Response time under 3 s with 30 days of data. (4) Evidence: Postman result and sample output.

- **US18-T3 — Implement trend identification** | File: `US18-T3_Implement_Trend_Identification.docx` | Responsible: Vicente Rocha Alfaro | Reviewer: Oscar Abraham Talavera Nava | Hours: 2 | Completed: November 13, 2026
  - What: Calculate a linear regression slope over the selected window, classify it as RISING, FALLING or STABLE and project when the variable will reach its threshold.
  - Conditions: (1) Slope calculated for every variable. (2) Classification uses a documented tolerance. (3) Projection to threshold calculated. (4) Evidence: Outputs for synthetic rising, falling and stable series.

- **US18-T4 — Build the historical analysis view** | File: `US18-T4_Build_Historical_Analysis_View.docx` | Responsible: Vicente Rocha Alfaro | Reviewer: Oscar Abraham Talavera Nava | Hours: 1 | Completed: November 13, 2026
  - What: Show daily averages with the optimal band, trend arrows with text and a period selector (24 h, 7 days, 30 days).
  - Conditions: (1) Charts show the optimal band. (2) Trend shown with arrow and text. (3) Period selector works. (4) Evidence: Screenshot of the historical analysis view.

- **US18-T5 — Test historical analysis** | File: `US18-T5_Test_Historical_Analysis.docx` | Responsible: Vicente Rocha Alfaro | Reviewer: Oscar Abraham Talavera Nava | Hours: 1 | Completed: November 19, 2026
  - What: Compare the calculated statistics with a manual spreadsheet calculation over 7 days of data.
  - Conditions: (1) At least 7 days of data compared. (2) Differences below 1%. (3) Comparison table saved. (4) Evidence: Comparison table between system and spreadsheet.

#### US-20 — AI irrigation recommendation  →  subfolder `US-20/`

- **US20-T1 — Design the recommendation model** | File: `US20-T1_Design_Recommendation_Model.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 2 | Completed: November 6, 2026
  - What: Define inputs (current soil moisture and trend, temperature, humidity, hours since last irrigation, tank level, recent anomalies), the weighted score 0–100 of irrigation need, the recommendation types (IRRIGATE, WAIT, CHECK_SENSOR, CHECK_WATER) and the confidence calculation.
  - Conditions: (1) Inputs, weights and score documented. (2) Recommendation types and thresholds defined. (3) Approved by the Product Owner. (4) Evidence: Model design document approved by the PO.

- **US20-T2 — Build the data preprocessing pipeline** | File: `US20-T2_Build_Data_Preprocessing_Pipeline.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 3 | Completed: November 6, 2026
  - What: Resample measurements to 5-minute intervals, remove flagged anomalies, fill short gaps and compute the features used by the model. Include unit tests.
  - Conditions: (1) Resampling and gap filling implemented. (2) Anomalies removed from the input. (3) Unit tests pass. (4) Evidence: Pipeline output sample and unit-test results.

- **US20-T3 — Implement the recommendation engine** | File: `US20-T3_Implement_Recommendation_Engine.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 5 | Completed: November 13, 2026
  - What: Compute the score, type and confidence every 15 minutes and whenever a new alert is created; store recommendations and avoid duplicates while one is pending.
  - Conditions: (1) Recommendations generated automatically. (2) Stored with score, type, confidence and inputs. (3) No duplicates while one is pending. (4) Evidence: Recommendations generated for the test scenarios.

- **US20-T4 — Calculate duration and configure AI parameters** | File: `US20-T4_Calculate_Duration_Configure_AI_Parameters.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 1 | Completed: November 13, 2026
  - What: Calculate the recommended irrigation minutes from the moisture deficit, capped by the maximum duration, and expose GET/PUT /ai/config so the administrator can adjust weights and thresholds.
  - Conditions: (1) Duration calculated and capped. (2) AI parameters editable by administrators only. (3) A parameter change modifies the next recommendation. (4) Evidence: Configuration screen and before/after output.

- **US20-T5 — Deliver recommendations to the producer** | File: `US20-T5_Deliver_Recommendations_Producer.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 1 | Completed: November 19, 2026
  - What: Publish GET /recommendations and a notification on the producer dashboard when a new recommendation is generated.
  - Conditions: (1) Endpoint returns pending and past recommendations. (2) Notification visible on the dashboard. (3) Only authorized roles can read them. (4) Evidence: Screenshot of the notification and API response.

- **US20-T6 — Validate recommendations with scenarios** | File: `US20-T6_Validate_Recommendations_Scenarios.docx` | Responsible: Oscar Abraham Talavera Nava | Reviewer: Vicente Rocha Alfaro | Hours: 2 | Completed: November 19, 2026
  - What: Run 10 scenarios (dry and hot, wet, recent irrigation, low tank, sensor anomaly, night, etc.) and compare the expected and actual recommendation.
  - Conditions: (1) Ten scenarios executed. (2) Agreement of at least 90%. (3) Disagreements analyzed. (4) Evidence: Validation report with expected vs actual results.

#### US-21 — Explainable AI recommendation  →  subfolder `US-21/`

- **US21-T1 — Define the explanation structure** | File: `US21-T1_Define_Explanation_Structure.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: November 6, 2026
  - What: Define the five elements and a plain-language template for every recommendation type, based on the example of section 11 of the project document.
  - Conditions: (1) Five elements defined. (2) One template per recommendation type. (3) Reviewed by the team. (4) Evidence: Explanation template document.

- **US21-T2 — Implement the natural-language explanation generator** | File: `US21-T2_Implement_Natural-Language_Explanation_Generator.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 3 | Completed: November 13, 2026
  - What: Generate the text from the top contributing factors of the score; optional LLM rewording with automatic fallback to the template.
  - Conditions: (1) Every recommendation gets an explanation. (2) Top factors mentioned with their values. (3) Fallback works without API key. (4) Evidence: Examples of generated explanations.

- **US21-T3 — Show the explanation in the recommendation card** | File: `US21-T3_Show_Explanation_Recommendation_Card.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 2 | Completed: November 13, 2026
  - What: The card shows the five elements, a confidence bar with text and an expandable "Why?" list of factors.
  - Conditions: (1) Card shows all five elements. (2) Confidence shown with bar and text. (3) "Why?" list expands. (4) Evidence: Screenshot of the recommendation card.

- **US21-T4 — Test explanation readability and consistency** | File: `US21-T4_Test_Explanation_Readability_Consistency.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 2 | Completed: November 19, 2026
  - What: Review 10 explanations with a checklist; ask a non-technical person to read three and explain what they would do.
  - Conditions: (1) Ten explanations checked. (2) All contain the five elements. (3) Non-technical reader understood them. (4) Evidence: Readability checklist and reader notes.

#### US-26 — Accept or reject AI recommendations  →  subfolder `US-26/`

- **US26-T1 — Implement the recommendation decision endpoint** | File: `US26-T1_Implement_Recommendation_Decision_Endpoint.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: November 6, 2026
  - What: Implement POST /recommendations/{id}/decision with ACCEPTED/REJECTED and optional comment; store user and time; a decided recommendation cannot be decided again.
  - Conditions: (1) Decision stored with user and time. (2) Second decision rejected with 409. (3) Only Producer/Administrator allowed. (4) Evidence: Postman success and error cases.

- **US26-T2 — Add accept/reject actions to the dashboard** | File: `US26-T2_Add_Accept_Reject_Actions_Dashboard.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: November 19, 2026
  - What: Add Accept and Reject buttons to the recommendation card; accepting IRRIGATE creates an irrigation command with source AI; rejecting asks for an optional reason.
  - Conditions: (1) Buttons visible on pending recommendations. (2) Accept starts irrigation. (3) Reject stores the reason. (4) Evidence: Screenshots of accept and reject flows.

- **US26-T3 — Test the decision flow** | File: `US26-T3_Test_Decision_Flow.docx` | Responsible: Alexis Enrique Valle Parra | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: November 19, 2026
  - What: Verify accept (pump ON and event with source AI), reject (stored) and double decision (blocked).
  - Conditions: (1) Three cases executed. (2) Event with source AI verified. (3) Screenshots saved. (4) Evidence: Test table with results and screenshots.

#### US-27 — Integrated monitoring dashboard  →  subfolder `US-27/`

- **US27-T1 — Design the integrated dashboard layout** | File: `US27-T1_Design_Integrated_Dashboard_Layout.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 2 | Completed: November 6, 2026
  - What: Wireframe with status summary, sensor cards, historical charts, alerts, actuators with tank level, recommendations and device connectivity; review usability with the team.
  - Conditions: (1) Wireframe includes every panel. (2) Layout works on desktop and phone. (3) Reviewed by the team and PO. (4) Evidence: Wireframe reviewed by the team.

- **US27-T2 — Integrate sensor cards and historical graphs** | File: `US27-T2_Integrate_Sensor_Cards_Historical_Graphs.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 3 | Completed: November 6, 2026
  - What: Current values with status color and text, and a historical chart per variable with period selector (24 h, 7 days, 30 days) and threshold band.
  - Conditions: (1) Sensor cards show value, unit, status and time. (2) Historical chart with threshold band. (3) Period selector works. (4) Evidence: Screenshot of sensor cards and historical graphs.

- **US27-T3 — Integrate alerts, actuators and recommendations panels** | File: `US27-T3_Integrate_Alerts_Actuators_Recommendations_Panels.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 4 | Completed: November 13, 2026
  - What: Bring the alerts panel, actuator panel with irrigation control and tank level, and the recommendation cards into the single dashboard.
  - Conditions: (1) All panels visible in one screen. (2) Panels refresh automatically. (3) Actions still work from the dashboard. (4) Evidence: Screenshot of the integrated dashboard.

- **US27-T4 — Add device connectivity indicator** | File: `US27-T4_Add_Device_Connectivity_Indicator.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 2 | Completed: November 13, 2026
  - What: Mark devices OFFLINE when last_seen is older than 5 minutes, show it to producer and administrator and create an alert when a device disconnects.
  - Conditions: (1) Device status ONLINE/OFFLINE shown. (2) Alert created on disconnection. (3) Status recovers on reconnection. (4) Evidence: Screenshots of a device disconnected and reconnected.

- **US27-T5 — Check dashboard performance and usability** | File: `US27-T5_Check_Dashboard_Performance_Usability.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 2 | Completed: November 19, 2026
  - What: Measure load time with 30 days of data (target 3 s), check the layout on a phone and run a short usability check with a non-technical person.
  - Conditions: (1) Load time measured and within target. (2) Phone layout verified. (3) Usability observations recorded. (4) Evidence: Performance and usability report.

- **US27-T6 — Test the integrated dashboard** | File: `US27-T6_Test_Integrated_Dashboard.docx` | Responsible: Carlos Ramirez Mendoza | Reviewer: Jorge Velez Delgado | Hours: 1 | Completed: November 19, 2026
  - What: Test each panel for the Producer, Administrator and Super Administrator roles.
  - Conditions: (1) Every panel tested per role. (2) Pass/fail recorded. (3) Screenshots saved. (4) Evidence: Test table with results and screenshots.

#### US-28 — Execute system tests  →  subfolder `US-28/`

- **US28-T1 — Write the test plan and traceability matrix** | File: `US28-T1_Write_Test_Plan_Traceability_Matrix.docx` | Responsible: Jorge Velez Delgado | Reviewer: Alexis Enrique Valle Parra | Hours: 2 | Completed: November 6, 2026
  - What: Map FR-01..FR-30 and NFR-01..NFR-09 to user stories and test cases; define environment, data and pass criteria.
  - Conditions: (1) Every requirement mapped. (2) Test cases defined with expected results. (3) Plan reviewed by the team. (4) Evidence: Test plan and traceability matrix.

- **US28-T2 — Build the automated test suite** | File: `US28-T2_Build_Automated_Test_Suite.docx` | Responsible: Vicente Rocha Alfaro | Reviewer: Oscar Abraham Talavera Nava | Hours: 3 | Completed: November 19, 2026
  - What: Unit and integration tests (Jest + Supertest) for authentication, measurements, alerts, irrigation, anomalies and recommendations, with a coverage report.
  - Conditions: (1) Tests cover the main modules. (2) Suite runs with one command. (3) Coverage report generated. (4) Evidence: Test run report and coverage summary.

- **US28-T3 — Execute functional tests** | File: `US28-T3_Execute_Functional_Tests.docx` | Responsible: Jorge Velez Delgado | Reviewer: Alexis Enrique Valle Parra | Hours: 3 | Completed: November 13, 2026
  - What: Execute the functional cases FR-01..FR-30, record pass/fail and register defects on the board.
  - Conditions: (1) All functional cases executed. (2) Results recorded. (3) Defects registered and retested. (4) Evidence: Executed traceability matrix with results.

- **US28-T4 — Execute non-functional tests** | File: `US28-T4_Execute_Non-Functional_Tests.docx` | Responsible: Jorge Velez Delgado | Reviewer: Alexis Enrique Valle Parra | Hours: 3 | Completed: November 19, 2026
  - What: Performance (NFR-01), scalability (NFR-02), security (NFR-03, NFR-04, NFR-09), data integrity (NFR-05), usability (NFR-06), maintainability (NFR-07) and reliability (NFR-08).
  - Conditions: (1) Every NFR tested. (2) Measurements recorded. (3) Results compared with targets. (4) Evidence: Non-functional test report.

- **US28-T5 — Run the final acceptance scenario** | File: `US28-T5_Run_Final_Acceptance_Scenario.docx` | Responsible: Jorge Velez Delgado | Reviewer: Alexis Enrique Valle Parra | Hours: 2 | Completed: November 19, 2026
  - What: Execute the 15 steps of section 24 of the project document and record a video with a checklist.
  - Conditions: (1) All 15 steps executed. (2) Each step marked pass/fail. (3) Video recorded. (4) Evidence: Acceptance checklist and video.

#### Sprint-level tasks  →  subfolder `Sprint/`

- **SPR-T1 — Final demonstration rehearsal and Sprint Review** | File: `Sprint4_SPR-T1_Final_Demonstration_Rehearsal_Sprint_Review.docx` | Responsible: Whole team (facilitated by Jorge) | Completed: November 19, 2026
  - What: Rehearse the final demonstration with the demo script, then present the increment and the complete product at the final Sprint Review.
  - Conditions: (1) Rehearsal done before the Review. (2) Every member presents their part. (3) Feedback recorded. (4) Evidence: Demo script and Review record.

- **SPR-T2 — User manual** | File: `Sprint4_SPR-T2_User_Manual.docx` | Responsible: Alexis Enrique Valle Parra + Carlos Ramirez Mendoza | Completed: November 19, 2026
  - What: Write the user manual for the three roles with screenshots of every function.
  - Conditions: (1) Covers Producer, Administrator and Super Administrator. (2) Screenshots of every function. (3) Reviewed by another member. (4) Evidence: User manual document.

- **SPR-T3 — Technical documentation** | File: `Sprint4_SPR-T3_Technical_Documentation.docx` | Responsible: Oscar Abraham Talavera Nava + Vicente Rocha Alfaro | Completed: November 19, 2026
  - What: Architecture, database, API, IoT firmware and simulator, AI component and deployment guide.
  - Conditions: (1) All components documented. (2) Deployment steps reproducible. (3) Reviewed by another member. (4) Evidence: Technical documentation.

- **SPR-T4 — Final presentation and evidence compilation** | File: `Sprint4_SPR-T4_Final_Presentation_Evidence_Compilation.docx` | Responsible: Jorge Velez Delgado + Alexis Enrique Valle Parra | Completed: November 19, 2026
  - What: Prepare the final presentation and check that all evidence of Sprints 2–4 is complete and correctly named.
  - Conditions: (1) Presentation ready. (2) Evidence folders complete. (3) Board and burndown updated. (4) Evidence: Final presentation and evidence index.

## 6. Finish

Show a summary per sprint (documents created, attachments, tests executed and their results) and the output of `check_evidence.js`. If you fixed code while collecting evidence, list the fixes and commit them with the message `fix(<TaskID>): <description>`.
