import { Badge } from "@adversary/ui/components/badge";
import { Button } from "@adversary/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@adversary/ui/components/dropdown-menu";
import { Separator } from "@adversary/ui/components/separator";
import { Link } from "@tanstack/react-router";
import { FileUpIcon, ListIcon, LogOutIcon, SettingsIcon, UserIcon, WrenchIcon } from "lucide-react";

import { BrandMark } from "./brand-mark";
import { useSimulation } from "./simulation-provider";
import { ModeToggle } from "./mode-toggle";
import { useLogoutMutation, useMeQuery } from "@/hooks/use-auth";

export default function Header() {
  const { runtime } = useSimulation();
  const meQuery = useMeQuery();
  const logout = useLogoutMutation();
  const auth = meQuery.data;

  return (
    <header className="sticky top-0 z-40 bg-background/92 backdrop-blur-md">
      <div className="flex min-h-14 flex-row items-center justify-between gap-3 px-3 sm:px-5">
        <div className="flex items-center gap-4">
          <Link
            to="/operations"
            className="flex items-center gap-2"
            aria-label="Adversary home"
          >
            <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <BrandMark className="size-5" />
            </span>
            <span className="hidden text-sm font-semibold tracking-[0.18em] sm:inline">
              ADVERSARY
            </span>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {runtime ? (
            <Badge
              variant={runtime.status === "running" ? "secondary" : "outline"}
            >
              <span
                className="mr-1.5 size-1.5 rounded-full bg-current"
                aria-hidden="true"
              />
              {runtime.status}
            </Badge>
          ) : null}
          {auth?.availability === "session" ? (
            auth.user ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" size="sm" aria-label={`Account: ${auth.user.email}`} />
                  }
                >
                  <UserIcon data-icon="inline-start" />
                  <span className="hidden max-w-40 truncate sm:inline">{auth.user.email}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled>{auth.user.email}</DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={logout.isPending}
                    onClick={() => logout.mutate()}
                  >
                    <LogOutIcon />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button variant="outline" size="sm" render={<Link to="/login" />}>
                <UserIcon data-icon="inline-start" />
                Login
              </Button>
            )
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="icon" aria-label="Settings" />
              }
            >
              <SettingsIcon className="size-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem render={<Link to="/import" />}>
                <FileUpIcon className="size-4" aria-hidden="true" />
                Import
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link to="/builder" />}>
                <WrenchIcon className="size-4" aria-hidden="true" />
                Builder
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link to="/runs" />}>
                <ListIcon className="size-4" aria-hidden="true" />
                Active runs
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link to="/manage" />}>
                <SettingsIcon className="size-4" aria-hidden="true" />
                Manage
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ModeToggle />
        </div>
      </div>
      <Separator />
    </header>
  );
}
