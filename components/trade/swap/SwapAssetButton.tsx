import Image from "next/image";
import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { PRESSABLE_CONTROL } from "@/lib/surface";

export interface SwapAssetButtonProps {
  symbol: string;
  iconSrc: string;
  onSelect?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  expanded?: boolean;
  className?: string;
}

const BADGE_STYLES =
  "group flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-card-border bg-background-secondary px-2 font-display text-base font-semibold text-foreground min-[360px]:gap-2 min-[360px]:px-3";

export const SwapAssetButton = forwardRef<HTMLButtonElement, SwapAssetButtonProps>(function SwapAssetButton({
  symbol,
  iconSrc,
  onSelect,
  disabled = false,
  ariaLabel,
  expanded,
  className,
}, ref) {
  const content = (
    <>
      <Image
        src={iconSrc}
        alt=""
        width={28}
        height={28}
        className={cn(
          "size-6 shrink-0 rounded-full object-cover transition-[transform,opacity] duration-150 ease-out motion-reduce:!scale-100 motion-reduce:transition-none min-[360px]:size-7 [@media(hover:hover)_and_(pointer:fine)]:group-hover:scale-[1.04] group-active:scale-[0.96]",
          // The APT mark is white-on-transparent, so it keeps a black plate in
          // both themes (--color-black is deliberately not remapped in light).
          symbol === "APT" && "bg-black p-[3px] object-contain",
        )}
      />
      <span>{symbol}</span>
      {onSelect && (
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "-mr-0.5 size-3.5 shrink-0 text-foreground-secondary transition-[transform,opacity] duration-150 ease-out motion-reduce:!translate-y-0 motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:group-hover:translate-y-0.5",
            expanded && "rotate-180",
          )}
          strokeWidth={2.5}
        />
      )}
    </>
  );

  if (!onSelect) {
    return <span className={cn(BADGE_STYLES, className)}>{content}</span>;
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-label={ariaLabel ?? `Choose asset, currently ${symbol}`}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      className={cn(
        BADGE_STYLES,
        PRESSABLE_CONTROL,
        "transition-[transform,opacity] outline-none hover:border-border-strong hover:bg-card-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background-tertiary disabled:cursor-not-allowed disabled:transform-none disabled:opacity-50 motion-reduce:!translate-y-0 [@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-0.5",
        className,
      )}
    >
      {content}
    </button>
  );
});
