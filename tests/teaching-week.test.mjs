import assert from "node:assert/strict";
import test from "node:test";
import { buildTeachingTerms, teachingWeekOn } from "../web/src/teaching-week.mjs";

function event(date, week, semester = "26年秋季学期") {
  return { start: `${date}T08:00:00+08:00`, teachingWeek: week, semester };
}

test("跨课程一致核验后，在空课周和周日也能确定教学周，周一切换", () => {
  const terms = buildTeachingTerms([event("2026-09-25", 1), event("2026-10-16", 4)]);
  assert.equal(teachingWeekOn(terms, new Date(2026, 9, 4)), 2);
  assert.equal(teachingWeekOn(terms, new Date(2026, 9, 5)), 3);
  assert.equal(teachingWeekOn(terms, new Date(2026, 9, 11)), 3);
  assert.equal(teachingWeekOn(terms, new Date(2026, 9, 12)), 4);
});

test("旧快照、矛盾周起点和超出已知范围时不猜测教学周", () => {
  assert.deepEqual(buildTeachingTerms([{ start: "2026-09-25T08:00:00+08:00", semester: "26年秋季学期" }]), []);
  const conflict = buildTeachingTerms([event("2026-09-25", 1), event("2026-10-16", 3)]);
  assert.equal(teachingWeekOn(conflict, new Date(2026, 9, 11)), null);
  const terms = buildTeachingTerms([event("2026-09-25", 1), event("2026-10-16", 4)]);
  assert.equal(teachingWeekOn(terms, new Date(2026, 8, 20)), null);
  assert.equal(teachingWeekOn(terms, new Date(2026, 9, 19)), null);
});

test("只在后半学期开始上课也能确定前面的周次，跨年不中断", () => {
  const terms = buildTeachingTerms([event("2025-04-29", 10, "25年春季学期")]);
  assert.equal(teachingWeekOn(terms, new Date(2025, 1, 24)), 1);
  const crossYear = buildTeachingTerms([event("2026-12-25", 1), event("2027-01-08", 3)]);
  assert.equal(teachingWeekOn(crossYear, new Date(2027, 0, 3)), 2);
  assert.equal(teachingWeekOn(crossYear, new Date(2027, 0, 4)), 3);
});
