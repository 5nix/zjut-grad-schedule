import assert from "node:assert/strict";
import test from "node:test";
import { expandCourses, parseSchedulePatterns, renderCalendar, toScheduleEvents } from "../lib/calendar.mjs";
import { parseScheduleEventsFromIcs } from "../lib/calendar-store.mjs";

const schedule = "1-3单周 星期五[1-4节];3周 星期六[1-4节];4-5周 星期五[9-12节];6-8周 星期五[9-12节]";
const periodsBySemester = new Map([["20261", new Map([
  ["1", { start: "0800", end: "0845" }],
  ["4", { start: "1050", end: "1135" }],
  ["9", { start: "1620", end: "1705" }],
  ["12", { start: "2020", end: "2105" }],
])]]);

function calendarData(overrides = {}) {
  return {
    studentId: "test-student",
    periodsBySemester,
    courses: [{
      semesterCode: "20261",
      semesterDisplay: "26年秋季学期",
      row: { KCMC: "单双周测试课程", PKSJ: schedule, SCSKRQ: "2026-09-25", ...overrides },
    }],
  };
}

test("识别单周首段并保留后续的周六和周五安排", () => {
  assert.deepEqual(parseSchedulePatterns(schedule), [
    { weeks: [1, 3], sections: [1, 2, 3, 4], weekday: 5 },
    { weeks: [3], sections: [1, 2, 3, 4], weekday: 6 },
    { weeks: [4, 5], sections: [9, 10, 11, 12], weekday: 5 },
    { weeks: [6, 7, 8], sections: [9, 10, 11, 12], weekday: 5 },
  ]);
});

test("单双周过滤与普通周次兼容", () => {
  assert.deepEqual(parseSchedulePatterns("1-8双周 星期五[1-4节]")[0].weeks, [2, 4, 6, 8]);
  assert.deepEqual(parseSchedulePatterns("2-7单周 星期五[1-4节]")[0].weeks, [3, 5, 7]);
  assert.deepEqual(parseSchedulePatterns("1,3-5周 星期五[1-4节]")[0].weeks, [1, 3, 4, 5]);
});

test("完整恢复8次安排及正确日期、时间和课次，JSON与ICS一致", () => {
  const rendered = renderCalendar(calendarData());
  assert.deepEqual(rendered.warnings, []);
  assert.equal(rendered.eventCount, 8);
  assert.deepEqual(rendered.events.map(({ date, start, end }) => [date, start, end]), [
    ["20260925", "0800", "1135"],
    ["20261009", "0800", "1135"],
    ["20261010", "0800", "1135"],
    ["20261016", "1620", "2105"],
    ["20261023", "1620", "2105"],
    ["20261030", "1620", "2105"],
    ["20261106", "1620", "2105"],
    ["20261113", "1620", "2105"],
  ]);
  assert.deepEqual(rendered.events.map((event) => event.lessonText),
    Array.from({ length: 8 }, (_, index) => `第${index + 1}/8节`));
  const jsonEvents = toScheduleEvents(rendered.events);
  const icsEvents = parseScheduleEventsFromIcs(rendered.ics);
  assert.deepEqual(icsEvents.map(({ start, end }) => [start, end]),
    jsonEvents.map(({ start, end }) => [start, end]));
});

test("首次日期确实不匹配时仍跳过，并记录足够的诊断字段", () => {
  const { events, warnings } = expandCourses(calendarData({ SCSKRQ: "2026-09-24" }));
  assert.equal(events.length, 0);
  assert.deepEqual(warnings, [{
    course: "单双周测试课程",
    semester: "20261",
    schedule,
    firstDate: "2026-09-24",
    message: "首次上课日期与排课星期不一致，已跳过该课程",
  }]);
});
