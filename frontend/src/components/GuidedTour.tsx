/**
 * Five-step guided tour.
 *
 * It navigates to the page it is describing rather than describing it in the
 * abstract, so a reviewer with two minutes sees the actual screens. Skip Tour
 * works from any step and is remembered, so the tour never reappears on refresh.
 */

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Compass, X } from 'lucide-react'
import { TOUR_STEPS, useUiPrefs } from '../state/UiPrefs'

export function GuidedTour() {
  const { tourStep, tourCompleted, startTour, nextTourStep, previousTourStep, skipTour } =
    useUiPrefs()
  const navigate = useNavigate()
  const autoStarted = useRef(false)

  // Offer the tour once, on the visitor's first arrival in the application.
  useEffect(() => {
    if (autoStarted.current || tourCompleted || tourStep !== null) return
    autoStarted.current = true
    startTour()
  }, [tourCompleted, tourStep, startTour])

  const step = tourStep === null ? null : TOUR_STEPS[tourStep]

  useEffect(() => {
    if (step) navigate(step.route)
  }, [step, navigate])

  if (tourStep === null || !step) return null

  const isLast = tourStep === TOUR_STEPS.length - 1

  return (
    <div
      role="dialog"
      aria-label="Guided tour"
      className="fixed right-4 bottom-4 left-4 z-40 mx-auto max-w-md rounded-lg border border-slate-300 bg-white p-4 shadow-xl sm:left-auto"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Compass className="h-4 w-4 text-blue-700" aria-hidden />
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Guided tour -- step {tourStep + 1} of {TOUR_STEPS.length}
          </p>
        </div>
        <button
          type="button"
          onClick={skipTour}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Skip tour"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <h2 className="mt-2 text-base font-semibold text-slate-900">{step.title}</h2>
      <p className="mt-1.5 text-sm text-slate-600">{step.body}</p>

      <div className="mt-3 flex items-center gap-1.5" aria-hidden>
        {TOUR_STEPS.map((s, index) => (
          <span
            key={s.title}
            className={`h-1.5 flex-1 rounded-full ${
              index <= tourStep ? 'bg-blue-700' : 'bg-slate-200'
            }`}
          />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button type="button" className="btn btn-secondary text-xs" onClick={skipTour}>
          Skip tour
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={previousTourStep}
            disabled={tourStep === 0}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </button>
          <button type="button" className="btn btn-primary" onClick={nextTourStep}>
            {isLast ? (
              <>
                <Check className="h-4 w-4" aria-hidden />
                Finish
              </>
            ) : (
              <>
                Next
                <ArrowRight className="h-4 w-4" aria-hidden />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
