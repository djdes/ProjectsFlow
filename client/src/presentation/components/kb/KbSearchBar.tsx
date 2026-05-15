import { Search } from 'lucide-react';

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export function KbSearchBar({ value, onChange }: Props): React.ReactElement {
  return (
    <div className="relative mb-2 px-2">
      <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Поиск…"
        className="h-7 w-full rounded-md border bg-background pl-7 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}
