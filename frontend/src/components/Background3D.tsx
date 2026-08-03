/** Soft light-theme atmosphere — kept name so existing imports keep working. */
export function Background3D() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bloom-bg" aria-hidden="true">
      <div
        className="bloom-petal"
        style={{
          top: '8%',
          left: '6%',
          width: '14rem',
          height: '16rem',
          background: 'linear-gradient(140deg, #99f6e4, #5eead4)',
        }}
      />
      <div
        className="bloom-petal"
        style={{
          top: '48%',
          right: '4%',
          width: '16rem',
          height: '12rem',
          background: 'linear-gradient(200deg, #bae6fd, #38bdf8)',
          animationDelay: '-5s',
        }}
      />
      <div
        className="bloom-petal"
        style={{
          bottom: '6%',
          left: '32%',
          width: '12rem',
          height: '10rem',
          background: 'linear-gradient(160deg, #fde68a, #fcd34d)',
          animationDelay: '-9s',
        }}
      />
      <div className="absolute inset-0 opacity-[0.035] mix-blend-multiply bg-[url('data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.85%22 numOctaves=%224%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22/%3E%3C/svg%3E')]" />
    </div>
  );
}
