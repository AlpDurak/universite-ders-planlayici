const fs = require("fs");
const { PDFParse } = require("pdf-parse");
const ExcelJS = require("exceljs");

// ==========================================
// CONFIGURATION
// ==========================================
const PDF_FILE = "lectures.pdf";
const JSON_FILE = "prefixes.json";
const OUTPUT_FILE = "top_10_schedules.xlsx";

// SCORING CONFIGURATION
const POINTS = {
  EMPTY_DAY: 200, // +100 for a completely empty day
  EMPTY_SLOT_1: 100, // +50 for late start (slot 1 empty)
  EMPTY_SLOT_2: 75, // +50 for late start (slot 2 empty)
  EMPTY_FRIDAY: 200, // +200 if Friday is empty
  EMPTY_SLOT_8: 100, // +50 for early finish (slot 8 empty)
  GAP_PENALTY: 20, // -10 per hour for gaps >= 3 hours
  GAP_THRESHOLD: 3, // Gaps smaller than this are ignored
  SINGLE_LECTURE: -100, // -100 if you go to school for just one class
};

const MAX_SLOTS = 15;
const DAYS_ORDER = ["M", "T", "W", "Th", "F", "St", "Su"];
const DAY_NAMES = {
  M: "Monday",
  T: "Tuesday",
  W: "Wednesday",
  Th: "Thursday",
  F: "Friday",
  St: "Saturday",
  Su: "Sunday",
};

// ==========================================
// 1. HELPER: PARSE & MERGE
// ==========================================
function parseTimeSlots(timeStr) {
  const slots = [];
  // Regex to catch Day+Hour (e.g. Th1, M12, T5)
  const regex = /(Th|St|M|T|W|F)(\d{1,2})/g;
  let match;
  while ((match = regex.exec(timeStr)) !== null) {
    slots.push({
      full: `${match[1]}${match[2]}`,
      day: match[1],
      hour: parseInt(match[2], 10),
    });
  }
  return slots;
}

function extractAndMergeLectures(rawText) {
  // Normalize P5 -> PS (Common OCR error in your PDF)
  // Remove quotes and newlines
  const cleanText = rawText
    .replace(/"/g, " ")
    .replace(/\n/g, " ")
    .replace(/-P5\./g, "-PS.");

  const sectionMap = new Map();
  // Improved Regex: captures CODE, SEPARATOR, SECTION
  // Examples: COMP1103.1, COMP1103-L.1, COMP1103-PS.1
  const courseCodeRegex = /([A-Z]{3,4}\d{3,4})([.\-])([A-Z0-9.]+)/g;

  let match;
  const indices = [];
  while ((match = courseCodeRegex.exec(cleanText)) !== null) {
    indices.push({
      fullCode: match[0], // COMP1103-L.1
      baseCode: match[1], // COMP1103
      suffix: match[3], // L.1 or 1 or PS.1
      index: match.index,
    });
  }

  for (let i = 0; i < indices.length; i++) {
    const entry = indices[i];
    const nextEntry = indices[i + 1];
    const chunkEnd = nextEntry ? nextEntry.index : cleanText.length;
    const chunkText = cleanText.substring(entry.index, chunkEnd);

    const foundSlots = parseTimeSlots(chunkText);

    if (foundSlots.length > 0) {
      if (!sectionMap.has(entry.fullCode)) {
        // Determine Type: Lecture, Lab, or PS
        let type = "LEC";
        if (entry.fullCode.includes("-L")) type = "LAB";
        else if (entry.fullCode.includes("-PS")) type = "PS";

        sectionMap.set(entry.fullCode, {
          fullCode: entry.fullCode,
          baseCode: entry.baseCode,
          type: type,
          slotSet: new Set(),
          slotObjects: [],
        });
      }

      const current = sectionMap.get(entry.fullCode);
      foundSlots.forEach((slot) => {
        if (!current.slotSet.has(slot.full)) {
          current.slotSet.add(slot.full);
          current.slotObjects.push(slot);
        }
      });
    }
  }

  return Array.from(sectionMap.values()).map((s) => ({
    fullCode: s.fullCode,
    baseCode: s.baseCode,
    type: s.type, // LEC, LAB, or PS
    slots: Array.from(s.slotSet),
    slotObjects: s.slotObjects,
  }));
}

// ==========================================
// 2. CORE: SCORING SYSTEM
// ==========================================
function calculateScore(schedule) {
  let score = 0;

  const dayGrid = {};
  DAYS_ORDER.forEach((d) => (dayGrid[d] = []));

  const coursesPerDay = {};
  DAYS_ORDER.forEach((d) => (coursesPerDay[d] = new Set()));

  schedule.forEach((course) => {
    course.slotObjects.forEach((slot) => {
      dayGrid[slot.day].push(slot.hour);
      // We track distinct Base Codes per day (e.g. COMP1103)
      // If you have Lecture AND Lab for COMP1103 on Monday, that counts as 1 course (travelled for 1 subject)
      // Or should it count as 2? Usually "Single Lecture" means "I went to school for 1 thing".
      // Let's count unique *Full Codes* (Sections) to be safe, or *Base Codes*.
      // Rule says "Single lecture in a day". Let's assume unique *Base Code* implies 1 subject.
      coursesPerDay[slot.day].add(course.baseCode);
    });
  });

  DAYS_ORDER.forEach((day) => {
    const hours = dayGrid[day].sort((a, b) => a - b);
    const uniqueSubjects = coursesPerDay[day].size;

    // Rule: Empty Day
    if (hours.length === 0) {
      score += POINTS.EMPTY_DAY;
      if (day === "F") score += POINTS.EMPTY_FRIDAY;
      return;
    }

    // Rule: Single Lecture (Subject) Penalty
    if (uniqueSubjects === 1) {
      score += POINTS.SINGLE_LECTURE;
    }

    // Rule: Comfort Slots
    if (!hours.includes(1)) score += POINTS.EMPTY_SLOT_1;
    if (!hours.includes(2)) score += POINTS.EMPTY_SLOT_2;
    if (!hours.includes(8)) score += POINTS.EMPTY_SLOT_8;

    // Rule: Gaps
    for (let i = 0; i < hours.length - 1; i++) {
      const current = hours[i];
      const next = hours[i + 1];
      const gap = next - current - 1;

      if (gap >= POINTS.GAP_THRESHOLD) {
        score -= gap * POINTS.GAP_PENALTY;
      }
    }
  });

  return score;
}

// ==========================================
// 3. HELPER: EXCEL GENERATION
// ==========================================
async function generateExcel(scoredSchedules) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Top 10 Schedules");

  const greenFill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFC6EFCE" },
  };
  const borderStyle = {
    top: { style: "thin" },
    left: { style: "thin" },
    bottom: { style: "thin" },
    right: { style: "thin" },
  };
  const centerAlign = { horizontal: "center", vertical: "middle" };

  let currentRow = 1;

  for (let i = 0; i < scoredSchedules.length; i++) {
    const item = scoredSchedules[i];
    const rank = i + 1;

    // Title
    const titleCell = sheet.getCell(`A${currentRow}`);
    titleCell.value = `RANK ${rank} (Score: ${item.score})`;
    titleCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    titleCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF203764" },
    };
    currentRow++;

    // Header
    const headerRow = sheet.getRow(currentRow);
    headerRow.getCell(1).value = "Day / Hour";
    for (let h = 1; h <= MAX_SLOTS; h++) {
      const cell = headerRow.getCell(h + 1);
      cell.value = h;
      cell.alignment = centerAlign;
      cell.font = { bold: true };
      cell.border = borderStyle;
    }
    currentRow++;

    // Grid Mapping
    const grid = {};
    DAYS_ORDER.forEach((d) => (grid[d] = new Array(MAX_SLOTS + 1).fill(null)));

    item.schedule.forEach((course) => {
      course.slotObjects.forEach((slot) => {
        if (grid[slot.day]) grid[slot.day][slot.hour] = course.fullCode;
      });
    });

    // Render
    DAYS_ORDER.forEach((dayKey) => {
      const row = sheet.getRow(currentRow);
      const dayCell = row.getCell(1);
      dayCell.value = DAY_NAMES[dayKey];
      dayCell.font = { bold: true };
      dayCell.border = borderStyle;

      for (let h = 1; h <= MAX_SLOTS; h++) {
        const cell = row.getCell(h + 1);
        const code = grid[dayKey][h];

        cell.border = borderStyle;
        if (code) {
          cell.value = code;
          cell.fill = greenFill;
          cell.alignment = centerAlign;
        }
      }
      currentRow++;
    });

    currentRow += 2;
  }

  sheet.getColumn(1).width = 18;
  for (let c = 2; c <= 16; c++) sheet.getColumn(c).width = 10; // Slightly wider for codes

  await workbook.xlsx.writeFile(OUTPUT_FILE);
}

// ==========================================
// 4. MAIN
// ==========================================
async function main() {
  console.log(`--- Smart Schedule Generator ---`);

  // 1. JSON Load
  let userWants;
  try {
    userWants = JSON.parse(fs.readFileSync(JSON_FILE, "utf8")).data;
    console.log(`Target Courses: ${userWants.join(", ")}`);
  } catch (err) {
    return console.error(err.message);
  }

  // 2. Parse PDF
  const dataBuffer = fs.readFileSync(PDF_FILE);
  const parser = new PDFParse({ data: dataBuffer });
  const pdfData = await parser.getText();
  const allSections = extractAndMergeLectures(pdfData.text);

  console.log(`Total sections found: ${allSections.length}`);

  // 3. Categorize Sections for Targeted Courses
  // We need to build a structure:
  // groupsToPick = [ [LectureOptions], [LabOptions], [PSOptions], ... ]
  const groupsToPick = [];
  const debugFound = new Set();

  userWants.forEach((target) => {
    // Find all sections belonging to this target course
    const relevant = allSections.filter((s) => s.baseCode === target);

    if (relevant.length === 0) {
      console.warn(`WARNING: No sections found for ${target}`);
      return;
    }
    debugFound.add(target);

    // Split by Type
    const lectures = relevant.filter((s) => s.type === "LEC");
    const labs = relevant.filter((s) => s.type === "LAB");
    const ps = relevant.filter((s) => s.type === "PS");

    // If types exist, they are MANDATORY categories to pick from
    if (lectures.length > 0) groupsToPick.push(lectures);
    if (labs.length > 0) groupsToPick.push(labs);
    if (ps.length > 0) groupsToPick.push(ps);

    console.log(
      `Course ${target}: Found ${lectures.length} Lec, ${labs.length} Lab, ${ps.length} PS`,
    );
  });

  if (groupsToPick.length === 0)
    return console.log("No valid course groups found.");

  // 4. Cartesian Product (Generate all combinations)
  const cartesian = (args) =>
    args.reduce((a, b) => a.flatMap((d) => b.map((e) => [d, e].flat())), [[]]);
  const allCombinations = cartesian(groupsToPick);

  console.log(
    `Analyzing ${allCombinations.length} total valid combinations...`,
  );

  // 5. Score & Sort
  const scoredSchedules = [];

  allCombinations.forEach((schedule) => {
    // Check Conflicts
    const used = new Set();
    let conflict = false;
    for (const c of schedule) {
      for (const s of c.slots) {
        if (used.has(s)) {
          conflict = true;
          break;
        }
        used.add(s);
      }
      if (conflict) break;
    }

    if (!conflict) {
      const score = calculateScore(schedule);
      scoredSchedules.push({ schedule, score });
    }
  });

  console.log(
    `Found ${scoredSchedules.length} valid non-conflicting schedules.`,
  );

  scoredSchedules.sort((a, b) => b.score - a.score);

  const top10 = scoredSchedules.slice(0, 10);
  if (top10.length > 0) {
    console.log(`Top Score: ${top10[0].score}`);
    console.log(`10th Score: ${top10[top10.length - 1].score}`);
  }

  await generateExcel(top10);
  console.log(`Done! Check ${OUTPUT_FILE}`);
}

main();
