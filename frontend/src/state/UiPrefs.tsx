/**
 * Visitor-facing preferences: Recruiter Mode and the guided tour.
 *
 * Persisted to localStorage so a page refresh does not reset the visitor's
 * choices and does not re-launch a tour they already skipped -- being shown the
 * same tour on every refresh is the fastest way to make someone close the tab.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

const RECRUITER_KEY = 'pumpguard.recruiterMode'
const TOUR_KEY = 'pumpguard.tourCompleted'

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : raw === 'true'
  } catch {
    // Private browsing or blocked storage: fall back to the default rather than
    // taking the whole app down over a preference.
    return fallback
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    /* preferences are best-effort */
  }
}

export interface UiPrefsValue {
  /** Hides debug and advanced panels aimed at engineers rather than reviewers. */
  recruiterMode: boolean
  setRecruiterMode: (value: boolean) => void
  tourStep: number | null
  tourCompleted: boolean
  startTour: () => void
  nextTourStep: () => void
  previousTourStep: () => void
  skipTour: () => void
}

const UiPrefsContext = createContext<UiPrefsValue | null>(null)

export function useUiPrefs(): UiPrefsValue {
  const value = useContext(UiPrefsContext)
  if (!value) throw new Error('useUiPrefs must be used inside <UiPrefsProvider>')
  return value
}

export const TOUR_STEPS = [
  {
    title: 'Digital Twin',
    route: '/app/digital-twin',
    body: 'A 3D model of the motor-pump set. The shaft and coupling turn at the measured speed and stop when the asset stops. Click any sensor marker to read its live value, unit, quality and alarm limit.',
  },
  {
    title: 'Vibration Analysis',
    route: '/app/vibration',
    body: 'Time waveform and FFT spectrum. The 1x and 2x reference lines are where imbalance and misalignment show up -- imbalance drives 1x, misalignment lifts 2x. Bearing defect frequencies are calculated from geometry, not detected.',
  },
  {
    title: 'Pump Physics',
    route: '/app/pump-performance',
    body: 'The operating point is the intersection of the pump curve and the system curve. Move the valve slider and watch it travel along the pump curve -- flow, head, efficiency and power all follow from that one intersection.',
  },
  {
    title: 'AI Diagnosis',
    route: '/app/diagnosis',
    body: 'Physics evidence and model evidence are kept in separate panels. Open "Why this diagnosis?" for the feature importances. When the rules and the classifier disagree, the page says so instead of hiding it.',
  },
  {
    title: 'SCADA Control',
    route: '/app/scada',
    body: 'The control state machine with real interlocks. If a command is blocked, the panel tells you which state you are in and why the transition is refused.',
  },
] as const

export function UiPrefsProvider({ children }: { children: ReactNode }) {
  const [recruiterMode, setRecruiterModeState] = useState<boolean>(() =>
    readFlag(RECRUITER_KEY, false),
  )
  const [tourCompleted, setTourCompleted] = useState<boolean>(() => readFlag(TOUR_KEY, false))
  const [tourStep, setTourStep] = useState<number | null>(null)

  useEffect(() => {
    writeFlag(RECRUITER_KEY, recruiterMode)
  }, [recruiterMode])

  const setRecruiterMode = useCallback((value: boolean) => setRecruiterModeState(value), [])

  const startTour = useCallback(() => setTourStep(0), [])

  const finish = useCallback(() => {
    setTourStep(null)
    setTourCompleted(true)
    writeFlag(TOUR_KEY, true)
  }, [])

  const nextTourStep = useCallback(() => {
    setTourStep((step) => {
      if (step === null) return null
      if (step >= TOUR_STEPS.length - 1) {
        setTourCompleted(true)
        writeFlag(TOUR_KEY, true)
        return null
      }
      return step + 1
    })
  }, [])

  const previousTourStep = useCallback(() => {
    setTourStep((step) => (step === null || step === 0 ? step : step - 1))
  }, [])

  const value = useMemo<UiPrefsValue>(
    () => ({
      recruiterMode,
      setRecruiterMode,
      tourStep,
      tourCompleted,
      startTour,
      nextTourStep,
      previousTourStep,
      skipTour: finish,
    }),
    [recruiterMode, setRecruiterMode, tourStep, tourCompleted, startTour, nextTourStep, previousTourStep, finish],
  )

  return <UiPrefsContext.Provider value={value}>{children}</UiPrefsContext.Provider>
}
