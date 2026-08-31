"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  EditorContent,
  useEditor,
} from "@tiptap/react";

import StarterKit from "@tiptap/starter-kit";

import {
  Markdown,
} from "@tiptap/markdown";

type Props = {
  value:
    string;

  onChange:
    (
      value:
        string
    ) => void;

  error?:
    boolean;

  placeholder?:
    string;
};

export default function KnowledgeRichTextEditor({
  value,
  onChange,
  error,
  placeholder =
    "محتوا را وارد کنید...",
}: Props) {
  const [
    revision,
    setRevision,
  ] =
    useState(
      0
    );

  const editor =
    useEditor({
      immediatelyRender:
        false,

      content:
        value ||
        "",

      contentType:
        "markdown",

      extensions: [
        StarterKit.configure({
          heading: {
            levels: [
              2,
              3,
            ],
          },

          link: {
            openOnClick:
              false,

            autolink:
              true,

            linkOnPaste:
              true,

            defaultProtocol:
              "https",

            HTMLAttributes: {
              target:
                "_blank",

              rel:
                "noopener noreferrer",
            },
          },
        }),

        Markdown.configure({
          markedOptions: {
            gfm:
              true,

            breaks:
              true,
          },
        }),
      ],

      editorProps: {
        attributes: {
          dir:
            "rtl",

          spellcheck:
            "true",

          "aria-label":
            "ویرایشگر محتوای پایگاه دانش",

          class:
            [
              "min-h-[340px]",
              "px-4",
              "py-4",
              "text-sm",
              "leading-8",
              "text-slate-800",
              "outline-none",
              "[&_p]:mb-3",
              "[&_p:last-child]:mb-0",
              "[&_h2]:mb-3",
              "[&_h2]:mt-5",
              "[&_h2]:text-xl",
              "[&_h2]:font-black",
              "[&_h3]:mb-2",
              "[&_h3]:mt-4",
              "[&_h3]:text-lg",
              "[&_h3]:font-black",
              "[&_ul]:my-3",
              "[&_ul]:list-disc",
              "[&_ul]:pr-6",
              "[&_ol]:my-3",
              "[&_ol]:list-decimal",
              "[&_ol]:pr-6",
              "[&_li]:my-1",
              "[&_blockquote]:my-4",
              "[&_blockquote]:border-r-4",
              "[&_blockquote]:border-slate-300",
              "[&_blockquote]:pr-4",
              "[&_blockquote]:text-slate-600",
              "[&_a]:font-bold",
              "[&_a]:text-blue-700",
              "[&_a]:underline",
              "[&_a]:underline-offset-4",
              "[&_code]:rounded",
              "[&_code]:bg-slate-100",
              "[&_code]:px-1",
              "[&_pre]:my-4",
              "[&_pre]:overflow-x-auto",
              "[&_pre]:rounded-xl",
              "[&_pre]:bg-slate-950",
              "[&_pre]:p-4",
              "[&_pre]:text-slate-100",
            ].join(
              " "
            ),
        },
      },

      onUpdate: ({
        editor:
          currentEditor,
      }) => {
        onChange(
          currentEditor.getMarkdown()
        );

        setRevision(
          (
            current
          ) =>
            current +
            1
        );
      },

      onSelectionUpdate: () => {
        setRevision(
          (
            current
          ) =>
            current +
            1
        );
      },
    });

  /*
   * وقتی مقدار از API بارگذاری می‌شود یا فرم
   * از بیرون Reset می‌شود، Editor را بدون
   * ایجاد onUpdate اضافی همگام کن.
   */
  useEffect(
    () => {
      if (
        !editor
      ) {
        return;
      }

      const current =
        normalizeMarkdown(
          editor.getMarkdown()
        );

      const incoming =
        normalizeMarkdown(
          value
        );

      if (
        current ===
        incoming
      ) {
        return;
      }

      editor.commands.setContent(
        value ||
          "",
        {
          contentType:
            "markdown",

          emitUpdate:
            false,
        }
      );

      setRevision(
        (
          currentRevision
        ) =>
          currentRevision +
          1
      );
    },
    [
      editor,
      value,
    ]
  );

  /*
   * revision فقط برای Re-render شدن Toolbar
   * هنگام تغییر Selection/Formatting است.
   */
  void revision;

  if (
    !editor
  ) {
    return (
      <div className="h-[390px] animate-pulse rounded-xl bg-slate-100" />
    );
  }

  function setLink() {
    if (
      !editor
    ) {
      return;
    }

    const previousHref =
      String(
        editor
          .getAttributes(
            "link"
          )
          .href ||
          ""
      );

    const rawUrl =
      window.prompt(
        "آدرس لینک را وارد کنید:",
        previousHref ||
          "https://"
      );

    if (
      rawUrl ===
      null
    ) {
      return;
    }

    const trimmed =
      rawUrl.trim();

    if (
      !trimmed
    ) {
      editor
        .chain()
        .focus()
        .extendMarkRange(
          "link"
        )
        .unsetLink()
        .run();

      return;
    }

    const href =
      normalizeWebUrl(
        trimmed
      );

    if (
      !href
    ) {
      window.alert(
        "آدرس لینک معتبر نیست. فقط لینک‌های http و https مجاز هستند."
      );

      return;
    }

    if (
      editor.state
        .selection
        .empty
    ) {
      const label =
        window.prompt(
          "متنی که باید به‌عنوان لینک نمایش داده شود:",
          ""
        );

      if (
        label ===
          null ||
        !label.trim()
      ) {
        return;
      }

      const markdown =
        `[${escapeMarkdownLinkText(
          label.trim()
        )}](${href})`;

      editor
        .chain()
        .focus()
        .insertContent(
          markdown,
          {
            contentType:
              "markdown",
          }
        )
        .run();

      return;
    }

    editor
      .chain()
      .focus()
      .extendMarkRange(
        "link"
      )
      .setLink({
        href,

        target:
          "_blank",
      })
      .run();
  }
function removeLink() {
  if (
    !editor
  ) {
    return;
  }

  editor
    .chain()
    .focus()
    .extendMarkRange(
      "link"
    )
    .unsetLink()
    .run();
}

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-white transition focus-within:ring-2 focus-within:ring-emerald-100 ${
        error
          ? "border-rose-300 focus-within:border-rose-400"
          : "border-slate-300 focus-within:border-emerald-500"
      }`}
    >

      {/* Toolbar */}

      <div className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 p-2">

        <ToolbarButton
          label="متن"
          active={
            editor.isActive(
              "paragraph"
            )
          }
          onClick={() =>
            editor
              .chain()
              .focus()
              .setParagraph()
              .run()
          }
        />

        <ToolbarButton
          label="H2"
          active={
            editor.isActive(
              "heading",
              {
                level:
                  2,
              }
            )
          }
          onClick={() =>
            editor
              .chain()
              .focus()
              .toggleHeading({
                level:
                  2,
              })
              .run()
          }
        />

        <ToolbarButton
          label="H3"
          active={
            editor.isActive(
              "heading",
              {
                level:
                  3,
              }
            )
          }
          onClick={() =>
            editor
              .chain()
              .focus()
              .toggleHeading({
                level:
                  3,
              })
              .run()
          }
        />

        <ToolbarDivider />

        <ToolbarButton
          label="پررنگ"
          active={
            editor.isActive(
              "bold"
            )
          }
          onClick={() =>
            editor
              .chain()
              .focus()
              .toggleBold()
              .run()
          }
        />

        <ToolbarButton
          label="مورب"
          active={
            editor.isActive(
              "italic"
            )
          }
          onClick={() =>
            editor
              .chain()
              .focus()
              .toggleItalic()
              .run()
          }
        />

        <ToolbarDivider />

        <ToolbarButton
          label="• فهرست"
          active={
            editor.isActive(
              "bulletList"
            )
          }
          onClick={() =>
            editor
              .chain()
              .focus()
              .toggleBulletList()
              .run()
          }
        />

        <ToolbarButton
          label="۱. فهرست"
          active={
            editor.isActive(
              "orderedList"
            )
          }
          onClick={() =>
            editor
              .chain()
              .focus()
              .toggleOrderedList()
              .run()
          }
        />

        <ToolbarButton
          label="نقل‌قول"
          active={
            editor.isActive(
              "blockquote"
            )
          }
          onClick={() =>
            editor
              .chain()
              .focus()
              .toggleBlockquote()
              .run()
          }
        />

        <ToolbarDivider />

        <ToolbarButton
          label="لینک"
          active={
            editor.isActive(
              "link"
            )
          }
          onClick={
            setLink
          }
        />

        <ToolbarButton
          label="حذف لینک"
          disabled={
            !editor.isActive(
              "link"
            )
          }
          onClick={
            removeLink
          }
        />

        <ToolbarDivider />

        <ToolbarButton
          label="↶"
          title="Undo"
          disabled={
            !editor.can()
              .chain()
              .focus()
              .undo()
              .run()
          }
          onClick={() =>
            editor
              .chain()
              .focus()
              .undo()
              .run()
          }
        />

        <ToolbarButton
          label="↷"
          title="Redo"
          disabled={
            !editor.can()
              .chain()
              .focus()
              .redo()
              .run()
          }
          onClick={() =>
            editor
              .chain()
              .focus()
              .redo()
              .run()
          }
        />

      </div>

      {/* Editor */}

      <div className="relative">

        {editor.isEmpty && (
          <div className="pointer-events-none absolute right-4 top-4 z-10 text-sm text-slate-400">
            {
              placeholder
            }
          </div>
        )}

        <EditorContent
          editor={
            editor
          }
        />

      </div>

      <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">
        برای لینک، ابتدا متن را انتخاب کنید و «لینک» را بزنید؛ یا بدون انتخاب متن، لینک و عنوان آن را وارد کنید.
      </div>

    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  active,
  disabled,
  title,
}: {
  label:
    string;

  onClick:
    () => void;

  active?:
    boolean;

  disabled?:
    boolean;

  title?:
    string;
}) {
  return (
    <button
      type="button"
      title={
        title ||
        label
      }
      aria-pressed={
        active
      }
      disabled={
        disabled
      }
      onClick={
        onClick
      }
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? "border-emerald-300 bg-emerald-100 text-emerald-800"
          : "border-transparent bg-white text-slate-600 hover:border-slate-200 hover:bg-slate-100"
      }`}
    >
      {
        label
      }
    </button>
  );
}

function ToolbarDivider() {
  return (
    <span
      aria-hidden="true"
      className="mx-1 hidden h-8 w-px bg-slate-200 sm:block"
    />
  );
}

function normalizeMarkdown(
  value:
    string
) {
  return String(
    value ||
      ""
  )
    .replace(
      /\r\n/g,
      "\n"
    )
    .trim();
}

function normalizeWebUrl(
  value:
    string
) {
  let candidate =
    value.trim();

  if (
    !candidate
  ) {
    return "";
  }

  if (
    !/^[a-z][a-z0-9+.-]*:/i.test(
      candidate
    )
  ) {
    candidate =
      `https://${candidate}`;
  }

  try {
    const url =
      new URL(
        candidate
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

function escapeMarkdownLinkText(
  value:
    string
) {
  return value
    .replace(
      /\\/g,
      "\\\\"
    )
    .replace(
      /\[/g,
      "\\["
    )
    .replace(
      /\]/g,
      "\\]"
    );
}
