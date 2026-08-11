/** Quiet atmosphere — subtle, slow, no vestibular motion. */
export function Background3D() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bloom-bg" aria-hidden="true">
      <div
        className="bloom-petal"
        style={{
          top: '0%',
          left: '8%',
          width: '22rem',
          height: '18rem',
          background: 'linear-gradient(145deg, rgba(167,243,208,0.55), rgba(52,211,153,0.2))',
          opacity: 0.28,
        }}
      />
      <div
        className="bloom-petal"
        style={{
          top: '55%',
          right: '-4%',
          width: '24rem',
          height: '18rem',
          background: 'linear-gradient(210deg, rgba(186,230,253,0.45), rgba(125,211,252,0.18))',
          opacity: 0.22,
          animationDelay: '-10s',
        }}
      />
    </div>
  );
}
