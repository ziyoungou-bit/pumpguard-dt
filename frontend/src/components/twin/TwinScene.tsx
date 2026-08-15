/**
 * React Three Fiber scene for the motor-pump digital twin.
 *
 * What is real and what is a visual aid:
 *   - Shaft and coupling rotation is driven by the measured rpm, so the twin
 *     stops when the asset stops and speeds up when the asset speeds up.
 *   - The shake is EXAGGERATED. True vibration displacement at 4 mm/s and
 *     24 Hz is about 26 micrometres -- invisible at this scale. The scene
 *     multiplies it by a large fixed factor purely so the viewer can see the
 *     condition change, and every surface that shows it says so. It must never
 *     be read as true displacement.
 *   - Temperature drives a restrained warm tint on the motor body. It is an
 *     indication, not a thermal image.
 */

import { VIBRATION } from '../../lib/pumpParameters.generated'
import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { Telemetry } from '../../types/contracts'
import { AssetState } from '../../types/contracts'
import { ASSET_TAGS } from '../../lib/pumpPhysics'

/** How much the visual shake is magnified relative to real displacement. */
export const VIBRATION_MAGNIFICATION = 400

export interface SensorMarkerSpec {
  tag: string
  label: string
  position: [number, number, number]
  unit: string
  read: (t: Telemetry) => number
  /** High alarm limit for the reading, in the same unit. */
  alarmLimit: number
  digits: number
}

export const SENSOR_MARKERS: SensorMarkerSpec[] = [
  {
    tag: ASSET_TAGS.accelerometer,
    label: 'Pump bearing accelerometer',
    position: [-0.02, 0.62, 0.2],
    unit: 'mm/s',
    read: (t) => t.vibration_rms_mm_s,
    alarmLimit: VIBRATION.zone_c_d_mm_s,
    digits: 2,
  },
  {
    tag: ASSET_TAGS.motor_temperature,
    label: 'Motor winding temperature',
    position: [-0.75, 0.66, 0.14],
    unit: 'degC',
    read: (t) => t.motor_temperature_c,
    alarmLimit: 78,
    digits: 1,
  },
  {
    tag: ASSET_TAGS.bearing_temperature,
    label: 'Pump bearing temperature',
    position: [-0.05, 0.5, -0.26],
    unit: 'degC',
    read: (t) => t.bearing_temperature_c,
    alarmLimit: 62,
    digits: 1,
  },
  {
    tag: ASSET_TAGS.suction_pressure,
    label: 'Suction pressure',
    position: [0.95, 0.42, 0],
    unit: 'kPa abs',
    read: (t) => t.suction_pressure_kpa,
    alarmLimit: 120,
    digits: 1,
  },
  {
    tag: ASSET_TAGS.discharge_pressure,
    label: 'Discharge pressure',
    position: [0.22, 0.98, 0.12],
    unit: 'kPa abs',
    read: (t) => t.discharge_pressure_kpa,
    alarmLimit: 260,
    digits: 1,
  },
  {
    tag: ASSET_TAGS.flow,
    label: 'Discharge flow',
    position: [0.78, 1.16, 0],
    unit: 'L/min',
    read: (t) => t.flow_lpm,
    alarmLimit: 32,
    digits: 1,
  },
  {
    tag: ASSET_TAGS.current,
    label: 'Motor line current',
    position: [-1.02, 0.58, 0.3],
    unit: 'A',
    read: (t) => t.motor_current_a,
    alarmLimit: 1.09,
    digits: 2,
  },
]

// --------------------------------------------------------------------------
// Materials
// --------------------------------------------------------------------------

const STEEL = '#9aa3ad'
const CAST_IRON = '#6b7280'
const BASEPLATE = '#3f4650'
const COUPLING = '#c2410c'

/** Cold motor colour warming toward amber. Deliberately restrained. */
function motorColour(temperatureC: number): string {
  const t = THREE.MathUtils.clamp((temperatureC - 25) / 65, 0, 1)
  const cold = new THREE.Color('#4b5563')
  const hot = new THREE.Color('#b45309')
  return `#${cold.clone().lerp(hot, t).getHexString()}`
}

// --------------------------------------------------------------------------
// Rotating assembly
// --------------------------------------------------------------------------

function RotatingAssembly({ rpm, running }: { rpm: number; running: boolean }) {
  const group = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    if (!group.current) return
    // Rotate at the true shaft rate. At 1450 rpm that is 24.2 rev/s, which will
    // strobe against the display refresh -- that is honest behaviour for a real
    // speed, and the RPM readout beside the scene is the authoritative value.
    const radiansPerSecond = running ? (rpm / 60) * Math.PI * 2 : 0
    group.current.rotation.x += radiansPerSecond * delta
  })

  // The group is not pre-rotated: each cylinder is laid along X by its own
  // rotation, so spinning the group about X spins them about their own axis.
  return (
    <group ref={group}>
      {/* Shaft between motor and pump */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 0.42, 24]} />
        <meshStandardMaterial color={STEEL} metalness={0.85} roughness={0.3} />
      </mesh>
      {/* Flexible coupling */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.095, 0.095, 0.16, 24]} />
        <meshStandardMaterial color={COUPLING} metalness={0.2} roughness={0.55} />
      </mesh>
      {/* Coupling bolts: off-axis features, so the rotation is actually visible */}
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          rotation={[0, 0, Math.PI / 2]}
          position={[0, Math.cos((i * Math.PI) / 2) * 0.06, Math.sin((i * Math.PI) / 2) * 0.06]}
        >
          <cylinderGeometry args={[0.016, 0.016, 0.19, 12]} />
          <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
    </group>
  )
}

// --------------------------------------------------------------------------
// Static machine geometry
// --------------------------------------------------------------------------

function MotorPumpAssembly({ telemetry, valveOpening }: { telemetry: Telemetry; valveOpening: number }) {
  const motorMaterialColour = motorColour(telemetry.motor_temperature_c)

  return (
    <group>
      {/* Baseplate */}
      <mesh position={[-0.15, -0.02, 0]} receiveShadow>
        <boxGeometry args={[2.3, 0.07, 0.85]} />
        <meshStandardMaterial color={BASEPLATE} metalness={0.3} roughness={0.8} />
      </mesh>

      {/* Motor MTR-101 */}
      <group position={[-0.75, 0.34, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.22, 0.22, 0.6, 32]} />
          <meshStandardMaterial color={motorMaterialColour} metalness={0.4} roughness={0.6} />
        </mesh>
        {/* Cooling fins */}
        {[-0.2, -0.1, 0, 0.1, 0.2].map((x) => (
          <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.235, 0.235, 0.02, 32]} />
            <meshStandardMaterial color={motorMaterialColour} metalness={0.4} roughness={0.7} />
          </mesh>
        ))}
        {/* Terminal box */}
        <mesh position={[-0.2, 0.2, 0.16]} castShadow>
          <boxGeometry args={[0.16, 0.12, 0.14]} />
          <meshStandardMaterial color="#374151" roughness={0.7} />
        </mesh>
        {/* Feet */}
        <mesh position={[0, -0.28, 0]}>
          <boxGeometry args={[0.5, 0.14, 0.36]} />
          <meshStandardMaterial color="#4b5563" roughness={0.8} />
        </mesh>
      </group>

      {/* Bearing housing / pump pedestal */}
      <mesh position={[-0.06, 0.34, 0]} castShadow>
        <boxGeometry args={[0.2, 0.26, 0.24]} />
        <meshStandardMaterial color={CAST_IRON} roughness={0.7} />
      </mesh>
      <mesh position={[-0.06, 0.13, 0]}>
        <boxGeometry args={[0.22, 0.2, 0.3]} />
        <meshStandardMaterial color="#4b5563" roughness={0.8} />
      </mesh>

      {/* Pump casing P-101 (volute) */}
      <group position={[0.24, 0.36, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.3, 0.3, 0.24, 40]} />
          <meshStandardMaterial color={CAST_IRON} metalness={0.35} roughness={0.65} />
        </mesh>
        {/* Suction nozzle, axial */}
        <mesh position={[0.22, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.085, 0.085, 0.2, 24]} />
          <meshStandardMaterial color={CAST_IRON} roughness={0.65} />
        </mesh>
        {/* Discharge nozzle, radial (upward) */}
        <mesh position={[0, 0.3, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 0.16, 24]} />
          <meshStandardMaterial color={CAST_IRON} roughness={0.65} />
        </mesh>
      </group>

      {/* Suction line: pump -> reservoir */}
      <mesh position={[0.72, 0.36, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, 0.72, 20]} />
        <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[1.08, 0.36, 0]}>
        <sphereGeometry args={[0.065, 20, 20]} />
        <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[1.08, 0.16, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.42, 20]} />
        <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.35} />
      </mesh>

      {/* Discharge line: pump -> up -> across */}
      <mesh position={[0.24, 0.72, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.56, 20]} />
        <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[0.24, 1.0, 0]}>
        <sphereGeometry args={[0.055, 20, 20]} />
        <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[0.62, 1.0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.05, 0.05, 0.76, 20]} />
        <meshStandardMaterial color={STEEL} metalness={0.7} roughness={0.35} />
      </mesh>

      {/* Control valve on the discharge line, handle angle tracks the opening */}
      <group position={[0.24, 0.86, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.16, 0.14, 0.16]} />
          <meshStandardMaterial color="#1e3a8a" metalness={0.3} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.13, 0]} rotation={[0, (1 - valveOpening) * Math.PI * 0.5, 0]}>
          <boxGeometry args={[0.26, 0.025, 0.05]} />
          <meshStandardMaterial color="#dc2626" roughness={0.5} />
        </mesh>
      </group>

      {/* Reservoir with a water surface */}
      <group position={[1.35, 0.0, 0]}>
        <mesh position={[0, 0.16, 0]}>
          <boxGeometry args={[0.62, 0.34, 0.5]} />
          <meshStandardMaterial color="#94a3b8" transparent opacity={0.28} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0.11, 0]}>
          <boxGeometry args={[0.58, 0.22, 0.46]} />
          <meshStandardMaterial color="#1d4ed8" transparent opacity={0.45} roughness={0.15} />
        </mesh>
      </group>
    </group>
  )
}

// --------------------------------------------------------------------------
// Sensor markers
// --------------------------------------------------------------------------

function SensorMarker({
  spec,
  telemetry,
  selected,
  onSelect,
}: {
  spec: SensorMarkerSpec
  telemetry: Telemetry
  selected: boolean
  onSelect: (tag: string) => void
}) {
  const value = spec.read(telemetry)
  const inAlarm = value >= spec.alarmLimit
  const colour = inAlarm ? '#b91c1c' : selected ? '#1d4ed8' : '#0f172a'

  return (
    <group position={spec.position}>
      <mesh
        onClick={(event) => {
          event.stopPropagation()
          onSelect(spec.tag)
        }}
        onPointerOver={(event) => {
          event.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          document.body.style.cursor = 'auto'
        }}
      >
        <sphereGeometry args={[selected ? 0.05 : 0.038, 20, 20]} />
        <meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.25} />
      </mesh>
      <Html distanceFactor={3.2} position={[0, 0.09, 0]} center>
        <button
          type="button"
          onClick={() => onSelect(spec.tag)}
          className={`numeric rounded border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap shadow-sm ${
            inAlarm
              ? 'border-red-400 bg-red-50 text-red-800'
              : selected
                ? 'border-blue-500 bg-blue-50 text-blue-800'
                : 'border-slate-300 bg-white/95 text-slate-700'
          }`}
        >
          {spec.tag}
        </button>
      </Html>
    </group>
  )
}

// --------------------------------------------------------------------------
// Shake wrapper
// --------------------------------------------------------------------------

function VibrationShake({
  telemetry,
  running,
  children,
}: {
  telemetry: Telemetry
  running: boolean
  children: React.ReactNode
}) {
  const group = useRef<THREE.Group>(null)
  const elapsed = useRef(0)

  useFrame((_, delta) => {
    if (!group.current) return
    elapsed.current += delta
    if (!running) {
      group.current.position.set(0, 0, 0)
      return
    }
    // Peak displacement from velocity RMS: x_pk = sqrt(2) * v_rms / (2 pi f).
    // In metres this is tens of microns, hence the magnification factor.
    const f = Math.max(1, telemetry.rotational_frequency_hz)
    const displacementM = (Math.SQRT2 * (telemetry.vibration_rms_mm_s / 1000)) / (2 * Math.PI * f)
    const amplitude = Math.min(0.05, displacementM * VIBRATION_MAGNIFICATION)
    const phase = 2 * Math.PI * f * elapsed.current
    group.current.position.set(
      amplitude * Math.sin(phase),
      amplitude * Math.sin(phase * 2 + 0.6) * 0.7,
      amplitude * Math.cos(phase) * 0.4,
    )
  })

  return <group ref={group}>{children}</group>
}

// --------------------------------------------------------------------------
// Scene
// --------------------------------------------------------------------------

export function TwinScene({
  telemetry,
  valveOpening,
  selectedTag,
  onSelectTag,
}: {
  telemetry: Telemetry
  valveOpening: number
  selectedTag: string | null
  onSelectTag: (tag: string | null) => void
}) {
  const running =
    telemetry.asset_state === AssetState.RUNNING || telemetry.asset_state === AssetState.STARTING
  const markers = useMemo(() => SENSOR_MARKERS, [])

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [1.9, 1.5, 2.2], fov: 42 }}
      onPointerMissed={() => onSelectTag(null)}
      style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #e6eaef 100%)' }}
    >
      {/*
        Lit with plain lights rather than drei's <Environment preset>, which
        fetches an HDR from a CDN at runtime. A portfolio site that has to reach
        a third-party asset host to render its centrepiece is one outage away
        from a black canvas.
      */}
      <ambientLight intensity={0.85} />
      <hemisphereLight args={['#ffffff', '#94a3b8', 0.6]} />
      <directionalLight position={[3, 5, 4]} intensity={1.6} castShadow />
      <directionalLight position={[-4, 2, -3]} intensity={0.45} />

      <VibrationShake telemetry={telemetry} running={running}>
        <MotorPumpAssembly telemetry={telemetry} valveOpening={valveOpening} />
        <group position={[-0.25, 0.34, 0]}>
          <RotatingAssembly rpm={telemetry.rpm} running={running} />
        </group>
      </VibrationShake>

      {markers.map((spec) => (
        <SensorMarker
          key={spec.tag}
          spec={spec}
          telemetry={telemetry}
          selected={selectedTag === spec.tag}
          onSelect={onSelectTag}
        />
      ))}

      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]} receiveShadow>
        <planeGeometry args={[8, 8]} />
        <meshStandardMaterial color="#dbe1e8" roughness={0.95} />
      </mesh>

      <OrbitControls
        enablePan={false}
        minDistance={1.6}
        maxDistance={6}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 0.4, 0]}
      />
    </Canvas>
  )
}
