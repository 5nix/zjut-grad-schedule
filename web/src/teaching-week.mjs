const DAY_MS = 24 * 60 * 60 * 1000;

export function buildTeachingTerms(events) {
  const terms = new Map();
  for (const event of events) {
    if (!Number.isInteger(event.teachingWeek) || event.teachingWeek < 1 || !event.semester) continue;
    const match = String(event.start).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) continue;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    const start = date.getTime() - (mondayOffset + (event.teachingWeek - 1) * 7) * DAY_MS;
    const term = terms.get(event.semester) ?? { starts: new Set(), lastWeek: 0 };
    term.starts.add(start);
    term.lastWeek = Math.max(term.lastWeek, event.teachingWeek);
    terms.set(event.semester, term);
  }
  return [...terms.values()]
    .filter((term) => term.starts.size === 1)
    .map((term) => ({ start: [...term.starts][0], lastWeek: term.lastWeek }));
}

export function teachingWeekOn(terms, date) {
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const matches = terms.map((term) => ({
    week: Math.floor((day - term.start) / (7 * DAY_MS)) + 1,
    lastWeek: term.lastWeek,
  })).filter(({ week, lastWeek }) => week >= 1 && week <= lastWeek);
  return matches.length === 1 ? matches[0].week : null;
}
