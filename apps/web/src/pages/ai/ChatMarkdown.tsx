import Markdown from "react-markdown";

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="ai-markdown">
      <Markdown
        skipHtml
        allowedElements={[
          "p",
          "strong",
          "em",
          "ol",
          "ul",
          "li",
          "blockquote",
          "code",
          "pre",
          "h1",
          "h2",
          "h3",
          "h4",
          "hr",
          "br",
          "a",
        ]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
