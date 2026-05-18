# Calibration Report — Benchmark Properties

Our measurement pipeline (Google Solar API → Claude vision fallback → heuristics) run against the 5 example properties from `benchmark-measurements.md`. Reference A and Reference B are the trusted commercial measurements provided by the hackathon.

| Property | Predicted sqft | Pitch | Ref A | Ref B | Err vs avg | Sources | Confidence |
|---|---:|---:|---:|---:|---:|---|---|
| 21106 Kenswick Meadows Ct | 2,389 | 7:12 | 2,443 | 2,343 | -0.2% | google_geocoding, google_solar_api, claude_vision | low |
| 5914 Copper Lilly Lane | 4,369 | 10:12 | 4,391 | 4,296 | +0.6% | google_geocoding, google_solar_api, claude_vision | medium |
| 122 NW 13th Ave | 2,924 | 6:12 | 2,917 | 2,851 | +1.4% | google_geocoding, google_solar_api, claude_vision | low |
| 14132 Trenton Ave | 3,170 | 4:12 | 2,990 | 2,935 | +7.0% | google_geocoding, google_solar_api, claude_vision | medium |
| 835 S Cobble Creek | 3,070 | 8:12 | 3,070 | 3,017 | +0.9% | google_geocoding, google_solar_api, claude_vision | high |

**Aggregate accuracy:** median absolute error 0.9%, worst-case 7.0%.

## Predicted quote (Better tier) for each benchmark

| Property | Predicted Better-tier total |
|---|---:|
| 21106 Kenswick Meadows Ct | $20,197 |
| 5914 Copper Lilly Lane | $35,012 |
| 122 NW 13th Ave | $25,836 |
| 14132 Trenton Ave | $32,763 |
| 835 S Cobble Creek | $21,846 |

## Notes per property

- **21106 Kenswick Meadows Ct**: Vision polygon implausible (6557 sqft); using gut estimate 2750 sqft instead. | Source disagreement (67% agreement). Sources: google_solar=2389, claude_vision=3185. | Penetrations dropped to 0 due to low confidence: plumbing_vents, exhaust_vents, box_vents.
- **5914 Copper Lilly Lane**: Penetrations dropped to 0 due to low confidence: exhaust_vents, box_vents.
- **122 NW 13th Ave**: Vision polygon implausible (4778 sqft); using gut estimate 1975 sqft instead. | Source disagreement (68% agreement). Sources: google_solar=2924, claude_vision=2208. | Penetrations dropped to 0 due to low confidence: plumbing_vents, exhaust_vents, box_vents.
- **14132 Trenton Ave**: Vision polygon implausible (6346 sqft); using gut estimate 2400 sqft instead. | Penetrations dropped to 0 due to low confidence: plumbing_vents, exhaust_vents.
- **835 S Cobble Creek**: Vision polygon implausible (6775 sqft); using gut estimate 2550 sqft instead. | Penetrations dropped to 0 due to low confidence: plumbing_vents, exhaust_vents, box_vents.
