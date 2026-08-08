import type { ReactNode } from 'react';
import type { SourceRecordData } from '../types';

type MarkdownContentProps = {
  content: string;
  sources?: SourceRecordData[];
  className?: string;
};

function sourceLabel(source: SourceRecordData): string {
  return source.publisher || source.provider || source.title;
}

function inlineContent(value: string, sources: SourceRecordData[]): ReactNode[] {
  const sourceById = new Map(sources.map((source) => [source.id.toLowerCase(), source]));
  const tokenPattern = /(\[来源:([0-9a-f-]{36})\])|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(`([^`]+)`)|(\*([^*]+)\*)|(_([^_]+)_)/gi;
  const result: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;
  while ((match = tokenPattern.exec(value))) {
    if (match.index > cursor) result.push(value.slice(cursor, match.index));
    const key = `${match.index}-${tokenIndex++}`;
    const sourceId = match[2]?.toLowerCase();
    if (sourceId) {
      const source = sourceById.get(sourceId);
      result.push(source ? (
        source.canonical_url
          ? <a key={key} className="inline-citation" href={source.canonical_url} target="_blank" rel="noreferrer">{sourceLabel(source)}</a>
          : <span key={key} className="inline-citation">{sourceLabel(source)}</span>
      ) : match[1]);
    } else if (match[4] && match[5]) {
      result.push(<a key={key} href={match[5]} target="_blank" rel="noreferrer">{inlineContent(match[4], sources)}</a>);
    } else if (match[7] || match[9]) {
      result.push(<strong key={key}>{inlineContent(match[7] || match[9], sources)}</strong>);
    } else if (match[11]) {
      result.push(<code key={key}>{match[11]}</code>);
    } else if (match[13] || match[15]) {
      result.push(<em key={key}>{inlineContent(match[13] || match[15], sources)}</em>);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) result.push(value.slice(cursor));
  return result;
}

function isBlockStart(line: string): boolean {
  return /^\s*(#{1,6})\s+/.test(line)
    || /^\s*[-*+]\s+/.test(line)
    || /^\s*\d+[.)]\s+/.test(line)
    || /^\s*>\s?/.test(line)
    || /^\s*(```|---+|___+|\*\*\*+)\s*$/.test(line);
}

export function MarkdownContent({ content, sources = [], className = '' }: MarkdownContentProps) {
  const lines = content.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  let blockIndex = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = line.match(/^\s*```\s*([\w-]*)\s*$/);
    if (fence) {
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<pre key={`code-${blockIndex++}`}><code className={fence[1] ? `language-${fence[1]}` : undefined}>{codeLines.join('\n')}</code></pre>);
      continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
      const Heading = headingTags[level - 1];
      blocks.push(<Heading key={`heading-${blockIndex++}`}>{inlineContent(heading[2], sources)}</Heading>);
      index += 1;
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={`hr-${blockIndex++}`} />);
      index += 1;
      continue;
    }
    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const items: string[] = [];
      const matcher = unordered ? /^\s*[-*+]\s+(.+)$/ : /^\s*\d+[.)]\s+(.+)$/;
      while (index < lines.length) {
        const item = matcher.exec(lines[index]);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(<List key={`list-${blockIndex++}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineContent(item, sources)}</li>)}</List>);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${blockIndex++}`}>{quoteLines.map((item, itemIndex) => <p key={itemIndex}>{inlineContent(item, sources)}</p>)}</blockquote>);
      continue;
    }
    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${blockIndex++}`}>{paragraphLines.map((item, itemIndex) => <span key={itemIndex}>{itemIndex > 0 && <br />}{inlineContent(item, sources)}</span>)}</p>);
  }
  return <div className={`markdown-body ${className}`.trim()}>{blocks}</div>;
}
