import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { DataGapWarning } from "@/lib/rankings";

export function DataGapAlerts({ warnings }: { warnings: DataGapWarning[] }) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {warnings.map((warning) => (
        <Alert
          key={`${warning.title}-${warning.description}`}
          role="alert"
          className="border-amber-300 bg-amber-50 text-amber-950"
        >
          <AlertTitle>{warning.title}</AlertTitle>
          <AlertDescription>{warning.description}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
