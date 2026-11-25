export const FEATURES = ["extract", "formats", "player", "jobs", "auth", "billing", "history"] as const;
export type DevFeature = (typeof FEATURES)[number];
