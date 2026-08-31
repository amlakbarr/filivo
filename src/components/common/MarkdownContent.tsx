"use client";

import ReactMarkdown from "react-markdown";

import remarkGfm from "remark-gfm";

type Props = {
  content:
    string;

  className?:
    string;
};

export default function MarkdownContent({
  content,
  className,
}: Props) {
  return (
    <div
      className={`min-w-0 break-words ${className || ""}`}
    >
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
        ]}
        components={{
          p: ({
            children,
          }) => (
            <p className="mb-3 whitespace-pre-wrap last:mb-0">
              {
                children
              }
            </p>
          ),

          strong: ({
            children,
          }) => (
            <strong className="font-black">
              {
                children
              }
            </strong>
          ),

          em: ({
            children,
          }) => (
            <em className="italic">
              {
                children
              }
            </em>
          ),

          h1: ({
            children,
          }) => (
            <h1 className="mb-3 mt-5 text-xl font-black first:mt-0">
              {
                children
              }
            </h1>
          ),

          h2: ({
            children,
          }) => (
            <h2 className="mb-3 mt-5 text-lg font-black first:mt-0">
              {
                children
              }
            </h2>
          ),

          h3: ({
            children,
          }) => (
            <h3 className="mb-2 mt-4 text-base font-black first:mt-0">
              {
                children
              }
            </h3>
          ),

          ul: ({
            children,
          }) => (
            <ul className="my-3 list-disc space-y-1 pr-5">
              {
                children
              }
            </ul>
          ),

          ol: ({
            children,
          }) => (
            <ol className="my-3 list-decimal space-y-1 pr-5">
              {
                children
              }
            </ol>
          ),

          li: ({
            children,
          }) => (
            <li className="pr-1">
              {
                children
              }
            </li>
          ),

          blockquote: ({
            children,
          }) => (
            <blockquote className="my-4 border-r-4 border-slate-300 pr-4 text-slate-600">
              {
                children
              }
            </blockquote>
          ),

          a: ({
            href,
            children,
          }) => {
            const safeHref =
              getSafeHref(
                href
              );

            if (
              !safeHref
            ) {
              return (
                <span>
                  {
                    children
                  }
                </span>
              );
            }

            return (
              <a
                href={
                  safeHref
                }
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-blue-700 underline decoration-blue-300 underline-offset-4 transition hover:text-blue-900"
              >
                {
                  children
                }
              </a>
            );
          },

          code: ({
            children,
          }) => (
            <code className="rounded bg-slate-200/70 px-1 py-0.5 font-mono text-[0.9em]">
              {
                children
              }
            </code>
          ),

          pre: ({
            children,
          }) => (
            <pre
              dir="ltr"
              className="my-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-left text-sm leading-6 text-slate-100"
            >
              {
                children
              }
            </pre>
          ),

          hr: () => (
            <hr className="my-5 border-slate-200" />
          ),

          table: ({
            children,
          }) => (
            <div className="my-4 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                {
                  children
                }
              </table>
            </div>
          ),

          th: ({
            children,
          }) => (
            <th className="border border-slate-300 bg-slate-100 px-3 py-2 text-right font-black">
              {
                children
              }
            </th>
          ),

          td: ({
            children,
          }) => (
            <td className="border border-slate-300 px-3 py-2 align-top">
              {
                children
              }
            </td>
          ),
        }}
      >
        {
          content
        }
      </ReactMarkdown>
    </div>
  );
}

function getSafeHref(
  value:
    string |
    undefined
) {
  const href =
    String(
      value ||
        ""
    ).trim();

  if (
    !href
  ) {
    return "";
  }

  try {
    const url =
      new URL(
        href
      );

    if (
      url.protocol !==
        "http:" &&
      url.protocol !==
        "https:"
    ) {
      return "";
    }

    return url.toString();
  } catch {
    return "";
  }
}
