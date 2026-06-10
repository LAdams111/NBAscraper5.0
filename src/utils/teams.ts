/** Match Hoop Central nameToSlug convention. */
export function nameToSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Known abbreviation overrides (balldontlie → Hoop Central seed conventions). */
const ABBREVIATION_ALIASES: Record<string, string> = {
  GS: "GSW",
  NY: "NYK",
  SA: "SAS",
  NO: "NOP",
  PHO: "PHX",
};

/** Historical / relocated teams not in current NBA list. */
const HISTORICAL_TEAMS: Record<
  string,
  { slug: string; name: string; abbreviation: string }
> = {
  "Seattle SuperSonics": {
    slug: "seattle-supersonics",
    name: "Seattle SuperSonics",
    abbreviation: "SEA",
  },
  "New Jersey Nets": {
    slug: "new-jersey-nets",
    name: "New Jersey Nets",
    abbreviation: "NJN",
  },
  "Charlotte Bobcats": {
    slug: "charlotte-bobcats",
    name: "Charlotte Bobcats",
    abbreviation: "CHA",
  },
  "New Orleans Hornets": {
    slug: "new-orleans-hornets",
    name: "New Orleans Hornets",
    abbreviation: "NOH",
  },
};

export interface ResolvedTeam {
  slug: string;
  name: string;
  abbreviation: string;
}

export function resolveTeam(fullName: string, abbreviation: string): ResolvedTeam {
  const historical = HISTORICAL_TEAMS[fullName];
  if (historical) return historical;

  const abbrev = ABBREVIATION_ALIASES[abbreviation] ?? abbreviation;

  return {
    slug: nameToSlug(fullName),
    name: fullName,
    abbreviation: abbrev,
  };
}
