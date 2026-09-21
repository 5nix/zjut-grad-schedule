import { createHash } from "node:crypto";

const WEEKDAY = {
  星期一: 1,
  星期二: 2,
  星期三: 3,
  星期四: 4,
  星期五: 5,
  星期六: 6,
  星期日: 7,
  星期天: 7,
};

function numberSet(value) {
  const numbers = new Set();
  const normalized = String(value)
    .replace(/[第周节]/g, "")
    .replace(/到/g, "-")
    .replace(/，/g, ",")
    .replace(/、/g, ",");
  for (const token of normalized.split(",").map((part) => part.trim()).filter(Boolean)) {
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let value = start; value <= end; value += 1) numbers.add(value);
    } else if (/^\d+$/.test(token)) {
      numbers.add(Number(token));
    }
  }
  return [...numbers].sort((left, right) => left - right);
}

function contiguousRuns(values) {
  const runs = [];
  for (const value of values) {
    const current = runs.at(-1);
    if (!current || value !== current.at(-1) + 1) runs.push([value]);
    else current.push(value);
  }
  return runs;
}

export function parseSchedulePatterns(value) {
  const patterns = [];
  const source = String(value ?? "");
  const matcher = /([\d\s,、，-]+)周[\s\S]*?(星期[一二三四五六日天])\s*\[([^\]]+)\]/g;
  for (const match of source.matchAll(matcher)) {
    const weeks = numberSet(match[1]);
    const sections = numberSet(match[3]);
    const weekday = WEEKDAY[match[2]];
    if (!weeks.length || !sections.length || !weekday) continue;
    patterns.push({ weeks, sections, weekday });
  }
  if (!patterns.length) throw new Error(`无法解析排课时间：${source}`);
  return patterns;
}

function localDate(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) throw new Error(`首次上课日期格式无效：${value ?? ""}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) throw new Error(`首次上课日期无效：${value}`);
  return date;
}

function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function dateText(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
}

function dateIso(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function weekdayOf(date) {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function timeValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`节次时间无效：${value}`);
  const hours = Math.floor(numeric / 100);
  const minutes = numeric % 100;
  if (hours > 23 || minutes > 59) throw new Error(`节次时间无效：${value}`);
  return `${String(hours).padStart(2, "0")}${String(minutes).padStart(2, "0")}`;
}

export function periodMap(rows) {
  return new Map(
    rows.map((row) => [
      String(row.DM),
      { start: timeValue(row.KSSJ), end: timeValue(row.JSSJ) },
    ]),
  );
}

function locationFor(row) {
  if (row.PKDD && String(row.PKDD).trim()) return String(row.PKDD).trim();
  const raw = String(row.PKSJDD ?? "");
  const close = raw.lastIndexOf("]");
  return close >= 0 ? raw.slice(close + 1).trim() : raw.trim();
}

function courseTitle(row) {
  const course = String(row.KCMC ?? "未命名课程").trim();
  const teacher = String(row.RKJS ?? "").trim();
  return teacher ? `${course} · ${teacher}` : course;
}

function courseDescription(row, semesterDisplay, lessonNumber, lessonTotal) {
  const lines = [`第${lessonNumber}/${lessonTotal}节`];
  const campus = String(row.XQDM_DISPLAY ?? "").trim();
  if (campus) lines.push(campus);
  if (semesterDisplay) lines.push(semesterDisplay);
  const notes = [row.XKBZ, row.KBBZ, row.XSJXFSBZ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (notes.length) lines.push(`备注：${notes.join("；")}`);
  return lines.join("\n");
}

function uidFor(studentId, semesterCode, row, date, startSection, endSection) {
  const source = [
    studentId,
    semesterCode,
    row.KCDM ?? row.KCMC ?? "course",
    dateIso(date),
    startSection,
    endSection,
  ].join("|");
  return `${createHash("sha256").update(source).digest("hex").slice(0, 32)}@zjut-course-calendar`;
}

export function expandCourses({ studentId, courses, periodsBySemester }) {
  const events = [];
  const warnings = [];

  for (const course of courses) {
    const { row, semesterCode, semesterDisplay } = course;
    let patterns;
    try {
      patterns = parseSchedulePatterns(row.PKSJ);
    } catch (error) {
      warnings.push({ course: row.KCMC ?? null, message: error.message });
      continue;
    }

    let firstDate;
    try {
      firstDate = localDate(row.SCSKRQ);
    } catch (error) {
      warnings.push({ course: row.KCMC ?? null, message: error.message });
      continue;
    }

    const firstPattern = patterns[0];
    if (weekdayOf(firstDate) !== firstPattern.weekday) {
      warnings.push({
        course: row.KCMC ?? null,
        message: "首次上课日期与排课星期不一致，已跳过该课程",
      });
      continue;
    }

    const periods = periodsBySemester.get(semesterCode);
    if (!periods) {
      warnings.push({ course: row.KCMC ?? null, message: `缺少学期 ${semesterCode} 的节次时间表` });
      continue;
    }

    const anchorWeek = firstPattern.weeks[0];
    const anchorWeekday = firstPattern.weekday;
    const courseEvents = [];
    for (const pattern of patterns) {
      for (const week of pattern.weeks) {
        const date = addDays(
          firstDate,
          (week - anchorWeek) * 7 + pattern.weekday - anchorWeekday,
        );
        for (const sectionRun of contiguousRuns(pattern.sections)) {
          const startSection = sectionRun[0];
          const endSection = sectionRun.at(-1);
          const start = periods.get(String(startSection));
          const end = periods.get(String(endSection));
          if (!start || !end) {
            warnings.push({
              course: row.KCMC ?? null,
              message: `缺少第 ${startSection}-${endSection} 节的时间配置`,
            });
            continue;
          }
          courseEvents.push({
            uid: uidFor(studentId, semesterCode, row, date, startSection, endSection),
            date: dateText(date),
            start: start.start,
            end: end.end,
            title: courseTitle(row),
            location: locationFor(row),
          });
        }
      }
    }

    courseEvents.sort((left, right) =>
      `${left.date}${left.start}${left.end}`.localeCompare(`${right.date}${right.start}${right.end}`),
    );
    const lessonTotal = courseEvents.length;
    courseEvents.forEach((event, index) => {
      event.description = courseDescription(row, semesterDisplay, index + 1, lessonTotal);
    });
    events.push(...courseEvents);
  }
  return { events, warnings };
}

function escapeText(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r?\n/g, "\\n");
}

function foldLine(line) {
  const result = [];
  let current = "";
  for (const character of line) {
    if (Buffer.byteLength(current + character, "utf8") > 75) {
      result.push(current);
      current = ` ${character}`;
    } else {
      current += character;
    }
  }
  result.push(current);
  return result;
}

function utcStamp(date) {
  const parts = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    "T",
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0"),
    "Z",
  ];
  return parts.join("");
}

export function renderCalendar({ studentId, courses, periodsBySemester }) {
  const { events, warnings } = expandCourses({ studentId, courses, periodsBySemester });
  events.sort((left, right) =>
    `${left.date}${left.start}${left.title}`.localeCompare(`${right.date}${right.start}${right.title}`),
  );
  const stamp = utcStamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ZJUT Graduate Course Calendar//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:浙工大研究生课表",
    "X-WR-TIMEZONE:Asia/Shanghai",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Shanghai",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0800",
    "TZOFFSETTO:+0800",
    "TZNAME:CST",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${stamp}`,
      `DTSTART;TZID=Asia/Shanghai:${event.date}T${event.start}00`,
      `DTEND;TZID=Asia/Shanghai:${event.date}T${event.end}00`,
      `SUMMARY:${escapeText(event.title)}`,
      `LOCATION:${escapeText(event.location)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "SEQUENCE:0",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return {
    ics: `${lines.flatMap(foldLine).join("\r\n")}\r\n`,
    eventCount: events.length,
    warnings,
  };
}

export async function fetchAllCalendarData(client) {
  const semesters = await client.fetchSemesters();
  const courses = [];
  const periodsBySemester = new Map();
  for (const semester of semesters) {
    const semesterCode = String(semester.XNXQDM);
    const result = await client.fetchCourses(semesterCode);
    if (!result.rowCount) continue;
    const periodRows = await client.fetchPeriodTable(semesterCode);
    periodsBySemester.set(semesterCode, periodMap(periodRows));
    for (const row of result.rows) {
      courses.push({
        row,
        semesterCode,
        semesterDisplay: semester.XNXQDM_DISPLAY || row.XNXQDM_DISPLAY || semesterCode,
      });
    }
  }
  return { semesters, courses, periodsBySemester };
}
