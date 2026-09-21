import fs from "node:fs/promises";
import path from "node:path";

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
