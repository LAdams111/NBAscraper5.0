/** Parse height strings like "6-9" or "6'9" into centimeters. */
export function heightToCm(height: string | null | undefined): number | null {
  if (!height?.trim()) return null;

  const normalized = height.trim().replace(/['"]/g, "-");
  const match = /^(\d+)\s*[-]\s*(\d+(?:\.\d+)?)$/.exec(normalized);
  if (!match) return null;

  const feet = Number(match[1]);
  const inches = Number(match[2]);
  if (Number.isNaN(feet) || Number.isNaN(inches)) return null;

  const totalInches = feet * 12 + inches;
  return Math.round(totalInches * 2.54);
}

/** Parse weight in pounds (balldontlie default) to kilograms. */
export function weightToKg(weight: string | null | undefined): number | null {
  if (!weight?.trim()) return null;

  const pounds = Number.parseFloat(weight.trim());
  if (Number.isNaN(pounds)) return null;

  return Math.round(pounds * 0.453592);
}

/** Normalize position to a short label when possible. */
export function normalizePosition(position: string | null | undefined): string | null {
  if (!position?.trim()) return null;
  const p = position.trim().toUpperCase();
  if (p.length <= 3) return p;
  if (p.includes("-")) return p.split("-")[0] ?? p;
  return p;
}
