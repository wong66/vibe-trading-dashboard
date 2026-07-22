import { Library } from "lucide-react";
import { cn } from "@/lib/utils";
import { ZOO_CARDS } from "@/lib/alphaZooHelpers";

interface Props {
  zooFilter: string;
  onSelectZoo: (zooId: string) => void;
}

export function AlphaZooCardGrid({ zooFilter, onSelectZoo }: Props) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {ZOO_CARDS.map((z) => {
        const active = zooFilter === z.id;
        return (
          <button
            key={z.id}
            type="button"
            onClick={() => onSelectZoo(active ? "" : z.id)}
            className={cn(
              "text-left border rounded-xl p-4 space-y-2 transition bg-gradient-to-br",
              z.accent,
              "hover:border-primary/50",
              active && "border-primary ring-1 ring-primary/30",
            )}
          >
            <div className="flex items-center justify-between">
              <Library className="h-5 w-5 text-primary" aria-hidden="true" />
              <span className="text-xs font-mono text-muted-foreground">
                {z.approxCount}
              </span>
            </div>
            <h3 className="font-semibold text-sm leading-tight">{z.title}</h3>
            <p className="text-xs text-muted-foreground line-clamp-3">
              {z.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}
