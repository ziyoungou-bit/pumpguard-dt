"""Vibration feature extraction, in the exact field names `contracts` defines.

The output field names here are not a local choice. They are
`contracts.Telemetry`'s vibration fields and the entries of
`contracts.FEATURE_ORDER`, because these values go straight onto the wire and
into the model's feature vector. A rename here is a silent product failure
somewhere else -- see the note at the top of `contracts.py`.

Two conventions, applied consistently
-------------------------------------
*Time-domain* overalls (RMS, peak, peak-to-peak, crest factor) are computed on
the **resultant** magnitude sqrt(x^2+y^2+z^2). One number for the machine, and
the identity RMS(resultant)^2 = RMS_x^2 + RMS_y^2 + RMS_z^2 holds exactly, so
the overall is consistent with the per-axis values reported beside it.

*Spectral* features (1x, 2x, high-frequency band, dominant frequency) are taken
as the **worst axis**: each axis is transformed separately and the largest value
is reported. This is what an analyst does, and it is the only way an axial-only
signature survives -- misalignment's axial 2x would be diluted to nothing by
averaging. It also cannot be computed from the resultant: taking a magnitude is
a nonlinear operation that manufactures harmonics which are not in the machine.

Crest factor is peak/RMS: 1.41 for a pure sine, near 3 for Gaussian noise, and
high when short impacts sit on a low background -- which is why it is an early
bearing and cavitation indicator while RMS is still normal.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

import numpy as np

from .spectrum import Spectrum, compute_spectrum
from .waveform import HIGH_FREQUENCY_CUTOFF_HZ, VibrationWaveform

#: Half-width of the window used to read a discrete order out of the spectrum.
#: Wide enough to hold a Hann mainlobe (four bins, 5 Hz at the default block)
#: and to tolerate the small speed wander a real machine has.
ORDER_TOLERANCE_HZ = 3.0


# --------------------------------------------------------------------------
# Scalar statistics on a single channel
# --------------------------------------------------------------------------


def rms(samples: np.ndarray) -> float:
    """Root mean square. Not de-meaned: for vibration the mean is already zero,
    and removing it here would hide a genuine sensor offset from the overall."""
    values = np.asarray(samples, dtype=float)
    if values.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(values**2)))


def peak(samples: np.ndarray) -> float:
    """Largest absolute excursion."""
    values = np.asarray(samples, dtype=float)
    if values.size == 0:
        return 0.0
    return float(np.max(np.abs(values)))


def peak_to_peak(samples: np.ndarray) -> float:
    """Full swing, max minus min. Not 2x peak unless the signal is symmetric."""
    values = np.asarray(samples, dtype=float)
    if values.size == 0:
        return 0.0
    return float(np.max(values) - np.min(values))


def crest_factor(samples: np.ndarray) -> float:
    """peak / RMS. Returns 0.0 for a dead channel rather than dividing by zero."""
    denominator = rms(samples)
    if denominator <= 0.0:
        return 0.0
    return peak(samples) / denominator


# --------------------------------------------------------------------------
# Feature set
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class VibrationFeatures:
    """Field names match `contracts.Telemetry` exactly. Do not rename.

    `peak_to_peak_mm_s` is the one field with no Telemetry counterpart: it is a
    standard displacement-style overall an engineer expects to see, so it is
    computed and exposed, but it is not on the wire.
    """

    # per-axis RMS
    vibration_x_mm_s: float
    vibration_y_mm_s: float
    vibration_z_mm_s: float

    # time-domain overalls, from the resultant
    vibration_rms_mm_s: float
    vibration_peak_mm_s: float
    peak_to_peak_mm_s: float
    crest_factor: float

    # spectral, worst axis
    amplitude_1x_mm_s: float
    amplitude_2x_mm_s: float
    high_frequency_energy: float
    dominant_frequency_hz: float

    rotational_frequency_hz: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def telemetry_fields(self) -> dict[str, float]:
        """Only the keys that exist on `contracts.Telemetry`, ready to splat in."""
        payload = self.to_dict()
        payload.pop("peak_to_peak_mm_s")
        return payload


def extract_features(waveform: VibrationWaveform) -> VibrationFeatures:
    """Reduce a three-axis block to the contract's vibration feature set."""
    fs = waveform.sampling.sampling_rate_hz
    f_r = waveform.rotational_frequency_hz
    magnitude = waveform.magnitude

    spectra = [compute_spectrum(axis, fs) for axis in waveform.axes]

    return VibrationFeatures(
        vibration_x_mm_s=rms(waveform.x),
        vibration_y_mm_s=rms(waveform.y),
        vibration_z_mm_s=rms(waveform.z),
        vibration_rms_mm_s=rms(magnitude),
        vibration_peak_mm_s=peak(magnitude),
        peak_to_peak_mm_s=peak_to_peak(magnitude),
        crest_factor=crest_factor(magnitude),
        amplitude_1x_mm_s=_worst_axis_amplitude(spectra, f_r),
        amplitude_2x_mm_s=_worst_axis_amplitude(spectra, 2.0 * f_r),
        high_frequency_energy=max(
            spectrum.band_energy(HIGH_FREQUENCY_CUTOFF_HZ, spectrum.nyquist_hz)
            for spectrum in spectra
        ),
        dominant_frequency_hz=_dominant_frequency(spectra),
        rotational_frequency_hz=f_r,
    )


def _worst_axis_amplitude(spectra: list[Spectrum], frequency_hz: float) -> float:
    if frequency_hz <= 0.0:
        return 0.0
    return max(spectrum.amplitude_at(frequency_hz, ORDER_TOLERANCE_HZ) for spectrum in spectra)


def _dominant_frequency(spectra: list[Spectrum]) -> float:
    """Dominant frequency of whichever axis carries the largest single peak."""
    best_amplitude = -1.0
    best_frequency = 0.0
    for spectrum in spectra:
        frequency = spectrum.dominant_frequency()
        amplitude = spectrum.amplitude_at(frequency)
        if amplitude > best_amplitude:
            best_amplitude = amplitude
            best_frequency = frequency
    return best_frequency
