import assert from "node:assert/strict";
import test from "node:test";
import { expandCourses, parseSchedulePatterns, renderCalendar, toScheduleEvents } from "../lib/calendar.mjs";
import { parseScheduleEventsFromIcs } from "../lib/calendar-store.mjs";

const schedule = "1-3单周 星期五[1-4节];3周 星期六[1-4节];4-5周 星期五[9-12节];6-8周 星期五[9-12节]";
const periodsBySemester = new Map([["20261", new Map([
  ["1", { start: "0800", end: "0845" }],
  ["2", { start: "0855", end: "0940" }],
  ["4", { start: "1050", end: "1135" }],
  ["6", { start: "1330", end: "1415" }],
  ["9", { start: "1620", end: "1705" }],
  ["10", { start: "1830", end: "1915" }],
  ["11", { start: "1925", end: "2010" }],
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
  assert.deepEqual(jsonEvents.map((event) => event.teachingWeek), [1, 3, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(icsEvents.map((event) => event.teachingWeek), jsonEvents.map((event) => event.teachingWeek));
});

test("从最早安排选锚点，恢复周四段在前的12次课程，段落重排不改变日程", () => {
  const source = "1-6周 星期四[1-4节];1周 星期一[6-9节];2-3,5-6周 星期一[6-9节];4周 星期六[6-9节]";
  const data = calendarData({ PKSJ: source, SCSKRQ: "2024-09-16" });
  const { events, warnings } = expandCourses(data);
  assert.deepEqual(warnings, []);
  assert.equal(events.length, 12);
  assert.deepEqual(events.map((event) => event.date), [
    "20240916", "20240919", "20240923", "20240926", "20240930", "20241003",
    "20241010", "20241012", "20241014", "20241017", "20241021", "20241024",
  ]);
  const rearranged = expandCourses(calendarData({ PKSJ: source.split(";").reverse().join(";"), SCSKRQ: "2024-09-16" }));
  assert.deepEqual(rearranged.events, events);
});

test("首课在第10周且周五段在前时，恢复16次课程与教学周", () => {
  const { events, warnings } = expandCourses(calendarData({
    PKSJ: "10-17周 星期五[1-4节];10-13,15-17周 星期二[1-2节];14周 星期二[10-11节]",
    SCSKRQ: "2025-04-29",
  }));
  assert.deepEqual(warnings, []);
  assert.equal(events.length, 16);
  assert.equal(events[0].date, "20250429");
  assert.equal(events[0].teachingWeek, 10);
  assert.equal(events.at(-1).date, "20250620");
  assert.equal(events.at(-1).teachingWeek, 17);
  assert.equal(events.find((event) => event.date === "20250527").start, "1830");
});

test("未排课课程正常略过，只有不完整的排课信息才产生警告", () => {
  assert.deepEqual(expandCourses(calendarData({ PKSJ: null, SCSKRQ: null })), { events: [], warnings: [] });
  assert.equal(expandCourses(calendarData({ SCSKRQ: null })).warnings.length, 1);
});

test("未知段和无效范围不会被部分匹配后悄悄丢弃", () => {
  for (const source of [
    "1-8周 星期五[1-4节];未知排课格式",
    "未知前缀1-8周 星期五[1-4节]",
    "8-1周 星期五[1-4节]",
    "1-8周 星期五[1,x节]",
  ]) {
    assert.throws(() => parseSchedulePatterns(source));
    const result = expandCourses(calendarData({ PKSJ: source }));
    assert.equal(result.events.length, 0);
    assert.equal(result.warnings.length, 1);
  }
});

test("旧ICS快照未带教学周时仍可正常读取", () => {
  const rendered = renderCalendar(calendarData());
  const events = parseScheduleEventsFromIcs(rendered.ics.replace(/^X-ZJUT-TEACHING-WEEK:.*\r\n/gm, ""));
  assert.equal(events.length, 8);
  assert.ok(events.every((event) => event.teachingWeek === undefined));
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
