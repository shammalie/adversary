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
import { FileUpIcon, RadarIcon, SettingsIcon, WrenchIcon } from "lucide-react";

import { useSimulation } from "./simulation-provider";
import { ModeToggle } from "./mode-toggle";

export default function Header() {
  const { runtime } = useSimulation();

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
              <RadarIcon aria-hidden="true" />
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
            </DropdownMenuContent>
          </DropdownMenu>
          <ModeToggle />
        </div>
      </div>
      <Separator />
    </header>
  );
}
