import fs from "node:fs/promises";
import path from "node:path";

function logDirectory() {
  if (process.env.LOG_DIR) return path.resolve(process.env.LOG_DIR);
  const calendarDirectory = process.env.CALENDAR_STORE_DIR ?? "./data/calendars";
  return path.join(path.dirname(path.resolve(calendarDirectory)), "logs");
}

function retentionDays() {
  const value = Number(process.env.LOG_RETENTION_DAYS ?? 180);
  return Number.isInteger(value) && value > 0 ? value : 180;
}

function datePart(date) {
  return date.toISOString().slice(0, 10);
}

export class EventLog {
  constructor(directory = logDirectory(), days = retentionDays()) {
    this.directory = directory;
    this.days = days;
    this.queue = Promise.resolve();
    this.lastPrunedAt = 0;
  }

  write(event, fields = {}) {
    const document = {
      timestamp: new Date().toISOString(),
      event,
      ...fields,
    };
    const line = `${JSON.stringify(document)}\n`;
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
        const file = path.join(this.directory, `events-${datePart(new Date())}.jsonl`);
        await fs.appendFile(file, line, { encoding: "utf8", mode: 0o600 });
        await fs.chmod(file, 0o600);
        if (Date.now() - this.lastPrunedAt >= 24 * 60 * 60 * 1000) {
          this.lastPrunedAt = Date.now();
          await this.prune();
        }
      })
      .catch((error) => {
        console.error(JSON.stringify({ event: "event_log_write_failed", error: error.name }));
      });
    return this.queue;
  }

  async prune() {
    let entries;
    try {
      entries = await fs.readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const cutoff = Date.now() - this.days * 24 * 60 * 60 * 1000;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(/^events-(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (!match) continue;
      const timestamp = Date.parse(`${match[1]}T00:00:00Z`);
      if (Number.isFinite(timestamp) && timestamp < cutoff) {
        await fs.unlink(path.join(this.directory, entry.name));
      }
    }
  }
}
