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
    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-2 mb-2">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 mt-10 mb-3">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mt-6 mb-2">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-[15px] leading-7 text-slate-600 dark:text-slate-300 my-4">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-6 my-4 space-y-1.5 text-[15px] leading-7 text-slate-600 dark:text-slate-300">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-6 my-4 space-y-1.5 text-[15px] leading-7 text-slate-600 dark:text-slate-300">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  a: ({ href, children }) => {
    const external = !!href && /^https?:\/\//.test(href);
    return (
      <a
        href={href}
        className="text-indigo-600 dark:text-indigo-400 underline underline-offset-2 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    );
  },
  strong: ({ children }) => <strong className="font-semibold text-slate-900 dark:text-slate-100">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-slate-200 dark:border-slate-700 pl-4 my-4 text-slate-500 dark:text-slate-400 italic">{children}</blockquote>
  ),
  hr: () => <hr className="border-slate-200 dark:border-slate-800 my-8" />,
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
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <div className="mx-auto w-full max-w-[720px] px-5 sm:px-6 py-10 sm:py-14">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back to home
        </Link>
        <article className="mt-8">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {markdown}
          </ReactMarkdown>
        </article>
      </div>
    </div>
  );
}
