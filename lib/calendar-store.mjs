import fs from "node:fs/promises";
import path from "node:path";

function unfoldIcsLines(ics) {
  const lines = String(ics).replace(/\r\n?/g, "\n").split("\n");
  const unfolded = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

function propertyValue(line, name) {
  const separator = line.indexOf(":");
  if (separator < 0) return null;
  const property = line.slice(0, separator).split(";", 1)[0].toUpperCase();
  return property === name ? line.slice(separator + 1) : null;
}

function unescapeIcsText(value) {
  return String(value ?? "")
    .replace(/\\n/gi, "\n")
    .replace(/\\([\\;,])/g, "$1");
}

function parseIcsDateTime(value) {
  const match = String(value ?? "").match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, utc] = match;
  return utc
    ? `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`
    : `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
}

function parseDescription(value) {
  const lines = unescapeIcsText(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let campus = "";
  let semester = "";
  let lessonText = "";
  let schedule = "";
  const notes = [];
  const unlabeled = [];

  for (const line of lines) {
    const labeled = line.match(/^(任课教师|学期|校区|周次\/节次|备注)\s*[：:]\s*(.*)$/);
    if (labeled) {
      const [, label, text] = labeled;
      if (label === "学期") semester = text.trim();
      else if (label === "校区") campus = text.trim();
      else if (label === "周次/节次") schedule = text.trim();
      else if (label === "备注" && text.trim()) notes.push(text.trim());
      continue;
    }
    if (/^第\d+\/\d+节$/.test(line)) {
      lessonText = line;
      continue;
    }
    if (/学期$/.test(line)) {
      semester = line;
      continue;
    }
    unlabeled.push(line);
  }

  if (!campus) campus = unlabeled.shift() ?? "";
  notes.push(...unlabeled);
  return { campus, semester, lessonText, schedule, description: notes.join("\n") };
}

function assignLegacyLessonText(events) {
  const groups = new Map();
  for (const event of events) {
    if (event.lessonText) continue;
    const key = [event.title, event.location, event.campus, event.semester, event.schedule].join("\u0000");
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => left.start.localeCompare(right.start));
    group.forEach((event, index) => {
      event.lessonText = `第${index + 1}/${group.length}节`;
    });
  }
}

export function parseScheduleEventsFromIcs(ics) {
  const events = [];
  let current = null;
  for (const line of unfoldIcsLines(ics)) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) {
        const start = parseIcsDateTime(current.start);
        const end = parseIcsDateTime(current.end);
        if (current.id && current.title && start && end) {
          const meta = parseDescription(current.description);
          events.push({
            id: unescapeIcsText(current.id),
            title: unescapeIcsText(current.title),
            start,
            end,
            location: unescapeIcsText(current.location),
            campus: meta.campus,
            semester: meta.semester,
            lessonText: meta.lessonText,
            description: meta.description,
            schedule: meta.schedule,
          });
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const fields = [
      ["id", "UID"],
      ["title", "SUMMARY"],
      ["start", "DTSTART"],
      ["end", "DTEND"],
      ["location", "LOCATION"],
      ["description", "DESCRIPTION"],
    ];
    for (const [key, name] of fields) {
      const value = propertyValue(line, name);
      if (value !== null) current[key] = value;
    }
  }

  assignLegacyLessonText(events);
  return events.map(({ schedule, ...event }) => event);
}

function assertStudentId(studentId) {
  if (!/^\d{6,20}$/.test(String(studentId))) throw new Error("学号格式不正确");
}

export class CalendarStore {
  constructor(directory = process.env.CALENDAR_STORE_DIR ?? "./data/calendars") {
    this.directory = path.resolve(directory);
    this.writeQueues = new Map();
  }

  fileFor(studentId) {
    assertStudentId(studentId);
    return path.join(this.directory, `${studentId}.json`);
  }

  async load(studentId) {
    try {
      const document = JSON.parse(await fs.readFile(this.fileFor(studentId), "utf8"));
      if (typeof document.ics !== "string" || !document.ics) return null;
      if (typeof document.fetchedAt !== "string") return null;
      if (Array.isArray(document.events)) return document;
      const events = parseScheduleEventsFromIcs(document.ics);
      if (events.length || Number(document.eventCount) === 0) {
        return { ...document, events };
      }
      return document;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async save(studentId, feed) {
    const file = this.fileFor(studentId);
    const previous = this.writeQueues.get(studentId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const document = {
        version: 2,
        ics: feed.ics,
        etag: feed.etag,
        lastModified: feed.lastModified,
        fetchedAt: feed.fetchedAt,
        eventCount: feed.eventCount,
        warningCount: feed.warningCount,
        events: feed.events,
      };
      const temporary = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temporary, file);
    });
    this.writeQueues.set(studentId, next);
    try {
      await next;
    } finally {
      if (this.writeQueues.get(studentId) === next) this.writeQueues.delete(studentId);
    }
  }
}
