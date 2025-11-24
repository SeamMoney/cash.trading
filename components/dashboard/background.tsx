"use client"

export function DashboardBackground() {
  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes float {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(30px, -30px) scale(1.1);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.9);
          }
        }

        @keyframes float-reverse {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(-30px, 30px) scale(0.9);
          }
          66% {
            transform: translate(20px, -20px) scale(1.1);
          }
        }

        @keyframes pulse-slow {
          0%, 100% {
            opacity: 0.1;
            transform: translate(-50%, -50%) scale(1);
          }
          50% {
            opacity: 0.15;
            transform: translate(-50%, -50%) scale(1.05);
          }
        }

        @keyframes grid-shift {
          0% {
            transform: translate(0, 0);
          }
          100% {
            transform: translate(50px, 50px);
          }
        }

        @keyframes scanline {
          0% {
            transform: translateY(-100%);
          }
          100% {
            transform: translateY(100%);
          }
        }

        .orb-1 {
          animation: float 20s ease-in-out infinite;
        }

        .orb-2 {
          animation: float-reverse 15s ease-in-out infinite;
        }

        .orb-3 {
          animation: pulse-slow 10s ease-in-out infinite;
        }

        .grid-animated {
          animation: grid-shift 20s linear infinite;
        }

        .scanline-animated {
          animation: scanline 8s linear infinite;
        }
      `}} />

      <div className="fixed inset-0 z-0 select-none bg-black pointer-events-none overflow-hidden">
        {/* Animated gradient orbs */}
        <div className="absolute inset-0">
          {/* Yellow orb - bottom left */}
          <div
            className="orb-1 absolute w-[600px] h-[600px] rounded-full blur-[120px] opacity-20"
            style={{
              background: 'radial-gradient(circle, rgba(255,246,0,0.4) 0%, transparent 70%)',
              left: '-10%',
              bottom: '-10%',
            }}
          />

          {/* Yellow orb - top right */}
          <div
            className="orb-2 absolute w-[500px] h-[500px] rounded-full blur-[100px] opacity-15"
            style={{
              background: 'radial-gradient(circle, rgba(255,246,0,0.3) 0%, transparent 70%)',
              right: '-5%',
              top: '-5%',
            }}
          />

          {/* Center glow */}
          <div
            className="orb-3 absolute w-[800px] h-[800px] rounded-full blur-[150px] opacity-10"
            style={{
              background: 'radial-gradient(circle, rgba(255,246,0,0.25) 0%, transparent 70%)',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          />
        </div>

        {/* Animated grid */}
        <div
          className="grid-animated absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(rgba(255,246,0,0.5) 1px, transparent 1px),
                             linear-gradient(90deg, rgba(255,246,0,0.5) 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
          }}
        />

        {/* Scanline effect */}
        <div
          className="scanline-animated absolute inset-0 opacity-[0.02]"
          style={{
            background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,246,0,0.3) 2px, rgba(255,246,0,0.3) 4px)',
          }}
        />

        {/* Dark overlay */}
        <div className="absolute inset-0 bg-black/50" />
      </div>
    </>
  )
}
