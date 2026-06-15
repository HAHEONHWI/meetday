const STORAGE_KEY = "meetday-state-v2";
const ADMIN_SESSION_KEY = "meetday-admin-auth";
const ADMIN_PASSWORD = window.MEETDAY_ADMIN_PASSWORD || "";
const FIREBASE_APP_URL = "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
const FIREBASE_FIRESTORE_URL = "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
const periods = [1, 2, 3];
const SAMPLE_LECTURE_PRESET = [
  { name: "졸업1", unavailable: [], capacities: { 1: 4, 2: 4, 3: 4 } },
  { name: "졸업2", unavailable: [], capacities: { 1: 4, 2: 4, 3: 4 } },
  { name: "졸업3", unavailable: [], capacities: { 1: 4, 2: 4, 3: 4 } },
  { name: "졸업4", unavailable: [], capacities: { 1: 4, 2: 4, 3: 4 } },
  { name: "졸업5", unavailable: [2], capacities: { 1: 3, 2: 3, 3: 3 } },
  { name: "졸업6", unavailable: [1], capacities: { 1: 3, 2: 3, 3: 3 } },
  { name: "졸업7", unavailable: [3], capacities: { 1: 3, 2: 3, 3: 3 } },
];

let firebaseDb = null;
let firebaseDocRef = null;
let applyingRemoteState = false;
let localState = loadLocalState();
let lectures = localState.lectures;
let students = localState.students;
let lastResult = localState.lastResult;

const lectureForm = document.querySelector("#lectureForm");
const lectureList = document.querySelector("#lectureList");
const lectureCount = document.querySelector("#lectureCount");
const csvInput = document.querySelector("#csvInput");
const assignBtn = document.querySelector("#assignBtn");
const downloadBtn = document.querySelector("#downloadBtn");
const statusEl = document.querySelector("#status");
const unassignedList = document.querySelector("#unassignedList");
const firebaseStatus = document.querySelector("#firebaseStatus");
const studentCount = document.querySelector("#studentCount");
const studentEditorBody = document.querySelector("#studentEditorBody");
const studentScheduleBody = document.querySelector("#studentScheduleBody");
const speakerScheduleList = document.querySelector("#speakerScheduleList");
const tabButtons = [...document.querySelectorAll(".tab-button")];
const tabPanels = [...document.querySelectorAll(".tab-panel[data-tab-group-panel]")];
const modeButtons = [...document.querySelectorAll(".mode-button")];
const modePanels = [...document.querySelectorAll(".mode-panel")];
const adminLockPanel = document.querySelector("#adminLockPanel");
const adminContent = document.querySelector("#adminContent");
const adminLoginForm = document.querySelector("#adminLoginForm");
const adminPasswordInput = document.querySelector("#adminPassword");
const adminLockMessage = document.querySelector("#adminLockMessage");
const adminLogoutBtn = document.querySelector("#adminLogoutBtn");
const adminOnlyElements = [...document.querySelectorAll(".admin-only")];
const sampleSetupBtn = document.querySelector("#sampleSetupBtn");

let isAdminAuthenticated = sessionStorage.getItem(ADMIN_SESSION_KEY) === "true";

renderLectures();
renderStudentEditor();
if (lastResult) {
  renderResultViews(lastResult);
  downloadBtn.disabled = false;
}
initModes();
initTabs();
renderAdminState();
initFirebase();

lectureForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ensureAdminAccess()) return;

  const name = document.querySelector("#speakerName").value.trim();
  const unavailable = [...document.querySelectorAll("input[name='unavailable']:checked")].map((input) =>
    Number(input.value),
  );
  const capacities = {
    1: Number(document.querySelector("#cap1").value),
    2: Number(document.querySelector("#cap2").value),
    3: Number(document.querySelector("#cap3").value),
  };

  if (!name) {
    setStatus("졸업생 이름을 입력하세요.", true);
    return;
  }

  if (periods.every((period) => unavailable.includes(period))) {
    setStatus("모든 교시가 불가능한 강의는 등록할 수 없습니다.", true);
    return;
  }

  if (Object.values(capacities).some((value) => value < 1 || value > 30 || Number.isNaN(value))) {
    setStatus("교시별 최대 수용인원은 1명부터 30명까지 입력할 수 있습니다.", true);
    return;
  }

  lectures.push({
    id: crypto.randomUUID(),
    number: nextLectureNumber(),
    name,
    unavailable,
    capacities,
  });

  lastResult = null;
  await saveState();
  renderLectures();
  clearResults();
  lectureForm.reset();
  resetCapacityInputs();
  setStatus("강의를 추가했습니다.");
});

lectureList.addEventListener("click", async (event) => {
  if (!ensureAdminAccess()) return;
  const button = event.target.closest("button[data-delete]");
  if (!button) return;

  lectures = lectures.filter((lecture) => lecture.id !== button.dataset.delete);
  renumberLectures();
  lastResult = null;
  await saveState();
  renderLectures();
  clearResults();
  setStatus("강의를 삭제했습니다.");
});

csvInput.addEventListener("change", async (event) => {
  if (!ensureAdminAccess()) {
    csvInput.value = "";
    return;
  }
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    students = parseStudents(text);
    lastResult = null;
    await saveState();
    renderLectures();
    renderStudentEditor();
    clearResults();
    setStatus(`${students.length}명의 학생을 불러왔습니다. 표에서 수정 후 배정 실행을 누르세요.`);
  } catch (error) {
    students = [];
    await saveState();
    renderLectures();
    renderStudentEditor();
    clearResults();
    setStatus(error.message, true);
  }
});

studentEditorBody.addEventListener("input", async (event) => {
  if (!ensureAdminAccess()) return;
  const input = event.target.closest("input, select");
  if (!input) return;

  const row = input.closest("tr[data-student-id]");
  if (!row) return;

  const student = students.find((item) => item.id === row.dataset.studentId);
  if (!student) return;

  if (input.dataset.field === "name") student.name = input.value.trimStart();
  if (input.dataset.field === "grade") student.grade = Number(input.value);
  if (input.dataset.field === "klass") student.klass = input.value.trimStart();
  if (input.dataset.field === "choice") student.choices[Number(input.dataset.choiceIndex)] = input.value.trim();

  lastResult = null;
  downloadBtn.disabled = true;
  await saveState();
  renderLectures();
  renderStudentEditor();
  renderStudentScheduleTable(null);
  renderSpeakerSchedules(null);
  renderUnassigned([]);
});

assignBtn.addEventListener("click", async () => {
  if (!ensureAdminAccess()) return;
  if (!lectures.length) {
    setStatus("먼저 강의를 등록하세요.", true);
    return;
  }

  if (!students.length) {
    setStatus("먼저 학생 CSV를 업로드하세요.", true);
    return;
  }

  const invalidStudent = students.find(
    (student) =>
      !student.name.trim() ||
      ![1, 2, 3].includes(Number(student.grade)) ||
      !String(student.klass).trim(),
  );

  if (invalidStudent) {
    setStatus("학생 입력값에 빈 이름, 잘못된 학년, 빈 반이 없는지 확인하세요.", true);
    return;
  }

  students = students.map((student) => ({
    ...student,
    name: student.name.trim(),
    klass: String(student.klass).trim(),
    choices: [0, 1, 2].map((index) => (student.choices[index] || "").trim()),
  }));

  renderStudentEditor();
  lastResult = assignStudents(lectures, students);
  await saveState();
  renderResultViews(lastResult);
  downloadBtn.disabled = false;

  const assignedCount = lastResult.assignments.reduce((sum, slot) => sum + slot.students.length, 0);
  const totalNeeded = students.length * periods.length;
  const overCapacityCount = lectures.filter((lecture) => getLectureDemandSummary(lecture, lastResult).isOverCapacity).length;
  const overCapacityText = overCapacityCount ? `, 수용인원 초과 강의 ${overCapacityCount}개` : "";
  const message = `${totalNeeded}개 교시 배정 중 ${assignedCount}개를 완료했습니다. 미배정 ${lastResult.unassigned.length}개${overCapacityText}`;
  setStatus(message, lastResult.unassigned.length > 0 || overCapacityCount > 0);
});

downloadBtn.addEventListener("click", () => {
  if (!lastResult) return;
  downloadCsv(toResultCsv(lastResult), "meetday_assignment.csv");
});

document.querySelector("#sampleCsvBtn").addEventListener("click", () => {
  if (!ensureAdminAccess()) return;
  const sample = buildSampleCsv();
  downloadCsv(sample, "meetday_sample_students.csv");
});

sampleSetupBtn.addEventListener("click", async () => {
  if (!ensureAdminAccess()) return;

  lectures = SAMPLE_LECTURE_PRESET.map((lecture, index) => ({
    id: crypto.randomUUID(),
    number: index + 1,
    name: lecture.name,
    unavailable: [...lecture.unavailable],
    capacities: { ...lecture.capacities },
  }));

  lastResult = null;
  await saveState();
  renderLectures();
  clearResults();
  setStatus("검증용 강의 7개를 불러왔습니다.");
});

document.querySelector("#resetBtn").addEventListener("click", async () => {
  if (!ensureAdminAccess()) return;
  if (!confirm("등록된 강의와 배정 결과를 모두 초기화할까요?")) return;
  lectures = [];
  students = [];
  lastResult = null;
  await saveState();
  csvInput.value = "";
  renderLectures();
  renderStudentEditor();
  clearResults();
  setStatus("초기화했습니다.");
});

adminLoginForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!ADMIN_PASSWORD) {
    adminLockMessage.textContent = "관리자 비밀번호가 로컬 설정 파일에 없습니다.";
    setStatus("관리자 비밀번호가 로컬 설정 파일에 없습니다.", true);
    return;
  }

  if (adminPasswordInput.value === ADMIN_PASSWORD) {
    isAdminAuthenticated = true;
    sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
    adminPasswordInput.value = "";
    adminLockMessage.textContent = "관리자 모드가 열렸습니다.";
    renderAdminState();
    setStatus("관리자 모드가 열렸습니다.");
    return;
  }

  adminLockMessage.textContent = "비밀번호가 올바르지 않습니다.";
  setStatus("관리자 비밀번호가 올바르지 않습니다.", true);
});

adminLogoutBtn.addEventListener("click", () => {
  isAdminAuthenticated = false;
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  renderAdminState();
  setMode("viewer");
  setStatus("관리자 모드를 잠갔습니다.");
});

function initModes() {
  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.modeTarget;
      if (target === "admin" && !isAdminAuthenticated) {
        setMode("admin");
        adminPasswordInput.focus();
        setStatus("관리자 페이지는 비밀번호 입력 후 사용할 수 있습니다.", true);
        return;
      }
      setMode(target);
    });
  });
}

function initTabs() {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.tabGroup === "admin" && !ensureAdminAccess()) return;
      const target = button.dataset.tabTarget;
      const group = button.dataset.tabGroup;
      tabButtons
        .filter((item) => item.dataset.tabGroup === group)
        .forEach((item) => item.classList.toggle("active", item === button));
      tabPanels
        .filter((panel) => panel.dataset.tabGroupPanel === group)
        .forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${target}`));
    });
  });
}

function renderAdminState() {
  adminLockPanel.classList.toggle("hidden", isAdminAuthenticated);
  adminContent.classList.toggle("hidden", !isAdminAuthenticated);
  adminOnlyElements.forEach((element) => element.classList.toggle("hidden", !isAdminAuthenticated));
}

function setMode(target) {
  modeButtons.forEach((button) => button.classList.toggle("active", button.dataset.modeTarget === target));
  modePanels.forEach((panel) => panel.classList.toggle("active", panel.id === `mode-${target}`));
}

function ensureAdminAccess() {
  if (isAdminAuthenticated) return true;
  setMode("admin");
  adminPasswordInput.focus();
  setStatus("관리자 기능은 비밀번호 입력 후 사용할 수 있습니다.", true);
  return false;
}

function loadLocalState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (Array.isArray(saved)) return { lectures: saved, students: [], lastResult: null };
    return {
      lectures: Array.isArray(saved.lectures) ? saved.lectures : [],
      students: Array.isArray(saved.students) ? saved.students : [],
      lastResult: saved.lastResult || null,
    };
  } catch {
    return { lectures: [], students: [], lastResult: null };
  }
}

async function saveState() {
  const state = {
    lectures,
    students,
    lastResult,
    updatedAt: new Date().toISOString(),
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  if (!firebaseDocRef || applyingRemoteState) return;

  try {
    const { setDoc } = await import(FIREBASE_FIRESTORE_URL);
    await setDoc(firebaseDocRef, state, { merge: true });
    setFirebaseStatus("Firebase 동기화됨", "on");
  } catch (error) {
    setFirebaseStatus("Firebase 저장 실패", "error");
    setStatus(`Firebase 저장 실패: ${error.message}`, true);
  }
}

function nextLectureNumber() {
  return lectures.reduce((max, lecture) => Math.max(max, lecture.number || 0), 0) + 1;
}

function renumberLectures() {
  lectures = lectures.map((lecture, index) => ({ ...lecture, number: index + 1 }));
}

function renderLectures() {
  lectureCount.textContent = `${lectures.length}개 강의`;

  if (!lectures.length) {
    lectureList.className = "lecture-list empty";
    lectureList.textContent = "등록된 강의가 없습니다.";
    return;
  }

  lectureList.className = "lecture-list";
  lectureList.innerHTML = lectures
    .map((lecture) => {
      const demand = getLectureDemandSummary(lecture, lastResult);
      const periodHtml = periods
        .map((period) => {
          const unavailable = lecture.unavailable.includes(period);
          const label = unavailable ? "수업불가" : `${lecture.capacities[period]}명`;
          return `<span class="period ${unavailable ? "off" : ""}">${period}교시 ${label}</span>`;
        })
        .join("");
      const warningHtml = demand.isOverCapacity
        ? `<span class="warning-badge">수용인원 초과</span>`
        : "";

      return `
        <article class="lecture-card ${demand.isOverCapacity ? "warning" : ""}">
          <div class="lecture-card-head">
            <div>
              <strong>${lecture.number}. ${escapeHtml(lecture.name)}</strong>
              <small>CSV 순위에는 ${lecture.number} 또는 ${escapeHtml(lecture.name)} 입력</small>
            </div>
            <button type="button" class="danger" data-delete="${lecture.id}">삭제</button>
          </div>
          <div class="lecture-meta">
            <span>${demand.periodSummaryText}</span>
            ${warningHtml}
          </div>
          <div class="periods">${periodHtml}</div>
        </article>
      `;
    })
    .join("");
}

function renderStudentEditor() {
  studentCount.textContent = `${students.length}명`;

  if (!students.length) {
    studentEditorBody.innerHTML = '<tr><td colspan="6" class="blank">아직 학생 데이터가 없습니다.</td></tr>';
    return;
  }

  studentEditorBody.innerHTML = students
    .map(
      (student) => `
        <tr data-student-id="${student.id}">
          <td><input type="text" data-field="name" value="${escapeAttribute(student.name)}" /></td>
          <td>
            <select data-field="grade">
              ${[1, 2, 3]
                .map((grade) => `<option value="${grade}" ${Number(student.grade) === grade ? "selected" : ""}>${grade}</option>`)
                .join("")}
            </select>
          </td>
          <td><input type="text" data-field="klass" value="${escapeAttribute(student.klass)}" /></td>
          ${[0, 1, 2]
            .map(
              (index) =>
                `<td><input type="text" data-field="choice" data-choice-index="${index}" value="${escapeAttribute(student.choices[index] || "")}" /></td>`,
            )
            .join("")}
        </tr>
      `,
    )
    .join("");
}

function parseStudents(text) {
  const rows = parseCsv(text).filter((row) => row.some((cellValue) => cellValue.trim()));
  if (rows.length < 2) {
    throw new Error("CSV에 학생 데이터가 없습니다.");
  }

  const headers = rows[0].map(normalizeHeader);
  const required = ["이름", "학년", "반", "1순위", "2순위", "3순위"];
  const indexes = Object.fromEntries(required.map((header) => [header, headers.indexOf(header)]));

  const missing = required.filter((header) => indexes[header] === -1);
  if (missing.length) {
    throw new Error(`CSV 헤더가 올바르지 않습니다. 누락: ${missing.join(", ")}`);
  }

  return rows.slice(1).map((row, index) => {
    const name = cell(row, indexes["이름"]);
    const grade = Number(cell(row, indexes["학년"]));
    const klass = cell(row, indexes["반"]);
    const choices = [cell(row, indexes["1순위"]), cell(row, indexes["2순위"]), cell(row, indexes["3순위"])];

    if (!name || ![1, 2, 3].includes(grade)) {
      throw new Error(`${index + 2}행의 이름 또는 학년이 올바르지 않습니다. 학년은 1, 2, 3만 가능합니다.`);
    }

    return { id: `student-${index}`, name, grade, klass, choices };
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return value.replace(/^\uFEFF/, "").trim();
}

function cell(row, index) {
  return (row[index] || "").trim();
}

function assignStudents(lectureData, studentData) {
  const slots = lectureData.flatMap((lecture) =>
    periods
      .filter((period) => !lecture.unavailable.includes(period))
      .map((period) => ({
        lectureId: lecture.id,
        lectureNumber: lecture.number,
        lectureName: lecture.name,
        period,
        capacity: Number(lecture.capacities[period]),
        students: [],
      })),
  );

  const studentSchedules = new Map(studentData.map((student) => [student.id, new Map()]));
  const orderedStudents = [...studentData].sort(compareForDiversity);

  for (const student of orderedStudents) {
    const schedule = studentSchedules.get(student.id);
    const selectedLectures = resolveSelectedLectures(student, lectureData);
    const assignedSlots = findBestSlotsForStudent(selectedLectures, slots, student, schedule);

    assignedSlots.forEach((slot) => {
      slot.students.push({ ...student });
      schedule.set(slot.period, slot);
    });
  }

  const unassigned = [];
  for (const student of studentData) {
    const schedule = studentSchedules.get(student.id);
    const assignedLectureIds = new Set([...schedule.values()].map((slot) => slot.lectureId));

    resolveSelectedLectures(student, lectureData).forEach((lecture) => {
      if (!assignedLectureIds.has(lecture.id)) {
        unassigned.push({ ...student, lectureName: lecture.name });
      }
    });

    student.choices.forEach((choice) => {
      if (choice && !resolveLecture(choice, lectureData)) {
        unassigned.push({ ...student, lectureName: choice });
      }
    });
  }

  return { assignments: slots, unassigned };
}

function compareForDiversity(a, b) {
  if (a.grade !== b.grade) return a.grade - b.grade;
  if (String(a.klass) !== String(b.klass)) return String(a.klass).localeCompare(String(b.klass), "ko");
  return a.name.localeCompare(b.name, "ko");
}

function resolveLecture(choice, lectureData) {
  if (!choice) return null;
  const normalized = choice.trim();
  const asNumber = Number(normalized);

  if (!Number.isNaN(asNumber)) {
    return lectureData.find((lecture) => lecture.number === asNumber) || null;
  }

  return lectureData.find((lecture) => lecture.name === normalized) || null;
}

function scoreSlot(slot, student) {
  const gradeCounts = countGrades(slot.students);
  const sameGradeCount = gradeCounts[student.grade] || 0;
  const capacity = Math.max(slot.capacity, 1);
  const currentCount = slot.students.length;
  const loadPenalty = (currentCount / capacity) * 100;
  const sameGradePenalty = sameGradeCount * 8;
  const overflowPenalty =
    currentCount >= capacity ? 1000 + (currentCount - capacity) * 200 : 0;

  return overflowPenalty + loadPenalty + sameGradePenalty + slot.period / 100;
}

function hasLecture(schedule, lectureId) {
  return [...schedule.values()].some((slot) => slot.lectureId === lectureId);
}

function resolveSelectedLectures(student, lectureData) {
  const selected = [];
  const usedIds = new Set();

  student.choices.forEach((choice) => {
    const lecture = resolveLecture(choice, lectureData);
    if (!lecture || usedIds.has(lecture.id)) return;
    usedIds.add(lecture.id);
    selected.push(lecture);
  });

  return selected;
}

function findBestSlotsForStudent(selectedLectures, slots, student, schedule) {
  if (!selectedLectures.length) return [];

  const orderedLectures = [...selectedLectures].sort((a, b) => {
    const aOptions = slots.filter((slot) => slot.lectureId === a.id).length;
    const bOptions = slots.filter((slot) => slot.lectureId === b.id).length;
    return aOptions - bOptions;
  });

  let best = { assignedCount: -1, totalScore: Number.POSITIVE_INFINITY, slots: [] };

  function search(index, usedPeriods, chosenSlots, totalScore) {
    if (index === orderedLectures.length) {
      if (
        chosenSlots.length > best.assignedCount ||
        (chosenSlots.length === best.assignedCount && totalScore < best.totalScore)
      ) {
        best = { assignedCount: chosenSlots.length, totalScore, slots: [...chosenSlots] };
      }
      return;
    }

    const lecture = orderedLectures[index];
    const candidates = slots
      .filter((slot) => slot.lectureId === lecture.id && !usedPeriods.has(slot.period) && !schedule.has(slot.period))
      .sort((a, b) => scoreSlot(a, student) - scoreSlot(b, student));

    candidates.forEach((slot) => {
      usedPeriods.add(slot.period);
      chosenSlots.push(slot);
      search(index + 1, usedPeriods, chosenSlots, totalScore + scoreSlot(slot, student));
      chosenSlots.pop();
      usedPeriods.delete(slot.period);
    });

    search(index + 1, usedPeriods, chosenSlots, totalScore + 1000);
  }

  search(0, new Set(), [], 0);
  return best.slots;
}

function countGrades(studentList) {
  return studentList.reduce(
    (counts, student) => {
      counts[student.grade] += 1;
      return counts;
    },
    { 1: 0, 2: 0, 3: 0 },
  );
}

function renderResultViews(result) {
  renderUnassigned(result.unassigned);
  renderStudentScheduleTable(result);
  renderSpeakerSchedules(result);
}

function renderStudentScheduleTable(result) {
  if (!result) {
    studentScheduleBody.innerHTML = '<tr><td colspan="5" class="blank">아직 배정 결과가 없습니다.</td></tr>';
    return;
  }

  const sourceStudents = students.length ? students : extractStudentsFromResult(result);
  const scheduleMap = new Map();
  sourceStudents.forEach((student) => {
    scheduleMap.set(student.id, {
      classLabel: `${student.grade}-${student.klass}`,
      name: student.name,
      periods: { 1: "", 2: "", 3: "" },
    });
  });

  result.assignments.forEach((slot) => {
    slot.students.forEach((student) => {
      const row = scheduleMap.get(student.id);
      if (!row) return;
      row.periods[slot.period] = `${slot.lectureNumber}. ${slot.lectureName}`;
    });
  });

  const rows = [...scheduleMap.values()]
    .sort((a, b) => a.classLabel.localeCompare(b.classLabel, "ko") || a.name.localeCompare(b.name, "ko"))
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.classLabel)}</td>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.periods[1] || "미배정")}</td>
          <td>${escapeHtml(row.periods[2] || "미배정")}</td>
          <td>${escapeHtml(row.periods[3] || "미배정")}</td>
        </tr>
      `,
    )
    .join("");

  studentScheduleBody.innerHTML = rows || '<tr><td colspan="5" class="blank">학생 데이터가 없습니다.</td></tr>';
}

function renderSpeakerSchedules(result) {
  if (!result) {
    speakerScheduleList.className = "speaker-schedule-list empty";
    speakerScheduleList.textContent = "아직 배정 결과가 없습니다.";
    return;
  }

  const grouped = new Map();
  lectures.forEach((lecture) => {
    grouped.set(lecture.id, {
      lectureId: lecture.id,
      lectureNumber: lecture.number,
      lectureName: lecture.name,
      unavailable: lecture.unavailable || [],
      periods: { 1: [], 2: [], 3: [] },
    });
  });

  result.assignments.forEach((slot) => {
    const target = grouped.get(slot.lectureId);
    if (!target) return;
    target.periods[slot.period] = slot.students
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "ko"))
      .map((student) => `${student.grade}-${student.klass} ${student.name}`);
  });

  const cards = [...grouped.values()]
    .sort((a, b) => a.lectureNumber - b.lectureNumber)
    .map((lecture) => {
      const demand = getLectureDemandSummary(
        lectures.find((item) => item.id === lecture.lectureId),
        result,
      );
      const periodItems = periods
        .map((period) => {
          const studentsText = lecture.unavailable.includes(period)
            ? "수업불가"
            : lecture.periods[period].length
              ? lecture.periods[period].map(escapeHtml).join(", ")
              : "없음";
          return `
            <div class="speaker-period">
              <strong>${period}교시</strong>
              <p>${studentsText}</p>
            </div>
          `;
        })
        .join("");

      return `
        <article class="speaker-card ${demand.isOverCapacity ? "warning" : ""}">
          <div class="speaker-card-head">
            <div>
              <h3>${lecture.lectureNumber}. ${escapeHtml(lecture.lectureName)}</h3>
              <p class="speaker-meta">${demand.periodSummaryText}</p>
            </div>
            ${demand.isOverCapacity ? '<span class="warning-badge">수용인원 초과</span>' : ""}
          </div>
          <div class="speaker-periods">${periodItems}</div>
        </article>
      `;
    })
    .join("");

  speakerScheduleList.className = "speaker-schedule-list";
  speakerScheduleList.innerHTML = cards || '<div class="empty">아직 배정 결과가 없습니다.</div>';
}

function getLectureDemandSummary(lecture, result) {
  if (!lecture) {
    return { periodSummaryText: "", isOverCapacity: false };
  }

  const assignmentMap = new Map();
  if (result?.assignments) {
    result.assignments.forEach((slot) => {
      if (slot.lectureId === lecture.id) {
        assignmentMap.set(slot.period, slot.students.length);
      }
    });
  }

  const periodSummaries = periods.map((period) => {
    if (lecture.unavailable.includes(period)) {
      return `${period}교시 수업불가`;
    }

    const assignedCount = assignmentMap.get(period) || 0;
    const capacity = Number(lecture.capacities[period] || 0);
    return `${period}교시 ${assignedCount}/${capacity}명`;
  });

  const isOverCapacity = periods.some((period) => {
    if (lecture.unavailable.includes(period)) return false;
    const assignedCount = assignmentMap.get(period) || 0;
    return assignedCount > Number(lecture.capacities[period] || 0);
  });

  return {
    periodSummaryText: periodSummaries.join(", "),
    isOverCapacity,
  };
}

function renderUnassigned(unassigned) {
  if (!unassigned.length) {
    unassignedList.className = "empty";
    unassignedList.textContent = "미배정 없음";
    return;
  }

  unassignedList.className = "unassigned-items";
  unassignedList.innerHTML = unassigned
    .map(
      (student) =>
        `<span class="student-chip">${escapeHtml(student.grade)}-${escapeHtml(student.klass)} ${escapeHtml(student.name)} / ${escapeHtml(student.lectureName || "배정 실패")}</span>`,
    )
    .join("");
}

function clearResults() {
  downloadBtn.disabled = true;
  renderUnassigned([]);
  renderStudentScheduleTable(null);
  renderSpeakerSchedules(null);
}

function extractStudentsFromResult(result) {
  const studentMap = new Map();

  result.assignments.forEach((slot) => {
    slot.students.forEach((student) => {
      if (!studentMap.has(student.id)) {
        studentMap.set(student.id, {
          id: student.id,
          name: student.name,
          grade: student.grade,
          klass: student.klass,
          choices: student.choices || [],
        });
      }
    });
  });

  result.unassigned.forEach((student) => {
    if (!studentMap.has(student.id)) {
      studentMap.set(student.id, {
        id: student.id,
        name: student.name,
        grade: student.grade,
        klass: student.klass,
        choices: student.choices || [],
      });
    }
  });

  return [...studentMap.values()];
}

async function initFirebase() {
  const config = window.MEETDAY_FIREBASE_CONFIG;

  if (!config || !config.projectId) {
    setFirebaseStatus("로컬 저장", "");
    return;
  }

  try {
    setFirebaseStatus("Firebase 연결 중", "");
    const [{ initializeApp }, { getFirestore, doc, onSnapshot }] = await Promise.all([
      import(FIREBASE_APP_URL),
      import(FIREBASE_FIRESTORE_URL),
    ]);
    const firebaseApp = initializeApp(config);
    firebaseDb = getFirestore(firebaseApp);
    firebaseDocRef = doc(firebaseDb, "meetday", "state");

    onSnapshot(
      firebaseDocRef,
      (snapshot) => {
        setFirebaseStatus("Firebase 동기화됨", "on");
        if (!snapshot.exists()) {
          saveState();
          return;
        }

        const remoteState = snapshot.data();
        applyingRemoteState = true;
        lectures = Array.isArray(remoteState.lectures) ? remoteState.lectures : [];
        students = Array.isArray(remoteState.students) ? remoteState.students : [];
        lastResult = remoteState.lastResult || null;
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            lectures,
            students,
            lastResult,
            updatedAt: remoteState.updatedAt || new Date().toISOString(),
          }),
        );
        renderLectures();
        renderStudentEditor();
        if (lastResult) {
          renderResultViews(lastResult);
          downloadBtn.disabled = false;
        } else {
          clearResults();
        }
        studentCount.textContent = `${students.length}명`;
        applyingRemoteState = false;
      },
      (error) => {
        setFirebaseStatus("Firebase 연결 실패", "error");
        setStatus(`Firebase 연결 실패: ${error.message}`, true);
      },
    );
  } catch (error) {
    setFirebaseStatus("Firebase 연결 실패", "error");
    setStatus(`Firebase 연결 실패: ${error.message}`, true);
  }
}

function setFirebaseStatus(message, state) {
  firebaseStatus.textContent = message;
  firebaseStatus.classList.toggle("on", state === "on");
  firebaseStatus.classList.toggle("error", state === "error");
}

function toResultCsv(result) {
  const rows = [["교시", "강의번호", "졸업생이름", "학생이름", "학년", "반"]];

  result.assignments.forEach((slot) => {
    slot.students.forEach((student) => {
      rows.push([slot.period, slot.lectureNumber, slot.lectureName, student.name, student.grade, student.klass]);
    });
  });

  result.unassigned.forEach((student) => {
    rows.push(["미배정", "", student.lectureName || "", student.name, student.grade, student.klass]);
  });

  return `\uFEFF${rows.map((row) => row.map(csvValue).join(",")).join("\n")}`;
}

function buildSampleCsv() {
  const rows = [["이름", "학년", "반", "1순위", "2순위", "3순위"]];
  const classConfigs = [
    { grade: 1, klass: "1", choices: ["1", "2", "5"] },
    { grade: 2, klass: "1", choices: ["1", "2", "6"] },
    { grade: 3, klass: "1", choices: ["1", "3", "7"] },
    { grade: 1, klass: "2", choices: ["1", "3", "4"] },
    { grade: 2, klass: "2", choices: ["1", "3", "4"] },
    { grade: 3, klass: "2", choices: ["2", "3", "4"] },
  ];

  let studentNumber = 1;
  classConfigs.forEach((config) => {
    for (let i = 0; i < 6; i += 1) {
      rows.push([
        `학생${String(studentNumber).padStart(2, "0")}`,
        config.grade,
        config.klass,
        config.choices[0],
        config.choices[1],
        config.choices[2],
      ]);
      studentNumber += 1;
    }
  });

  return `\uFEFF${rows.map((row) => row.map(csvValue).join(",")).join("\n")}`;
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(text, filename) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function setStatus(message, warning = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("warn", warning);
}

function resetCapacityInputs() {
  document.querySelector("#cap1").value = 20;
  document.querySelector("#cap2").value = 20;
  document.querySelector("#cap3").value = 20;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
