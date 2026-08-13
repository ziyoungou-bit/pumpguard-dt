"""Single-sided amplitude spectrum of a vibration block, done properly.

The whole value of this module is that the numbers coming out are in the same
engineering unit as the numbers going in. A 1.0 mm/s sine must read 1.0 mm/s in
the spectrum -- not 0.5 (forgetting the single-sided factor of two), not 2.0
(applying it twice), and not 0.5 again (forgetting that a Hann window throws
away half the signal amplitude). Every one of those errors produces a
plausible-looking chart, which is why they survive so long in real code.

Normalisation
-------------
For a block of N samples with window w:

    X   = rfft(x * w)
    S_k = 2 * |X_k| / sum(w)                       [engineering units, peak]

`sum(w)` is the window's *coherent gain* times N. Dividing by it undoes both
the FFT's N scaling and the window's amplitude loss. The factor 2 folds the
negative-frequency half onto the positive half -- and is therefore *not*
applied to DC or to the Nyquist bin, which have no mirror partner. Missing that
exception makes DC read double, which quietly corrupts any band that includes
it.

Reading amplitudes back out
---------------------------
A tone almost never lands exactly on a bin centre. At the worst offset (half a
bin) a Hann window loses 1.42 dB of peak height -- a 15 % amplitude error --
so reading the single tallest bin is not good enough for a feature that feeds
a classifier. The fix is the standard one: sum *power* across the mainlobe and
divide by the window's equivalent noise bandwidth,

    ENBW = N * sum(w^2) / (sum(w))^2               [bins; 1.5 for Hann]
    A    = sqrt( sum_k S_k^2 / ENBW )              [peak amplitude]
    RMS  = sqrt( sum_k S_k^2 / (2 * ENBW) )

which is exact regardless of where the tone falls, because it measures the
energy the window spread around rather than the height of one bin. Both
`amplitude_at` and `band_energy` use it, so a discrete tone and a band of
random noise are measured on the same footing.

Frequency resolution is fs/N and nothing can improve it: at 5120 Hz over 4096
samples that is 1.25 Hz, i.e. 75 rpm. Two shaft orders 1.25 Hz apart are one
bin apart and cannot be separated. Zero padding interpolates, it does not
resolve.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

#: Bins below this frequency are ignored when looking for the dominant peak.
#: DC and the first bin or two carry sensor offset and drift, not vibration,
#: and they would otherwise win every time.
MINIMUM_ANALYSIS_FREQUENCY_HZ = 2.0


@dataclass(frozen=True)
class Spectrum:
    """Single-sided amplitude spectrum, DC to Nyquist inclusive.

    `amplitudes_mm_s` are *peak* amplitudes in the signal's own unit: a 1.0 mm/s
    sine on a bin centre gives a 1.0 mm/s bin.
    """

    frequencies_hz: np.ndarray
    amplitudes_mm_s: np.ndarray
    resolution_hz: float
    sampling_rate_hz: float
    #: Window equivalent noise bandwidth in bins (1.5 for Hann). Needed to turn
    #: a sum of bin powers back into an amplitude, so it travels with the data.
    enbw_bins: float

    @property
    def nyquist_hz(self) -> float:
        return self.sampling_rate_hz / 2.0

    # -- readers ---------------------------------------------------------

    def dominant_frequency(self) -> float:
        """Frequency of the largest bin above `MINIMUM_ANALYSIS_FREQUENCY_HZ`."""
        mask = self.frequencies_hz >= MINIMUM_ANALYSIS_FREQUENCY_HZ
        if not mask.any():
            return 0.0
        candidates = self.amplitudes_mm_s[mask]
        return float(self.frequencies_hz[mask][int(np.argmax(candidates))])

    def amplitude_at(self, frequency_hz: float, tolerance_hz: float | None = None) -> float:
        """Peak amplitude of whatever sits within +/- tolerance of a frequency.

        The tolerance is widened to at least two bins whatever the caller asks
        for: a Hann mainlobe is four bins wide, and a narrower window would
        clip energy off the sides and under-read every time. Passing a wide
        tolerance is the caller's business -- it will also collect any noise in
        that span, which is the honest answer to "how much energy is near this
        frequency".
        """
        window_hz = max(tolerance_hz if tolerance_hz is not None else 0.0, 2.0 * self.resolution_hz)
        power = self._band_power(frequency_hz - window_hz, frequency_hz + window_hz)
        return float(np.sqrt(power / self.enbw_bins))

    def band_energy(self, f_low: float, f_high: float) -> float:
        """RMS amplitude of everything between two frequencies, same unit as the input.

        RMS rather than peak, because a band normally holds broadband random
        content with no meaningful peak. For a band containing one pure sine of
        amplitude A this returns A/sqrt(2), as an RMS should.
        """
        power = self._band_power(f_low, f_high)
        return float(np.sqrt(power / (2.0 * self.enbw_bins)))

    def _band_power(self, f_low: float, f_high: float) -> float:
        """Sum of bin powers over a closed frequency interval."""
        if f_high < f_low:
            f_low, f_high = f_high, f_low
        mask = (self.frequencies_hz >= f_low) & (self.frequencies_hz <= f_high)
        if not mask.any():
            return 0.0
        return float(np.sum(self.amplitudes_mm_s[mask] ** 2))


def compute_spectrum(signal: np.ndarray, sampling_rate_hz: float) -> Spectrum:
    """Hann-windowed single-sided amplitude spectrum, DC to Nyquist.

    The mean is removed first. A sensor DC offset is not vibration, and left in
    place it leaks into the lowest bins through the window and inflates any
    low-frequency band measurement.
    """
    samples = np.asarray(signal, dtype=float)
    if samples.ndim != 1:
        raise ValueError("signal must be one dimensional")
    n = samples.size
    if n < 8:
        raise ValueError("signal is too short to transform")
    if sampling_rate_hz <= 0.0:
        raise ValueError("sampling_rate_hz must be positive")

    samples = samples - samples.mean()

    # Periodic ("sym=False") Hann, the correct choice for spectral analysis:
    # the symmetric variant duplicates the endpoint and biases the gain.
    window = np.hanning(n + 1)[:n]
    coherent_gain = window.sum()

    transform = np.fft.rfft(samples * window)
    amplitudes = 2.0 * np.abs(transform) / coherent_gain

    # DC has no negative-frequency twin, and for even N neither does Nyquist.
    amplitudes[0] /= 2.0
    if n % 2 == 0:
        amplitudes[-1] /= 2.0

    frequencies = np.fft.rfftfreq(n, d=1.0 / sampling_rate_hz)
    enbw_bins = n * float(np.sum(window**2)) / (coherent_gain**2)

    return Spectrum(
        frequencies_hz=frequencies,
        amplitudes_mm_s=amplitudes,
        resolution_hz=sampling_rate_hz / n,
        sampling_rate_hz=sampling_rate_hz,
        enbw_bins=enbw_bins,
    )
