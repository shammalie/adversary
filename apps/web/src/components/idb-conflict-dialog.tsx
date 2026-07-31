import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@adversary/ui/components/alert-dialog";

import type { ConflictChoice, IdbConflict } from "@/lib/idb-server-migrate";

export function IdbConflictDialog({
  conflict,
  onResolve,
}: {
  conflict: IdbConflict | null;
  onResolve: (choice: ConflictChoice) => void;
}) {
  return (
    <AlertDialog open={Boolean(conflict)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Draft conflict</AlertDialogTitle>
          <AlertDialogDescription>
            Scenario <span className="font-medium text-foreground">{conflict?.name}</span> exists
            both in this browser (IndexedDB) and on the server. Choose which copy to keep — they
            will not be merged automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {conflict ? (
          <dl className="grid gap-2 rounded-md border bg-muted/40 p-3 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Local updated</dt>
              <dd className="font-mono">{new Date(conflict.idbUpdatedAt).toLocaleString()}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Server updated</dt>
              <dd className="font-mono">{new Date(conflict.serverUpdatedAt).toLocaleString()}</dd>
            </div>
          </dl>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onResolve("keep-server")}>
            Keep server
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => onResolve("keep-local")}>
            Keep local
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
