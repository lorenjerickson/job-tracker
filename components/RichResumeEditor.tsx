"use client";
import TextAlign from "@tiptap/extension-text-align";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "./ui";

/**
 * Rich-text resume editor (Tiptap / ProseMirror).
 * Supports the formatting resumes actually use: name/section/role headings, bold, italic, underline,
 * strikethrough, bulleted and numbered lists, links, alignment, and divider lines.
 */
export default function RichResumeEditor({
  html,
  versionLabel,
  saving,
  onSave,
  onDirtyChange,
}: {
  html: string;
  versionLabel: string;
  saving: boolean;
  onSave: (html: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const baseline = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const editor = useEditor({
    immediatelyRender: false, // avoid SSR hydration mismatches
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: false,
        codeBlock: false,
        blockquote: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: html,
    editorProps: { attributes: { class: "rte-doc", spellcheck: "true", "aria-label": "Resume editor" } },
    onCreate: ({ editor }) => {
      baseline.current = editor.getHTML();
    },
    onUpdate: ({ editor }) => {
      const d = editor.getHTML() !== baseline.current;
      setDirty(d);
    },
  });

  // Load a different version into the editor.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setContent(html, { emitUpdate: false });
    baseline.current = editor.getHTML();
    setDirty(false);
  }, [editor, html]);

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  // Warn before leaving the page with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  return (
    <div className="rte">
      <div className="rte-bar">
        <div className="rte-tools" role="toolbar" aria-label="Formatting">
          {editor ? <Toolbar editor={editor} /> : <span className="muted small">Loading editor…</span>}
        </div>
        <div className="rte-actions">
        <span className="small muted" style={{ whiteSpace: "nowrap" }}>
          {dirty ? "Unsaved changes" : `Viewing ${versionLabel}`}
        </span>
        {dirty && (
          <button
            className="btn ghost sm"
            disabled={saving}
            onClick={() => {
              editor?.commands.setContent(html, { emitUpdate: false });
              baseline.current = editor?.getHTML() ?? null;
              setDirty(false);
            }}
          >
            Discard
          </button>
        )}
        <button className="btn primary sm" disabled={!dirty || saving || !editor} onClick={() => editor && onSave(editor.getHTML())}>
          {saving ? <Spinner /> : null} Save as new version
        </button>
        </div>
      </div>
      <div className="rte-page">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive("heading", { level: 1 })
        ? "h1"
        : e.isActive("heading", { level: 2 })
          ? "h2"
          : e.isActive("heading", { level: 3 })
            ? "h3"
            : "p",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      link: e.isActive("link"),
      left: e.isActive({ textAlign: "left" }),
      center: e.isActive({ textAlign: "center" }),
      right: e.isActive({ textAlign: "right" }),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();

  const setBlock = (v: string) => {
    if (v === "p") chain().setParagraph().run();
    else chain().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
  };

  const editLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL (leave empty to remove)", prev ?? "https://");
    if (url === null) return;
    if (!url.trim()) chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  return (
    <>
      <Btn label="Undo (⌘Z)" disabled={!s.canUndo} onClick={() => chain().undo().run()}>↶</Btn>
      <Btn label="Redo (⌘⇧Z)" disabled={!s.canRedo} onClick={() => chain().redo().run()}>↷</Btn>
      <Sep />
      <select className="rte-select" value={s.block} onChange={(e) => setBlock(e.target.value)} aria-label="Text style">
        <option value="p">Body text</option>
        <option value="h1">Name (Heading 1)</option>
        <option value="h2">Section (Heading 2)</option>
        <option value="h3">Role (Heading 3)</option>
      </select>
      <Sep />
      <Btn label="Bold (⌘B)" active={s.bold} onClick={() => chain().toggleBold().run()}><b>B</b></Btn>
      <Btn label="Italic (⌘I)" active={s.italic} onClick={() => chain().toggleItalic().run()}><i>I</i></Btn>
      <Btn label="Underline (⌘U)" active={s.underline} onClick={() => chain().toggleUnderline().run()}><u>U</u></Btn>
      <Btn label="Strikethrough" active={s.strike} onClick={() => chain().toggleStrike().run()}><s>S</s></Btn>
      <Sep />
      <Btn label="Bulleted list" active={s.bullet} onClick={() => chain().toggleBulletList().run()}>
        <Icon d="M6 4h8M6 8h8M6 12h8" dots />
      </Btn>
      <Btn label="Numbered list" active={s.ordered} onClick={() => chain().toggleOrderedList().run()}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>1.</span>
      </Btn>
      <Btn label="Decrease indent" disabled={!editor.can().liftListItem("listItem")} onClick={() => chain().liftListItem("listItem").run()}>⇤</Btn>
      <Btn label="Increase indent" disabled={!editor.can().sinkListItem("listItem")} onClick={() => chain().sinkListItem("listItem").run()}>⇥</Btn>
      <Sep />
      <Btn label="Align left" active={s.left} onClick={() => chain().setTextAlign("left").run()}><Icon d="M2 4h12M2 8h8M2 12h11" /></Btn>
      <Btn label="Center" active={s.center} onClick={() => chain().setTextAlign("center").run()}><Icon d="M2 4h12M4 8h8M3 12h10" /></Btn>
      <Btn label="Align right" active={s.right} onClick={() => chain().setTextAlign("right").run()}><Icon d="M2 4h12M6 8h8M3 12h11" /></Btn>
      <Sep />
      <Btn label="Link" active={s.link} onClick={editLink}><Icon d="M7 9l2-2M6 11l-1 1a2.1 2.1 0 0 1-3-3l2-2a2.1 2.1 0 0 1 3 0M10 5l1-1a2.1 2.1 0 0 1 3 3l-2 2a2.1 2.1 0 0 1-3 0" /></Btn>
      <Btn label="Divider line" onClick={() => chain().setHorizontalRule().run()}><Icon d="M2 8h12" /></Btn>
      <Btn label="Clear formatting" onClick={() => chain().unsetAllMarks().clearNodes().run()}>
        <span style={{ fontSize: 11 }}>T<sub>×</sub></span>
      </Btn>
    </>
  );
}

function Btn({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rte-btn ${active ? "on" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="rte-sep" aria-hidden />;

function Icon({ d, dots }: { d: string; dots?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d={d} />
      {dots && (
        <g fill="currentColor" stroke="none">
          <circle cx="2.5" cy="4" r="1.1" />
          <circle cx="2.5" cy="8" r="1.1" />
          <circle cx="2.5" cy="12" r="1.1" />
        </g>
      )}
    </svg>
  );
}
