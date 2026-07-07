import { Canvas } from '@react-three/fiber';
import { Float, MeshDistortMaterial, OrbitControls, Stars } from '@react-three/drei';

function GlowOrb() {
  return (
    <Float speed={1.5} rotationIntensity={0.4} floatIntensity={1.2}>
      <mesh scale={1.8}>
        <icosahedronGeometry args={[1, 4]} />
        <MeshDistortMaterial
          color="#6366f1"
          attach="material"
          distort={0.35}
          speed={1.5}
          roughness={0.2}
          metalness={0.8}
          transparent
          opacity={0.35}
        />
      </mesh>
    </Float>
  );
}

export function Background3D() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none">
      <div className="absolute inset-0 bg-gradient-to-br from-dark-900 via-[#0d0b1a] to-dark-900" />
      <Canvas camera={{ position: [0, 0, 5], fov: 60 }} className="opacity-50">
        <ambientLight intensity={0.4} />
        <pointLight position={[10, 10, 10]} intensity={1.2} color="#818cf8" />
        <Stars radius={80} depth={40} count={6000} factor={4} saturation={0} fade speed={0.8} />
        <GlowOrb />
        <OrbitControls autoRotate autoRotateSpeed={0.35} enableZoom={false} enablePan={false} />
      </Canvas>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.12),_transparent_55%)]" />
    </div>
  );
}
