const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M6 12c7-3 13-2 18 2v27c-5-4-11-5-18-2V12Z" {...stroke} strokeWidth="2.2" />
      <path d="M42 12c-7-3-13-2-18 2v27c5-4 11-5 18-2V12Z" {...stroke} strokeWidth="2.2" />
      <path d="M11 21c5-2 11 0 16 6s9 6 13 2" {...stroke} strokeWidth="2.2" />
      <circle cx="12" cy="21" r="2.6" fill="#c95f4c" />
      <path d="m37 26 3 3-4 1" {...stroke} strokeWidth="2" />
    </svg>
  );
}

export function NotebookHero() {
  return (
    <svg
      className="h-auto w-full"
      viewBox="0 0 620 470"
      role="img"
      aria-label="打开的旅行手帐，展示由地点与路线组成的旅程状态"
    >
      <path d="M68 92c73-18 150-12 239 23v307c-80-31-159-35-239-15V92Z" fill="#fffaf0" stroke="#2f332f" strokeWidth="3" />
      <path d="M552 92c-73-18-150-12-245 23v307c85-31 166-35 245-15V92Z" fill="#fffdf7" stroke="#2f332f" strokeWidth="3" />
      <path d="M307 116v305" stroke="#d8ceba" strokeWidth="3" />
      <path d="M92 80h103l15 28H107Z" fill="#e7c987" opacity=".72" />
      <path d="M414 77h95l-11 31h-98Z" fill="#a9c5b0" opacity=".72" />
      <text x="104" y="143" fill="#2f332f" fontSize="34" fontWeight="600" fontFamily="serif">一段旅程</text>
      <text x="107" y="172" fill="#5e655e" fontSize="15">INTENT · FACTS · PLAN</text>
      <path d="M109 188c39 6 82 5 130-1" stroke="#c95f4c" strokeWidth="3" strokeLinecap="round" />
      <path d="M102 232c45-44 90-32 111 4s-8 72-54 64-39 46 16 70" fill="none" stroke="#3f6b57" strokeWidth="5" strokeLinecap="round" strokeDasharray="1 0" />
      <circle cx="103" cy="231" r="10" fill="#fffdf7" stroke="#3f6b57" strokeWidth="4" />
      <circle cx="213" cy="236" r="10" fill="#fffdf7" stroke="#3f6b57" strokeWidth="4" />
      <circle cx="159" cy="300" r="10" fill="#fffdf7" stroke="#3f6b57" strokeWidth="4" />
      <circle cx="176" cy="370" r="10" fill="#fffdf7" stroke="#3f6b57" strokeWidth="4" />
      <path d="M338 308h180M353 308v-91M503 308v-91M346 217h165l-29-34H374Z" fill="none" stroke="#2f332f" strokeWidth="4" strokeLinejoin="round" />
      <path d="M372 308v-62h111v62M397 246v62M427 246v62M457 246v62" fill="none" stroke="#2f332f" strokeWidth="3" />
      <path d="M355 217c24-12 48-12 72 0s48 12 72 0" fill="none" stroke="#c95f4c" strokeWidth="4" strokeLinecap="round" />
      <path d="M343 348c36-14 63-6 82 24 26-32 58-36 96-12" fill="none" stroke="#4d7f98" strokeWidth="5" strokeLinecap="round" />
      <path d="M370 145h112l20 26-22 22H360l-19-24Z" fill="#f7e2a5" stroke="#2f332f" strokeWidth="2" />
      <text x="372" y="176" fill="#6f4508" fontSize="16" fontWeight="600">变化发生，始终有备选</text>
      <circle cx="523" cy="137" r="34" fill="none" stroke="#c95f4c" strokeWidth="3" strokeDasharray="4 5" />
      <text x="503" y="142" fill="#c95f4c" fontSize="13" fontWeight="700">TRIP</text>
      <path d="m281 65 15 27M299 61l7 30M315 65l-1 27" stroke="#2f332f" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function CityLineDoodle({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 280 112" aria-hidden="true">
      <path d="M8 92h264M30 92V57h40v35M38 57l13-19 12 19M44 70h12M92 92V46h50v46M101 46l16-20 16 20M109 63h16M109 77h16M166 92V60h29v32M204 92V48h46v44M213 48l14-22 14 22" {...stroke} strokeWidth="2.5" />
      <path d="M6 100c50-10 88-5 115 5s77 7 153-8" {...stroke} stroke="#4d7f98" strokeWidth="4" />
      <path d="M157 42c4-11 12-16 24-16 10 0 18 5 23 15" {...stroke} stroke="#3f6b57" strokeWidth="3" />
    </svg>
  );
}

export function EmptyNotebook({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <svg className="mb-4 h-28 w-36 text-[var(--color-ink-muted)]" viewBox="0 0 160 120" aria-hidden="true">
        <path d="M18 24c21-6 42-3 62 8v70c-20-11-41-14-62-8V24ZM142 24c-21-6-42-3-62 8v70c20-11 41-14 62-8V24Z" {...stroke} strokeWidth="2.5" />
        <path d="M80 32v70M34 48h26M34 60h18M98 50c12-9 22-8 31 3M99 72c10 4 18 3 26-2" {...stroke} strokeWidth="2" />
      </svg>
      <p className="max-w-64 text-sm leading-6 text-[var(--color-ink-muted)]">{label}</p>
    </div>
  );
}
