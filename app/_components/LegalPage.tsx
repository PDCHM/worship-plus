import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

// Renders a legal document from content/legal/<slug>.md. The file is read at
// build time (server component, no client JS) so the page is fully static and
// indexable. We render the markdown's own headings rather than retyping the
// legal text — the document supplies its own title.
type Props = {
  slug: "privacy-policy" | "terms-of-service";
};

// Per-element styling so the rendered markdown matches the app in light/dark
// without depending on the Tailwind typography plugin.
const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-[1.75rem] sm:text-4xl font-extrabold leading-tight tracking-tight text-slate-900 dark:text-slate-100 mt-2 mb-1">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-10 mb-3 pt-6 border-t border-violet-100 dark:border-violet-900/40">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-6 mb-2">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-[15px] leading-7 text-slate-600 dark:text-slate-300 my-4">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-6 my-4 space-y-1.5 text-[15px] leading-7 text-slate-600 dark:text-slate-300 marker:text-[#7a5cff]">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-6 my-4 space-y-1.5 text-[15px] leading-7 text-slate-600 dark:text-slate-300 marker:text-[#7a5cff]">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  a: ({ href, children }) => {
    const external = !!href && /^https?:\/\//.test(href);
    return (
      <a
        href={href}
        className="font-medium text-[#6a4cf0] dark:text-violet-300 underline decoration-violet-300 underline-offset-2 hover:decoration-[#6a4cf0] transition-colors"
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    );
  },
  strong: ({ children }) => <strong className="font-semibold text-slate-900 dark:text-slate-100">{children}</strong>,
  // Used for the "Last updated" line under each title.
  em: ({ children }) => <em className="not-italic text-sm font-medium text-[#7a6ca8] dark:text-violet-300/80">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-slate-200 dark:border-slate-700 pl-4 my-4 text-slate-500 dark:text-slate-400 italic">{children}</blockquote>
  ),
  hr: () => <hr className="border-violet-100 dark:border-violet-900/40 my-8" />,
  code: ({ children }) => (
    <code className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[13px] font-mono text-slate-800 dark:text-slate-200">{children}</code>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-slate-200 dark:border-slate-700 px-3 py-2 text-left font-semibold text-slate-900 dark:text-slate-100">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-slate-200 dark:border-slate-700 px-3 py-2 text-slate-600 dark:text-slate-300">{children}</td>
  ),
};

export default function LegalPage({ slug }: Props) {
  const file = path.join(process.cwd(), "content", "legal", `${slug}.md`);
  const markdown = fs.readFileSync(file, "utf8");

  return (
    <div className="min-h-screen overflow-x-hidden bg-white dark:bg-slate-950">
      {/* Soft brand header strip. "/" sends signed-in users on to /app and
          everyone else to the landing page, so one Back link serves both. */}
      <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg, #6f4cf0, #b196ff)" }} />
      <div className="mx-auto w-full max-w-[680px] px-5 sm:px-6 py-8 sm:py-12">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full bg-[#f3f0ff] dark:bg-violet-500/15 px-3.5 py-1.5 text-sm font-semibold text-[#6a4cf0] dark:text-violet-300 ring-1 ring-violet-200/80 dark:ring-violet-800/60 hover:bg-[#ebe4ff] dark:hover:bg-violet-500/25 transition-colors"
        >
          ← Back
        </Link>
        <article className="mt-8 break-words">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {markdown}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
