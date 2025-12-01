"use client"
import { memo } from "react"
import { Waves } from "@paper-design/shaders-react"

const MemoizedWaves = memo(Waves)

export function DashboardBackground() {
  return (
    <div className="fixed inset-0 z-0 select-none shader-background bg-black pointer-events-none">
      <div className="absolute inset-0">
        <MemoizedWaves
          colorBack="#000000"
          colorFront="#ffff00"
          scale={1.2}
          rotation={0}
          shape={2}
          frequency={0.35}
          amplitude={0.6}
          spacing={1.1}
          proportion={0.15}
          softness={0.1}
          style={{
            backgroundColor: "#000000",
            height: "100vh",
            width: "100vw",
          }}
        />
      </div>
      <div className="absolute inset-0 bg-black/60" />
    </div>
  )
}
