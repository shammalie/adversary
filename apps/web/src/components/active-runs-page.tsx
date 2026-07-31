import { Badge } from "@adversary/ui/components/badge";
import { Button } from "@adversary/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@adversary/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@adversary/ui/components/table";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { useSimulation } from "@/components/simulation-provider";
import { useRunsQuery, useStopRunMutation } from "@/hooks/use-runs";

export function ActiveRunsPage() {
  const runs = useRunsQuery(false);
  const stopRun = useStopRunMutation();
  const { setActiveRunId } = useSimulation();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Active scenarios</h1>
          <p className="text-sm text-muted-foreground">
            Running and recently finished server runs (last 24h).
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" render={<Link to="/manage" />}>
            Manage storage
          </Button>
          <Button render={<Link to="/builder" />}>Builder</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
          <CardDescription>
            Open a running scenario on Operations to follow live ingest over WebSocket.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.isError ? (
            <p className="text-sm text-destructive">
              {runs.error instanceof Error ? runs.error.message : "Failed to load runs."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scenario</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Start at</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead className="w-48" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(runs.data ?? []).map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium">
                      {run.scenarioName || run.scenarioId}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={run.status === "running" ? "secondary" : "outline"}
                      >
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(run.startAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(run.startedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        render={
                          <Link
                            to="/operations"
                            onClick={() => {
                              setActiveRunId(run.id);
                            }}
                          />
                        }
                      >
                        Open ops
                      </Button>
                      {run.status === "running" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={stopRun.isPending}
                          onClick={() => {
                            void stopRun
                              .mutateAsync(run.id)
                              .then(() => toast.success("Run stopped."))
                              .catch((error: unknown) =>
                                toast.error(
                                  error instanceof Error ? error.message : "Stop failed.",
                                ),
                              );
                          }}
                        >
                          Stop
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
                {(runs.data?.length ?? 0) === 0 && !runs.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No recent runs. Publish a scenario in the builder and start it.
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
