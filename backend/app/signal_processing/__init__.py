"""Vibration signal processing: waveform synthesis, FFT, features, bearing kinematics.

The pipeline runs strictly one way, and every arrow is a real computation:

    waveform.synthesise()  ->  a sampled three-axis velocity block, mm/s
        |
        v
    spectrum.compute_spectrum()  ->  Hann-windowed amplitude spectrum
        |
        v
    features.extract_features()  ->  the fields contracts.Telemetry carries

`bearing` stands beside the pipeline rather than in it: it calculates
theoretical defect frequencies from geometry. It detects nothing. Read its
docstring before putting its output in front of a user.
"""

from __future__ import annotations

from .bearing import (
    CALCULATION_BASIS,
    DISCLAIMER,
    BearingFrequencies,
    defect_frequencies,
    defect_frequencies_at_rpm,
    defect_frequencies_from_geometry,
)
from .features import (
    ORDER_TOLERANCE_HZ,
    VibrationFeatures,
    crest_factor,
    extract_features,
    peak,
    peak_to_peak,
    rms,
)
from .spectrum import Spectrum, compute_spectrum
from .waveform import (
    HIGH_FREQUENCY_CUTOFF_HZ,
    SAMPLING,
    SamplingConfig,
    VibrationWaveform,
    synthesise,
)

__all__ = [
    "CALCULATION_BASIS",
    "DISCLAIMER",
    "HIGH_FREQUENCY_CUTOFF_HZ",
    "ORDER_TOLERANCE_HZ",
    "SAMPLING",
    "BearingFrequencies",
    "SamplingConfig",
    "Spectrum",
    "VibrationFeatures",
    "VibrationWaveform",
    "compute_spectrum",
    "crest_factor",
    "defect_frequencies",
    "defect_frequencies_at_rpm",
    "defect_frequencies_from_geometry",
    "extract_features",
    "peak",
    "peak_to_peak",
    "rms",
    "synthesise",
]
