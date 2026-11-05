import type { Metadata } from "next";
import { PineStudio } from "../../components/pine-studio/PineStudio";
import { compilePineToSolana } from "../../lib/pine-solana/compiler";
import { STUDIO_EXAMPLES } from "../../lib/pine-solana/studio-model";
import type { CompileResult } from "../../lib/pine-solana/ir";

export const metadata: Metadata = {
  title: "Pine Studio — cash.trading",
  description: "Your Pine ideas, one step closer to Solana. Preview scripts, inspect signals, and export a Solana project.",
};

export default function PineStudioPage() {
  // Match the HTTP API's plain JSON boundary; the compiler intentionally uses
  // prototype-free metadata dictionaries, which React Server Components reject.
  const initialCompile = JSON.parse(JSON.stringify(compilePineToSolana(STUDIO_EXAMPLES[0].source))) as CompileResult;
  return <PineStudio initialCompile={initialCompile} />;
}
