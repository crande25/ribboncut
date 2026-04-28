export const SE_MICHIGAN_CITIES = [
  "Detroit, MI",
  "Ann Arbor, MI",
  "Novi, MI",
  "Troy, MI",
  "Royal Oak, MI",
  "Birmingham, MI",
  "Dearborn, MI",
  "Livonia, MI",
  "Canton, MI",
  "Plymouth, MI",
  "Farmington Hills, MI",
  "Southfield, MI",
  "Rochester Hills, MI",
  "West Bloomfield, MI",
  "Ferndale, MI",
  "Ypsilanti, MI",
  "Northville, MI",
  "Bloomfield Hills, MI",
  "Monroe, MI",
  "Port Huron, MI",
] as const;

export type SEMichiganCity = (typeof SE_MICHIGAN_CITIES)[number];
