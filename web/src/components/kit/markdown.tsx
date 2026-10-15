// Markdown — thin wrapper over streamdown, tuned for streaming LLM output. streamdown safely renders
// half-finished markdown mid-stream (unterminated code fences, dangling lists, partial tables don't
// flash broken), so pass a growing string straight from your token stream. GFM tables, code blocks and
// mermaid come from streamdown; its stylesheet is imported once here.
import { Streamdown } from "streamdown";
import "streamdown/styles.css";

import { cn } from "@/lib/utils";

interface MarkdownProps {
  /** The markdown source. Safe to update on every streamed chunk. */
  children: string;
  className?: string;
}

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <Streamdown className={cn("text-sm leading-relaxed break-words", className)}>
      {children}
    </Streamdown>
  );
}
