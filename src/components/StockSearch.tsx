"use client";

import { useState, useRef, useEffect } from "react";

interface SearchResult {
  code: string;
  name: string;
  market: number;
}

export default function StockSearch({
  onSelect,
}: {
  onSelect: (code: string, name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined!);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleChange(value: string) {
    setQuery(value);
    clearTimeout(timerRef.current);
    if (!value.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const resp = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
        const data = await resp.json();
        setResults(Array.isArray(data) ? data : []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function handleSelect(item: SearchResult) {
    onSelect(item.code, item.name);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2 focus-within:border-[var(--accent-blue)] transition-colors">
        <span className="text-[var(--text-secondary)] mr-2 text-sm">🔍</span>
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="搜索股票代码或名称..."
          className="bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none w-48"
        />
        {loading && <span className="text-xs text-[var(--text-secondary)] animate-pulse">搜索中...</span>}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full right-0 mt-1 w-72 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg shadow-2xl z-50 overflow-hidden">
          {results.map((item) => (
            <button
              key={item.code}
              onClick={() => handleSelect(item)}
              className="w-full text-left px-4 py-2.5 hover:bg-[var(--bg-secondary)] transition-colors flex items-center justify-between"
            >
              <span className="text-sm text-[var(--text-primary)]">{item.name}</span>
              <span className="text-xs text-[var(--text-secondary)] font-mono">{item.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
