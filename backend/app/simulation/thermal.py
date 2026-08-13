"""Motor and bearing temperature: first-order rise toward a load-dependent steady state.

A lumped thermal capacity is the standard first-order model for an electrical
machine (IEC 60034-1 thermal testing assumes exactly this exponential
approach), and it is the right level of detail here: two states, two time
constants, no finite-element pretence.

    T_steady = T_ambient + rise_at_rated * load_fraction
    T(t+dt)  = T_steady + (T(t) - T_steady) * exp(-dt/tau)

The exponential update is used instead of the Euler form `T += (T_s - T)*dt/tau`
because the simulator must stay stable if a caller steps it with a dt of a few
seconds to fast-forward a demo. Euler goes unstable at dt > 2*tau; this form
cannot.

Motor and bearing are separate states with different time constants: the
winding is the heat source and warms first, the bearing is heated indirectly
through the shaft and lags it. That difference is diagnostic -- a bearing
running hot while the winding is cool is a mechanical problem, not an
electrical one.

Dry running is the one case where the loss falls but the temperature rises:
the liquid is both the load and the coolant, so losing it removes the cooling
that the (now small) remaining loss depends on. That is why the dry-run rise
is added on top of the load term rather than scaled by it.
"""

from __future__ import annotations

import math

from ..config.pump_parameters import THERMAL, ThermalParameters


class ThermalModel:
    """Per-session thermal state for one motor-pump set."""

    #: Cooling is slower than heating: a stopped machine loses its fan.
    COOLING_TAU_FACTOR: float = 1.6
    #: The bearing sees less of the dry-run heat than the winding does.
    BEARING_DRY_RUN_SHARE: float = 0.6

    def __init__(self, thermal: ThermalParameters = THERMAL) -> None:
        self._p = thermal
        self.motor_c: float = thermal.ambient_c
        self.bearing_c: float = thermal.ambient_c

    def reset(self) -> None:
        self.motor_c = self._p.ambient_c
        self.bearing_c = self._p.ambient_c

    def update(self, dt: float, load_fraction: float, prime_loss: float, running: bool) -> None:
        """Advance both states one tick.

        `load_fraction` is shaft power over motor rating, `prime_loss` is the
        dry-run severity (0..1), `running` is False once the shaft has stopped.
        """
        if dt <= 0.0:
            return
        p = self._p
        load = max(0.0, load_fraction)
        dry = min(max(prime_loss, 0.0), 1.0)

        if not running:
            self.motor_c = _relax(self.motor_c, p.ambient_c, dt, p.motor_time_constant_s * self.COOLING_TAU_FACTOR)
            self.bearing_c = _relax(
                self.bearing_c, p.ambient_c, dt, p.bearing_time_constant_s * self.COOLING_TAU_FACTOR
            )
            return

        motor_target = p.ambient_c + p.motor_rise_at_rated_c * load + p.dry_run_extra_rise_c * dry
        bearing_target = (
            p.ambient_c + p.bearing_rise_at_rated_c * load + p.dry_run_extra_rise_c * self.BEARING_DRY_RUN_SHARE * dry
        )

        # Losing the liquid removes the thermal mass with it, so the machine
        # heats on the (much shorter) dry-run time constant. The blend keeps
        # the transition continuous as prime is lost.
        motor_tau = _blend(p.motor_time_constant_s, p.dry_run_time_constant_s, dry)
        bearing_tau = _blend(p.bearing_time_constant_s, p.dry_run_time_constant_s, dry)

        self.motor_c = _relax(self.motor_c, motor_target, dt, motor_tau)
        self.bearing_c = _relax(self.bearing_c, bearing_target, dt, bearing_tau)


def _relax(current: float, target: float, dt: float, tau_s: float) -> float:
    if tau_s <= 0.0:
        return target
    return target + (current - target) * math.exp(-dt / tau_s)


def _blend(a: float, b: float, weight: float) -> float:
    return a + (b - a) * weight
