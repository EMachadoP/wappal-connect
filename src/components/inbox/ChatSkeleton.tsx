import { Skeleton } from "@/components/ui/skeleton";

export function ChatSkeleton() {
  return (
    <div className="flex-1 p-4 space-y-4 overflow-hidden">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}
        >
          <div className="space-y-2 max-w-[70%]">
            <Skeleton className={`h-10 w-[200px] rounded-lg ${i % 2 === 0 ? "bg-primary/20" : "bg-muted"}`} />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}