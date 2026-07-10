"use client"
import { memo } from "react"
import { Dithering } from "@paper-design/shaders-react"

const MemoizedDithering = memo(Dithering)

export function DashboardBackground() {
  return (
    <div className="fixed inset-0 z-0 select-none shader-background bg-black pointer-events-none">
      <div className="absolute inset-0 translate-y-[25%] scale-125">
        <MemoizedDithering
          colorBack="#00000000"
          colorFront="#5a5a00"
          speed={0.43}
          shape="wave"
          type="4x4"
          pxSize={3}
          scale={1.5}
          style={{
            backgroundColor: "#000000",
            height: "100vh",
            width: "100vw",
          }}
        />
      </div>
      {/* Heavier dim so the shader never bleeds through translucent cards
          (leaderboard rows, bot config form) and text stays readable. */}
      <div className="absolute inset-0 bg-black/80" />
    </div>
  )
}
