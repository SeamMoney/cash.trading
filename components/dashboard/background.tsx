"use client"

export function DashboardBackground() {
  return (
    <div className="fixed inset-0 z-0 select-none bg-black pointer-events-none">
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-black via-zinc-900 to-black opacity-90" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,246,0,0.05),transparent_50%)]" />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,246,0,0.5) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(255,246,0,0.5) 1px, transparent 1px)`,
          backgroundSize: '50px 50px'
        }}
      />

      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/40" />
    </div>
  )
}
