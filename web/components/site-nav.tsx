import Link from "next/link";

import { cn } from "@/lib/utils";

type SiteNavProps = {
  active: "overview" | "rankings";
};

const navItems = [
  { href: "/", label: "今日總覽", value: "overview" },
  { href: "/rankings", label: "ETF 排行榜", value: "rankings" },
] as const;

export function SiteNav({ active }: SiteNavProps) {
  return (
    <nav aria-label="主要導覽" className="flex flex-wrap items-center gap-2">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={cn(
            "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
            item.value === active
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
