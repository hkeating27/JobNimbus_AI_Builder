// Reference measurements for the 5 example properties from benchmark-measurements.md.
// Used by the calibration harness to score our pipeline.

export type RefLineItems = {
  ridge_lf?: number;
  hip_lf?: number;
  ridge_or_hip_lf?: number; // some references combine these
  valley_lf: number;
  rake_lf: number;
  eave_lf: number;
};

export type BenchmarkRef = {
  name: string;
  total_sqft: number;
  pitch_label: string;
  line_items?: RefLineItems;
};

export type BenchmarkProperty = {
  address: string;
  references: BenchmarkRef[];
};

export const BENCHMARK_PROPERTIES: BenchmarkProperty[] = [
  {
    address: "21106 Kenswick Meadows Ct, Humble, TX 77338",
    references: [
      { name: "Reference A", total_sqft: 2443, pitch_label: "6:12", line_items: { ridge_or_hip_lf: 141, valley_lf: 40, rake_lf: 101, eave_lf: 187 } },
      { name: "Reference B", total_sqft: 2343, pitch_label: "6:12", line_items: { ridge_lf: 26, hip_lf: 101, valley_lf: 38, rake_lf: 83, eave_lf: 90 } },
    ],
  },
  {
    address: "5914 Copper Lilly Lane, Spring, TX 77389",
    references: [
      { name: "Reference A", total_sqft: 4391, pitch_label: "8:12", line_items: { ridge_lf: 79, hip_lf: 321, valley_lf: 197, rake_lf: 121, eave_lf: 324 } },
      { name: "Reference B", total_sqft: 4296, pitch_label: "8:12", line_items: { ridge_lf: 77, hip_lf: 348, valley_lf: 195, rake_lf: 119, eave_lf: 220 } },
    ],
  },
  {
    address: "122 NW 13th Ave, Cape Coral, FL 33993",
    references: [
      { name: "Reference A", total_sqft: 2917, pitch_label: "6:12", line_items: { ridge_lf: 59, hip_lf: 83, valley_lf: 22, rake_lf: 51, eave_lf: 201 } },
      { name: "Reference B", total_sqft: 2851, pitch_label: "6:12", line_items: { ridge_lf: 59, hip_lf: 81, valley_lf: 21, rake_lf: 49, eave_lf: 148 } },
    ],
  },
  {
    address: "14132 Trenton Ave, Orland Park, IL 60462",
    references: [
      { name: "Reference A", total_sqft: 2990, pitch_label: "4:12", line_items: { ridge_or_hip_lf: 241, valley_lf: 78, rake_lf: 0, eave_lf: 255 } },
      { name: "Reference B", total_sqft: 2935, pitch_label: "4:12", line_items: { ridge_lf: 48, hip_lf: 187, valley_lf: 78, rake_lf: 0, eave_lf: 251 } },
    ],
  },
  {
    address: "835 S Cobble Creek, Nixa, MO 65714",
    references: [
      { name: "Reference A", total_sqft: 3070, pitch_label: "8:12", line_items: { ridge_or_hip_lf: 232, valley_lf: 113, rake_lf: 50, eave_lf: 211 } },
      { name: "Reference B", total_sqft: 3017, pitch_label: "8:12", line_items: { ridge_lf: 79, hip_lf: 150, valley_lf: 111, rake_lf: 48, eave_lf: 208 } },
    ],
  },
];

export const TEST_PROPERTIES: string[] = [
  "3561 E 102nd Ct, Thornton, CO 80229",
  "1612 S Canton Ave, Springfield, MO 65802",
  "6310 Laguna Bay Court, Houston, TX 77041",
  "3820 E Rosebrier St, Springfield, MO 65809",
  "1261 20th Street, Newport News, VA 23607",
];
