import { Button } from "@adversary/ui/components/button";
import { ButtonGroup } from "@adversary/ui/components/button-group";
import { Calendar } from "@adversary/ui/components/calendar";
import { Input } from "@adversary/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@adversary/ui/components/popover";
import { format } from "date-fns";
import { CalendarClockIcon } from "lucide-react";

interface DateTimePickerProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  "aria-invalid"?: boolean;
}

const PRESETS = [
  { label: "+1m", minutes: 1 },
  { label: "+5m", minutes: 5 },
  { label: "+15m", minutes: 15 },
] as const;

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function parseValue(value: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function DateTimePicker({
  id,
  value,
  onChange,
  "aria-invalid": ariaInvalid,
}: DateTimePickerProps) {
  const selected = parseValue(value);
  const timeValue = selected ? toLocalInputValue(selected).slice(11) : "12:00";

  function setDate(date?: Date) {
    if (!date) return;
    const [hours, minutes] = timeValue.split(":").map(Number);
    date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
    onChange(date.toISOString());
  }

  function setTime(time: string) {
    const date = selected ? new Date(selected) : new Date();
    const [hours, minutes] = time.split(":").map(Number);
    date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
    onChange(date.toISOString());
  }

  function bumpMinutes(minutes: number) {
    const base = selected ?? new Date();
    onChange(new Date(base.getTime() + minutes * 60_000).toISOString());
  }

  function setNow() {
    onChange(new Date().toISOString());
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 min-[22rem]:grid-cols-[minmax(0,1fr)_7.5rem]">
        <Popover>
          <PopoverTrigger
            render={
              <Button
                id={id}
                type="button"
                variant="outline"
                className="w-full justify-start font-normal"
                aria-invalid={ariaInvalid}
              />
            }
          >
            <CalendarClockIcon data-icon="inline-start" />
            {selected ? format(selected, "PP") : "Choose date"}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selected}
              onSelect={setDate}
              timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
            />
          </PopoverContent>
        </Popover>
        <Input
          aria-label="Event time"
          type="time"
          step="60"
          value={timeValue}
          aria-invalid={ariaInvalid}
          onChange={(event) => setTime(event.target.value)}
        />
      </div>
      <ButtonGroup
        aria-label="Quick time adjustments"
        className="flex-wrap"
      >
        <Button type="button" variant="outline" size="sm" onClick={setNow}>
          Now
        </Button>
        {PRESETS.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => bumpMinutes(preset.minutes)}
          >
            {preset.label}
          </Button>
        ))}
      </ButtonGroup>
    </div>
  );
}
