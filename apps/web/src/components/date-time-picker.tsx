import { Button } from "@adversary/ui/components/button";
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

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function DateTimePicker({
  id,
  value,
  onChange,
  "aria-invalid": ariaInvalid,
}: DateTimePickerProps) {
  const selected = value ? new Date(value) : undefined;
  const timeValue = selected ? toLocalInputValue(selected).slice(11) : "12:00";

  function setDate(date?: Date) {
    if (!date) return;
    const [hours, minutes] = timeValue.split(":").map(Number);
    date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
    onChange(date.toISOString());
  }

  function setTime(time: string) {
    const date = selected ?? new Date();
    const [hours, minutes] = time.split(":").map(Number);
    date.setHours(hours ?? 0, minutes ?? 0, 0, 0);
    onChange(date.toISOString());
  }

  return (
    <div className="grid grid-cols-[1fr_7.5rem] gap-2">
      <Popover>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              className="justify-start font-normal"
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
  );
}
