import { Fragment, type ReactNode } from "react";

// Render the small Markdown subset used by this demo as escaped React text.
// Never interpret model output as HTML or executable links.
export default function ResponseText({ text }: { text: string }) {
  const inline = (content: string) =>
    content
      .split(/(\*\*[^*]+\*\*)/g)
      .map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      );
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (
      line.includes("|") &&
      /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[index + 1] || "")
    ) {
      const cells = (value: string) =>
        value
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim());
      const header = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|"))
        rows.push(cells(lines[index++]));
      index--;
      nodes.push(
        <div
          className="response-table"
          key={index}
          tabIndex={0}
          role="region"
          aria-label="豆包回复表格，可横向滚动"
        >
          <table>
            <thead>
              <tr>
                {header.map((cell, i) => (
                  <th key={i}>{inline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const heading = /^#{1,6}\s+/.test(line);
    const content = line.replace(/^#{1,6}\s+/, "");
    nodes.push(
      heading ? (
        <h4 key={index}>{inline(content)}</h4>
      ) : (
        <p key={index}>{inline(content)}</p>
      ),
    );
  }
  return <div className="response-text">{nodes}</div>;
}
