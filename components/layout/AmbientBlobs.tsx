interface BlobConfig {
  color: string;
  size: number;
  style: React.CSSProperties;
  animDelay?: string;
}

const CONFIGS: Record<string, BlobConfig[]> = {
  home: [
    { color: "blob-pomegranate", size: 600, style: { top: -200, right: -100 }, animDelay: undefined },
    { color: "blob-purple", size: 500, style: { top: 500, left: -200 }, animDelay: "blob-animate-delay-1" },
    { color: "blob-blue", size: 400, style: { bottom: 300, right: -150 }, animDelay: "blob-animate-delay-2" },
    { color: "blob-pomegranate", size: 300, style: { bottom: 800, left: "20%" }, animDelay: "blob-animate-delay-1" },
  ],
  earn: [
    { color: "blob-pomegranate", size: 500, style: { top: -100, right: -80 } },
    { color: "blob-purple", size: 400, style: { top: 600, left: -150 }, animDelay: "blob-animate-delay-1" },
  ],
  trade: [
    { color: "blob-pomegranate", size: 450, style: { top: -120, right: -60 } },
    { color: "blob-blue", size: 400, style: { bottom: 200, left: -100 }, animDelay: "blob-animate-delay-1" },
  ],
  send: [
    { color: "blob-blue", size: 500, style: { top: -150, left: -100 } },
    { color: "blob-pomegranate", size: 350, style: { bottom: 200, right: -80 }, animDelay: "blob-animate-delay-1" },
  ],
  "agent-bank": [
    { color: "blob-purple", size: 550, style: { top: -180, right: -120 } },
    { color: "blob-pomegranate", size: 400, style: { top: 500, left: -150 }, animDelay: "blob-animate-delay-1" },
    { color: "blob-blue", size: 300, style: { bottom: 100, right: "10%" }, animDelay: "blob-animate-delay-2" },
  ],
  launchpad: [
    { color: "blob-purple", size: 500, style: { top: -150, right: -80 } },
    { color: "blob-pomegranate", size: 400, style: { top: 600, left: -120 }, animDelay: "blob-animate-delay-1" },
    { color: "blob-blue", size: 300, style: { bottom: 200, right: "5%" }, animDelay: "blob-animate-delay-2" },
  ],
};

interface AmbientBlobsProps {
  variant?: keyof typeof CONFIGS;
}

export function AmbientBlobs({ variant = "home" }: AmbientBlobsProps) {
  const blobs = CONFIGS[variant] ?? CONFIGS.home;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {blobs.map((blob, i) => (
        <div
          key={i}
          className={`ambient-blob ${blob.color} blob-animate ${blob.animDelay ?? ""} opacity-50 sm:opacity-70`}
          style={{
            width: blob.size,
            height: blob.size,
            ...blob.style,
          }}
        />
      ))}
    </div>
  );
}
