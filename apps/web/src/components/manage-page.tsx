import { Badge } from "@adversary/ui/components/badge";
import { Button } from "@adversary/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@adversary/ui/components/card";
import { Checkbox } from "@adversary/ui/components/checkbox";
import { Input } from "@adversary/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@adversary/ui/components/table";
import { Link } from "@tanstack/react-router";
import { HardDriveIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  useBulkDeleteManageScenariosMutation,
  useDeleteManageScenarioMutation,
  useManageScenariosQuery,
  useManageStatsQuery,
  useManageUsageQuery,
} from "@/hooks/use-manage";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ManagePage() {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const list = useManageScenariosQuery({ q: q.trim() || undefined, limit: 100 });
  const stats = useManageStatsQuery();
  const usage = useManageUsageQuery({ bucket: "1d" });
  const deleteOne = useDeleteManageScenarioMutation();
  const bulkDelete = useBulkDeleteManageScenariosMutation();

  const items = list.data?.items ?? [];

  function toggle(id: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...new Set([...current, id])] : current.filter((value) => value !== id),
    );
  }

  async function handleBulkDelete() {
    if (selected.length === 0) return;
    try {
      const result = await bulkDelete.mutateAsync(selected);
      toast.success(`Deleted ${result.deleted} scenario${result.deleted === 1 ? "" : "s"}.`);
      setSelected([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bulk delete failed.");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Manage</h1>
          <p className="text-sm text-muted-foreground">
            Server-stored scenarios, storage stats, and usage.
          </p>
        </div>
        <Button variant="outline" render={<Link to="/runs" />}>
          Active runs
        </Button>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Scenarios</CardDescription>
            <CardTitle className="text-2xl">{stats.data?.scenarioCount ?? "—"}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {stats.data
              ? `${stats.data.draftCount} draft · ${stats.data.readyCount} ready`
              : "Loading…"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Payload storage</CardDescription>
            <CardTitle className="text-2xl">
              {stats.data ? formatBytes(stats.data.totalPayloadBytes) : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2 text-xs text-muted-foreground">
            <HardDriveIcon className="size-3.5" aria-hidden="true" />
            JSON drafts + ready payloads
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active runs</CardDescription>
            <CardTitle className="text-2xl">{stats.data?.runsActive ?? "—"}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {stats.data
              ? `${stats.data.runsCompleted} completed · ${stats.data.runsStopped} stopped`
              : "Loading…"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Usage (24h buckets)</CardDescription>
            <CardTitle className="text-2xl">{usage.data?.totals ? Object.values(usage.data.totals).reduce((a, b) => a + b, 0) : "—"}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {usage.data?.totals
              ? Object.entries(usage.data.totals)
                  .slice(0, 3)
                  .map(([key, value]) => `${key.split(".").pop()}:${value}`)
                  .join(" · ")
              : "Loading…"}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Scenarios</CardTitle>
            <CardDescription>
              {list.data ? `${list.data.total} total` : "Loading…"}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search by name…"
              className="w-48"
              aria-label="Search scenarios"
            />
            <Button
              variant="destructive"
              size="sm"
              disabled={selected.length === 0 || bulkDelete.isPending}
              onClick={() => void handleBulkDelete()}
            >
              <Trash2Icon className="size-4" aria-hidden="true" />
              Delete selected ({selected.length})
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {list.isError ? (
            <p className="text-sm text-destructive">
              {list.error instanceof Error ? list.error.message : "Failed to load scenarios."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Targets</TableHead>
                  <TableHead>Events</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.includes(item.id)}
                        onCheckedChange={(checked) => toggle(item.id, checked === true)}
                        aria-label={`Select ${item.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        to="/builder"
                        search={{ scenarioId: item.id }}
                        className="hover:underline"
                      >
                        {item.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.status === "ready" ? "secondary" : "outline"}>
                        {item.status}
                      </Badge>
                      {item.activeRuns > 0 ? (
                        <Badge variant="outline" className="ml-1">
                          {item.activeRuns} run{item.activeRuns === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>{formatBytes(item.sizeBytes)}</TableCell>
                    <TableCell>{item.targetCount}</TableCell>
                    <TableCell>{item.eventCount}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(item.updatedAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deleteOne.isPending}
                        onClick={() => {
                          void deleteOne
                            .mutateAsync(item.id)
                            .then(() => toast.success(`Deleted ${item.name}.`))
                            .catch((error: unknown) =>
                              toast.error(
                                error instanceof Error ? error.message : "Delete failed.",
                              ),
                            );
                        }}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {items.length === 0 && !list.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      No scenarios on the server yet.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
