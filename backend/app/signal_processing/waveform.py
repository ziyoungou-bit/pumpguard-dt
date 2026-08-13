"""Synthesis of a real time-domain vibration waveform for the pump.

This module builds an actual sampled velocity signal, one sample at a time,
from physical components: shaft rotation, its harmonics, vane passing, bearing
kinematics and a broadband noise floor. The spectrum is then *measured* from
that signal by `spectrum.compute_spectrum`, exactly as it would be measured
from a real accelerometer block.

That ordering is the point. The tempting shortcut is to write the spectrum
directly -- decide that imbalance means "a 6 mm/s peak at 24 Hz" and draw it.
Doing so makes every downstream number a restatement of the fault label: the
crest factor, the noise floor, the sidebands and the leakage would all have to
be invented separately and would never be mutually consistent. Synthesising in
the time domain means the features are derived, not declared, and a bug in the
FFT path shows up as a wrong number rather than staying invisible.

Units and quantity
------------------
Velocity in mm/s. That is what `contracts.Telemetry` carries, it is the
quantity ISO 10816 / ISO 20816 judges machine severity on, and it is what a
vibration analyst reads for shaft-rate faults. Bearing and cavitation work is
properly done in acceleration, which this rig does not model; the high-frequency
band here is a *velocity-domain proxy* for that energy, which is honest for a
demonstration but is not envelope analysis.

Sampling
--------
5120 Hz, 4096 samples: a standard condition-monitoring combination.

  * Nyquist 2560 Hz, and 5120 = 2.56 x 2000 Hz, so an analyser's 2000 Hz
    analysis range comes out with the usual anti-alias margin.
  * 4096 samples is 0.8 s of data and gives 1.25 Hz resolution -- 19.3 bins
    between DC and 1x at 1450 rpm, so 1x, 2x, 3x and the 145 Hz vane pass are
    all comfortably separated.

Fault signatures
----------------
Each is scaled by `severity` in 0..1 through a smooth polynomial, so nothing
steps. At severity 0 every fault reduces exactly to the healthy baseline.

  imbalance       1x rises hard and radially (x/y); axial barely moves. A
                  residual unbalance is a rotating radial force, so that is
                  where the response goes. x and y are in quadrature -- the
                  rotor traces an orbit, it does not shake along one line.
  misalignment    2x rises faster than 1x, and axial (z) rises hard. Axial
                  vibration at 1x/2x is the classic indicator: a coupling
                  misaligned angularly pushes and pulls along the shaft once
                  or twice per revolution.
  cavitation      Broadband high-frequency random energy, amplitude-modulated
                  at vane pass. Bubble implosion is a shower of unsynchronised
                  impacts -- there is no discrete "cavitation frequency" -- but
                  the collapses are concentrated where the vane passes the
                  cutwater, which is what modulates them.
  flow_restriction  Modest broadband rise plus a sub-synchronous component near
                  0.4x from recirculation instability, and heavier vane-pass
                  loading as the operating point moves off BEP.
  dry_run         Vane passing collapses (no liquid to load the vanes) while
                  the shaft harmonics ring up (hydraulic damping is gone) and
                  the high-frequency floor lifts. Note the signature *changes
                  shape*, it does not simply get bigger.
  normal          Baseline only.
  sensor_fault    Baseline. A sensor fault is a defect of the measurement
                  chain, not of the machine, so it belongs to whoever models
                  the sensor -- corrupting the true waveform here would make it
                  indistinguishable from a real mechanical fault.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import signal as scipy_signal

from ..config.pump_parameters import BEARING, PUMP, BearingGeometry, PumpParameters
from ..contracts import FaultType
from .bearing import defect_frequencies

# --------------------------------------------------------------------------
# Acquisition settings
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class SamplingConfig:
    """One acquisition block. See the module docstring for why these values."""

    sampling_rate_hz: float = 5120.0
    block_size: int = 4096

    @property
    def nyquist_hz(self) -> float:
        return self.sampling_rate_hz / 2.0

    @property
    def frequency_resolution_hz(self) -> float:
        """fs/N. 1.25 Hz at the defaults; no processing can improve on it."""
        return self.sampling_rate_hz / self.block_size

    @property
    def duration_s(self) -> float:
        return self.block_size / self.sampling_rate_hz

    def time_vector(self) -> np.ndarray:
        return np.arange(self.block_size, dtype=float) / self.sampling_rate_hz


SAMPLING = SamplingConfig()

#: Everything at or above this is treated as the "high frequency" band. Above
#: the 6th harmonic and the 145 Hz vane pass by a wide margin, so the band
#: holds only broadband content, which is what makes it a cavitation indicator.
HIGH_FREQUENCY_CUTOFF_HZ = 1000.0

#: Passband of the synthesised broadband component, kept clear of the cutoff on
#: one side and Nyquist on the other so the filter's skirts are not truncated.
_HF_BAND_HZ = (1200.0, 2400.0)

# --------------------------------------------------------------------------
# Healthy baseline levels, mm/s peak (noise terms are standard deviations)
#
# Sized against ISO 20816 zone A/B for a small machine: a healthy overall of
# roughly 1 mm/s RMS, rising into the several-mm/s range as faults develop.
# --------------------------------------------------------------------------

BASELINE_1X_MM_S = 0.80
BASELINE_2X_MM_S = 0.22
BASELINE_3X_MM_S = 0.10
BASELINE_BLADE_PASS_MM_S = 0.30
BASELINE_BEARING_MM_S = 0.05
BASELINE_NOISE_MM_S = 0.08
BASELINE_HIGH_FREQUENCY_MM_S = 0.06

#: Axial response to a radial excitation, as a fraction of the radial level. A
#: healthy machine is not perfectly decoupled, but it is close.
BASELINE_AXIAL_FRACTION = 0.35

#: Sub-synchronous instability frequency as a fraction of shaft speed. Flow
#: recirculation in a centrifugal pump shows up at 0.3-0.5x.
SUB_SYNCHRONOUS_ORDER = 0.42


# --------------------------------------------------------------------------
# Fault modulation
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class _Modulation:
    """Multipliers and additions applied to the healthy baseline.

    All defaults are the identity, so `_Modulation()` is a healthy machine and
    every fault at severity 0 collapses onto it.
    """

    gain_1x: float = 1.0
    gain_2x: float = 1.0
    gain_3x: float = 1.0
    gain_blade_pass: float = 1.0
    gain_bearing: float = 1.0
    #: How much of the fault's *increase* in the shaft orders reaches the axial
    #: channel, as a fraction of the radial increase. 0 means a purely radial
    #: fault, 1 means axial follows radial, above 1 means the fault drives axial
    #: harder than radial. It scales the increment and not the total, so the
    #: healthy axial coupling is untouched at severity 0 whatever the value.
    axial_coupling: float = 1.0
    gain_noise: float = 1.0
    gain_high_frequency: float = 1.0
    #: Depth of amplitude modulation on the high-frequency band, 0..1.
    high_frequency_modulation: float = 0.0
    #: Absolute level of the sub-synchronous component, mm/s peak.
    sub_synchronous_mm_s: float = 0.0


def _modulation_for(fault: FaultType, severity: float) -> _Modulation:
    """Map a fault and its severity onto baseline modifiers.

    Written as an explicit branch per fault rather than a table of coefficients:
    there are six real cases with genuinely different shapes, and the physical
    reasoning for each coefficient only makes sense next to the coefficient.
    """
    s = float(min(max(severity, 0.0), 1.0))

    if s == 0.0 or fault in (FaultType.NORMAL, FaultType.SENSOR_FAULT):
        return _Modulation()

    if fault is FaultType.IMBALANCE:
        # 1x dominates and everything else is nearly untouched -- that narrow
        # signature is exactly what makes imbalance the easy diagnosis.
        return _Modulation(
            gain_1x=1.0 + 9.0 * s,
            # Almost none of it reaches the axial channel: a radial force can
            # only excite axial motion through structural cross-coupling.
            axial_coupling=0.05,
            gain_bearing=1.0 + 0.4 * s,
            gain_noise=1.0 + 0.2 * s,
        )

    if fault is FaultType.MISALIGNMENT:
        # 2x climbs about three times as fast as 1x in absolute terms, and the
        # axial channel climbs with it.
        return _Modulation(
            gain_1x=1.0 + 2.0 * s,
            gain_2x=1.0 + 16.0 * s,
            gain_3x=1.0 + 6.0 * s,
            # Angular misalignment pushes and pulls along the shaft once and
            # twice per revolution, so the axial channel is driven harder than
            # the radial one. This is the separator from imbalance.
            axial_coupling=3.0,
            gain_bearing=1.0 + 1.2 * s,
            gain_noise=1.0 + 0.3 * s,
        )

    if fault is FaultType.CAVITATION:
        # Deliberately no change to 1x. Cavitation that shows as a 1x rise is
        # not cavitation, and a classifier trained on that would be learning a
        # fiction.
        return _Modulation(
            gain_blade_pass=1.0 + 0.8 * s,
            gain_noise=1.0 + 1.5 * s,
            gain_high_frequency=1.0 + 18.0 * s,
            high_frequency_modulation=0.8 * s,
        )

    if fault is FaultType.FLOW_RESTRICTION:
        return _Modulation(
            gain_1x=1.0 + 0.8 * s,
            gain_blade_pass=1.0 + 1.5 * s,
            gain_noise=1.0 + 2.5 * s,
            gain_high_frequency=1.0 + 3.0 * s,
            sub_synchronous_mm_s=0.9 * s,
        )

    if fault is FaultType.DRY_RUN:
        # The vane-pass component falls away as the liquid does; the shaft
        # orders rise because the liquid was damping them.
        return _Modulation(
            gain_1x=1.0 + 1.6 * s,
            gain_2x=1.0 + 1.6 * s,
            gain_3x=1.0 + 2.5 * s,
            gain_blade_pass=1.0 - 0.85 * s,
            gain_bearing=1.0 + 2.0 * s,
            gain_noise=1.0 + 0.6 * s,
            gain_high_frequency=1.0 + 2.5 * s,
        )

    return _Modulation()


# --------------------------------------------------------------------------
# Waveform
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class VibrationWaveform:
    """One acquisition block on three axes, mm/s.

    x and y are the radial pair (horizontal and vertical at the bearing
    housing); z is axial, along the shaft.
    """

    x: np.ndarray
    y: np.ndarray
    z: np.ndarray
    sampling: SamplingConfig
    rotational_frequency_hz: float
    blade_pass_frequency_hz: float

    @property
    def axes(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        return (self.x, self.y, self.z)

    @property
    def magnitude(self) -> np.ndarray:
        """Resultant |v| at each sample, sqrt(x^2 + y^2 + z^2)."""
        return np.sqrt(self.x**2 + self.y**2 + self.z**2)


def synthesise(
    rotational_speed_rpm: float,
    fault: FaultType = FaultType.NORMAL,
    severity: float = 0.0,
    seed: int | None = None,
    sampling: SamplingConfig = SAMPLING,
    pump: PumpParameters = PUMP,
    bearing_geometry: BearingGeometry = BEARING,
) -> VibrationWaveform:
    """Build one three-axis velocity block, mm/s.

    `seed` fixes every random draw -- noise, phases, the broadband band -- so a
    given (speed, fault, severity, seed) always yields the identical waveform.
    The simulator varies the seed per tick to get fresh noise; the tests hold it
    fixed so a severity sweep isolates the fault and is not swamped by noise.
    """
    rng = np.random.default_rng(seed)
    f_r = max(0.0, rotational_speed_rpm) / 60.0
    f_blade = pump.impeller_vanes * f_r
    t = sampling.time_vector()

    if f_r <= 0.05:
        # Stopped machine: no rotation, so only the sensor's own electrical
        # noise floor. Returning zeros instead would give a crest factor of 0/0.
        floor = 0.01
        return VibrationWaveform(
            x=rng.normal(0.0, floor, sampling.block_size),
            y=rng.normal(0.0, floor, sampling.block_size),
            z=rng.normal(0.0, floor, sampling.block_size),
            sampling=sampling,
            rotational_frequency_hz=0.0,
            blade_pass_frequency_hz=0.0,
        )

    mod = _modulation_for(fault, severity)

    # Fixed-per-block random phases: real vibration has no reason to start a
    # block at zero crossing, and a deterministic phase would make the
    # harmonics add up identically every time and bias peak and crest factor.
    phase_1x, phase_2x, phase_3x, phase_blade, phase_sub = rng.uniform(0.0, 2.0 * np.pi, 5)

    radial_amplitudes = (
        BASELINE_1X_MM_S * mod.gain_1x,
        BASELINE_2X_MM_S * mod.gain_2x,
        BASELINE_3X_MM_S * mod.gain_3x,
    )
    # The axial channel gets the healthy coupled share of each order, plus the
    # fault's increase scaled by `axial_coupling`. Multiplying the whole radial
    # amplitude by a single axial gain instead would make every fault raise
    # axial vibration in proportion to its radial one -- which would erase the
    # only feature that tells imbalance and misalignment apart.
    axial_amplitudes = tuple(
        BASELINE_AXIAL_FRACTION * (baseline + (radial - baseline) * mod.axial_coupling)
        for baseline, radial in zip(
            (BASELINE_1X_MM_S, BASELINE_2X_MM_S, BASELINE_3X_MM_S), radial_amplitudes
        )
    )
    amp_blade = BASELINE_BLADE_PASS_MM_S * mod.gain_blade_pass

    def shaft_orders(amplitudes: tuple[float, ...], phase_offset: float) -> np.ndarray:
        amp_1x, amp_2x, amp_3x = amplitudes
        return (
            amp_1x * np.sin(2.0 * np.pi * f_r * t + phase_1x + phase_offset)
            + amp_2x * np.sin(2.0 * np.pi * 2.0 * f_r * t + phase_2x + phase_offset)
            + amp_3x * np.sin(2.0 * np.pi * 3.0 * f_r * t + phase_3x)
        )

    # A rotating unbalance force makes the rotor orbit, so the vertical channel
    # lags the horizontal by a quarter turn rather than repeating it.
    radial_x = shaft_orders(radial_amplitudes, 0.0)
    radial_y = shaft_orders(radial_amplitudes, -np.pi / 2.0)
    axial = shaft_orders(axial_amplitudes, 0.0)

    blade = amp_blade * np.sin(2.0 * np.pi * f_blade * t + phase_blade)
    sub_synchronous = mod.sub_synchronous_mm_s * np.sin(
        2.0 * np.pi * SUB_SYNCHRONOUS_ORDER * f_r * t + phase_sub
    )

    bearing_component = _bearing_component(t, f_r, mod.gain_bearing, bearing_geometry, rng)

    noise_sigma = BASELINE_NOISE_MM_S * mod.gain_noise
    hf_level = BASELINE_HIGH_FREQUENCY_MM_S * mod.gain_high_frequency

    def channel(base: np.ndarray, axial_channel: bool) -> np.ndarray:
        # Vane passing is a hydraulic pressure pulsation: it loads the casing
        # radially far more than axially.
        blade_share = 0.4 if axial_channel else 1.0
        return (
            base
            + blade_share * blade
            + (0.3 if axial_channel else 1.0) * sub_synchronous
            + bearing_component * (0.5 if axial_channel else 1.0)
            + rng.normal(0.0, noise_sigma, sampling.block_size)
            + _high_frequency_band(
                t, hf_level, mod.high_frequency_modulation, f_blade, sampling, rng
            )
        )

    return VibrationWaveform(
        x=channel(radial_x, axial_channel=False),
        y=channel(radial_y, axial_channel=False),
        z=channel(axial, axial_channel=True),
        sampling=sampling,
        rotational_frequency_hz=f_r,
        blade_pass_frequency_hz=f_blade,
    )


def _bearing_component(
    t: np.ndarray,
    rotational_frequency_hz: float,
    gain: float,
    geometry: BearingGeometry,
    rng: np.random.Generator,
) -> np.ndarray:
    """Low-level tones at the bearing's theoretical defect frequencies.

    Present even on a healthy machine: every bearing generates a little energy
    at its kinematic frequencies from normal element passage. They are *not* a
    defect here, and nothing in this module claims otherwise -- see
    `bearing.py`.
    """
    frequencies = defect_frequencies(rotational_frequency_hz, geometry)
    level = BASELINE_BEARING_MM_S * gain
    component = np.zeros_like(t)
    for frequency, share in (
        (frequencies.bpfo_hz, 1.0),
        (frequencies.bpfi_hz, 0.8),
        (frequencies.bsf_hz, 0.6),
        (frequencies.ftf_hz, 0.4),
    ):
        phase = rng.uniform(0.0, 2.0 * np.pi)
        component += level * share * np.sin(2.0 * np.pi * frequency * t + phase)
    return component


def _high_frequency_band(
    t: np.ndarray,
    level_mm_s: float,
    modulation_depth: float,
    blade_pass_hz: float,
    sampling: SamplingConfig,
    rng: np.random.Generator,
) -> np.ndarray:
    """Band-limited random energy, optionally amplitude-modulated at vane pass.

    Built by band-passing white noise with a Butterworth filter from SciPy
    (`sosfiltfilt`, so the filter is zero-phase and does not smear the block's
    edges) and then rescaling to the requested RMS -- filtering removes most of
    the variance, so without the rescale the level would be meaningless.

    This is what makes cavitation broadband rather than a peak: there is no
    single frequency in here, only energy spread across 1200-2400 Hz. The AM
    envelope puts sidebands around that energy at the vane-pass rate, which is
    where the modulation physically comes from.
    """
    if level_mm_s <= 0.0:
        return np.zeros_like(t)

    white = rng.normal(0.0, 1.0, sampling.block_size)
    low, high = _HF_BAND_HZ
    sos = scipy_signal.butter(
        4, [low / sampling.nyquist_hz, high / sampling.nyquist_hz], btype="band", output="sos"
    )
    band = scipy_signal.sosfiltfilt(sos, white)
    deviation = float(np.std(band))
    if deviation <= 0.0:
        return np.zeros_like(t)
    band = band / deviation * level_mm_s

    if modulation_depth > 0.0:
        envelope = 1.0 + modulation_depth * np.sin(2.0 * np.pi * blade_pass_hz * t)
        band = band * envelope

    return band
