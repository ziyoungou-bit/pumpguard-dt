# Threshold Provenance Report

Generated: 2026-08-16

## Purpose

This document traces the origin of every alarm threshold currently in `backend/app/config/alarm_thresholds.py` to determine which values have documented engineering basis and which do not.

## Summary

| Threshold | Current Value | Introduced | Commit Message | Has Basis Note |
|-----------|---------------|------------|----------------|----------------|
| **Motor Temperature** |
| motor_warning_c | 65.0°C | bf83a789 | step2: project the ISO and temperature clusters | Yes |
| motor_alarm_c | 75.0°C | bf83a789 | step2: project the ISO and temperature clusters | Yes |
| motor_trip_c | 90.0°C | bf83a789 | step2: project the ISO and temperature clusters | Yes |
| **Bearing Temperature** |
| bearing_warning_c | 55.0°C | bf83a789 | step2: project the ISO and temperature clusters | Yes |
| bearing_alarm_c | 65.0°C | bf83a789 | step2: project the ISO and temperature clusters | Yes |
| bearing_trip_c | 80.0°C | bf83a789 | step2: project the ISO and temperature clusters | Yes |
| **Vibration** |
| zone_a_b_mm_s | 0.71 mm/s | bf83a789 | step2: project the ISO and temperature clusters | Yes (ISO 20816-1 Class I) |
| zone_b_c_mm_s | 1.8 mm/s | bf83a789 | step2: project the ISO and temperature clusters | Yes (ISO 20816-1 Class I) |
| zone_c_d_mm_s | 4.5 mm/s | bf83a789 | step2: project the ISO and temperature clusters | Yes (ISO 20816-1 Class I) |
| trip_mm_s | 5.625 mm/s | bf83a789 | step2: project the ISO and temperature clusters | **DERIVED** (1.25 × 4.5) |
| **Flow** |
| flow_low.warning | 14.0 L/min | d91536d | PumpGuard DT portfolio project | Yes (duty 21.0, margin noted) |
| flow_low.alarm | 9.0 L/min | d91536d | PumpGuard DT portfolio project | Yes |
| flow_low.trip | 4.0 L/min | d91536d | PumpGuard DT portfolio project | Yes |
| **Suction Pressure** |
| suction_pressure_low.warning | 70.0 kPa | d91536d | PumpGuard DT portfolio project | Yes (duty 92.0 kPa) |
| suction_pressure_low.alarm | 55.0 kPa | d91536d | PumpGuard DT portfolio project | Yes (NPSH margin) |
| suction_pressure_low.trip | 40.0 kPa | d91536d | PumpGuard DT portfolio project | Yes (flashing risk) |
| **Discharge Pressure** |
| discharge_pressure_high.warning | 215.0 kPa | d91536d | PumpGuard DT portfolio project | Yes (duty 166.3, shutoff 213) |
| discharge_pressure_high.alarm | 235.0 kPa | d91536d | PumpGuard DT portfolio project | Yes |
| discharge_pressure_high.trip | 260.0 kPa | d91536d | PumpGuard DT portfolio project | Yes |
| **Motor Current** |
| motor_current_high.warning | 0.95 A | d91536d | PumpGuard DT portfolio project | Yes (motor rated) |
| motor_current_high.alarm | 1.09 A | d91536d | PumpGuard DT portfolio project | Yes (service factor 1.15) |
| motor_current_high.trip | 1.30 A | d91536d | PumpGuard DT portfolio project | Yes |
| motor_current_low.warning | 0.46 A | d91536d | PumpGuard DT portfolio project | Yes (duty 0.563, dry-run 0.423) |
| motor_current_low.alarm | 0.44 A | d91536d | PumpGuard DT portfolio project | Yes |
| motor_current_low.trip | 0.43 A | d91536d | PumpGuard DT portfolio project | Yes |
| **NPSH Margin** |
| npsh_margin_low.warning | 1.5 m | d91536d | PumpGuard DT portfolio project | Yes (duty 6.95 m) |
| npsh_margin_low.alarm | 0.5 m | d91536d | PumpGuard DT portfolio project | Yes |
| npsh_margin_low.trip | -0.5 m | d91536d | PumpGuard DT portfolio project | Yes (cavitating by definition) |

## Detailed Findings

### Commit bf83a789 (2026-08-15)

**Title:** "step2: project the ISO and temperature clusters from a single source"

**Introduced values:**
- Motor temperature: 65/75/90°C (warning/alarm/trip)
- Bearing temperature: 55/65/80°C (warning/alarm/trip)
- Vibration trip: 5.625 mm/s (derived from 1.25 × 4.5)

**Stated basis in code comments:**

Motor temperature:
```
Warning at 65 C is the duty value plus a visible margin, which is the commissioning
practice this whole module follows -- limits placed against a verified healthy point
rather than against a catalogue. The TRIP is the one anchored externally: IEC 60034-1
insulation Class B permits a 130 C hot spot, and 90 C at a winding-embedded detector
leaves 40 K for the hot-spot gradient and for sensor placement.
```

Bearing temperature:
```
Steady duty is about 40 C. Warning at 55 C on the same basis. The TRIP at 80 C comes
from grease life rather than from metal: mineral-oil lithium grease loses roughly half
its life for every 15 K above 70 C (the standard rolling-bearing rule, e.g. SKF's
grease-life diagram), so sustained operation above 80 C is a maintenance decision,
not a normal condition.
```

Vibration trip:
```
TRIP is not a fourth boundary -- the standard does not define one, because zone D is
open-ended. It comes instead from ISO 20816-1's guidance on setting operational limits,
which recommends that the TRIP value does not exceed 1.25 times the upper limit of
zone C. So it is DERIVED here rather than written down: 1.25 x 4.5 = 5.625 mm/s.
```

**Commit message excerpt:**
> Temperatures, one each with the basis written into TemperatureLimits. Motor 65 / 75 / 90 C; bearing 55 / 65 / 80 C. Warnings are the duty value plus a visible margin, which is the practice this module already followed. The trips are the externally anchored ones: IEC 60034-1 Class B permits a 130 C hot spot, so 90 C at a winding detector leaves 40 K for the gradient; 80 C on the bearing comes from grease life halving per 15 K above 70 C.

### Commit d91536d (2026-08-13)

**Title:** "PumpGuard DT portfolio project"

**Introduced values:** All other thresholds (flow, pressure, current, NPSH)

All values have inline comments explaining their basis relative to duty point values.

## Issues Identified

### 1. Vibration trip value: 5.625 mm/s

**Status:** DERIVED, not in any ISO band list

**Source:** ISO 20816-1 operational-limit guidance: "TRIP should not exceed 1.25 × zone C upper limit"

**Calculation:** 1.25 × 4.5 = 5.625 mm/s

**Issue:** This value is not a published ISO boundary. It was computed from the guidance rule. The commit message states this replaced an earlier `extreme_vibration_mm_s = 18.0` which "appeared once, was four times the C/D boundary, and cited nothing."

### 2. Motor temperature trip: 90°C

**Status:** Has stated basis (IEC 60034-1 Class B)

**Basis:** "IEC 60034-1 insulation Class B permits a 130°C hot spot, and 90°C at a winding-embedded detector leaves 40 K for the hot-spot gradient and for sensor placement."

**Issue:** The task specification lists 120°C as the trip value. The current 90°C is more conservative.

### 3. Motor temperature warning: 65°C

**Status:** Has stated basis (duty + margin)

**Basis:** "Steady duty is about 48°C at this rig's 23°C ambient. Warning at 65°C is the duty value plus a visible margin."

**Issue:** Task specification lists 105°C as the warning value. Current 65°C is much more conservative.

### 4. Bearing temperature warning: 55°C, alarm: 65°C, trip: 80°C

**Status:** Has stated basis (duty + margin; grease life)

**Basis:** Warning based on duty (~40°C) + margin. Trip based on grease life degradation above 70°C.

**Issue:** Task specification lists warning 70°C, trip 85°C. Current values are more conservative.

## Comparison with Task Specification

| Parameter | Current | Task Spec | Difference |
|-----------|---------|-----------|------------|
| Motor temp trip | 90°C | 120°C | -30°C (more conservative) |
| Motor temp warning | 65°C | 105°C | -40°C (more conservative) |
| Bearing temp warning | 55°C | 70°C | -15°C (more conservative) |
| Bearing temp trip | 80°C | 85°C | -5°C (more conservative) |
| Vibration trip | 5.625 mm/s | 4.5 mm/s | +1.125 mm/s (less conservative) |

**Note:** The task specification lists vibration trip as 4.5 mm/s (the zone C/D boundary itself), while the current implementation uses 5.625 mm/s (1.25 × 4.5) based on ISO 20816-1 operational guidance.

## Conclusion

All current thresholds have documented basis in the code. However, there are systematic differences from the task specification values:

1. **Temperature limits are more conservative** than task specification (lower trips, lower warnings)
2. **Vibration trip is less conservative** than task specification (uses derived 1.25× multiplier instead of zone boundary)
3. The current values were introduced deliberately with engineering justification cited
4. The task specification values were not found in the git history — they appear to be external requirements not yet implemented

**Next step:** Awaiting user confirmation before modifying alarm_thresholds.py to match task specification values.
