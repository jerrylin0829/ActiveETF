import { Button } from "@/components/ui/button";
import type { OverviewRange } from "@/lib/today-overview";

type DateSelectorProps = {
  selectedDate: string | null;
  availableDates: string[];
  range: OverviewRange;
};

export function DateSelector({ selectedDate, availableDates, range }: DateSelectorProps) {
  return (
    <form action="/" className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="range" value={range} />
      <label className="grid gap-1 text-sm font-medium text-muted-foreground">
        交易日
        <select
          name="date"
          defaultValue={selectedDate ?? ""}
          className="h-9 min-w-40 rounded-md border border-input bg-card px-3 font-mono text-sm text-foreground shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {availableDates.map((date) => (
            <option key={date} value={date}>
              {date}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="outline" size="lg">
        切換日期
      </Button>
    </form>
  );
}
