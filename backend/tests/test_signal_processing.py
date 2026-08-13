"""Verification of the vibration signal chain.

These tests are the point of the module, not a formality. Three things are
being proved:

1. The DSP is arithmetically correct. A sine of known frequency and amplitude
   must come back out of the FFT at that frequency and that amplitude. This is
   the test that catches the classic factor-of-two normalisation errors, which
   otherwise produce a chart that looks entirely plausible and is wrong by 6 dB.
2. The fault signatures behave the way the physics says they should, and behave
   that way *monotonically* in severity. A classifier trained on a signature
   that is not monotonic in severity learns noise.
3. The bearing kinematics match hand calculation.

Every random draw is seeded. A severity sweep whose result changes run to run
is not evidence of anything.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from app.config.pump_parameters import BEARING, PUMP
from app.contracts import FEATURE_ORDER, FaultType, Telemetry
from app.signal_processing import (
    HIGH_FREQUENCY_CUTOFF_HZ,
    SAMPLING,
    compute_spectrum,
    crest_factor,
    defect_frequencies,
    defect_frequencies_from_geometry,
    extract_features,
    peak,
    peak_to_peak,
    rms,
    synthesise,
)
from app.signal_processing.bearing import CALCULATION_BASIS

RATED_RPM = PUMP.rated_speed_rpm  # 1450
ROTATIONAL_HZ = RATED_RPM / 60.0  # 24.1667 Hz
SEED = 20240517
SEVERITIES = (0.0, 0.25, 0.5, 0.75, 1.0)


def _sine(frequency_hz: float, amplitude: float) -> np.ndarray:
    t = SAMPLING.time_vector()
    return amplitude * np.sin(2.0 * np.pi * frequency_hz * t + 0.37)


def _features_at(fault: FaultType, severity: float):
    """One feature set, seeded identically for every severity in a sweep."""
    return extract_features(synthesise(RATED_RPM, fault, severity, seed=SEED))


# ==========================================================================
# 1. FFT frequency and amplitude accuracy
# ==========================================================================


def test_sampling_configuration_is_the_documented_one():
    assert SAMPLING.sampling_rate_hz == 5120.0
    assert SAMPLING.block_size == 4096
    assert SAMPLING.nyquist_hz == 2560.0
    assert SAMPLING.frequency_resolution_hz == pytest.approx(1.25)
    assert SAMPLING.duration_s == pytest.approx(0.8)


def test_fft_recovers_frequency_of_a_known_sine_within_one_bin():
    spectrum = compute_spectrum(_sine(ROTATIONAL_HZ, 1.0), SAMPLING.sampling_rate_hz)
    assert abs(spectrum.dominant_frequency() - ROTATIONAL_HZ) <= spectrum.resolution_hz


def test_fft_recovers_amplitude_of_an_off_bin_sine_within_two_percent():
    """24.167 Hz falls between bins (19.33 bins at 1.25 Hz resolution).

    Reading the tallest bin alone would under-read by up to 15 % from Hann
    scalloping; the mainlobe power sum in `amplitude_at` removes that.
    """
    amplitude = 1.0
    spectrum = compute_spectrum(_sine(ROTATIONAL_HZ, amplitude), SAMPLING.sampling_rate_hz)
    measured = spectrum.amplitude_at(ROTATIONAL_HZ, tolerance_hz=3.0)
    assert measured == pytest.approx(amplitude, rel=0.02)


def test_spectrum_bin_scaling_is_neither_halved_nor_doubled():
    """A 1.0 mm/s sine placed exactly on a bin must read 1.0 mm/s, not 0.5 or 2.0.

    25.0 Hz is 20 whole cycles in the 0.8 s block, so it lands on bin 20 with
    no leakage and the raw bin height is the amplitude directly. This isolates
    the coherent-gain normalisation from the mainlobe-summing logic.
    """
    on_bin_hz = 25.0
    assert (on_bin_hz / SAMPLING.frequency_resolution_hz) == pytest.approx(20.0)

    spectrum = compute_spectrum(_sine(on_bin_hz, 1.0), SAMPLING.sampling_rate_hz)
    tallest_bin = float(np.max(spectrum.amplitudes_mm_s))
    assert tallest_bin == pytest.approx(1.0, rel=0.01)
    assert spectrum.amplitude_at(on_bin_hz) == pytest.approx(1.0, rel=0.01)


def test_amplitude_scales_linearly_with_signal_amplitude():
    for amplitude in (0.5, 1.0, 4.0, 12.5):
        spectrum = compute_spectrum(_sine(ROTATIONAL_HZ, amplitude), SAMPLING.sampling_rate_hz)
        assert spectrum.amplitude_at(ROTATIONAL_HZ, 3.0) == pytest.approx(amplitude, rel=0.02)


def test_hann_equivalent_noise_bandwidth_is_one_and_a_half_bins():
    spectrum = compute_spectrum(_sine(ROTATIONAL_HZ, 1.0), SAMPLING.sampling_rate_hz)
    assert spectrum.enbw_bins == pytest.approx(1.5, rel=0.01)


def test_band_energy_of_a_pure_sine_is_its_rms():
    spectrum = compute_spectrum(_sine(400.0, 2.0), SAMPLING.sampling_rate_hz)
    assert spectrum.band_energy(380.0, 420.0) == pytest.approx(2.0 / math.sqrt(2.0), rel=0.02)


def test_band_energy_of_band_limited_noise_recovers_its_standard_deviation():
    """Random content must be measured on the same footing as a discrete tone."""
    rng = np.random.default_rng(SEED)
    sigma = 0.75
    noise = rng.normal(0.0, sigma, SAMPLING.block_size)
    spectrum = compute_spectrum(noise, SAMPLING.sampling_rate_hz)
    assert spectrum.band_energy(0.0, spectrum.nyquist_hz) == pytest.approx(sigma, rel=0.05)


# ==========================================================================
# 2. Time-domain statistics
# ==========================================================================


def test_rms_of_pure_sine_is_amplitude_over_root_two():
    for amplitude in (1.0, 3.5, 10.0):
        assert rms(_sine(25.0, amplitude)) == pytest.approx(amplitude / math.sqrt(2.0), rel=0.01)


def test_crest_factor_of_pure_sine_is_root_two():
    assert crest_factor(_sine(25.0, 4.0)) == pytest.approx(math.sqrt(2.0), rel=0.02)


def test_peak_and_peak_to_peak_of_pure_sine():
    samples = _sine(25.0, 3.0)
    assert peak(samples) == pytest.approx(3.0, rel=0.01)
    assert peak_to_peak(samples) == pytest.approx(6.0, rel=0.01)


def test_crest_factor_of_gaussian_noise_is_near_three():
    """Sanity anchor: a sine is 1.41, broadband noise sits around 3-4."""
    rng = np.random.default_rng(SEED)
    noise = rng.normal(0.0, 1.0, SAMPLING.block_size)
    assert 3.0 < crest_factor(noise) < 5.0


def test_degenerate_channels_do_not_divide_by_zero():
    assert crest_factor(np.zeros(64)) == 0.0
    assert rms(np.array([])) == 0.0


# ==========================================================================
# 3. Waveform synthesis: structure
# ==========================================================================


def test_waveform_has_three_axes_of_the_configured_length():
    waveform = synthesise(RATED_RPM, FaultType.NORMAL, 0.0, seed=SEED)
    for axis in waveform.axes:
        assert isinstance(axis, np.ndarray)
        assert axis.size == SAMPLING.block_size
    assert waveform.rotational_frequency_hz == pytest.approx(24.1667, abs=1e-3)
    assert waveform.blade_pass_frequency_hz == pytest.approx(PUMP.impeller_vanes * ROTATIONAL_HZ)
    assert waveform.blade_pass_frequency_hz == pytest.approx(145.0, abs=0.1)


def test_synthesis_is_deterministic_for_a_fixed_seed():
    first = synthesise(RATED_RPM, FaultType.IMBALANCE, 0.6, seed=SEED)
    second = synthesise(RATED_RPM, FaultType.IMBALANCE, 0.6, seed=SEED)
    assert np.array_equal(first.x, second.x)
    assert np.array_equal(first.z, second.z)


def test_axes_are_not_copies_of_each_other():
    waveform = synthesise(RATED_RPM, FaultType.NORMAL, 0.0, seed=SEED)
    assert not np.allclose(waveform.x, waveform.y)
    assert not np.allclose(waveform.x, waveform.z)


def test_every_fault_at_zero_severity_equals_the_healthy_baseline():
    """Severity must be a smooth dial from healthy, with no step at the label."""
    baseline = synthesise(RATED_RPM, FaultType.NORMAL, 0.0, seed=SEED)
    for fault in FaultType:
        waveform = synthesise(RATED_RPM, fault, 0.0, seed=SEED)
        assert np.allclose(waveform.x, baseline.x), fault.value
        assert np.allclose(waveform.z, baseline.z), fault.value


def test_healthy_baseline_contains_the_expected_physical_components():
    features = _features_at(FaultType.NORMAL, 0.0)
    spectrum = compute_spectrum(
        synthesise(RATED_RPM, FaultType.NORMAL, 0.0, seed=SEED).x, SAMPLING.sampling_rate_hz
    )
    # 1x present and dominant, vane pass present, and an overall in the healthy
    # ISO 20816 range for a small machine.
    assert features.amplitude_1x_mm_s == pytest.approx(0.80, rel=0.15)
    assert spectrum.amplitude_at(PUMP.impeller_vanes * ROTATIONAL_HZ, 3.0) > 0.2
    assert spectrum.amplitude_at(3.0 * ROTATIONAL_HZ, 3.0) > 0.05
    assert 0.3 < features.vibration_rms_mm_s < 2.5


def test_stopped_machine_produces_a_noise_floor_not_a_divide_by_zero():
    features = extract_features(synthesise(0.0, FaultType.NORMAL, 0.0, seed=SEED))
    assert features.vibration_rms_mm_s < 0.1
    assert features.crest_factor > 0.0
    assert features.amplitude_1x_mm_s == 0.0


# ==========================================================================
# 4. Imbalance
# ==========================================================================


def test_imbalance_severity_monotonically_increases_one_x():
    amplitudes = [_features_at(FaultType.IMBALANCE, s).amplitude_1x_mm_s for s in SEVERITIES]
    assert all(b > a for a, b in zip(amplitudes, amplitudes[1:])), amplitudes
    assert amplitudes[-1] > 5.0 * amplitudes[0]


def test_imbalance_is_radial_not_axial():
    """A rotating unbalance is a radial force. If the axial channel responded as
    hard as the radial one, imbalance and misalignment would be inseparable."""
    healthy = extract_features(synthesise(RATED_RPM, FaultType.NORMAL, 0.0, seed=SEED))
    faulted = _features_at(FaultType.IMBALANCE, 1.0)

    radial_rise = max(faulted.vibration_x_mm_s, faulted.vibration_y_mm_s) / max(
        healthy.vibration_x_mm_s, healthy.vibration_y_mm_s
    )
    axial_rise = faulted.vibration_z_mm_s / healthy.vibration_z_mm_s
    assert radial_rise > 3.0 * axial_rise


def test_imbalance_does_not_disturb_two_x():
    """The narrow 1x-only signature is what makes imbalance diagnosable."""
    healthy = _features_at(FaultType.NORMAL, 0.0)
    faulted = _features_at(FaultType.IMBALANCE, 1.0)
    assert faulted.amplitude_2x_mm_s == pytest.approx(healthy.amplitude_2x_mm_s, rel=0.25)


# ==========================================================================
# 5. Misalignment
# ==========================================================================


def test_misalignment_severity_monotonically_increases_two_x():
    amplitudes = [_features_at(FaultType.MISALIGNMENT, s).amplitude_2x_mm_s for s in SEVERITIES]
    assert all(b > a for a, b in zip(amplitudes, amplitudes[1:])), amplitudes


def test_misalignment_raises_two_x_faster_than_one_x():
    healthy = _features_at(FaultType.MISALIGNMENT, 0.0)
    severe = _features_at(FaultType.MISALIGNMENT, 1.0)

    rise_1x = severe.amplitude_1x_mm_s - healthy.amplitude_1x_mm_s
    rise_2x = severe.amplitude_2x_mm_s - healthy.amplitude_2x_mm_s
    assert rise_1x > 0.0
    assert rise_2x > rise_1x

    # And the same must hold at every intermediate severity, not just the end.
    for severity in SEVERITIES[1:]:
        features = _features_at(FaultType.MISALIGNMENT, severity)
        step_1x = features.amplitude_1x_mm_s - healthy.amplitude_1x_mm_s
        step_2x = features.amplitude_2x_mm_s - healthy.amplitude_2x_mm_s
        assert step_2x > step_1x, severity


def test_misalignment_raises_the_axial_channel():
    """Axial vibration is the classic misalignment indicator."""
    axial = [_features_at(FaultType.MISALIGNMENT, s).vibration_z_mm_s for s in SEVERITIES]
    assert all(b > a for a, b in zip(axial, axial[1:])), axial
    assert axial[-1] > 4.0 * axial[0]


def test_imbalance_and_misalignment_are_separable_by_the_two_x_to_one_x_ratio():
    imbalance = _features_at(FaultType.IMBALANCE, 0.8)
    misalignment = _features_at(FaultType.MISALIGNMENT, 0.8)
    imbalance_ratio = imbalance.amplitude_2x_mm_s / imbalance.amplitude_1x_mm_s
    misalignment_ratio = misalignment.amplitude_2x_mm_s / misalignment.amplitude_1x_mm_s
    assert misalignment_ratio > 5.0 * imbalance_ratio


# ==========================================================================
# 6. Cavitation
# ==========================================================================


def test_cavitation_severity_monotonically_increases_high_frequency_energy():
    energies = [_features_at(FaultType.CAVITATION, s).high_frequency_energy for s in SEVERITIES]
    assert all(b > a for a, b in zip(energies, energies[1:])), energies
    assert energies[-1] > 5.0 * energies[0]


def test_cavitation_does_not_create_a_discrete_one_x_peak():
    """Bubble collapse is broadband. A cavitation model that raises 1x would
    teach the classifier something that is not true of a real pump."""
    baseline = _features_at(FaultType.CAVITATION, 0.0).amplitude_1x_mm_s
    for severity in SEVERITIES:
        amplitude = _features_at(FaultType.CAVITATION, severity).amplitude_1x_mm_s
        assert amplitude == pytest.approx(baseline, rel=0.15), severity


def test_cavitation_high_frequency_content_is_broadband_not_a_peak():
    """No single bin in the high-frequency band may stand out: the energy is
    spread across the band, which is what distinguishes implosion noise from a
    discrete mechanical order."""
    waveform = synthesise(RATED_RPM, FaultType.CAVITATION, 1.0, seed=SEED)
    spectrum = compute_spectrum(waveform.x, SAMPLING.sampling_rate_hz)
    band = (spectrum.frequencies_hz >= HIGH_FREQUENCY_CUTOFF_HZ) & (
        spectrum.frequencies_hz <= spectrum.nyquist_hz
    )
    tallest_bin = float(np.max(spectrum.amplitudes_mm_s[band]))
    band_rms = spectrum.band_energy(HIGH_FREQUENCY_CUTOFF_HZ, spectrum.nyquist_hz)
    assert tallest_bin < 0.5 * band_rms


def test_cavitation_raises_crest_factor():
    """Modulated impact-like energy on a steady background is what crest factor
    is for."""
    healthy = _features_at(FaultType.CAVITATION, 0.0).crest_factor
    severe = _features_at(FaultType.CAVITATION, 1.0).crest_factor
    assert severe > healthy


# ==========================================================================
# 7. Flow restriction and dry run
# ==========================================================================


def test_flow_restriction_raises_broadband_and_sub_synchronous_content():
    energies = [
        _features_at(FaultType.FLOW_RESTRICTION, s).high_frequency_energy for s in SEVERITIES
    ]
    assert all(b > a for a, b in zip(energies, energies[1:])), energies

    healthy = compute_spectrum(
        synthesise(RATED_RPM, FaultType.NORMAL, 0.0, seed=SEED).x, SAMPLING.sampling_rate_hz
    )
    severe = compute_spectrum(
        synthesise(RATED_RPM, FaultType.FLOW_RESTRICTION, 1.0, seed=SEED).x,
        SAMPLING.sampling_rate_hz,
    )
    sub_synchronous_hz = 0.42 * ROTATIONAL_HZ
    assert severe.amplitude_at(sub_synchronous_hz, 3.0) > 4.0 * healthy.amplitude_at(
        sub_synchronous_hz, 3.0
    )


def test_dry_run_collapses_the_blade_pass_component():
    """No liquid means no hydraulic vane loading. The signature changes shape,
    it does not merely grow."""
    blade_pass_hz = PUMP.impeller_vanes * ROTATIONAL_HZ
    healthy = compute_spectrum(
        synthesise(RATED_RPM, FaultType.NORMAL, 0.0, seed=SEED).x, SAMPLING.sampling_rate_hz
    )
    dry = compute_spectrum(
        synthesise(RATED_RPM, FaultType.DRY_RUN, 1.0, seed=SEED).x, SAMPLING.sampling_rate_hz
    )
    assert dry.amplitude_at(blade_pass_hz, 3.0) < 0.5 * healthy.amplitude_at(blade_pass_hz, 3.0)
    assert dry.amplitude_at(ROTATIONAL_HZ, 3.0) > healthy.amplitude_at(ROTATIONAL_HZ, 3.0)


def test_dry_run_raises_high_frequency_energy_monotonically():
    energies = [_features_at(FaultType.DRY_RUN, s).high_frequency_energy for s in SEVERITIES]
    assert all(b > a for a, b in zip(energies, energies[1:])), energies


# ==========================================================================
# 8. Bearing kinematics
# ==========================================================================
#
# Hand calculation for the 6205 at 1450 rpm (f_r = 24.16667 Hz):
#   r  = (d/D)cos(0) = 7.94 / 39.04                     = 0.2033811
#   BPFO = (9/2)(24.16667)(1 - r)  = 108.75 * 0.7966189 = 86.632 Hz
#   BPFI = (9/2)(24.16667)(1 + r)  = 108.75 * 1.2033811 = 130.868 Hz
#   BSF  = (39.04/15.88)(24.16667)(1 - r^2)
#        = 2.4584382 * 24.16667 * 0.9586362             = 56.955 Hz
#   FTF  = (1/2)(24.16667)(1 - r)  = 12.083333 * 0.7966189 = 9.626 Hz


def test_bearing_frequencies_match_hand_calculation():
    frequencies = defect_frequencies(ROTATIONAL_HZ, BEARING)
    assert frequencies.designation == "6205"
    assert frequencies.bpfo_hz == pytest.approx(86.632, abs=0.01)
    assert frequencies.bpfi_hz == pytest.approx(130.868, abs=0.01)
    assert frequencies.bsf_hz == pytest.approx(56.955, abs=0.01)
    assert frequencies.ftf_hz == pytest.approx(9.626, abs=0.01)


def test_bearing_frequency_ordering_holds():
    frequencies = defect_frequencies(ROTATIONAL_HZ, BEARING)
    assert frequencies.bpfi_hz > frequencies.bpfo_hz > frequencies.ftf_hz
    assert frequencies.bpfo_hz > frequencies.bsf_hz > frequencies.ftf_hz


def test_bearing_frequency_identities_hold():
    """BPFO + BPFI = n * f_r, and BPFO = n * FTF. Both fall out of the algebra,
    so a violation means a formula was mistyped."""
    frequencies = defect_frequencies(ROTATIONAL_HZ, BEARING)
    assert frequencies.bpfo_hz + frequencies.bpfi_hz == pytest.approx(
        BEARING.rolling_elements * ROTATIONAL_HZ, rel=1e-9
    )
    assert frequencies.bpfo_hz == pytest.approx(
        BEARING.rolling_elements * frequencies.ftf_hz, rel=1e-9
    )


def test_bearing_frequencies_scale_linearly_with_shaft_speed():
    slow = defect_frequencies(ROTATIONAL_HZ / 2.0, BEARING)
    fast = defect_frequencies(ROTATIONAL_HZ, BEARING)
    assert fast.bpfo_hz == pytest.approx(2.0 * slow.bpfo_hz, rel=1e-12)
    assert slow.orders["bpfo"] == pytest.approx(fast.orders["bpfo"], rel=1e-12)


def test_bearing_frequencies_are_all_below_nyquist_for_this_machine():
    """If they were not, the analysis band would be too narrow to ever see them
    and the calculator page would be quoting unmeasurable numbers."""
    frequencies = defect_frequencies(ROTATIONAL_HZ, BEARING)
    for value in (frequencies.bpfo_hz, frequencies.bpfi_hz, frequencies.bsf_hz):
        assert value < SAMPLING.nyquist_hz


def test_custom_geometry_is_accepted_for_the_calculator_page():
    """A contact angle must reduce BPFO -- cos(theta) < 1 shrinks the ratio."""
    straight = defect_frequencies_from_geometry(ROTATIONAL_HZ, 9, 7.94, 39.04, 0.0)
    angled = defect_frequencies_from_geometry(ROTATIONAL_HZ, 9, 7.94, 39.04, 40.0)
    assert angled.bpfo_hz > straight.bpfo_hz
    assert angled.bpfi_hz < straight.bpfi_hz


@pytest.mark.parametrize(
    "elements,ball_mm,pitch_mm,angle_deg",
    [
        (0, 7.94, 39.04, 0.0),  # no rolling elements
        (9, 0.0, 39.04, 0.0),  # zero ball diameter
        (9, 40.0, 39.04, 0.0),  # ball larger than the pitch circle
        (9, 7.94, 39.04, 95.0),  # impossible contact angle
    ],
)
def test_impossible_bearing_geometry_raises(elements, ball_mm, pitch_mm, angle_deg):
    with pytest.raises(ValueError):
        defect_frequencies_from_geometry(ROTATIONAL_HZ, elements, ball_mm, pitch_mm, angle_deg)


def test_bearing_payload_states_the_frequencies_are_calculated_not_detected():
    """The honesty requirement, enforced. A frequency table on a CM screen reads
    as a diagnosis unless it says otherwise, so the disclaimer travels with the
    data rather than living in a docstring the user never sees."""
    payload = defect_frequencies(ROTATIONAL_HZ, BEARING).to_dict()
    assert payload["basis"] == CALCULATION_BASIS == "THEORETICAL_KINEMATIC"
    disclaimer = payload["disclaimer"].lower()
    assert "theoretical" in disclaimer
    assert "not" in disclaimer and "measurement" in disclaimer
    # The geometry it was derived from must be visible alongside the answer.
    assert payload["rolling_elements"] == BEARING.rolling_elements
    assert payload["pitch_diameter_mm"] == BEARING.pitch_diameter_mm


# ==========================================================================
# 9. Nyquist and spectrum hygiene
# ==========================================================================


def test_no_returned_frequency_exceeds_nyquist():
    for fault in FaultType:
        waveform = synthesise(RATED_RPM, fault, 1.0, seed=SEED)
        for axis in waveform.axes:
            spectrum = compute_spectrum(axis, SAMPLING.sampling_rate_hz)
            assert spectrum.frequencies_hz.max() <= SAMPLING.nyquist_hz
            assert spectrum.frequencies_hz.min() >= 0.0
            assert spectrum.dominant_frequency() <= SAMPLING.nyquist_hz


def test_spectrum_has_the_expected_bin_count_and_resolution():
    spectrum = compute_spectrum(_sine(100.0, 1.0), SAMPLING.sampling_rate_hz)
    assert spectrum.frequencies_hz.size == SAMPLING.block_size // 2 + 1
    assert spectrum.resolution_hz == pytest.approx(SAMPLING.frequency_resolution_hz)
    assert spectrum.frequencies_hz[-1] == pytest.approx(SAMPLING.nyquist_hz)


def test_dc_offset_does_not_leak_into_the_measured_amplitude():
    """A sensor bias is not vibration. Left in, it would inflate every low
    band it touched."""
    clean = compute_spectrum(_sine(ROTATIONAL_HZ, 1.0), SAMPLING.sampling_rate_hz)
    biased = compute_spectrum(_sine(ROTATIONAL_HZ, 1.0) + 12.0, SAMPLING.sampling_rate_hz)
    assert biased.amplitude_at(ROTATIONAL_HZ, 3.0) == pytest.approx(
        clean.amplitude_at(ROTATIONAL_HZ, 3.0), rel=1e-6
    )


def test_spectrum_rejects_input_it_cannot_transform():
    with pytest.raises(ValueError):
        compute_spectrum(np.zeros((4, 4)), SAMPLING.sampling_rate_hz)
    with pytest.raises(ValueError):
        compute_spectrum(np.zeros(4), SAMPLING.sampling_rate_hz)
    with pytest.raises(ValueError):
        compute_spectrum(np.zeros(1024), 0.0)


# ==========================================================================
# 10. Contract compliance
# ==========================================================================


def test_feature_field_names_match_the_frozen_contract():
    """Every vibration feature name must exist on Telemetry. A rename here is a
    silent failure downstream, not an error."""
    features = _features_at(FaultType.IMBALANCE, 0.5)
    telemetry_fields = set(Telemetry.__dataclass_fields__)
    for name in features.telemetry_fields():
        assert name in telemetry_fields, name


def test_every_vibration_entry_in_feature_order_is_produced():
    features = _features_at(FaultType.IMBALANCE, 0.5)
    produced = set(features.telemetry_fields())
    expected = {
        "vibration_rms_mm_s",
        "vibration_peak_mm_s",
        "crest_factor",
        "amplitude_1x_mm_s",
        "amplitude_2x_mm_s",
        "high_frequency_energy",
    }
    assert expected <= set(FEATURE_ORDER)
    assert expected <= produced


def test_all_features_are_finite_for_every_fault_and_severity():
    for fault in FaultType:
        for severity in SEVERITIES:
            features = _features_at(fault, severity)
            for name, value in features.to_dict().items():
                assert math.isfinite(value), f"{fault.value} {severity} {name}"
                assert value >= 0.0, f"{fault.value} {severity} {name}"


def test_overall_rms_is_the_quadrature_sum_of_the_axes():
    """The resultant convention, checked. If this drifts, the overall stops
    agreeing with the per-axis numbers shown next to it."""
    features = _features_at(FaultType.MISALIGNMENT, 0.7)
    expected = math.sqrt(
        features.vibration_x_mm_s**2
        + features.vibration_y_mm_s**2
        + features.vibration_z_mm_s**2
    )
    assert features.vibration_rms_mm_s == pytest.approx(expected, rel=1e-9)
