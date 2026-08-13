/**
 * The single source of live truth for the whole app.
 *
 * Connection strategy, in priority order:
 *
 *   1. LIVE   -- /ws/realtime is open and delivering Telemetry frames.
 *   2. DEMO   -- the backend is unreachable. The bundled recorded dataset is
 *                replayed, labelled "Recorded Demo" everywhere. If the visitor
 *                touches a control, the browser-side plant model takes over so
 *                the SCADA and Simulation Lab pages still respond.
 *
 * There is deliberately no third state where the UI shows nothing. A blank
 * chart on a portfolio site reads as a broken portfolio site, so the fallback
 * engages immediately on mount rather than after the first failure -- the app
 * starts in DEMO and is promoted to LIVE the moment a real frame arrives.
 *
 * Reconnection uses exponential backoff with jitter (1 s, 2 s, 4 s ... capped at
 * 20 s). Backoff rather than a fixed retry because a backend that is down tends
 * to stay down for a while, and a tight retry loop from every open tab is how a
 * cold-starting server is kept cold.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Alarm, Diagnosis, Telemetry } from '../types/contracts'
import { AssetState, DataSource, FaultType } from '../types/contracts'
import * as api from '../lib/api'
import { realtimeSocketUrl } from '../lib/env'
import { DEMO_FRAMES, DEMO_TICK_S, demoAlarms, demoDiagnosis, demoValveOpening } from '../data/recordedDemo'
import {
  applyCommand,
  commandBlockedReason,
  initialLocalSimState,
  tickLocalSim,
  type LocalSimState,
  type ScadaCommand,
} from './localSim'

export type ConnectionMode = 'live' | 'demo'
/** Within DEMO: replaying the bundled recording, or running the local model. */
export type DemoMode = 'replay' | 'interactive'

const TICK_MS = DEMO_TICK_S * 1000
const HISTORY_LIMIT = 3600 // 30 minutes at 0.5 s
const LIVE_TIMEOUT_MS = 4000
const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 20000
const POLL_MS = 2500

export interface AppStateValue {
  telemetry: Telemetry
  history: Telemetry[]
  diagnosis: Diagnosis
  alarms: Alarm[]
  connection: ConnectionMode
  demoMode: DemoMode
  /** True while the first connection attempt is still outstanding. */
  connecting: boolean
  reconnectAttempts: number
  sessionId?: string
  /** Present only when the backend supplied it. */
  diagnosisFromApi: boolean
  valveOpening: number
  rpmSetpoint: number
  noise: number
  autoMode: boolean
  operatingHours: number
  blockedReason: string
  lastCommandFeedback: string

  sendCommand: (command: ScadaCommand) => void
  setValveOpening: (opening: number) => void
  setRpmSetpoint: (rpm: number) => void
  setNoise: (noise: number) => void
  injectFault: (fault: string, severity: number) => void
  clearFault: () => void
  acknowledgeAlarm: (id: number) => void
  isCommandBlocked: (command: ScadaCommand) => string | null
}

const AppStateContext = createContext<AppStateValue | null>(null)

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext)
  if (!value) throw new Error('useAppState must be used inside <AppStateProvider>')
  return value
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [telemetry, setTelemetry] = useState<Telemetry>(DEMO_FRAMES[0])
  const [history, setHistory] = useState<Telemetry[]>([DEMO_FRAMES[0]])
  const [apiDiagnosis, setApiDiagnosis] = useState<Diagnosis | null>(null)
  const [apiAlarms, setApiAlarms] = useState<Alarm[] | null>(null)
  const [connection, setConnection] = useState<ConnectionMode>('demo')
  const [demoMode, setDemoMode] = useState<DemoMode>('replay')
  const [connecting, setConnecting] = useState(true)
  const [reconnectAttempts, setReconnectAttempts] = useState(0)
  const [sessionId, setSessionId] = useState<string | undefined>(undefined)
  const [sim, setSim] = useState<LocalSimState>(initialLocalSimState)
  const [acknowledged, setAcknowledged] = useState<Record<number, string>>({})
  const [lastCommandFeedback, setLastCommandFeedback] = useState('')

  // Refs mirror the pieces the timers and socket handlers need, so those
  // callbacks never close over stale state.
  const connectionRef = useRef<ConnectionMode>('demo')
  const demoModeRef = useRef<DemoMode>('replay')
  const simRef = useRef<LocalSimState>(sim)
  const replayIndexRef = useRef(0)
  const lastFrameAtRef = useRef(0)
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<number | null>(null)
  const attemptRef = useRef(0)
  const disposedRef = useRef(false)

  simRef.current = sim
  connectionRef.current = connection
  demoModeRef.current = demoMode

  const pushFrame = useCallback((frame: Telemetry) => {
    setTelemetry(frame)
    setHistory((previous) => {
      const next = previous.length >= HISTORY_LIMIT ? previous.slice(1) : previous.slice()
      next.push(frame)
      return next
    })
  }, [])

  // ---------------------------------------------------------------- websocket
  useEffect(() => {
    disposedRef.current = false

    const scheduleReconnect = () => {
      if (disposedRef.current) return
      const attempt = attemptRef.current
      const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt)
      // Jitter spreads reconnects from multiple tabs instead of synchronising them.
      const jittered = delay * (0.7 + Math.random() * 0.6)
      attemptRef.current = attempt + 1
      setReconnectAttempts(attempt + 1)
      reconnectTimerRef.current = window.setTimeout(connect, jittered)
    }

    const connect = () => {
      if (disposedRef.current) return
      let socket: WebSocket
      try {
        socket = new WebSocket(realtimeSocketUrl(api.getSessionId()))
      } catch {
        scheduleReconnect()
        return
      }
      socketRef.current = socket

      socket.onopen = () => {
        attemptRef.current = 0
        setReconnectAttempts(0)
      }

      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data as string) as Telemetry
          // Guard against a payload that parses but is not Telemetry: without
          // this a stray message would blank every gauge with undefined.
          if (typeof frame?.rpm !== 'number' || typeof frame?.vibration_rms_mm_s !== 'number') return
          lastFrameAtRef.current = Date.now()
          setConnecting(false)
          if (connectionRef.current !== 'live') setConnection('live')
          pushFrame(frame)
        } catch {
          // A malformed frame is dropped; the stream is not torn down for it.
        }
      }

      socket.onerror = () => {
        socket.close()
      }

      socket.onclose = () => {
        socketRef.current = null
        setConnecting(false)
        if (connectionRef.current === 'live') {
          // Fall back to the recording rather than freezing on the last frame.
          setConnection('demo')
        }
        scheduleReconnect()
      }
    }

    // Session first (optional endpoint), then the socket. If /api/session is
    // absent we connect without a session_id rather than blocking on it.
    api
      .openSession()
      .then((id) => {
        if (disposedRef.current) return
        setSessionId(id)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!disposedRef.current) connect()
      })

    return () => {
      disposedRef.current = true
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current)
      const socket = socketRef.current
      socketRef.current = null
      if (socket) {
        socket.onclose = null
        socket.onerror = null
        socket.onmessage = null
        socket.close()
      }
    }
  }, [pushFrame])

  // ------------------------------------------------------------- demo ticker
  // Runs continuously. It only emits frames while the app is NOT live, so a
  // healthy websocket silently suppresses it and a dropped one resumes it
  // within one tick.
  useEffect(() => {
    const id = window.setInterval(() => {
      const isLive =
        connectionRef.current === 'live' && Date.now() - lastFrameAtRef.current < LIVE_TIMEOUT_MS
      if (isLive) return
      if (connectionRef.current === 'live') setConnection('demo')

      if (demoModeRef.current === 'interactive') {
        const advanced = tickLocalSim(simRef.current, DEMO_TICK_S)
        simRef.current = advanced.state
        setSim(advanced.state)
        pushFrame(advanced.frame)
      } else {
        const index = replayIndexRef.current
        replayIndexRef.current = (index + 1) % DEMO_FRAMES.length
        pushFrame(DEMO_FRAMES[index])
      }
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [pushFrame])

  // --------------------------------------------------- diagnosis + alarm poll
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      if (connectionRef.current !== 'live') {
        if (!cancelled) {
          setApiDiagnosis(null)
          setApiAlarms(null)
        }
        return
      }
      const [diagnosis, alarms] = await Promise.all([api.getDiagnosis(), api.getAlarms()])
      if (cancelled) return
      setApiDiagnosis(diagnosis)
      setApiAlarms(Array.isArray(alarms) ? alarms : null)
    }
    void poll()
    const id = window.setInterval(() => void poll(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [connection])

  // ------------------------------------------------------------------ actions
  /** Any control input while offline hands the plant to the local model. */
  const enterInteractive = useCallback(() => {
    if (connectionRef.current === 'live') return false
    if (demoModeRef.current !== 'interactive') {
      // Seed the local model from the frame currently on screen so the handover
      // is continuous rather than snapping back to a cold machine.
      const frame = DEMO_FRAMES[replayIndexRef.current]
      const seeded: LocalSimState = {
        ...initialLocalSimState(),
        asset_state: frame.asset_state,
        rpm: frame.rpm,
        rpm_setpoint: frame.rpm > 100 ? frame.rpm : 1450,
        valve_opening: demoValveOpening(frame),
        motor_temperature_c: frame.motor_temperature_c,
        bearing_temperature_c: frame.bearing_temperature_c,
        elapsed_s: frame.elapsed_s,
        started_at_ms: Date.now() - frame.elapsed_s * 1000,
      }
      simRef.current = seeded
      setSim(seeded)
      demoModeRef.current = 'interactive'
      setDemoMode('interactive')
    }
    return true
  }, [])

  const sendCommand = useCallback(
    (command: ScadaCommand) => {
      if (connectionRef.current === 'live') {
        if (command === 'auto' || command === 'manual' || command === 'maintenance') {
          setLastCommandFeedback(`${command.toUpperCase()} requested`)
          return
        }
        void api.sendControl(command).then((result) => {
          setLastCommandFeedback(
            result?.accepted === false
              ? (result.blocked_reason ?? 'Command refused by the controller')
              : `${command.toUpperCase()} accepted`,
          )
        })
        return
      }
      enterInteractive()
      const blocked = commandBlockedReason(simRef.current, command)
      const next = applyCommand(simRef.current, command)
      simRef.current = next
      setSim(next)
      setLastCommandFeedback(blocked ?? `${command.toUpperCase()} accepted`)
    },
    [enterInteractive],
  )

  const setValveOpening = useCallback(
    (opening: number) => {
      const clamped = Math.min(1, Math.max(0, opening))
      if (connectionRef.current === 'live') {
        void api.setValve(clamped)
        return
      }
      enterInteractive()
      const next = { ...simRef.current, valve_opening: clamped }
      simRef.current = next
      setSim(next)
    },
    [enterInteractive],
  )

  const setRpmSetpoint = useCallback(
    (rpm: number) => {
      const clamped = Math.min(1750, Math.max(0, rpm))
      if (connectionRef.current === 'live') {
        void api.setSpeed(clamped)
        return
      }
      enterInteractive()
      const next = { ...simRef.current, rpm_setpoint: clamped }
      simRef.current = next
      setSim(next)
    },
    [enterInteractive],
  )

  const setNoise = useCallback(
    (noise: number) => {
      const clamped = Math.min(1, Math.max(0, noise))
      enterInteractive()
      const next = { ...simRef.current, noise: clamped }
      simRef.current = next
      setSim(next)
    },
    [enterInteractive],
  )

  const injectFault = useCallback(
    (fault: string, severity: number) => {
      const clamped = Math.min(1, Math.max(0, severity))
      if (connectionRef.current === 'live') {
        void api.injectFault(fault, clamped)
        setLastCommandFeedback(`Injected ${fault} at severity ${clamped.toFixed(2)}`)
        return
      }
      enterInteractive()
      const next = { ...simRef.current, fault_state: fault, severity: clamped }
      simRef.current = next
      setSim(next)
      setLastCommandFeedback(`Injected ${fault} at severity ${clamped.toFixed(2)}`)
    },
    [enterInteractive],
  )

  const clearFault = useCallback(() => {
    if (connectionRef.current === 'live') {
      void api.clearFault()
      setLastCommandFeedback('Fault cleared')
      return
    }
    enterInteractive()
    const next = { ...simRef.current, fault_state: FaultType.NORMAL, severity: 0 }
    simRef.current = next
    setSim(next)
    setLastCommandFeedback('Fault cleared')
  }, [enterInteractive])

  const acknowledgeAlarmAction = useCallback((id: number) => {
    const at = new Date().toISOString()
    setAcknowledged((previous) => ({ ...previous, [id]: at }))
    if (connectionRef.current === 'live') void api.acknowledgeAlarm(id)
  }, [])

  const isCommandBlocked = useCallback(
    (command: ScadaCommand) => {
      if (connection === 'live') return null
      return commandBlockedReason(sim, command)
    },
    [connection, sim],
  )

  // ---------------------------------------------------------------- derived
  const diagnosis = useMemo<Diagnosis>(
    () => apiDiagnosis ?? demoDiagnosis(telemetry),
    [apiDiagnosis, telemetry],
  )

  const alarms = useMemo<Alarm[]>(() => {
    const base = apiAlarms ?? demoAlarms(telemetry)
    return base.map((alarm) =>
      acknowledged[alarm.id]
        ? { ...alarm, acknowledged: true, acknowledged_at: acknowledged[alarm.id] }
        : alarm,
    )
  }, [apiAlarms, telemetry, acknowledged])

  const valveOpening =
    connection === 'live'
      ? 1
      : demoMode === 'interactive'
        ? sim.valve_opening
        : demoValveOpening(telemetry)

  const value = useMemo<AppStateValue>(
    () => ({
      telemetry,
      history,
      diagnosis,
      alarms,
      connection,
      demoMode,
      connecting,
      reconnectAttempts,
      sessionId,
      diagnosisFromApi: apiDiagnosis !== null,
      valveOpening,
      rpmSetpoint: demoMode === 'interactive' ? sim.rpm_setpoint : telemetry.rpm || 1450,
      noise: sim.noise,
      autoMode: sim.auto_mode,
      operatingHours: sim.operating_hours,
      blockedReason: sim.blocked_reason,
      lastCommandFeedback,
      sendCommand,
      setValveOpening,
      setRpmSetpoint,
      setNoise,
      injectFault,
      clearFault,
      acknowledgeAlarm: acknowledgeAlarmAction,
      isCommandBlocked,
    }),
    [
      telemetry,
      history,
      diagnosis,
      alarms,
      connection,
      demoMode,
      connecting,
      reconnectAttempts,
      sessionId,
      apiDiagnosis,
      valveOpening,
      sim,
      lastCommandFeedback,
      sendCommand,
      setValveOpening,
      setRpmSetpoint,
      setNoise,
      injectFault,
      clearFault,
      acknowledgeAlarmAction,
      isCommandBlocked,
    ],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

/** Label shown in the header. Never says "live" unless the socket is live. */
export function dataSourceLabel(connection: ConnectionMode, telemetry: Telemetry): string {
  if (connection === 'live') {
    return telemetry.data_source === DataSource.LIVE_DEVICE ? 'LIVE DEVICE' : 'SIMULATION'
  }
  return 'RECORDED DEMO'
}

export const isRunning = (state: string) =>
  state === AssetState.RUNNING || state === AssetState.STARTING
