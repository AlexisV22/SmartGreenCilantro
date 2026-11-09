'use strict';

/**
 * Sprint 3 task numbering of the Scrum board (Weekly Planning documents W1–W3
 * and the Sprint 3 Burndown Reflection): 48 tasks, half-hour estimates.
 *
 * The first evidence run used the 28-task numbering of the original Sprint 3
 * Planning. OLD_TO_NEW maps those ids to the board ids; BOARD holds what the
 * board says about each task (estimate, actual hours, owner, completion date).
 */

const OLD_TO_NEW = {
  'US11-T1': 'US11-T1', 'US11-T2': 'US11-T4', 'US11-T3': 'US11-T5', 'US11-T4': 'US11-T7',
  'US12-T1': 'US12-T1', 'US12-T2': 'US12-T2', 'US12-T3': 'US12-T4',
  'US13-T1': 'US13-T1', 'US13-T2': 'US13-T3', 'US13-T3': 'US13-T4',
  'US15-T1': 'US15-T1', 'US15-T2': 'US15-T3', 'US15-T3': 'US15-T6', 'US15-T4': 'US15-T7', 'US15-T5': 'US15-T9',
  'US16-T1': 'US16-T1', 'US16-T2': 'US16-T3', 'US16-T3': 'US16-T4', 'US16-T4': 'US16-T5', 'US16-T5': 'US16-T6', 'US16-T6': 'US16-T8',
  'US17-T1': 'US17-T1', 'US17-T2': 'US17-T2', 'US17-T3': 'US17-T4',
  'US19-T1': 'US19-T1', 'US19-T2': 'US19-T4', 'US19-T3': 'US19-T6', 'US19-T4': 'US19-T8',
};

const W1 = 'October 16, 2026';
const W2 = 'October 23, 2026';
const W3 = 'October 29, 2026';

// id: [estimate, actual, completed, week label (when it differs from the planned week)]
const BOARD = {
  'US11-T1': [2, 2, W1], 'US11-T4': [3.5, 4, W2], 'US11-T5': [2, 2, W2], 'US11-T7': [1, 1, W3],
  'US12-T1': [1.5, 1.5, W1], 'US12-T2': [2.5, 2.5, W2], 'US12-T4': [1, 1, W3],
  'US13-T1': [1, 1, W1], 'US13-T3': [2.5, 2, W2], 'US13-T4': [1.5, 1.5, W3],
  'US15-T1': [1, 1, W1], 'US15-T3': [2, 2, W1], 'US15-T5': [1, 1, W1, 'Week 2 (done early, in Week 1)'],
  'US15-T6': [2.5, 3, W2], 'US15-T7': [2, 2, W2], 'US15-T9': [1.5, 1.5, W3],
  'US16-T1': [2, 2, W1], 'US16-T3': [2.5, 3.5, 'October 19, 2026', 'Week 1 (carry-over, closed in Week 2)'],
  'US16-T4': [3, 4, W2], 'US16-T5': [2, 2.5, 'October 26, 2026', 'Week 2 (carry-over, closed in Week 3)'],
  'US16-T6': [1.5, 1.5, W3], 'US16-T8': [1.5, 1.5, W3],
  'US17-T1': [1.5, 1.5, W1], 'US17-T2': [1, 1, W2], 'US17-T4': [0.5, 0.5, W3],
  'US19-T1': [2, 2, W1], 'US19-T4': [3, 3.5, W2], 'US19-T5': [1.5, 1.5, 'October 22, 2026'], 'US19-T6': [1, 1, W2], 'US19-T8': [2, 2, W3],
};

// Owners on the board that differ from the story owner.
const OWNER = {
  'US17-T1': ['Jorge Velez Delgado', 'Carlos Ramirez Mendoza'],
  'US17-T2': ['Carlos Ramirez Mendoza', 'Jorge Velez Delgado'],
  'US17-T4': ['Carlos Ramirez Mendoza', 'Jorge Velez Delgado'],
};

const DM2 = 'Daily Meeting 2 of Sprint 3 (Monday, October 19, 2026)';
const DM3 = 'Daily Meeting 3 of Sprint 3 (Monday, October 26, 2026)';
const DONE_W1 = `${DM2}, Scrum board: "Tasks moved to Done last week: US11-T1, US11-T2, US12-T1, US13-T1, US13-T2, US15-T1, US15-T2, US15-T3, US15-T4, US15-T5 (early), US16-T1, US16-T2, US17-T1, US19-T1, US19-T2, US19-T3."`;
const DONE_W2 = `${DM3}, Scrum board: "Tasks moved to Done last week: US11-T3, US11-T4, US11-T5, US12-T2, US13-T3, US15-T6, US15-T7, US16-T3, US16-T4, US17-T2, US19-T4, US19-T5, US19-T6."`;
const REVIEW = 'Sprint 3 Review & Delivery (October 30, 2026): "Product Owner accepted the seven user stories: all acceptance criteria met."';

const APPROVAL = {
  'US11-T1': DONE_W1,
  'US12-T1': `Daily Meeting 1 of Sprint 3 (Monday, October 12, 2026): "The PO confirmed that the severity levels are Low, Medium and High"; decision: severity Low ≤ 10 %, Medium 10–25 %, High > 25 % of deviation. ${DONE_W1}`,
  'US13-T1': DONE_W1,
  'US15-T1': `${DONE_W1} Daily Meeting 1: "The device will poll pending commands every 5 s."`,
  'US15-T3': DONE_W1,
  'US15-T5': `${DM2}, team update, Vicente Rocha Alfaro: "Finished US15-T5 (device polling and acknowledgement endpoints) one week early and shared the endpoints with Oscar." ${DONE_W1}`,
  'US16-T1': DONE_W1,
  'US16-T3': `${DM2}, team update, Oscar Abraham Talavera Nava: "Finish US16-T3 and upload its evidence." ${DONE_W2}`,
  'US17-T1': DONE_W1,
  'US19-T1': DONE_W1,
  'US11-T4': DONE_W2,
  'US11-T5': `${DM3}, team update, Jorge Velez Delgado: "Finished US11-T5, active alerts panel and banner (alerts appear within 30 s)." ${DONE_W2}`,
  'US12-T2': DONE_W2,
  'US13-T3': `${DM3}, team update, Carlos Ramirez Mendoza (by chat): "uploaded the evidence of US13-T3, alert history screen." ${DONE_W2}`,
  'US15-T6': DONE_W2,
  'US15-T7': `${DM3}, team update, Vicente Rocha Alfaro: "Finished US15-T7, irrigation control and MANUAL/AUTOMATIC selector." ${DONE_W2}`,
  'US16-T4': DONE_W2,
  'US16-T5': `${DM3}, team update, Oscar Abraham Talavera Nava: "Finish US16-T5 with Vicente and upload the evidence"; decision: "Feature freeze as soon as US16-T5 is in Ready (today)."`,
  'US17-T2': `${DM3}, team update, Carlos Ramirez Mendoza (by chat): "Finished US17-T2, irrigation history screen." ${DONE_W2}`,
  'US19-T4': DONE_W2,
  'US19-T5': DONE_W2,
  'US19-T6': `${DM3}, team update, Alexis Enrique Valle Parra: "Finished US19-T6: anomaly badge and list with a short explanation on the sensor cards." ${DONE_W2}`,
  'US11-T7': REVIEW, 'US12-T4': REVIEW, 'US13-T4': REVIEW, 'US15-T9': REVIEW, 'US16-T6': REVIEW, 'US16-T8': REVIEW, 'US17-T4': REVIEW, 'US19-T8': REVIEW,
  // Week 3 tasks added on October 30, 2026 (evidence collected after the Review).
  'US11-T6': `${DM3}, team update, Jorge Velez Delgado: "Start US11-T6, automated unit tests for the alert engine, and prepare the script of SPR-T1 for Thursday."`,
  'US11-T8': `Sprint 3 Week 2 Planning, US11-T4 notes: "Evaluation errors are logged and never reject the measurement; performance is verified in US11-T8 (Week 3)."`,
  'US12-T3': `${DM3}, team update, Carlos Ramirez Mendoza (by chat): "US12-T3, severity unit tests, and US17-T3, event log tests (US17-T3 and US17-T4 move to me from Jorge)."`,
  'US15-T8': `${DM3}, team update, Vicente Rocha Alfaro: "Pair with Oscar to close US16-T5 in the morning, then start US15-T8, automated tests for the command API."`,
  'US16-T7': `${DM3}, team update, Oscar Abraham Talavera Nava: "Finish US16-T5 with Vicente and upload the evidence, then start US16-T7, unit tests for the irrigation engine."`,
  'US17-T3': `${DM3}, decision: "US17-T3 and US17-T4 move from Jorge to Carlos." Team update, Carlos Ramirez Mendoza (by chat): "US12-T3, severity unit tests, and US17-T3, event log tests."`,
  'US19-T7': `${DM3}, team update, Alexis Enrique Valle Parra: "Start US19-T7, unit tests for the five detection methods."`,
  'US19-T9': `${DM3}, team update, Alexis Enrique Valle Parra (impediment): "The z-score check gives some false positives on night humidity; they will be measured in US19-T8 and tuned in US19-T9."`,
  'SPR-T1': REVIEW,
  'SPR-T2': `${REVIEW} Burndown in the Sprint 3 Burndown Reflection.`,
};

/** Replace every old Sprint 3 task id in a string at once (no chained replacements). */
function remapIds(s) {
  return s.replace(/US(11|12|13|15|16|17|19)-T(\d+)(?!\d)/g, (m) => OLD_TO_NEW[m] || m);
}

module.exports = { OLD_TO_NEW, BOARD, OWNER, APPROVAL, remapIds };
