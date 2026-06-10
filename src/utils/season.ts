/** Convert balldontlie season year to Hoop Central label (2024 → 2024-25). */
export function bdlSeasonToLabel(seasonYear: number): string {
  const next = (seasonYear + 1) % 100;
  return `${seasonYear}-${String(next).padStart(2, "0")}`;
}

/** Parse CLI season flag: "2024-25" or "2024" → balldontlie year + label. */
export function parseSeasonArg(value: string): { label: string; bdlYear: number } {
  const trimmed = value.trim();

  const hyphenMatch = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (hyphenMatch) {
    const startYear = Number(hyphenMatch[1]);
    return { label: trimmed, bdlYear: startYear };
  }

  const yearOnly = /^(\d{4})$/.exec(trimmed);
  if (yearOnly) {
    const bdlYear = Number(yearOnly[1]);
    return { label: bdlSeasonToLabel(bdlYear), bdlYear };
  }

  throw new Error(
    `Invalid season "${value}". Use "2024-25" or "2024" (balldontlie start year).`,
  );
}

/** Inclusive season years from draft year through current balldontlie season. */
export function careerSeasonYears(
  draftYear: number | null | undefined,
  throughBdlYear: number,
): number[] {
  const start = draftYear && draftYear > 1946 ? draftYear : 1946;
  const years: number[] = [];
  for (let y = start; y <= throughBdlYear; y += 1) {
    years.push(y);
  }
  return years;
}

export function currentBdlSeasonYear(now = new Date()): number {
  // NBA season starts in October; before October belongs to prior season start year.
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  return month >= 10 ? year : year - 1;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
