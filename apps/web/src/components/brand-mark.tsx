import type { SVGProps } from "react";

import { cn } from "@adversary/ui/lib/utils";

/** Adversary brand mark — Apex Cut (solid peak with hard notch). */
export function BrandMark({
  className,
  title,
  ...props
}: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      className={cn("size-4", className)}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path d="M16 4 L28 24 H21.2 L16 14.8 L10.8 24 H4 Z" />
    </svg>
  );
}
