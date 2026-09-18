const canonicalLineAliases: Record<string, string> = {
  EW: "EWL",
  EWL: "EWL",
  EASTWEST: "EWL",
  EASTWESTLINE: "EWL",
  NS: "NSL",
  NSL: "NSL",
  NORTHSOUTH: "NSL",
  NORTHSOUTHLINE: "NSL",
  NE: "NEL",
  NEL: "NEL",
  NORTHEAST: "NEL",
  NORTHEASTLINE: "NEL",
  CC: "CCL",
  CCL: "CCL",
  CIRCLE: "CCL",
  CIRCLELINE: "CCL",
  DT: "DTL",
  DTL: "DTL",
  DOWNTOWN: "DTL",
  DOWNTOWNLINE: "DTL",
  TE: "TEL",
  TEL: "TEL",
  THOMSONEASTCOAST: "TEL",
  THOMSONEASTCOASTLINE: "TEL",
  BP: "BPLRT",
  BPLRT: "BPLRT",
  SK: "SKLRT",
  SKLRT: "SKLRT",
  PG: "PGLRT",
  PGLRT: "PGLRT",
};

const identifierKey = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export function canonicalLineId(value: string): string {
  const key = identifierKey(value);
  return canonicalLineAliases[key] ?? key;
}

export function canonicalStationCodes(values: readonly string[]): string[] {
  return [
    ...new Set(
      values
        .flatMap((value) => value.toUpperCase().split(/[\/,;]+/))
        .map(identifierKey)
        .filter(Boolean),
    ),
  ];
}
