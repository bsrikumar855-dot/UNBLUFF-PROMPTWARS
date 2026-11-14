import React from "react";
import { Link } from "react-router-dom";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/cn";

/**
 * The UNBLUFF logo (mark and "unbluff · placement OS" lockup), served from /brand/logo.png. The link carries the
 * accessible name, so the image itself is decorative.
 */
export const Wordmark: React.FC<{ className?: string; to?: string }> = ({
  className,
  to = routes.home,
}) => (
  <Link to={to} aria-label="UNBLUFF home" className={cn("inline-flex items-center", className)}>
    <img src="/brand/logo.png" alt="" width={321} height={105} className="h-9 w-auto" />
  </Link>
);
